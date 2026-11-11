import { WalletError } from '../../../../packages/wallet/src/errors';
import type { WalletStorage } from '../../../../packages/wallet/src/types';

const databaseName = 'napplet-wallet-v1';
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(new WalletError('Wallet storage could not be read.'));
  });
function done(tx: IDBTransaction) {
  const promise = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(
        new WalletError('Wallet storage could not be saved. Free disk space before retrying.'),
      );
  });
  void promise.catch(() => {});
  return promise;
}
/** Account-separated, device-encrypted journal and decryption cache. No plaintext Web Storage.
 * The non-exportable key protects data at rest, not against same-origin malicious scripts. */
export class WalletVault implements WalletStorage {
  private connection?: Promise<IDBDatabase>;
  private deviceKey?: Promise<CryptoKey>;
  private closed = false;
  constructor(readonly pubkey: string) {
    if (!/^[a-f0-9]{64}$/.test(pubkey)) throw new WalletError('Invalid wallet account.');
  }
  private db() {
    if (this.closed) throw new WalletError('Wallet storage is closed. Reopen the wallet.');
    return (this.connection ??= new Promise((resolve, reject) => {
      const r = indexedDB.open(databaseName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('data');
      r.onsuccess = () => {
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
      r.onerror = r.onblocked = () =>
        reject(
          new WalletError('Encrypted wallet storage is unavailable. Close older tabs and retry.'),
        );
    }));
  }
  private context(key: string) {
    return new TextEncoder().encode(`${location.origin}:${this.pubkey}:${key}`);
  }
  private key() {
    if (this.closed) throw new WalletError('Wallet storage is closed. Reopen the wallet.');
    return (this.deviceKey ??= this.loadKey().catch((error) => {
      this.deviceKey = undefined;
      throw error;
    }));
  }
  private async loadKey() {
    const db = await this.db();
    const read = db.transaction('data', 'readonly'),
      readComplete = done(read),
      id = `${this.pubkey}:key`;
    const existing: CryptoKey | undefined = await request(read.objectStore('data').get(id));
    await readComplete;
    if (existing) return existing;
    // Generate outside the transaction, then recheck atomically: another vault
    // may have initialized this account while Web Crypto was running.
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    const tx = db.transaction('data', 'readwrite'),
      complete = done(tx),
      store = tx.objectStore('data');
    let key: CryptoKey = await request(store.get(id));
    if (!key) {
      key = candidate;
      store.put(key, id);
    }
    await complete;
    return key;
  }
  async getItem(id: string) {
    const db = await this.db();
    const tx = db.transaction('data', 'readonly'),
      complete = done(tx);
    const value = await request(tx.objectStore('data').get(`${this.pubkey}:${id}`));
    await complete;
    if (!value) return null;
    try {
      const bytes = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: value.iv, additionalData: this.context(id) },
        await this.key(),
        value.ciphertext,
      );
      return new TextDecoder().decode(bytes);
    } catch {
      throw new WalletError(
        'Wallet storage cannot be decrypted. Restore your encrypted backup; do not clear browser data.',
      );
    }
  }
  async setItem(id: string, value: string) {
    const key = await this.key(),
      iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: this.context(id) },
      key,
      new TextEncoder().encode(value),
    );
    const db = await this.db(),
      tx = db.transaction('data', 'readwrite'),
      complete = done(tx);
    tx.objectStore('data').put({ iv, ciphertext }, `${this.pubkey}:${id}`);
    await complete;
  }
  async removeItem(id: string) {
    const db = await this.db(),
      tx = db.transaction('data', 'readwrite'),
      complete = done(tx);
    tx.objectStore('data').delete(`${this.pubkey}:${id}`);
    await complete;
  }
  close() {
    this.closed = true;
    this.deviceKey = undefined;
    void this.connection?.then(
      (db) => db.close(),
      () => {},
    );
    this.connection = undefined;
  }
}
