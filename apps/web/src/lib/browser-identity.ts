import { AccountManager } from 'applesauce-accounts';
import { SessionAccount, disconnectedSigner, type SessionMetadata } from './session-account';
import { BrowserSessionVault, type SessionVault, type StoredSessions } from './session-vault';
import { ExtensionSigner } from 'applesauce-signers/signers/extension-signer';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readPrivateKey } from '../../../../packages/identity/src/key-material';
import { decryptRecovery, encryptRecovery } from './key-recovery';
import {
  AccountError,
  bunkerCredential,
  checkPubkey,
  openCredential,
  pairCredential,
  websiteKinds,
  type CreatorSigner,
  type Network,
  type RemoteCredential,
  type SignerOptions,
} from '../../../../packages/identity/src/signer';
import { verifiedEvent, type SignedEvent } from '../../../../packages/protocol/src';
import { browserConnectionName } from './connection-name';

type Template = Pick<SignedEvent, 'kind' | 'created_at' | 'tags' | 'content'>;
type Method = 'extension' | 'remote' | 'key';
export type IdentityState = {
  pubkey: string | null;
  method: Method | null;
  reconnect: boolean;
  authorization?: string;
  restoring?: boolean;
  warning?: string;
  sessions?: { id: string; pubkey: string; method: Method; remembered: boolean }[];
  activeId?: string;
};
const anonymous: IdentityState = { pubkey: null, method: null, reconnect: false };
type Active = {
  signer: CreatorSigner;
  account: SessionAccount;
  pubkey: string;
  method: Method;
  controller: AbortController;
  credential?: RemoteCredential;
  backupKey?: Uint8Array;
};
type Feedback = Pick<SignerOptions, 'onAuth'>;
type RememberChoice = boolean | (() => boolean);

