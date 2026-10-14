import { test, expect } from 'bun:test';
import { finalizeEvent, getPublicKey, matchFilters } from 'nostr-tools';
import { NappletMapPublication } from './map-publication-session';
import { mapTemplate } from './map-contract';
import type { SignedEvent } from '../../protocol/src';
const alice = new Uint8Array(32).fill(22),
  bob = new Uint8Array(32).fill(23);
const make = () => ({
  kind: 35858,
  created_at: Math.floor(Date.now() / 1000) - 5,
  content: 'credits',
  tags: [
    ['d', 'map-one'],
    ['title', 'Map One'],
    ['version', '1'],
    ['x', 'a'.repeat(64)],
    ['m', 'application/json'],
    ['size', '100'],
  ],
});
function fixture() {
  const abort = new AbortController();
  const state = {
    events: [] as SignedEvent[],
    consent: true,
    failRead: false,
    failWrite: false,
    sign: 0,
    publish: 0,
    onConsent: async () => {},
    onSign: async () => {},
    key: alice,
  };
  const session = new NappletMapPublication({
    pubkey: getPublicKey(alice),
    relays: ['wss://relay.example.com/'],
    signal: abort.signal,
    sign: async (_, t) => {
      state.sign++;
      await state.onSign();
      return finalizeEvent(t, state.key);
    },
    consent: async () => {
      await state.onConsent();
      return state.consent;
    },
    io: {
      query: async (filters, _s, complete) => {
        expect(complete).toBe(true);
        if (state.failRead) throw Error('offline');
        return state.events.filter((e) => matchFilters(filters, e));
      },
      publish: async (event) => {
        state.publish++;
        state.events.push(event);
        if (state.failWrite) throw Error('lost acknowledgement');
        return ['wss://relay.example.com/'];
      },
    },
  });
  return {
    state,
    session,
    abort,
    send: (event = make(), options = {}) => session.handle({ event, options }),
  };
}
test('native creation, update and bounded retry use real viewer signatures', async () => {
  const f = fixture();
  const t = make();
  f.state.failWrite = true;
  expect((await f.send(t)).ok).toBe(false);
  f.state.failWrite = false;
  expect((await f.send(t)).ok).toBe(true);
  expect(f.state.sign).toBe(1);
  expect((await f.send({ ...t, created_at: t.created_at + 1, content: 'update' })).ok).toBe(true);
  f.session.close();
});
test('denial, incomplete reads and foreign destinations never sign', async () => {
  for (const mode of ['deny', 'read', 'relay']) {
    const f = fixture();
    f.state.consent = mode !== 'deny';
    f.state.failRead = mode === 'read';
    expect(
      (await f.send(make(), mode === 'relay' ? { relays: ['wss://foreign.example.com/'] } : {})).ok,
    ).toBe(false);
    expect(f.state.sign).toBe(0);
    expect(f.state.publish).toBe(0);
    f.session.close();
  }
});
test('stale reads after consent and signer reject publication', async () => {
  for (const stage of ['consent', 'sign']) {
    const f = fixture();
    const update = async () => {
      f.state.events.push(finalizeEvent({ ...make(), created_at: make().created_at - 1 }, alice));
    };
    if (stage === 'consent') f.state.onConsent = update;
    else f.state.onSign = update;
    expect((await f.send()).ok).toBe(false);
    expect(f.state.publish).toBe(0);
    f.session.close();
  }
});
test('changed signer and account abort do not publish', async () => {
  for (const mode of ['signer', 'abort']) {
    const f = fixture();
    if (mode === 'signer') f.state.key = bob;
    else
      f.state.onSign = async () => {
        f.abort.abort();
      };
    expect((await f.send()).ok).toBe(false);
    expect(f.state.publish).toBe(0);
    f.session.close();
  }
});
test('deletion resolves exact owner map target and rejects foreign/unrelated IDs', async () => {
  const f = fixture();
  const base = finalizeEvent({ ...make(), created_at: make().created_at - 2 }, alice);
  f.state.events.push(base);
  const deletion = {
    kind: 5,
    created_at: make().created_at,
    content: 'Removed',
    tags: [
      ['a', `35858:${getPublicKey(alice)}:map-one`],
      ['e', base.id],
      ['k', '35858'],
    ],
  };
  expect((await f.send(deletion)).ok).toBe(true);
  expect(
    (
      await f.send({
        ...deletion,
        tags: [
          ['a', `35858:${getPublicKey(bob)}:map-one`],
          ['e', base.id],
          ['k', '35858'],
        ],
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await f.send({
        ...deletion,
        tags: [
          ['a', `35858:${getPublicKey(alice)}:map-one`],
          ['e', 'f'.repeat(64)],
          ['k', '35858'],
        ],
      })
    ).ok,
  ).toBe(false);
  f.session.close();
});
test('strict metadata and lineage reject malformed inputs and accept remix', () => {
  const parent = getPublicKey(bob);
  const remix = {
    ...make(),
    tags: [
      ...make().tags,
      ['A', `35858:${parent}:parent`],
      ['a', `35858:${parent}:parent`],
      ['E', 'b'.repeat(64), '', parent],
      ['e', 'b'.repeat(64), '', parent],
      ['K', '35858'],
      ['k', '35858'],
      ['P', parent],
      ['p', parent],
    ],
  };
  expect(mapTemplate(remix, getPublicKey(alice)).identifier).toBe('map-one');
  for (const extra of [
    [['d', 'duplicate']],
    [['zap', 'arbitrary']],
    [['server', 'https://127.0.0.1']],
    [['p', 'invalid']],
  ])
    expect(() =>
      mapTemplate({ ...make(), tags: [...make().tags, ...extra] }, getPublicKey(alice)),
    ).toThrow();
});

test('retry refuses a different revision after lost acknowledgement', async () => {
  const f = fixture();
  const t = make();
  f.state.failWrite = true;
  expect((await f.send(t)).ok).toBe(false);
  f.state.events.push(
    finalizeEvent({ ...t, created_at: t.created_at + 1, content: 'another device' }, alice),
  );
  f.state.failWrite = false;
  expect((await f.send(t)).ok).toBe(false);
  expect(f.state.publish).toBe(1);
  f.session.close();
});
test('closing during consent cancels without signer authority', async () => {
  const f = fixture();
  f.state.onConsent = async () => {
    f.session.close();
  };
  expect((await f.send()).ok).toBe(false);
  expect(f.state.sign).toBe(0);
  expect(f.state.publish).toBe(0);
});
test('signExact rejects a valid signature over modified metadata', async () => {
  const abort = new AbortController();
  let writes = 0;
  const session = new NappletMapPublication({
    pubkey: getPublicKey(alice),
    relays: ['wss://relay.example.com/'],
    signal: abort.signal,
    consent: async () => true,
    sign: async (_, t) => finalizeEvent({ ...t, content: 'modified' }, alice),
    io: {
      query: async () => [],
      publish: async () => {
        writes++;
      },
    },
  });
  expect((await session.handle({ event: make() })).ok).toBe(false);
  expect(writes).toBe(0);
  session.close();
});

test('optional lineage kind and event references can be omitted when updating valid remixes', async () => {
  const f = fixture();
  const parent = getPublicKey(bob);
  const t = {
    ...make(),
    tags: [
      ...make().tags,
      ['A', `35858:${parent}:parent`],
      ['a', `35858:${parent}:parent`],
      ['P', parent],
      ['p', parent],
    ],
  };
  expect(mapTemplate(t, getPublicKey(alice)).identifier).toBe('map-one');
  f.state.events.push(finalizeEvent({ ...t, created_at: t.created_at - 1 }, alice));
  expect((await f.send(t)).ok).toBe(true);
  f.session.close();
  for (const extra of [
    ['K', ''],
    ['k', '35859'],
    ['E', ''],
    ['e', 'oops'],
    ['e', 'b'.repeat(64), '', getPublicKey(alice)],
    ['E', 'b'.repeat(64), '', ''],
  ])
    expect(() => mapTemplate({ ...t, tags: [...t.tags, extra] }, getPublicKey(alice))).toThrow();
});
