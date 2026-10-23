import { test, expect } from 'bun:test';
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import { PrivateKeySigner } from 'applesauce-signers';
import { WalletFactory, WalletTokenFactory } from 'applesauce-wallet/factories';
import {
  getWalletPrivateKey,
  getTokenContent,
  unlockTokenContent,
} from 'applesauce-wallet/helpers';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { getEncodedToken, getDecodedToken, sumProofs } from '@cashu/cashu-ts';
import { ShellWallet } from './wallet';
import { TestMint, testInvoice } from './fixture';
import type { WalletStorage } from './types';
import { verifySignature } from '../../protocol/src/verify';

class MemoryStore implements WalletStorage {
  values = new Map<string, string>();
  fail = false;
  async getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  async setItem(k: string, v: string) {
    if (this.fail) throw Error('Disk full: private bearer');
    this.values.set(k, v);
  }
  async removeItem(k: string) {
    this.values.delete(k);
  }
}
async function setup(mint = new TestMint(), fund = 64) {
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey(),
    store = new EventStore({ verifyEvent: verifySignature }),
    pool = new RelayPool(),
    storage = new MemoryStore();
  const published: any[] = [];
  const destinations: { kind: number; relays: string[] }[] = [];
  let reject = false,
    connected = true;
  pool.publish = async (_relays, event) => {
    destinations.push({ kind: event.kind, relays: Array.isArray(_relays) ? _relays : [] });
    if (!reject) published.push(event);
    return [{ from: 'wss://relay.test/', ok: !reject, message: reject ? 'blocked' : 'saved' }];
  };
  const cashu = await mint.wallet();
  class UnderTest extends ShellWallet {
    override async cashu() {
      return cashu;
    }
    override resync() {}
    override async inspectMint() {
      return { name: 'Mock', nutzaps: true };
    }
  }
  const wallet = new UnderTest(
    {
      pubkey,
      signer,
      eventStore: store,
      pool,
      relays: ['wss://relay.test'],
      couch: { getAll: () => [], store: () => () => {}, remove: () => {}, clear: () => {} },
    },
    storage,
    () => {
      if (!connected) throw Error('Account changed');
    },
  );
  store.add(
    await WalletFactory.create([mint.url], generateSecretKey(), ['wss://relay.test']).sign(signer),
  );
  if (fund)
    store.add(
      await WalletTokenFactory.create({
        mint: mint.url,
        unit: 'sat',
        proofs: await mint.fund(fund),
      }).sign(signer),
    );
  await wallet.unlock();
  return {
    wallet,
    mint,
    store,
    storage,
    signer,
    pubkey,
    published,
    destinations,
    pool,
    reject: (v: boolean) => {
      reject = v;
    },
    disconnect: () => {
      connected = false;
    },
  };
}
test('Cashu send persists outputs before swapping; preserves unselected proofs, history and encrypted NIP-60 events', async () => {
  const s = await setup();
  // Multiple disjoint proofs force cashu-ts to leave some inputs unselected.
  s.store.add(
    await WalletTokenFactory.create({
      mint: s.mint.url,
      unit: 'sat',
      proofs: await s.mint.fund(8),
    }).sign(s.signer),
  );
  await s.wallet.unlock();
  const tx = await s.wallet.prepareSend(s.mint.url, 8);
  expect(tx.unselected?.length).toBeGreaterThan(0);
  expect(s.mint.swaps).toBe(0);
  await expect(s.wallet.resume(tx.id)).rejects.toThrow('Review and confirm');
  s.mint.beforeMutation = async () => {
    const saved = await s.wallet.journal.get(tx.id);
    expect(saved.status).toBe('pending');
    expect(saved.swap?.sendOutputs?.length).toBeGreaterThan(0);
  };
  const result = await s.wallet.resume(tx.id, true);
  expect(result.status).toBe('complete');
  expect(s.wallet.satBalances()[s.mint.url]).toBe(64);
  expect(sumProofs(getDecodedToken(result.token!, [s.mint.id]).proofs).toNumber()).toBe(8);
  const history = s.published.find((e) => e.kind === 7376);
  const tags = JSON.parse(await s.signer.nip44.decrypt(s.pubkey, history.content));
  expect(tags).toContainEqual(['type', 'send']);
  expect(tags.filter((t: string[]) => t[3] === 'destroyed')).toHaveLength(2);
  expect(s.published.some((e) => e.kind === 5)).toBe(true);
  expect(s.published.every(verifySignature)).toBe(true);
  expect(JSON.stringify(s.published)).not.toContain(
    getDecodedToken(result.token!, [s.mint.id]).proofs[0].secret,
  );
  await s.wallet.resume(tx.id, true);
  expect(s.mint.swaps).toBe(1);
});
test('all-funds Cashu send can save empty change and delete the old balance', async () => {
  const s = await setup(undefined, 8),
    tx = await s.wallet.prepareSend(s.mint.url, 8);
  await s.wallet.resume(tx.id, true);
  expect(s.wallet.satBalances()[s.mint.url] ?? 0).toBe(0);
});
test('lost swap response restores the identical outputs with NUT-09', async () => {
  const s = await setup(),
    tx = await s.wallet.prepareSend(s.mint.url, 10);
  s.mint.dropSwap = true;
  const result = await s.wallet.resume(tx.id, true);
  expect(result.status).toBe('complete');
  expect(s.wallet.satBalances()[s.mint.url]).toBe(54);
  expect(s.mint.swaps).toBe(1);
});
test('disk failure stops a mint mutation; account changes stop spending', async () => {
  const s = await setup(),
    tx = await s.wallet.prepareSend(s.mint.url, 10);
  s.storage.fail = true;
  await expect(s.wallet.resume(tx.id, true)).rejects.toThrow();
  expect(s.mint.swaps).toBe(0);
  s.storage.fail = false;
  s.disconnect();
  await expect(s.wallet.resume(tx.id, true)).rejects.toThrow('Account changed');
  expect(s.mint.swaps).toBe(0);
});
test('relay rejection retains signed events; retry does not swap a second time', async () => {
  const s = await setup(),
    tx = await s.wallet.prepareSend(s.mint.url, 10);
  s.reject(true);
  await expect(s.wallet.resume(tx.id, true)).rejects.toThrow('No relay acknowledged');
  const signed = (await s.wallet.journal.get(tx.id)).events!;
  expect(await s.storage.getItem('outbox')).not.toBeNull();
  s.reject(false);
  await s.wallet.resume(tx.id);
  expect(s.mint.swaps).toBe(1);
  expect(s.published.map((e) => e.id)).toContain(signed[0].id);
});
test('deposit polling mints exactly once and recovers a lost mint response', async () => {
  const s = await setup(undefined, 0);
  await s.wallet.deposit(s.mint.url, 32);
  const tx = s.wallet.transactions$.value[0];
  expect((await s.wallet.resume(tx.id)).status).toBe('invoice');
  s.mint.deposits.get(tx.quote!).state = 'PAID';
  s.mint.dropMint = true;
  await s.wallet.resume(tx.id);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(32);
  await s.wallet.resume(tx.id);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(32);
});
test('Lightning payment recovers paid quote after lost response, without paying twice', async () => {
  const s = await setup(),
    tx = await s.wallet.preparePayment(s.mint.url, testInvoice(8));
  s.mint.dropMelt = true;
  await expect(s.wallet.resume(tx.id, true)).rejects.toThrow('recovery data');
  const result = await s.wallet.resume(tx.id);
  expect(result.preimage).toBe('07'.repeat(32));
  expect(result.fee).toBe(1);
  expect(s.mint.meltCalls).toBe(1);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(55);
  await expect(s.wallet.preparePayment(s.mint.url, tx.invoice!)).rejects.toThrow('already has');
});
test('pending Lightning cannot be reclaimed; failed unpaid payment can', async () => {
  const s = await setup(),
    tx = await s.wallet.preparePayment(s.mint.url, testInvoice(8));
  s.mint.pendingMelt = true;
  expect((await s.wallet.resume(tx.id, true)).status).toBe('pending');
  await expect(s.wallet.reclaimPayment(tx.id)).rejects.toThrow('in flight');
  await expect(s.wallet.prepareSend(s.mint.url, 1)).rejects.toThrow('pending transaction');
  s.mint.melts.get(tx.quote!).state = 'UNPAID';
  s.mint.pendingMelt = false;
  const result = await s.wallet.reclaimPayment(tx.id);
  expect(result.recovered).toBe(true);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(64);
  expect(s.mint.meltCalls).toBe(1);
});
test('nutzap uses the dedicated P2PK key, DLEQ, stable address and exact advertised mint; recipient can redeem', async () => {
  const mint = new TestMint(),
    sender = await setup(mint),
    receiver = await setup(mint, 0);
  const info = await receiver.signer.signEvent({
    kind: 10019,
    created_at: 1,
    content: '',
    tags: [
      [
        'pubkey',
        getPublicKey(getWalletPrivateKey(receiver.store.getReplaceable(17375, receiver.pubkey)!)!),
      ],
      ['relay', 'wss://relay.test'],
      ['mint', mint.url, 'sat'],
    ],
  });
  receiver.store.add(info);
  const target = await receiver.signer.signEvent({
    kind: 35129,
    created_at: 1,
    content: '',
    tags: [['d', 'test']],
  });
  const recipientRelays = await receiver.signer.signEvent({
    kind: 10002,
    created_at: 1,
    content: '',
    tags: [
      ['r', 'wss://reader.test', 'read'],
      ['r', 'wss://writer.test', 'write'],
    ],
  });
  const senderRelays = await sender.signer.signEvent({
    kind: 10002,
    created_at: 1,
    content: '',
    tags: [['r', 'wss://sender-reader.test']],
  });
  const tx = await sender.wallet.prepareSend(
    mint.url,
    12,
    info,
    target,
    'Thanks!',
    recipientRelays,
  );
  await sender.wallet.resume(tx.id, true);
  const nut = sender.published.find((e) => e.kind === 9321);
  expect(nut.tags).toContainEqual(['a', `35129:${receiver.pubkey}:test`]);
  const token = await receiver.wallet.validateNutzap(nut),
    received = await receiver.wallet.prepareReceive(token, nut, senderRelays);
  await receiver.wallet.resume(received.id, true);
  expect(receiver.wallet.satBalances()[mint.url]).toBe(12);
  expect(sender.wallet.satBalances()[mint.url]).toBe(52);
  const history = receiver.published.find((e) => e.kind === 7376);
  expect(history.tags).toContainEqual(['e', nut.id, '', 'redeemed']);
  expect(sender.destinations.find((d) => d.kind === 9321)?.relays).toEqual([
    'wss://relay.test/',
    'wss://reader.test/',
  ]);
  expect(receiver.destinations.find((d) => d.kind === 7376)?.relays).toEqual([
    'wss://relay.test/',
    'wss://sender-reader.test/',
  ]);
  expect(
    receiver.destinations
      .filter((d) => d.kind !== 7376)
      .every((d) => !d.relays.includes('wss://sender-reader.test/')),
  ).toBe(true);
  await expect(receiver.wallet.validateNutzap(nut)).rejects.toThrow('already been redeemed');
});

