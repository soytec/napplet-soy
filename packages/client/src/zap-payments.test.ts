import { expect, test } from 'bun:test';
import { bech32 } from '@scure/base';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ZapPayments, zapReceiptFilters } from './zap-payments';
import { ZapTotalsStore } from './zap-totals';
import { inspectInvoice } from '../../protocol/src/invoice';
import { socialScope } from '../../protocol/src/social';
import { invoice } from '../../../tests/fixtures/direct-wallet';

function fixture() {
  const key = new Uint8Array(32).fill(3),
    author = new Uint8Array(32).fill(4);
  const now = Math.floor(Date.now() / 1000);
  const target = finalizeEvent(
    {
      kind: 35129,
      created_at: now,
      content: 'Fixture',
      tags: [
        ['d', 'payment-fixture'],
        ['x', 'b'.repeat(64)],
      ],
    },
    author,
  );
  const scope = socialScope(target);
  const endpoint = {
    pubkey: target.pubkey,
    nostrPubkey: getPublicKey(key),
    callback: 'https://wallet.example/callback',
    lnurl: bech32.encode(
      'lnurl',
      bech32.toWords(new TextEncoder().encode('https://wallet.example/.well-known/lnurlp/fixture')),
      2000,
    ),
    minSendable: 1000,
    maxSendable: 1000000,
    commentAllowed: 100,
  };
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: now,
      content: '',
      tags: [
        ['p', target.pubkey],
        ['e', target.id],
        ['a', scope.key],
        ['k', '35129'],
        ['amount', '21000'],
        ['lnurl', endpoint.lnurl],
        ['relays', 'wss://relay.example'],
      ],
    },
    key,
  );
  const serialized = JSON.stringify(request),
    bolt11 = invoice(21000, serialized);
  const prepared = {
    ...inspectInvoice(bolt11),
    invoice: bolt11,
    request,
    verify: 'https://wallet.example/verify/fixture',
  };
  const preimage = bytesToHex(sha256(new TextEncoder().encode(serialized)));
  const record = { target, endpoint, invoice: prepared, relays: ['wss://relay.example'] };
  return { scope, record, preimage, key };
}
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    get: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    }),
  };
}
async function eventually(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(1);
  expect(check()).toBe(true);
}

test('a saved QR invoice resumes after reload and provider confirmation without a preimage counts once', async () => {
  const { scope, record } = fixture(),
    saved = storage();
  const first = new ZapPayments({
    totals: new ZapTotalsStore(saved.get),
    storage: saved.get,
    query: async () => [],
  });
  first.remember(record);
  const totals = new ZapTotalsStore(saved.get);
  let settled = false,
    reads = 0;
  const reloaded = new ZapPayments({
    totals,
    storage: saved.get,
    query: async () => {
      reads++;
      return [];
    },
    check: async () => settled,
  });
  const pending = reloaded.pending(scope.key)!;
  expect(pending.invoice.paymentHash).toBe(record.invoice.paymentHash);
  let notices: string[] = [];
  const close = reloaded.watch(scope.key, (n) => notices.push(n.state));
  await eventually(() => reads === 1);
  expect(totals.get(scope.key)).toBeUndefined();
  await Bun.sleep(1);
  settled = true;
  reloaded.checkNow(scope.key);
  await eventually(() => notices.includes('paid'));
  expect(totals.get(scope.key)).toEqual({ zapCount: 1, msats: 21000 });
  expect(reloaded.pending(scope.key)).toBeUndefined();
  expect(new ZapTotalsStore(saved.get).get(scope.key)).toEqual({ zapCount: 1, msats: 21000 });
  const confirmed = JSON.parse(saved.values.get('napplet:zap-confirmations:v1')!);
  expect(Object.keys(confirmed[0]).sort()).toEqual(['at', 'msats', 'paymentHash', 'scope']);
  totals.observe(scope.key, [record.invoice, record.invoice]);
  expect(totals.get(scope.key)).toEqual({ zapCount: 1, msats: 21000 });
  close();
});

