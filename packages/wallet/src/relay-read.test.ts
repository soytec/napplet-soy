import { expect, test } from 'bun:test';
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import { Subject } from 'rxjs';
import { verifySignature } from '../../protocol/src/verify';
import { readWalletEvents } from './relay-read';

async function fixture() {
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey();
  const store = new EventStore({ verifyEvent: verifySignature }),
    pool = new RelayPool();
  const fast = new Subject<any>(),
    slow = new Subject<any>();
  pool.relay = ((url: string) => ({
    url,
    req: () => (url.includes('fast') ? fast : slow),
  })) as unknown as typeof pool.relay;
  const options = {
    pool,
    store,
    pubkey,
    signer,
    relays: ['wss://fast.test/', 'wss://slow.test/'],
    filters: [{ authors: [pubkey], kinds: [17375, 7375, 7376, 5] }],
    assertAccount: () => {},
  };
  const event = await signer.signEvent({ kind: 17375, created_at: 1, tags: [], content: '' });
  return { ...options, options, event, fast, slow };
}

test('wallet read streams verified data and finishes without waiting for a silent relay deadline', async () => {
  const s = await fixture();
  const reading = readWalletEvents(s.options);
  s.fast.next({ type: 'EVENT', event: s.event });
  // Wallet data is available immediately, before EOSE or the slow relay.
  expect(s.store.getReplaceable(17375, s.pubkey)?.id).toBe(s.event.id);
  s.fast.next({ type: 'EOSE' });
  try {
    const result = await Promise.race([
      reading.then(() => 'loaded'),
      Bun.sleep(4000).then(() => 'still waiting for slow relay'),
    ]);
    expect(result).toBe('loaded');
    expect(s.slow.observed).toBe(false);
  } finally {
    s.slow.next({ type: 'EOSE' });
    await reading;
  }
});

test('empty first relay does not conceal a wallet or deletion arriving from another relay', async () => {
  const s = await fixture();
  let loaded = false;
  const reading = readWalletEvents(s.options).then(() => {
    loaded = true;
  });
  s.fast.next({ type: 'EOSE' });
  await Bun.sleep(3100);
  expect(loaded).toBe(false);
  s.slow.next({ type: 'EVENT', event: s.event });
  const token = await s.signer.signEvent({ kind: 7375, created_at: 1, tags: [], content: '' });
  const deletion = await s.signer.signEvent({
    kind: 5,
    created_at: 2,
    tags: [
      ['e', token.id],
      ['k', '7375'],
    ],
    content: '',
  });
  s.slow.next({ type: 'EVENT', event: token });
  s.slow.next({ type: 'EVENT', event: deletion });
  s.slow.next({ type: 'EOSE' });
  await reading;
  expect(s.store.getReplaceable(17375, s.pubkey)?.id).toBe(s.event.id);
  expect(s.store.hasEvent(token.id)).toBe(false);
});

test('wallet read fails safely when no relay completes and rejects unverified wallet data', async () => {
  const s = await fixture();
  const reading = readWalletEvents(s.options);
  s.fast.next({ type: 'EVENT', event: { ...s.event, content: 'tampered' } });
  expect(s.store.getReplaceable(17375, s.pubkey)).toBeUndefined();
  s.fast.error(Error('private transport details'));
  s.slow.error(Error('unreachable'));
  await expect(reading).rejects.toThrow('No wallet relay completed');
});
