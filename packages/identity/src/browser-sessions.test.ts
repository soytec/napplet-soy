import { test, expect } from 'bun:test';
import { getPublicKey } from 'nostr-tools';
import { BrowserIdentity } from '../../../apps/web/src/lib/browser-identity';
import {
  type SessionSnapshot,
  type SessionVault,
  type StoredSessions,
} from '../../../apps/web/src/lib/session-vault';

const key = '1'.padStart(64, '0');
const other = '2'.padStart(64, '0');
const pubkey = getPublicKey(Uint8Array.from(Buffer.from(key, 'hex')));
const template = { kind: 7, created_at: 1, content: '+', tags: [] };
class MemoryVault implements SessionVault {
  data: StoredSessions = { accounts: [], active: null, revision: 0 };
  async load() {
    return structuredClone(this.data);
  }
  async save(value: SessionSnapshot, revision: number) {
    if (revision !== this.data.revision) throw Error('Concurrent session change');
    this.data = { ...structuredClone(value), revision: revision + 1 };
    return this.data.revision;
  }
}
test('remembered Applesauce accounts restore and sign the exact event without rewriting the vault', async () => {
  const vault = new MemoryVault(),
    first = new BrowserIdentity('local', vault);
  await first.importKey(key, '', true);
  expect(first.accounts.active?.pubkey).toBe(pubkey);
  const second = new BrowserIdentity('local', vault);
  await second.initialize();
  expect(second.state.pubkey).toBe(pubkey);
  expect(vault.data.revision).toBe(1);
  expect(await second.sign(pubkey, template)).toMatchObject({ ...template, pubkey });
  expect(
    await second.sign(pubkey, { ...template, kind: 1, content: 'A napplet for your feed.' }),
  ).toMatchObject({ kind: 1, content: 'A napplet for your feed.', pubkey });
  expect(await second.sign(pubkey, { ...template, kind: 30617 })).toMatchObject({
    kind: 30617,
    pubkey,
  });
  expect(() => second.sign(pubkey, { ...template, kind: 9999 })).toThrow('permissions');
  await second.initialize(); // Provider remount must not duplicate or reopen accounts.
  expect(second.state.sessions).toHaveLength(1);
  expect(vault.data.revision).toBe(1);
});
test('sign-out and forgetting synchronize across tabs without resurrecting removed accounts', async () => {
  const vault = new MemoryVault(),
    a = new BrowserIdentity('local', vault);
  await a.importKey(key, '', true);
  const b = new BrowserIdentity('local', vault);
  await b.initialize();
  await a.disconnect();
  await b.sync();
  expect(b.state.pubkey).toBeNull();
  expect(b.state.sessions).toHaveLength(1);
  expect(vault.data.active).toBeNull();
  expect(vault.data.revision).toBe(2);
  const id = b.state.sessions![0].id;
  await b.useSession(id);
  await a.sync();
  expect(a.state.pubkey).toBe(pubkey);
  await b.forget(id);
  await a.sync();
  expect(a.state.pubkey).toBeNull();
  expect(a.state.sessions).toEqual([]);
  expect(vault.data.accounts).toEqual([]);
});
test('private keys are temporary unless explicitly remembered; switching binds signatures to the selected identity', async () => {
  const vault = new MemoryVault(),
    a = new BrowserIdentity('local', vault);
  await a.importKey(key);
  expect(vault.data.accounts).toEqual([]);
  expect((await a.sign(pubkey, template)).pubkey).toBe(pubkey);
  await a.importKey(other, '', true);
  expect(() => a.sign(pubkey, template)).toThrow('correct account');
  const original = a.state.sessions!.find((s) => s.pubkey === pubkey)!;
  await a.useSession(original.id);
  expect((await a.sign(pubkey, template)).pubkey).toBe(pubkey);
  await a.disconnect();
  expect(a.state.sessions).toHaveLength(1);
  expect(a.state.sessions![0].pubkey).not.toBe(pubkey);
});
test('expired sessions cannot silently restore or sign', async () => {
  const vault = new MemoryVault(),
    a = new BrowserIdentity('local', vault);
  await a.importKey(key, '', true);
  (vault.data.accounts[0] as any).metadata.expires = Date.now() - 1;
  const b = new BrowserIdentity('local', vault);
  await b.initialize();
  expect(b.state.pubkey).toBeNull();
  expect(b.state.sessions).toEqual([]);
  a.accounts.active!.metadata!.expires = Date.now() - 1;
  expect(() => a.sign(pubkey, template)).toThrow('expired');
});
test('storage failures retain a usable visit-only signer and expose a warning', async () => {
  const a = new BrowserIdentity('local', {
    load: async () => {
      throw Error('Unavailable');
    },
    save: async () => {
      throw Error('Quota');
    },
  });
  await a.importKey(key, '', true);
  expect(a.state.pubkey).toBe(pubkey);
  expect(a.state.warning).toContain('Could not save');
  expect((await a.sign(pubkey, template)).pubkey).toBe(pubkey);
});
test('stale writes cannot overwrite a newer cross-tab sign-out', async () => {
  const vault = new MemoryVault(),
    a = new BrowserIdentity('local', vault);
  await a.importKey(key, '', true);
  const b = new BrowserIdentity('local', vault);
  await b.initialize();
  await a.disconnect();
  await b.importKey(other, '', true); // CAS fails; newer vault state wins.
  await b.sync();
  expect(vault.data.active).toBeNull();
  expect(b.state.pubkey).toBeNull();
  expect(b.state.sessions).toHaveLength(1);
});

test('signer refusals retain selection and late signatures cannot survive switching or sign-out', async () => {
  const vault = new MemoryVault(),
    a = new BrowserIdentity('local', vault);
  await a.importKey(key, '', true);
  const signer = (a.accounts.active as any).signer;
  signer.signEvent = async () => {
    throw Error('User refused');
  };
  expect(() => a.sign(pubkey, template)).toThrow('still selected');
  expect(a.state.pubkey).toBe(pubkey);
  expect(a.state.reconnect).toBe(true);
  expect((await a.sign(pubkey, template)).pubkey).toBe(pubkey); // Same saved key reopens.
  let finish: (() => void) | undefined;
  const activeSigner = (a.accounts.active as any).signer;
  const late = await activeSigner.signEvent(template);
  activeSigner.signEvent = () =>
    new Promise((resolve) => {
      finish = () => resolve(late);
    });
  const pending = a.sign(pubkey, template);
  const rejected = pending.catch(() => 'discarded');
  await a.importKey(other, '', true);
  finish!();
  expect(await rejected).toBe('discarded');
  expect(a.state.pubkey).not.toBe(pubkey);
  expect(a.state.reconnect).toBe(false);
});

test('a failed Forget keeps its warning visible and cannot claim stored credentials were erased', async () => {
  const vault = new MemoryVault(),
    a = new BrowserIdentity('local', vault);
  await a.importKey(key, '', true);
  const id = a.state.activeId!;
  vault.save = async () => {
    throw Error('Storage unavailable');
  };
  await a.forget(id);
  expect(a.state.pubkey).toBeNull();
  expect(a.state.warning).toContain('if Forget fails');
  expect(vault.data.accounts).toHaveLength(1);
});