test('shared watchers do not duplicate relay polls and invalid wallet proof cannot confirm', async () => {
  const { scope, record, preimage } = fixture();
  let reads = 0;
  const totals = new ZapTotalsStore();
  const manager = new ZapPayments({
    totals,
    query: async () => {
      reads++;
      return [];
    },
    check: async () => false,
  });
  manager.remember(record);
  const a = manager.watch(scope.key, () => {}),
    b = manager.watch(scope.key, () => {});
  await eventually(() => reads === 1);
  expect(manager.confirmPreimage(scope.key, record.invoice.paymentHash, '00'.repeat(32))).toBe(
    false,
  );
  expect(totals.get(scope.key)).toBeUndefined();
  expect(manager.confirmPreimage(scope.key, record.invoice.paymentHash, preimage)).toBe(true);
  expect(manager.confirmPreimage(scope.key, record.invoice.paymentHash, preimage)).toBe(true);
  expect(totals.get(scope.key)).toEqual({ zapCount: 1, msats: 21000 });
  a();
  b();
});

test('expired invoices can still be confirmed by a late provider, and malformed recovery data is ignored', async () => {
  const { scope, record } = fixture(),
    saved = storage();
  const manager = new ZapPayments({
    totals: new ZapTotalsStore(),
    storage: saved.get,
    query: async () => [],
  });
  manager.remember(record);
  const raw = JSON.parse(saved.values.get('napplet:zap-invoices:v1')!);
  raw.push({ ...raw[0], invoice: { ...raw[0].invoice, msats: 42000 } });
  saved.values.set('napplet:zap-invoices:v1', JSON.stringify(raw));
  const totals = new ZapTotalsStore();
  const late = new ZapPayments({
    totals,
    storage: saved.get,
    now: () => record.invoice.expiresAt * 1000 + 1000,
    query: async () => [],
    check: async () => true,
  });
  expect(late.pending(scope.key)?.invoice.msats).toBe(21000);
  const close = late.watch(scope.key, () => {});
  await eventually(() => totals.get(scope.key)?.msats === 21000);
  close();
  const blocked = new ZapPayments({
    totals: new ZapTotalsStore(),
    storage: () => {
      throw new Error('Blocked');
    },
    query: async () => [],
  });
  expect(() => blocked.remember(record)).not.toThrow();
  expect(blocked.durable).toBe(false);
});

test('confirmation requires an exact provider receipt, and failures remain recoverable', async () => {
  const { scope, record, key } = fixture();
  let fail = true,
    send = false;
  const receipt = finalizeEvent(
    {
      kind: 9735,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ...record.invoice.request.tags.filter((t) => ['p', 'e', 'a'].includes(t[0])),
        ['description', JSON.stringify(record.invoice.request)],
        ['bolt11', record.invoice.invoice],
      ],
    },
    key,
  );
  const foreign = finalizeEvent({ ...receipt, tags: receipt.tags }, new Uint8Array(32).fill(5));
  const totals = new ZapTotalsStore();
  const manager = new ZapPayments({
    totals,
    check: async () => {
      throw new Error('Provider unreachable');
    },
    query: async (_r, _s, receive) => {
      if (fail) throw new Error('Relay unreachable');
      receive(foreign);
      if (send) receive(receipt);
      return [foreign];
    },
  });
  manager.remember(record);
  const notices: string[] = [];
  const close = manager.watch(scope.key, (n) => notices.push(n.state));
  await eventually(() => notices.includes('unavailable'));
  expect(totals.get(scope.key)).toBeUndefined();
  expect(zapReceiptFilters({ ...record, savedAt: Date.now() }).map((f) => Object.keys(f))).toEqual(
    expect.arrayContaining([expect.arrayContaining(['#a']), expect.arrayContaining(['#e'])]),
  );
  fail = false;
  send = true;
  manager.checkNow(scope.key);
  await eventually(() => notices.includes('paid'));
  expect(totals.get(scope.key)).toEqual({ zapCount: 1, msats: 21000 });
  close();
});
