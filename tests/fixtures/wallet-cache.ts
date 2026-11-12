import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import { WalletFactory, WalletTokenFactory } from 'applesauce-wallet/factories';
import { WalletVault } from '../../apps/web/src/lib/wallet-storage';
import { ShellWallet } from '../../packages/wallet/src/wallet';

/** Isolated browser probe: real Web Crypto/IndexedDB, no relays or mint calls. */
export async function probe(cold: boolean) {
  const secret = new Uint8Array(32);
  secret[31] = 1;
  const signer = new PrivateKeySigner(secret);
  const pubkey = await signer.getPublicKey();
  const vault = new WalletVault(pubkey);
  let keyGenerations = 0,
    decryptions = 0;
  const generate = crypto.subtle.generateKey.bind(crypto.subtle);
  crypto.subtle.generateKey = ((...args: Parameters<typeof generate>) => {
    keyGenerations++;
    return generate(...args);
  }) as typeof generate;
  const decrypt = signer.nip44.decrypt;
  signer.nip44.decrypt = async (...args) => {
    decryptions++;
    return decrypt(...args);
  };
  try {
    if (cold) {
      const wallet = await WalletFactory.create(['https://mint.test'], undefined, [
        'wss://relay.test',
      ]).sign(signer);
      const token = await WalletTokenFactory.create({
        mint: 'https://mint.test',
        unit: 'sat',
        proofs: [{ id: '00abcdef', amount: 8, secret: 'browser-proof-secret', C: '02abcdef' }],
      }).sign(signer);
      await vault.setItem('test-events', JSON.stringify([wallet, token]));
    }
    const events = JSON.parse((await vault.getItem('test-events'))!);
    const store = new EventStore();
    events.forEach((event: Parameters<typeof store.add>[0]) => store.add(event));
    const wallet = new ShellWallet(
      {
        pubkey,
        signer,
        eventStore: store,
        pool: new RelayPool(),
        relays: ['wss://relay.test'],
        decryptionCache: vault,
        couch: { getAll: () => [], store: () => () => {}, clear: () => {}, remove: () => {} },
      },
      vault,
      () => {},
    );
    await Promise.all([wallet.unlock(), wallet.unlock()]);
    const balance = wallet.satBalances()['https://mint.test'];
    await wallet.lock();
    await wallet.unlock();
    wallet.stop();
    await wallet.lock();
    const other = new WalletVault('2'.repeat(64));
    const isolated = (await other.getItem(events[1].id)) === null;
    other.close();
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('napplet-wallet-v1');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction('data', 'readonly').objectStore('data').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return {
      balance,
      isolated,
      decryptions,
      keyGenerations,
      keyNonExportable: rows.some((row) => row instanceof CryptoKey && !row.extractable),
      noPlaintext: !JSON.stringify(rows).includes('browser-proof-secret'),
    };
  } finally {
    crypto.subtle.generateKey = generate;
    vault.close();
  }
}
