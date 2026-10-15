import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { Observable, firstValueFrom, toArray } from 'rxjs';
import { OutboxEventStore } from './outbox-store';
import type { PlaybackReadPool } from './playback';

const relay = 'wss://relay.example.com/';
const key = new Uint8Array(32).fill(3);
const signed = (kind = 1, content = 'hello', tags: string[][] = []) =>
  finalizeEvent({ kind, content, tags, created_at: 1000 }, key);
const empty: PlaybackReadPool = { req: () => new Observable(), close() {} };

test('verified bounded raw cache retains kind-5 and all replaceable versions without applying deletes', () => {
  let now = 1_000_000;
  const cache = new OutboxEventStore(empty, [relay], { maxEvents: 4, ttlMs: 20, now: () => now });
  const event = signed();
  const deletion = signed(5, '', [['e', event.id]]);
  const old = signed(10002, '', [['r', relay]]);
  const newer = finalizeEvent({ kind: 10002, content: '', tags: [], created_at: 1001 }, key);
  try {
    expect(cache.ingest({ ...event, content: 'forged' })).toBeUndefined();
    for (const e of [event, deletion, old, newer])
      expect(JSON.parse(JSON.stringify(cache.ingest(e)))).toEqual(JSON.parse(JSON.stringify(e)));
    expect(cache.cached([{}])).toHaveLength(4);
    expect(cache.cached([{ kinds: [5] }])[0]?.id).toBe(deletion.id);
    expect(cache.store.hasEvent(event.id)).toBe(true);
    expect(cache.store.getReplaceableHistory(10002, event.pubkey)).toHaveLength(2);
    cache.ingest(signed(2));
    expect(cache.cached([{}])).toHaveLength(4);
    expect(cache.store.hasEvent(event.id)).toBe(false);
    now += 21;
    expect(cache.cached([{}])).toEqual([]);
    expect(cache.store.database.getByFilters({})).toEqual([]);
  } finally {
    cache.close();
  }
});

test('public Applesauce loader is lazy, verifies events and rejects pointer relay hints', async () => {
  let requests = 0,
    teardown = 0;
  const event = signed();
  const pool: PlaybackReadPool = {
    req: (urls) =>
      new Observable((observer) => {
        requests++;
        expect(urls).toEqual([relay]);
        observer.next({ type: 'EVENT', from: relay, event: { ...event, content: 'forged' } });
        observer.next({ type: 'EVENT', from: relay, event: signed(2) });
        observer.next({ type: 'EVENT', from: relay, event });
        observer.next({ type: 'EOSE', from: relay });
        observer.complete();
        return () => {
          teardown++;
        };
      }),
    close() {},
  };
  const cache = new OutboxEventStore(pool, [relay]);
  try {
    const pending = cache.loadEvent({ id: event.id, relays: ['ws://127.0.0.1:9999/'] });
    expect(requests).toBe(0);
    const results = await firstValueFrom(pending.pipe(toArray()));
    expect(results.map((e) => e.id)).toEqual([event.id]);
    expect(cache.cached([{}]).map((e) => e.id)).toEqual([event.id]);
    expect(requests).toBe(1);
    expect(teardown).toBe(1);
  } finally {
    cache.close();
  }
});

test('closing scope cancels warm loader requests and suppresses later ingestion', async () => {
  let teardown = 0;
  const cache = new OutboxEventStore(
    {
      req: () =>
        new Observable(() => () => {
          teardown++;
        }),
      close() {},
    },
    [relay],
  );
  const values = firstValueFrom(cache.loadEvent({ id: signed().id }).pipe(toArray()));
  await new Promise((resolve) => setTimeout(resolve, 10));
  cache.close();
  expect(await values).toEqual([]);
  expect(teardown).toBe(1);
  expect(cache.ingest(signed())).toBeUndefined();
  expect(cache.cached([{}])).toEqual([]);
  cache.close();
});

test('byte bound evicts raw store entries and scopes do not share accounts', () => {
  const one = new OutboxEventStore(empty, [relay], { maxBytes: 500 });
  const two = new OutboxEventStore(empty, [relay]);
  try {
    one.ingest(signed());
    expect(two.cached([{}])).toEqual([]);
    one.ingest(signed(2));
    expect(one.cached([{}])).toHaveLength(1);
    expect(one.store.database.getByFilters({})).toHaveLength(1);
  } finally {
    one.close();
    two.close();
  }
});

test('real websocket entrypoint batches event pointers and releases relay requests', async () => {
  const { directReadPool } = await import('./playback');
  const first = signed(1),
    second = signed(2);
  let requests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] !== 'REQ') return;
        requests++;
        for (const event of [first, second, { ...first, content: 'forged' }])
          ws.send(JSON.stringify(['EVENT', message[1], event]));
        ws.send(JSON.stringify(['EOSE', message[1]]));
      },
    },
  });
  const url = `ws://127.0.0.1:${server.port}/`;
  const pool = directReadPool();
  const cache = new OutboxEventStore(pool, [url]);
  try {
    const results = await Promise.all([
      firstValueFrom(cache.loadEvent({ id: first.id }).pipe(toArray())),
      firstValueFrom(cache.loadEvent({ id: second.id }).pipe(toArray())),
    ]);
    expect(results.map((events) => events.map((e) => e.id))).toEqual([[first.id], [second.id]]);
    expect(requests).toBe(1);
    expect(cache.observedRelays(first.id)).toEqual([url]);
  } finally {
    cache.close();
    pool.close();
    server.stop(true);
  }
});