test('wallet configuration saves a recoverable reference and preserves the receiving key', async () => {
  const s = await setup(undefined, 0);
  const key = getWalletPrivateKey(s.store.getReplaceable(17375, s.pubkey)!);
  await s.wallet.configure([s.mint.url], ['wss://relay.test'], true);
  const reference = JSON.parse((await s.storage.getItem('wallet-reference'))!);
  expect(reference.kind).toBe(17375);
  expect(verifySignature(reference)).toBe(true);
  expect(getWalletPrivateKey(s.store.getReplaceable(17375, s.pubkey)!)).toEqual(key);
});
test('mint removal refuses balances and incomplete transactions; sat balance excludes other units', async () => {
  const s = await setup();
  await expect(
    s.wallet.configure(['https://other.test'], ['wss://relay.test'], false),
  ).rejects.toThrow('balance');
  s.store.add(
    await WalletTokenFactory.create({
      mint: s.mint.url,
      unit: 'usd',
      proofs: await s.mint.fund(32),
    }).sign(s.signer),
  );
  await s.wallet.unlock();
  expect(s.wallet.satBalances()[s.mint.url]).toBe(64);
});

test('nonzero input fees include receiver and melt costs in the reviewed maximum debit', async () => {
  const s = await setup(new TestMint(1000), 128);
  const receiver = await setup(s.mint, 0);
  const info = await receiver.signer.signEvent({
    kind: 10019,
    created_at: 1,
    content: '',
    tags: [
      [
        'pubkey',
        getPublicKey(getWalletPrivateKey(receiver.store.getReplaceable(17375, receiver.pubkey)!)!),
      ],
      ['relay', 'wss://relay.test'],
      ['mint', s.mint.url, 'sat'],
    ],
  });
  receiver.store.add(info);
  const tx = await s.wallet.prepareSend(s.mint.url, 8, info);
  expect(tx.fee).toBeGreaterThan(1);
  const result = await s.wallet.resume(tx.id, true);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(128 - tx.amount - tx.fee);
  const nut = s.published.find((e) => e.kind === 9321),
    token = await receiver.wallet.validateNutzap(nut);
  const receive = await receiver.wallet.prepareReceive(token, nut);
  expect(receive.amount).toBe(8);
  await receiver.wallet.resume(receive.id, true);
  expect(receiver.wallet.satBalances()[s.mint.url]).toBe(8);
  const before = s.wallet.satBalances()[s.mint.url],
    payment = await s.wallet.preparePayment(s.mint.url, testInvoice(8));
  const paid = await s.wallet.resume(payment.id, true);
  expect(paid.fee).toBeLessThanOrEqual(payment.fee);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(before - paid.amount - paid.fee);
});

