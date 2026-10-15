import { test, expect } from 'bun:test';
import { finalizeEvent, getPublicKey, matchFilters, type Filter } from 'nostr-tools';
import { NappletAppData, appDataPolicy } from './app-data-session';
import { appDataCollection, type AppDataHost } from '../../app-data/src/app-data';
import {
  dataTags,
  decodeDataRecord,
  APP_DATA_KIND,
  type DataTemplate,
} from '../../app-data/src/app-data-contract';
import type { SignedEvent } from '../../protocol/src';

const alice = new Uint8Array(32).fill(28),
  bob = new Uint8Array(32).fill(29);
const policy = appDataPolicy(`${getPublicKey(alice)}:35129:editor:${'a'.repeat(64)}`, [
  'wss://relay.example.com/',
]);
const make = (
  previous: string | null = null,
  id = 'track',
  data: unknown = { points: [1, 2] },
): DataTemplate => ({
  kind: APP_DATA_KIND,
  created_at: Math.floor(Date.now() / 1000) - 5,
  tags: dataTags(policy.scope, 'tracks', id, 'example.track', 1),
  content: JSON.stringify({
    schema: 'example.track',
    version: 1,
    title: 'Tiny track',
    previous,
    deleted: false,
    data,
  }),
});
function fixture(key = alice, events: SignedEvent[] = []) {
  const abort = new AbortController();
  const state = {
    consent: true,
    failRead: false,
    failWrite: false,
    sign: 0,
    publishes: 0,
    prompts: [] as string[],
    events,
    onConsent: async () => {},
    onSign: async () => {},
  };
  const session = new NappletAppData({
    policy,
    pubkey: getPublicKey(key),
    signal: abort.signal,
    sign: async (_, t) => {
      state.sign++;
      await state.onSign();
      return finalizeEvent(t, key);
    },
    consent: async (text) => {
      state.prompts.push(text);
      await state.onConsent();
      return state.consent;
    },
    io: {
      query: async (filters, _signal, complete) => {
        expect(complete).toBe(true);
        if (state.failRead) throw new Error('relay down');
        return state.events.filter((e) => matchFilters(filters, e));
      },
      publish: async (event) => {
        state.publishes++;
        if (state.failWrite)
          throw new Error('restricted: storage quota exceeded; token=hidden-value');
        state.events.push(event);
        return policy.relays;
      },
    },
  });
  const host: AppDataHost = {
    shell: {
      onReady: (callback) => {
        callback({ capabilities: { appData: policy } });
        return { close() {} };
      },
    },
    identity: { getPublicKey: async () => getPublicKey(key) },
    outbox: {
      publish: async (event, options) =>
        session.handle({ type: 'outbox.publish', event, options }) as any,
      query: async (filters) => ({
        events: state.events
          .filter((e) => matchFilters(filters as Filter[], e))
          .map((event) => ({ event })),
      }),
    },
  };
  return {
    session,
    state,
    abort,
    host,
    send: (event: DataTemplate) =>
      session.handle({
        type: 'outbox.publish',
        event,
        options: { toOutbox: false, relays: policy.relays },
      }),
  };
}
const validate = (v: unknown) => {
  if (
    !v ||
    typeof v !== 'object' ||
    !('points' in v) ||
    !Array.isArray(v.points) ||
    !v.points.every((p) => typeof p === 'number')
  )
    throw new Error('Expected numeric points.');
  return v as { points: number[] };
};
const collection = (host: AppDataHost) =>
  appDataCollection({ host, collection: 'tracks', schema: 'example.track', version: 1, validate });

