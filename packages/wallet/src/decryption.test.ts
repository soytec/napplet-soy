import { expect, test } from 'bun:test';
import { EventStore } from 'applesauce-core';
import { getEncryptedContent } from 'applesauce-core/helpers';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner, type ISigner } from 'applesauce-signers';
import { WalletFactory, WalletTokenFactory } from 'applesauce-wallet/factories';
import type { NostrEvent } from 'nostr-tools';
import { ShellWallet } from './wallet';
import type { WalletStorage } from './types';

const wire = (event: NostrEvent): NostrEvent => JSON.parse(JSON.stringify(event));
async function fixture() {
  const signer = new PrivateKeySigner();
  const pubkey = await signer.getPublicKey();
  const values = new Map<string, string>();
  const storage: WalletStorage = {
    getItem: async (id) => values.get(id) ?? null,
    setItem: async (id, value) => {
      values.set(id, value);
    },
    removeItem: async (id) => {
      values.delete(id);
    },
  };
  let calls = 0;
  let decrypt = (peer: string, value: string) => signer.nip44.decrypt(peer, value);
  const counting: ISigner = {
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (event) => signer.signEvent(event),
    nip44: {
      encrypt: (peer, value) => signer.nip44.encrypt(peer, value),
      decrypt: async (peer, value) => {
        calls++;
        return decrypt(peer, value);
      },
    },
  };
  const walletEvent = wire(
    await WalletFactory.create(['https://mint.test'], undefined, ['wss://relay.test']).sign(signer),
  );
  const token = async () =>
    wire(
      await WalletTokenFactory.create({
        mint: 'https://mint.test',
        unit: 'sat',
        proofs: [{ id: '00abcdef', amount: 1, secret: crypto.randomUUID(), C: '02abcdef' }],
      }).sign(signer),
    );
  const open = (events: NostrEvent[]) => {
    const store = new EventStore();
    events.forEach((event) => store.add(wire(event)));
    return new ShellWallet(
      {
        pubkey,
        signer: counting,
        eventStore: store,
        pool: new RelayPool(),
        relays: ['wss://relay.test'],
        decryptionCache: storage,
        couch: { getAll: () => [], store: () => () => {}, remove: () => {}, clear: () => {} },
      },
      storage,
      () => {},
    );
  };
  return {
    signer,
    pubkey,
    values,
    storage,
    walletEvent,
    token,
    open,
    calls: () => calls,
    decryptWith: (fn: typeof decrypt) => {
      decrypt = fn;
    },
  };
}

test('fresh wallet instances restore wallet, tokens and history without signer decryption', async () => {
  const f = await fixture();
  const history = await f.signer.signEvent({
    kind: 7376,
    created_at: 1,
    tags: [],
    content: await f.signer.nip44.encrypt(
      f.pubkey,
      JSON.stringify([
        ['direction', 'in'],
        ['amount', '1'],
      ]),
    ),
  });
  const events = [f.walletEvent, await f.token(), history];
  const first = f.open(events);
  await first.unlock();
  expect(f.calls()).toBe(3);
  await first.lock();
  first.stop();
  const next = f.open(events);
  await next.unlock();
  expect(f.calls()).toBe(3);
  expect(next.satBalances()['https://mint.test']).toBe(1);
  next.eventStore.add(await f.token());
  await Promise.all([next.unlock(), next.unlock(), next.unlock()]);
  expect(f.calls()).toBe(4);
  next.stop();
});

test('successful decryptions persist even when a later signer request is denied', async () => {
  const f = await fixture();
  const token = await f.token();
  f.decryptWith(async (peer, value) => {
    if (value === token.content) throw Error('denied: secret bearer');
    return f.signer.nip44.decrypt(peer, value);
  });
  const wallet = f.open([f.walletEvent, token]);
  await expect(wallet.unlock()).rejects.toThrow('Unlock your signer and retry');
  expect(f.values.has(f.walletEvent.id)).toBe(true);
  expect(wallet.autoUnlock).toBe(false);
  wallet.stop();
  f.decryptWith((peer, value) => f.signer.nip44.decrypt(peer, value));
  const restarted = f.open([f.walletEvent, token]);
  await restarted.unlock();
  expect(f.calls()).toBe(3); // wallet + denial, then only the token
  restarted.stop();
});

test('unreadable cache never silently falls through to the signer', async () => {
  const f = await fixture();
  f.storage.getItem = async () => {
    throw Error('private storage detail');
  };
  const wallet = f.open([f.walletEvent]);
  await expect(wallet.unlock()).rejects.toThrow('cache could not be read');
  expect(f.calls()).toBe(0);
  wallet.stop();
});

test('failed cache writes are retryable without repeating signer decryption', async () => {
  const f = await fixture();
  const save = f.storage.setItem;
  f.storage.setItem = async () => {
    throw Error('quota: private bearer');
  };
  const wallet = f.open([f.walletEvent]);
  await expect(wallet.unlock()).rejects.toThrow('cache could not be saved');
  f.storage.setItem = save;
  await wallet.unlock();
  expect(f.calls()).toBe(1);
  expect(f.values.has(f.walletEvent.id)).toBe(true);
  wallet.stop();
});

test('an event arriving during unlock is drained by the same shared task', async () => {
  const f = await fixture();
  const token = await f.token();
  const wallet = f.open([f.walletEvent]);
  f.decryptWith(async (peer, value) => {
    if (value === f.walletEvent.content) wallet.eventStore.add(token);
    return f.signer.nip44.decrypt(peer, value);
  });
  await wallet.unlock();
  expect(f.calls()).toBe(2);
  expect(f.values.has(token.id)).toBe(true);
  wallet.stop();
});

test('closing during a signer request clears late plaintext and does not persist it', async () => {
  const f = await fixture();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.decryptWith(async (peer, value) => {
    entered();
    await waiting;
    return f.signer.nip44.decrypt(peer, value);
  });
  const wallet = f.open([f.walletEvent]);
  const unlocking = wallet.unlock();
  await started;
  wallet.stop();
  const locking = wallet.lock();
  release();
  await expect(unlocking).rejects.toThrow('Wallet closed');
  await locking;
  expect(getEncryptedContent(wallet.eventStore.getReplaceable(17375, f.pubkey)!)).toBeUndefined();
  expect(f.values.size).toBe(0);
});