test('a restored journal recovers identical proofs after a process restart and rejected relay save', async () => {
  const s = await setup(),
    tx = await s.wallet.prepareSend(s.mint.url, 9);
  s.reject(true);
  await expect(s.wallet.resume(tx.id, true)).rejects.toThrow('No relay');
  s.wallet.stop();
  const restart = await setup(s.mint, 0);
  // Reconstruct with the original identity and encrypted relay snapshot, but no old instance state.
  class Reopened extends ShellWallet {
    override async cashu() {
      return s.mint.wallet();
    }
    override resync() {}
  }
  const wallet = new Reopened(
    {
      pubkey: s.pubkey,
      signer: s.signer,
      eventStore: s.store,
      pool: restart.pool,
      relays: ['wss://relay.test'],
      couch: { getAll: () => [], store: () => () => {}, remove: () => {}, clear: () => {} },
    },
    s.storage,
    () => {},
  );
  await wallet.unlock();
  const done = await wallet.resume(tx.id);
  expect(done.status).toBe('complete');
  expect(s.mint.swaps).toBe(1);
  expect(wallet.satBalances()[s.mint.url]).toBe(55);
});

test('nutzap rejects forged proofs, duplicate proofs, a foreign lock and unrelated redeemed token', async () => {
  const mint = new TestMint(),
    sender = await setup(mint),
    receiver = await setup(mint, 0);
  const info = await receiver.signer.signEvent({
    kind: 10019,
    created_at: 1,
    content: '',
    tags: [
      [
        'pubkey',
        getPublicKey(getWalletPrivateKey(receiver.store.getReplaceable(17375, receiver.pubkey)!)!),
      ],
      ['relay', 'wss://relay.test'],
      ['mint', mint.url, 'sat'],
    ],
  });
  receiver.store.add(info);
  await sender.wallet.resume((await sender.wallet.prepareSend(mint.url, 8, info)).id, true);
  const nut = sender.published.find((e) => e.kind === 9321);
  const duplicate = await sender.signer.signEvent({
    ...nut,
    tags: [...nut.tags, nut.tags.find((t: string[]) => t[0] === 'proof')],
  });
  await expect(receiver.wallet.validateNutzap(duplicate)).rejects.toThrow('repeats');
  const forge = async (change: (p: any) => void) =>
    sender.signer.signEvent({
      ...nut,
      tags: nut.tags.map((tag: string[]) => {
        if (tag[0] !== 'proof') return tag;
        const p = JSON.parse(tag[1]);
        change(p);
        return ['proof', JSON.stringify(p)];
      }),
    });
  await expect(
    receiver.wallet.validateNutzap(
      await forge((p) => {
        delete p.dleq;
      }),
    ),
  ).rejects.toThrow('DLEQ');
  await expect(
    receiver.wallet.validateNutzap(
      await forge((p) => {
        const secret = JSON.parse(p.secret);
        secret[1].data = '02' + sender.pubkey;
        p.secret = JSON.stringify(secret);
      }),
    ),
  ).rejects.toThrow('lock');
  const unrelated = getEncodedToken({ mint: mint.url, unit: 'sat', proofs: await mint.fund(8) });
  await expect(receiver.wallet.prepareReceive(unrelated, nut)).rejects.toThrow('does not match');
  expect(mint.swaps).toBe(1);
});