test('public records use independent authors, survive a host restart, update by revision and unpublish without deleting another author', async () => {
  const a = fixture(),
    b = fixture(bob, a.state.events);
  const tracks = await collection(a.host),
    others = await collection(b.host);
  const change = await tracks.prepare({
    id: 'same-id',
    title: 'Alice track',
    data: { points: [1, 2] },
    base: null,
  });
  const first = await change.publish();
  expect(first.author).toBe(getPublicKey(alice));
  const other = await (
    await others.prepare({
      id: 'same-id',
      title: 'Bob track',
      data: { points: [3, 4] },
      base: null,
    })
  ).publish();
  expect((await tracks.list()).records).toHaveLength(2);
  await expect(
    others.prepare({ id: first.id, title: 'Steal', data: { points: [] }, base: first }),
  ).rejects.toThrow('owner-mismatch');
  a.session.close();
  const restarted = fixture(alice, a.state.events),
    saved = await collection(restarted.host);
  const base = (await saved.get(first.author, first.id)).record!;
  const edit = await saved.prepare({
    id: base.id,
    title: base.title,
    data: { points: [5, 6] },
    base,
  });
  const second = await edit.publish();
  expect(second.revision).not.toBe(first.revision);
  expect((await saved.get(first.author, first.id)).record?.data).toEqual({ points: [5, 6] });
  const stale = await saved.prepare({
    id: base.id,
    title: base.title,
    data: { points: [7] },
    base,
  });
  await expect(stale.publish()).rejects.toThrow('conflict');
  const removed = await (
    await saved.prepare({ id: second.id, title: second.title, base: second, deleted: true })
  ).publish();
  expect(removed.deleted).toBe(true);
  expect(removed.data).toBeNull();
  expect((await saved.list()).records.map((r) => r.revision)).toEqual([other.revision]);
  expect(restarted.state.prompts.at(-1)).toContain(
    'Old copies and linked Blossom files are not erased',
  );
  restarted.session.close();
  b.session.close();
});

test('scope is stable across releases, distinct across creators/preview, and enforced before consent/signing', async () => {
  const identity = `${getPublicKey(alice)}:35129:editor`;
  expect(appDataPolicy(`${identity}:${'b'.repeat(64)}`, []).scope).toBe(policy.scope);
  expect(appDataPolicy(`${getPublicKey(bob)}:35129:editor:${'b'.repeat(64)}`, []).scope).not.toBe(
    policy.scope,
  );
  expect(appDataPolicy(`local-preview:fixture:${'b'.repeat(64)}`, []).scope).not.toBe(policy.scope);
  const f = fixture();
  const wrong = make();
  wrong.tags = dataTags('f'.repeat(64), 'tracks', 'track', 'example.track', 1);
  expect(await f.send(wrong)).toMatchObject({
    ok: false,
    error: expect.stringContaining('scope-mismatch'),
  });
  expect(await f.send({ ...make(), kind: 1 })).toMatchObject({ ok: false });
  expect(
    await f.session.handle({
      type: 'outbox.publish',
      event: make(),
      options: { toOutbox: false, relays: ['wss://other.example.com/'] },
    }),
  ).toMatchObject({ ok: false, error: expect.stringContaining('relay-not-configured') });
  expect(f.state.sign).toBe(0);
  expect(f.state.prompts).toEqual([]);
  f.session.close();
});

test('denial, incomplete reads, changed bases and changed identity cannot silently publish', async () => {
  const f = fixture();
  f.state.consent = false;
  expect(await f.send(make())).toMatchObject({
    ok: false,
    error: expect.stringContaining('user-denied'),
  });
  f.state.consent = true;
  f.state.failRead = true;
  expect(await f.send(make())).toMatchObject({
    ok: false,
    error: expect.stringContaining('read-incomplete'),
  });
  f.state.failRead = false;
  f.state.onConsent = async () => {
    f.state.events.push(finalizeEvent(make(), alice));
  };
  expect(await f.send(make())).toMatchObject({
    ok: false,
    error: expect.stringContaining('conflict'),
  });
  expect(f.state.sign).toBe(0);
  expect(f.state.publishes).toBe(0);
  f.session.close();
  const g = fixture();
  g.state.onSign = async () => {
    g.abort.abort();
  };
  expect(await g.send(make())).toMatchObject({ ok: false });
  await Bun.sleep(0);
  expect(g.state.publishes).toBe(0);
  g.session.close();
});

test('retry preserves the exact signed event, catches lost acknowledgements and redacts service errors', async () => {
  const f = fixture();
  f.state.failWrite = true;
  const template = make();
  const failed = await f.send(template);
  expect(failed).toMatchObject({
    ok: false,
    error: expect.stringContaining('storage quota exceeded'),
  });
  expect(String(failed.error)).not.toContain('hidden-value');
  expect(f.state.sign).toBe(1);
  // A relay stored it despite a lost OK; the exact retry must still work.
  f.state.events.push(finalizeEvent(structuredClone(template), alice));
  f.state.failWrite = false;
  const success = await f.send(template);
  expect(success).toMatchObject({
    ok: true,
    eventId: f.state.events[0].id,
    relays: { [policy.relays[0]]: true },
  });
  expect(f.state.sign).toBe(1);
  f.session.close();
});