test('getEvent reads cached raw deletion through Applesauce without claiming stalled network completion', async () => {
  const { PlaybackNostr } = await import('./playback');
  const deletion = signed(5, '', [['e', signed().id]]);
  let requests = 0;
  const client = new PlaybackNostr(
    [relay],
    () => {},
    () => null,
    {
      req: () =>
        new Observable(() => {
          requests++;
        }),
      close() {},
    },
  );
  try {
    client.events.ingest(deletion, relay);
    const result = await client.handle({
      type: 'outbox.getEvent',
      eventId: deletion.id,
      options: { timeoutMs: 100 },
    });
    expect(result).toMatchObject({
      result: { event: { id: deletion.id, kind: 5 } },
      incomplete: true,
    });
    expect(requests).toBe(1);
    expect(client.events.cached([{ kinds: [5] }]).map((event) => event.id)).toEqual([deletion.id]);
    expect(
      Object.getOwnPropertySymbols(client.events.cached([{ kinds: [5] }])[0]!).map(String),
    ).toEqual(['Symbol(verified)']);
  } finally {
    client.close();
  }
});

test('network SDK loader uses resolved relays, preserves partial events and requires every EOSE', async () => {
  const event = signed();
  const target = 'wss://author.example.com/';
  const requested: string[][] = [];
  const cache = new OutboxEventStore(
    {
      req: (relays) =>
        new Observable((observer) => {
          requested.push(relays);
          observer.next({ type: 'EVENT', from: target, event });
          observer.next({ type: 'EOSE', from: target });
          // Configured fallback never reaches EOSE.
        }),
      close() {},
    },
    [relay],
  );
  try {
    const partial = await cache.loadEventWithCoverage(event.id, [target, relay], 20);
    expect(partial.events.map((e) => e.id)).toEqual([event.id]);
    expect(partial.incomplete).toBe(true);
    expect(requested).toEqual([[target, relay]]);
  } finally {
    cache.close();
  }
});

test('network SDK loader does not substitute cache for required network coverage', async () => {
  const event = signed(5);
  let requests = 0;
  const cache = new OutboxEventStore(
    {
      req: () =>
        new Observable((observer) => {
          requests++;
          observer.next({ type: 'EOSE', from: relay });
          observer.complete();
        }),
      close() {},
    },
    [relay],
  );
  try {
    cache.ingest(event);
    const result = await cache.loadEventWithCoverage(event.id, [relay], 100);
    expect(result.events.map((e) => e.id)).toEqual([event.id]);
    expect(result.incomplete).toBe(false);
    expect(requests).toBe(1);
  } finally {
    cache.close();
  }
});

test('network SDK loader abort releases request and never claims completion', async () => {
  let closed = 0;
  const cache = new OutboxEventStore(
    {
      req: () =>
        new Observable(() => () => {
          closed++;
        }),
      close() {},
    },
    [relay],
  );
  const controller = new AbortController();
  try {
    const loading = cache.loadEventWithCoverage(signed().id, [relay], 1000, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    expect(await loading).toMatchObject({ events: [], incomplete: true });
    expect(closed).toBe(1);
  } finally {
    cache.close();
  }
});

test('getEvent websocket CLOSED preserves actionable target and cause while redacting credentials', async () => {
  const { PlaybackNostr } = await import('./playback');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'REQ')
          ws.send(
            JSON.stringify([
              'CLOSED',
              message[1],
              'restricted: authentication required token=super-secret-credential',
            ]),
          );
      },
    },
  });
  const url = `ws://127.0.0.1:${server.port}/`;
  const client = new PlaybackNostr(
    [url],
    () => {},
    () => null,
  );
  try {
    const result = await client.handle({
      type: 'outbox.getEvent',
      eventId: signed().id,
      options: { timeoutMs: 1000 },
    });
    expect(result).toMatchObject({ incomplete: true });
    expect('error' in result ? result.error : undefined).toContain(
      'restricted: authentication required',
    );
    expect('error' in result ? result.error : undefined).toContain(url);
    expect('error' in result ? result.error : undefined).toContain('outbox.getEvent');
    expect('error' in result ? result.error : undefined).not.toContain('super-secret-credential');
  } finally {
    client.close();
    server.stop(true);
  }
});

test('getEvent transport errors preserve nested useful cause and scrub secret links', async () => {
  const { PlaybackNostr } = await import('./playback');
  const client = new PlaybackNostr(
    [relay],
    () => {},
    () => null,
    {
      req: () =>
        new Observable((observer) =>
          observer.error(
            new Error('Connection failed', {
              cause: new Error(
                'ECONNREFUSED signer wss://user:private-password@relay.example.com/?token=private-token',
              ),
            }),
          ),
        ),
      close() {},
    },
  );
  try {
    const result = await client.handle({ type: 'outbox.getEvent', eventId: signed().id });
    expect('error' in result ? result.error : undefined).toContain('ECONNREFUSED');
    expect('error' in result ? result.error : undefined).toContain('Connection failed');
    expect('error' in result ? result.error : undefined).not.toContain('private-password');
    expect('error' in result ? result.error : undefined).not.toContain('private-token');
  } finally {
    client.close();
  }
});