test('outgoing nutzap must be acknowledged by a recipient relay, never only a wallet relay', async () => {
  const s = await setup();
  const other = new PrivateKeySigner(),
    key = getPublicKey(generateSecretKey());
  const info = await other.signEvent({
    kind: 10019,
    created_at: 1,
    content: '',
    tags: [
      ['pubkey', key],
      ['mint', s.mint.url, 'sat'],
      ['relay', 'wss://recipient.test'],
    ],
  });
  const tx = await s.wallet.prepareSend(s.mint.url, 4, info);
  await expect(s.wallet.resume(tx.id, true)).rejects.toThrow('No relay');
  const outbox = JSON.parse((await s.storage.getItem('outbox'))!);
  expect(outbox.items.find((i: any) => i.event.kind === 9321).relays).toEqual([
    'wss://recipient.test/',
  ]);
  expect(
    outbox.items
      .filter((i: any) => i.event.kind !== 9321)
      .every((i: any) => !i.relays.includes('wss://recipient.test/')),
  ).toBe(true);
});

test('deposit settlement survives expiry and hides the invoice before relay sync completes', async () => {
  const s = await setup(undefined, 0);
  await s.wallet.deposit(s.mint.url, 21);
  const tx = s.wallet.transactions$.value[0];
  tx.quoteExpires = Math.floor(Date.now() / 1000) - 1;
  await s.wallet.journal.put(tx);
  s.mint.deposits.get(tx.quote!).state = 'PAID';
  s.reject(true);
  await expect(s.wallet.checkSettlement(tx.id)).rejects.toThrow('No relay acknowledged');
  const pending = await s.wallet.journal.get(tx.id);
  expect(pending.quoteState).toBe('PAID');
  expect(pending.status).toBe('pending');
  s.reject(false);
  const completed = await s.wallet.checkSettlement(tx.id);
  expect(completed.status).toBe('complete');
  expect(s.wallet.satBalances()[s.mint.url]).toBe(21);
});