test('prepared changes cannot follow an account switch, and concurrent players cannot edit the same record while consent is pending', async () => {
  const a = fixture(),
    b = fixture(alice, a.state.events);
  const tracks = await collection(a.host);
  const change = await tracks.prepare({
    id: 'track',
    title: 'Track',
    data: { points: [1] },
    base: null,
  });
  a.host.identity.getPublicKey = async () => getPublicKey(bob);
  await expect(change.publish()).rejects.toThrow('identity-changed');
  expect(a.state.sign).toBe(0);
  expect(a.state.prompts).toHaveLength(0);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = Promise.withResolvers<void>();
  a.state.onConsent = async () => {
    entered.resolve();
    await held;
  };
  const pending = a.send(make());
  await entered.promise;
  expect(await b.send(make())).toMatchObject({ ok: false, error: expect.stringContaining('busy') });
  a.abort.abort();
  release();
  expect(await pending).toMatchObject({ ok: false });
  await Bun.sleep(0);
  expect(a.state.sign).toBe(0);
  expect(b.state.sign).toBe(0);
  a.session.close();
  b.session.close();
});

test('malformed, oversized and unsafe JSON is rejected; unsupported hosts and incomplete reads stay explicit', async () => {
  expect(() => decodeDataRecord(make(null, 'track', { points: ['x'.repeat(17000)] }))).toThrow(
    '16 KiB',
  );
  const unsafe = make();
  unsafe.content = unsafe.content.replace('"data":', '"unexpected":1,"data":');
  expect(() => decodeDataRecord(unsafe)).toThrow('invalid-record');
  const proto = make();
  proto.content = proto.content.replace('"data":', '"data":{"__proto__":1},"other":');
  expect(() => decodeDataRecord(proto)).toThrow('invalid-json');
  const f = fixture();
  const tracks = await collection(f.host);
  await expect(
    tracks.prepare({
      id: undefined as unknown as string,
      title: 'Missing ID',
      data: { points: [1] },
      base: null,
    }),
  ).rejects.toThrow('invalid-id');
  await expect(
    tracks.prepare({ id: 'bad', title: 'Bad', data: { points: [NaN] }, base: null }),
  ).rejects.toThrow('invalid-json');
  f.host.outbox.query = async () => ({ events: [], incomplete: true });
  expect(await tracks.list()).toMatchObject({ records: [], incomplete: true });
  expect(await tracks.get(getPublicKey(alice), 'missing')).toMatchObject({
    record: null,
    incomplete: true,
  });
  f.host.shell.onReady = (callback) => {
    callback({});
    return { close() {} };
  };
  await expect(collection(f.host)).rejects.toThrow('unavailable');
  f.session.close();
});

test('specialized OUTBOX requires explicit policy or a complete configured planner fanout', async () => {
  const f = fixture();
  expect(await f.session.handle({ type: 'outbox.publish', event: make() })).toMatchObject({
    ok: false,
    error: expect.stringContaining('policy-denied'),
  });
  expect(f.state.sign).toBe(0);
  f.session.close();
  let signatures = 0;
  const create = (relays: string[]) =>
    new NappletAppData({
      policy,
      pubkey: getPublicKey(alice),
      signal: new AbortController().signal,
      plan: async () => relays,
      consent: async () => true,
      sign: async (_, template) => {
        signatures++;
        return finalizeEvent(template, alice);
      },
      io: { query: async () => [], publish: async () => relays },
    });
  const valid = create(policy.relays);
  expect((await valid.handle({ type: 'outbox.publish', event: make() })).ok).toBe(true);
  valid.close();
  const denied = create([...policy.relays, 'wss://recipient.example.com/']);
  expect(
    await denied.handle({
      type: 'outbox.publish',
      event: make(),
      options: { toInboxes: [getPublicKey(bob)] },
    }),
  ).toMatchObject({ ok: false, error: expect.stringContaining('relay-not-configured') });
  expect(signatures).toBe(1);
  denied.close();
});