/** One tab-local signer backed by Applesauce account selection and an encrypted device vault. */
export class BrowserIdentity {
  private active?: Active;
  readonly accounts = new AccountManager<SessionMetadata>();
  private loading?: Promise<StoredSessions>;
  private revision = 0;
  private generation = 0;
  private saving = Promise.resolve();
  private syncing?: Promise<void>;
  private initialized = false;
  private pending?: AbortController;
  private listeners = new Set<() => void>();
  state = anonymous;
  constructor(
    private network: Network = 'public',
    private vault?: SessionVault,
    private connectionName = browserConnectionName,
  ) {
    this.accounts.registerType(SessionAccount);
    vault?.subscribe?.((revision) => {
      if (revision > this.revision) void this.sync();
    });
  }
  private get saved() {
    return this.accounts.accounts as SessionAccount[];
  }
  private load() {
    return (this.loading ??= (async () => {
      let data: StoredSessions = { accounts: [], active: null, revision: 0 };
      try {
        data = (await this.vault?.load()) ?? data;
        const accounts = data.accounts
          .map((value) => SessionAccount.fromJSON(value as any))
          .filter((account) => account.metadata!.expires > Date.now());
        for (const old of this.saved) this.accounts.removeAccount(old.id);
        this.accounts.fromJSON(accounts.map((account) => account.toJSON()));
        this.revision = data.revision;
      } catch {
        for (const old of this.saved) this.accounts.removeAccount(old.id);
        data = { accounts: [], active: null, revision: this.revision };
        this.update({
          ...this.state,
          warning: 'Saved accounts could not be opened. You can still connect for this visit.',
        });
      }
      this.update(this.state);
      return data;
    })());
  }
  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    const generation = this.generation;
    this.update({ ...this.state, restoring: true });
    const data = await this.load();
    if (generation !== this.generation) return;
    if (data.active && this.accounts.getAccount(data.active)) {
      const account = this.accounts.getAccount(data.active) as SessionAccount;
      this.accounts.setActive(account);
      this.update({
        pubkey: account.pubkey,
        method: account.method,
        reconnect: true,
        restoring: true,
      });
      try {
        await this.useSession(data.active);
      } catch {
        this.update({
          ...this.state,
          restoring: false,
          warning: 'Your account is saved. Unlock or reconnect its signer to continue.',
        });
      }
    } else this.update({ ...this.state, restoring: false });
  }
  sync() {
    return (this.syncing ??= (async () => {
      await this.saving;
      await this.loading;
      const data = await this.vault?.load().catch(() => undefined);
      if (!data || data.revision <= this.revision) return;
      this.cancel();
      this.closeActive();
      this.accounts.clearActive();
      this.loading = undefined;
      this.initialized = false;
      this.update({ ...anonymous, restoring: true });
      await this.initialize();
    })().finally(() => {
      this.syncing = undefined;
    }));
  }
  private persist() {
    if (!this.vault) return Promise.resolve();
    const accounts = this.saved.filter(
      (account) => account.metadata?.remember && account.metadata.expires > Date.now(),
    );
    const value = {
      accounts: accounts.map((account) => account.toJSON()),
      active: accounts.some((a) => a.id === this.accounts.active?.id)
        ? this.accounts.active!.id
        : null,
    };
    const task = this.saving.then(async () => {
      this.revision = await this.vault!.save(value, this.revision);
    });
    this.saving = task.catch(() => {});
    return task.catch(() => {
      this.update({
        ...this.state,
        warning:
          'Could not save this session change. Keep this tab open, or reconnect after reloading. On a shared device, clear this site’s browser data if Forget fails.',
      });
      // A failed compare-and-swap must not overwrite a newer sign-out in another tab.
      void this.sync();
    });
  }
  private closeActive() {
    const old = this.active;
    this.active = undefined;
    old?.controller.abort();
    old?.backupKey?.fill(0);
    if (old) {
      old.account.abortQueue(new Error('Account disconnected.'));
      old.account.signer = disconnectedSigner;
    }
    void old?.signer.close();
  }
  async remember(remember: boolean) {
    const account = this.active?.account;
    if (!account) throw Error('Connect an account first.');
    account.metadata = { remember, expires: Date.now() + 30 * 86400000 };
    await this.persist();
    this.update(this.state);
  }
  async forget(id: string) {
    this.cancel();
    if (this.active?.account.id === id) this.closeActive();
    this.accounts.removeAccount(id);
    await this.persist();
    this.update(this.active ? this.state : { ...anonymous, warning: this.state.warning });
  }
  async useSession(id: string, feedback: Feedback = {}) {
    const account = this.accounts.getAccount(id) as SessionAccount | undefined;
    if (!account || !account.metadata || account.metadata.expires <= Date.now())
      throw Error('This saved session expired. Connect again.');
    if (account.method === 'extension') return this.extension(account.metadata.remember, account);
    if (account.material.method === 'key')
      return this.importKey(account.material.key, '', account.metadata.remember, account);
    const credential = account.credential!;
    return this.connect(
      'remote',
      async (signal) => ({
        credential,
        signer: await openCredential(credential, this.network, {
          signal,
          expectedPubkey: account.pubkey,
          kinds: websiteKinds,
          name: this.connectionName,
          ...this.feedback(feedback, signal),
        }),
      }),
      account.metadata.remember,
      account,
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(state: IdentityState) {
    this.state = {
      ...state,
      sessions: this.saved.map((a) => ({
        id: a.id,
        pubkey: a.pubkey,
        method: a.method,
        remembered: !!a.metadata?.remember,
      })),
      activeId: this.accounts.active?.id,
    };
    this.listeners.forEach((fn) => fn());
  }
  private feedback(feedback: Feedback, signal: AbortSignal): Feedback {
    return {
      onAuth: async (url) => {
        if (signal.aborted) throw new AccountError('SIGNER_CANCELLED', 'Signer session cancelled.');
        this.update({ ...this.state, authorization: url });
        await feedback.onAuth?.(url);
      },
    };
  }
  cancel() {
    this.generation++;
    this.pending?.abort();
    this.pending = undefined;
    this.update({ ...this.state, authorization: undefined, restoring: false });
  }
  disconnect() {
    this.cancel();
    this.closeActive();
    this.accounts.clearActive();
    for (const account of this.saved)
      if (!account.metadata?.remember) this.accounts.removeAccount(account.id);
    this.update(anonymous);
    return this.persist();
  }
  private async connect(
    method: Method,
    factory: (
      signal: AbortSignal,
    ) => Promise<{ signer: CreatorSigner; credential?: RemoteCredential; backupKey?: Uint8Array }>,
    remember: RememberChoice = true,
    existing?: SessionAccount,
  ) {
    this.cancel();
    const controller = new AbortController();
    this.pending = controller;
    await this.load();
    let opened: Awaited<ReturnType<typeof factory>> | undefined;
    try {
      if (controller.signal.aborted) throw new Error('Connection cancelled.');
      opened = await factory(controller.signal);
      const pubkey = checkPubkey(await opened.signer.getPublicKey(), 'local');
      if (this.pending !== controller || controller.signal.aborted)
        throw new Error('Connection cancelled.');
      if (existing && existing.pubkey !== pubkey)
        throw new Error('Your signer selected a different account. Connect it explicitly.');
      const account =
        existing ??
        this.saved.find((a) => a.pubkey === pubkey && a.method === method) ??
        new SessionAccount(pubkey, opened.signer);
      const changedSelection = !existing || this.accounts.active?.id !== existing.id;
      if (!this.accounts.getAccount(account.id) && this.saved.length >= 8)
        throw new Error('Forget a saved account before adding another (maximum eight).');
      // Remote approval can take minutes; use the choice at activation, not QR creation.
      const shouldRemember = typeof remember === 'function' ? remember() : remember;
      this.closeActive();
      account.signer = opened.signer;
      account.material =
        method === 'extension'
          ? { method: 'extension' }
          : method === 'remote'
            ? { method: 'remote', credential: opened.credential! }
            : { method: 'key', key: bytesToHex(opened.backupKey!) };
      account.metadata = {
        remember: shouldRemember,
        expires: existing?.metadata?.expires ?? Date.now() + 30 * 86400000,
      };
      if (!this.accounts.getAccount(account.id)) this.accounts.addAccount(account);
      this.active = { ...opened, account, pubkey, method, controller };
      this.accounts.setActive(account);
      this.pending = undefined;
      this.update({ pubkey, method, reconnect: false, restoring: false });
      if (changedSelection) await this.persist();
    } catch (error) {
      const cancelled = controller.signal.aborted;
      controller.abort();
      await opened?.signer.close();
      opened?.backupKey?.fill(0);
      if (this.pending === controller) this.pending = undefined;
      if (error instanceof AccountError) throw error;
      if (method === 'extension' && !cancelled)
        throw new Error(
          'Install or unlock a Nostr extension, approve access, and try again. You can also choose a remote signer.',
        );
      throw new Error(
        cancelled
          ? 'Connection cancelled or unavailable. Please retry.'
          : 'Could not connect. Please retry.',
      );
    }
  }
  extension(remember = true, existing?: SessionAccount) {
    return this.connect(
      'extension',
      async (signal) => {
        const extension = new ExtensionSigner();
        const bounded = async <T>(fn: () => Promise<T>) => {
          if (signal.aborted) throw new Error('Disconnected.');
          let timer: ReturnType<typeof setTimeout> | undefined;
          let abort = () => {};
          try {
            return await Promise.race([
              fn(),
              new Promise<never>((_, reject) => {
                abort = () => reject(new Error('Connection cancelled.'));
                signal.addEventListener('abort', abort, { once: true });
                timer = setTimeout(
                  () => reject(new Error('Unlock your browser extension and retry.')),
                  60000,
                );
              }),
            ]);
          } finally {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
          }
        };
        const pubkey = await bounded(() => extension.getPublicKey());
        return {
          signer: {
            getPublicKey: async () => pubkey,
            nip44: {
              encrypt: (peer, text) =>
                bounded(async () => {
                  if ((await extension.getPublicKey()) !== pubkey)
                    throw Error('Your extension account changed.');
                  if (!extension.nip44)
                    throw Error('This signer must support NIP-44 for the wallet.');
                  return extension.nip44.encrypt(peer, text);
                }),
              decrypt: (peer, text) =>
                bounded(async () => {
                  if ((await extension.getPublicKey()) !== pubkey)
                    throw Error('Your extension account changed.');
                  if (!extension.nip44)
                    throw Error('This signer must support NIP-44 for the wallet.');
                  return extension.nip44.decrypt(peer, text);
                }),
            },
            signEvent: (template) =>
              bounded(async () => {
                if ((await new ExtensionSigner().getPublicKey()) !== pubkey)
                  throw new Error('Your extension account changed. Connect again.');
                return extension.signEvent(template);
              }),
            close: async () => {},
          },
        };
      },
      remember,
      existing,
    );
  }
  importKey(input: string, password = '', remember = false, existing?: SessionAccount) {
    return this.connect(
      'key',
      async (signal) => {
        let key: Uint8Array | undefined;
        try {
          key = input.trim().startsWith('ncryptsec1')
            ? await decryptRecovery(input, password, signal)
            : readPrivateKey(input);
          return {
            signer: await openCredential({ type: 'local', key: bytesToHex(key) }, this.network, {
              signal,
              kinds: websiteKinds,
            }),
            backupKey: key,
          };
        } catch {
          key?.fill(0);
          throw new AccountError(
            'INVALID_KEY',
            'Use a valid nsec, hexadecimal key, or encrypted recovery key with its passphrase (scrypt logN 10–18).',
          );
        } finally {
          input = '';
          password = '';
        }
      },
      remember,
      existing,
    );
  }
  async backup(pubkey: string, password: string, signal?: AbortSignal) {
    const active = this.active;
    if (!active?.backupKey || active.pubkey !== pubkey)
      throw new Error('Only the private key held by this browser session can be backed up here.');
    const value = await encryptRecovery(active.backupKey, password, signal);
    if (this.active !== active || active.controller.signal.aborted || signal?.aborted)
      throw new Error('The account changed. Open backup again for the selected account.');
    return value;
  }
  bunker(uri: string, feedback: Feedback = {}, remember: RememberChoice = true) {
    return this.connect(
      'remote',
      async (signal) => {
        const credential = bunkerCredential(uri.trim(), this.network);
        uri = '';
        const signer = await openCredential(credential, this.network, {
          signal,
          kinds: websiteKinds,
          name: this.connectionName,
          ...this.feedback(feedback, signal),
        });
        delete credential.secret;
        return { signer, credential };
      },
      remember,
    );
  }
  pair(
    relays: string[],
    onPairing: (uri: string) => void,
    feedback: Feedback = {},
    remember: RememberChoice = true,
  ) {
    return this.connect(
      'remote',
      (signal) =>
        pairCredential(relays, this.network, {
          signal,
          kinds: websiteKinds,
          timeoutMs: 120000,
          name: this.connectionName,
          onPairing,
          ...this.feedback(feedback, signal),
        }),
      remember,
    );
  }
  reconnect(feedback: Feedback = {}) {
    const account = this.accounts.active as SessionAccount | undefined;
    if (!account) return Promise.reject(new Error('Choose a saved account or sign-in method.'));
    return this.useSession(account.id, feedback);
  }
  /** Self-encryption for the shell wallet. Does not expose a signer to iframe code. */
  async walletCrypt(pubkey: string, method: 'encrypt' | 'decrypt', value: string) {
    if (this.state.pubkey === pubkey && this.state.reconnect) await this.reconnect();
    const active = this.active;
    if (!active || active.pubkey !== pubkey || active.account.metadata!.expires <= Date.now())
      throw Error('Connect the wallet’s account first.');
    if (!active.account.nip44) throw Error('This signer must support NIP-44 for the wallet.');
    try {
      const result = await active.account.nip44[method](pubkey, value);
      if (this.active !== active || active.controller.signal.aborted)
        throw Error('Account changed.');
      return result;
    } catch {
      throw Error(
        `Wallet ${method === 'encrypt' ? 'encryption' : 'decryption'} did not complete. Unlock your NIP-44 signer and retry.`,
      );
    }
  }
  async sign(pubkey: string, event: Template) {
    if (this.state.pubkey === pubkey && this.state.reconnect) await this.reconnect();
    const active = this.active;
    if (!active || active.pubkey !== pubkey) throw new Error('Connect the correct account first.');
    if (active.account.metadata!.expires <= Date.now()) {
      await this.forget(active.account.id);
      throw new Error('This session expired. Connect again.');
    }
    if (!websiteKinds.includes(event.kind))
      throw new Error('This event kind is outside this session’s permissions.');
    const template = structuredClone({
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
    });
    const expected = JSON.stringify(template);
    try {
      const result = verifiedEvent(await active.account.signEvent(template));
      if (this.active !== active || active.controller.signal.aborted)
        throw new Error('The account disconnected. Please retry.');
      if (
        result.pubkey !== pubkey ||
        JSON.stringify({
          kind: result.kind,
          created_at: result.created_at,
          tags: result.tags,
          content: result.content,
        }) !== expected
      )
        throw new Error('The signer changed the requested event.');
      if (this.state.authorization) this.update({ ...this.state, authorization: undefined });
      return result;
    } catch {
      if (this.active === active) {
        // Refusal, timeout and cancelled prompts are retryable, not a logout.
        this.update({ ...this.state, authorization: undefined, reconnect: true });
      }
      throw new Error(
        'Signing did not complete. Your account is still selected; unlock your signer and retry.',
      );
    }
  }
}
let browser: BrowserIdentity | undefined;
export function browserIdentity() {
  if (typeof window === 'undefined') throw new Error('Sign-in is only available in the browser.');
  return (browser ??= new BrowserIdentity('public', new BrowserSessionVault()));
}