test('background settlement checks never approve or replay outgoing payments', async () => {
  const s = await setup(),
    tx = await s.wallet.preparePayment(s.mint.url, testInvoice(8));
  expect((await s.wallet.checkSettlement(tx.id)).status).toBe('review');
  expect(s.mint.swaps).toBe(0);
  s.mint.pendingMelt = true;
  await s.wallet.resume(tx.id, true);
  expect((await s.wallet.checkSettlement(tx.id)).status).toBe('pending');
  s.mint.melts.get(tx.quote!).state = 'UNPAID';
  await s.wallet.checkSettlement(tx.id);
  expect(s.mint.meltCalls).toBe(1);
  expect(s.mint.swaps).toBe(1);
});

test('a lost successful Lightning response is settled by polling exactly once', async () => {
  const s = await setup(),
    tx = await s.wallet.preparePayment(s.mint.url, testInvoice(8));
  s.mint.dropMelt = true;
  await expect(s.wallet.resume(tx.id, true)).rejects.toThrow('recovery data');
  expect((await s.wallet.checkSettlement(tx.id)).status).toBe('complete');
  await s.wallet.checkSettlement(tx.id);
  expect(s.mint.meltCalls).toBe(1);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(55);
});

test('Cashu redemption checks distinguish unspent, partial and redeemed without spending', async () => {
  const s = await setup(),
    tx = await s.wallet.prepareSend(s.mint.url, 7);
  const sent = await s.wallet.resume(tx.id, true);
  const proofs = getDecodedToken(sent.token!, [s.mint.id]).proofs;
  expect(proofs.length).toBeGreaterThan(1);
  expect((await s.wallet.checkSettlement(tx.id)).tokenState).toBe('unspent');
  s.mint.spent.add(s.mint.y(proofs[0].secret));
  expect((await s.wallet.checkSettlement(tx.id)).tokenState).toBe('partial');
  for (const proof of proofs) s.mint.spent.add(s.mint.y(proof.secret));
  expect((await s.wallet.checkSettlement(tx.id)).tokenState).toBe('spent');
  expect(s.mint.swaps).toBe(1);
  expect(s.wallet.satBalances()[s.mint.url]).toBe(57);
  // Persist the receipt state for reloads; keep the token in encrypted recovery.
  const saved = await s.wallet.journal.get(tx.id);
  expect(saved.tokenState).toBe('spent');
  expect(saved.token).toBe(sent.token);
});

