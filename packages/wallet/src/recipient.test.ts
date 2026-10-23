import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { bech32 } from '@scure/base';
import { paymentRecipient } from './recipient';
import { walletBootstrapRelays } from './network';
import { resolveZapEndpoint } from '../../client/src/zaps';

const key = new Uint8Array(32).fill(7),
  pubkey = getPublicKey(key);
const other = new Uint8Array(32).fill(8);
function event(kind: number, content = '', tags: string[][] = [], age = 0) {
  return finalizeEvent(
    { kind, content, tags, created_at: Math.floor(Date.now() / 1000) + age },
    key,
  );
}
const receiving = [
  ['pubkey', getPublicKey(other)],
  ['mint', 'https://mint.example.com', 'sat'],
  ['relay', 'wss://relay.example.com'],
];

test('no payment action for absent, malformed or withdrawn Lightning addresses', () => {
  expect(paymentRecipient([], pubkey).lightning).toBe(false);
  for (const content of ['{}', '[]', '{', '{"lud16":"invalid"}', '{"lud16":"a@localhost"}'])
    expect(paymentRecipient([event(0, content)], pubkey).lightning).toBe(false);
  const old = event(0, '{"lud16":"creator@example.com"}', [], -10);
  expect(paymentRecipient([old], pubkey).lightning).toBe(true);
  expect(paymentRecipient([old, event(0, '{}')], pubkey).lightning).toBe(false);
});

test('legacy LNURL and blank lud16 agree with the actual invoice lookup', async () => {
  const url = 'https://pay.example.com/lnurl';
  const lud06 = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 2000);
  const profile = event(0, JSON.stringify({ lud16: '', lud06 }));
  expect(paymentRecipient([profile], pubkey).lightning).toBe(true);
  await resolveZapEndpoint(pubkey, [profile], async (target) => {
    expect(target.href).toBe(url);
    return {
      tag: 'payRequest',
      allowsNostr: true,
      nostrPubkey: pubkey,
      callback: url,
      minSendable: 1000,
      maxSendable: 21000,
    };
  });
});

test('a valid NIP-61 receiving wallet works without a Lightning address', () => {
  const info = event(10019, '', receiving);
  const value = paymentRecipient([info], pubkey);
  expect(value.lightning).toBe(false);
  expect(value.nutzap?.id).toBe(info.id);
  expect(paymentRecipient([event(10019, '', [])], pubkey).nutzap).toBeUndefined();
});

test('withdrawn or invalid latest receiving info never revives an old nutzap wallet', () => {
  const old = event(10019, '', receiving, -10);
  for (const tags of [
    receiving.filter((t) => t[0] !== 'mint'),
    [
      ['pubkey', pubkey],
      ['mint', 'https://mint.example.com'],
      ['relay', 'wss://relay.example.com'],
    ],
  ]) {
    expect(paymentRecipient([old, event(10019, '', tags)], pubkey).nutzap).toBeUndefined();
  }
});

test('recipient identity, signature and future timestamps are checked', () => {
  const info = event(10019, '', receiving);
  expect(paymentRecipient([info], getPublicKey(other)).nutzap).toBeUndefined();
  expect(paymentRecipient([{ ...info, sig: '0'.repeat(128) }], pubkey).nutzap).toBeUndefined();
  expect(paymentRecipient([event(10019, '', receiving, 1000)], pubkey).nutzap).toBeUndefined();
});

test('wallet bootstrap can use public relays without changing the local shell network', () => {
  const local = ['ws://127.0.0.1:9999'];
  const urls = walletBootstrapRelays(local);
  expect(urls.length).toBeGreaterThan(0);
  expect(urls.every((url) => url.startsWith('wss://'))).toBe(true);
  expect(urls).not.toContain(local[0]!);
  expect(local).toEqual(['ws://127.0.0.1:9999']);
  expect(
    walletBootstrapRelays(['wss://custom.example.com'], ['wss://custom.example.com/']),
  ).toEqual(['wss://custom.example.com/']);
  const unsafe = [
    'ws://public.example.com',
    'wss://127.0.0.1',
    'wss://user:pass@relay.example.com',
    'wss://lan.internal',
  ];
  const discovered = walletBootstrapRelays(local, unsafe);
  expect(discovered).toEqual(urls);
});