test('incomplete or unrelated mint proof states cannot mark a token redeemed', async () => {
  const s = await setup(),
    tx = await s.wallet.prepareSend(s.mint.url, 7);
  await s.wallet.resume(tx.id, true);
  const cashu = await s.wallet.cashu();
  cashu.checkProofsStates = async () => [];
  await expect(s.wallet.checkSettlement(tx.id)).rejects.toThrow('incomplete token status');
  cashu.checkProofsStates = async (proofs) =>
    proofs.map(() => ({ Y: '02' + '00'.repeat(32), state: 'SPENT' as any, witness: null }));
  await expect(s.wallet.checkSettlement(tx.id)).rejects.toThrow('incomplete token status');
  expect((await s.wallet.journal.get(tx.id)).tokenState).toBeUndefined();
});

test('settling multiple transfers does not resurrect a replaced token with a rounded timestamp', async () => {
  const s = await setup(undefined, 0);
  const original = await WalletTokenFactory.create({
    mint: s.mint.url,
    unit: 'sat',
    proofs: await s.mint.fund(64),
  }).sign(s.signer);
  s.store.add(
    await s.signer.signEvent({
      kind: 7375,
      content: original.content,
      tags: original.tags,
      created_at: Math.floor(Date.now() / 1000) + 1,
    }),
  );
  await s.wallet.unlock();
  for (let i = 1; i <= 2; i++) {
    const tx = await s.wallet.prepareSend(s.mint.url, 4);
    await s.wallet.resume(tx.id, true);
    expect(s.wallet.satBalances()[s.mint.url]).toBe(64 - i * 4);
  }
});
