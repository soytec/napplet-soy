import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import {
  checkedEndpoint,
  copyPublication,
  resolveOutbox,
  outboxSchema,
  publicationDestinations,
  MAX_KNOWN_COPY_RELAYS,
  type CopyState,
} from './publication-copies';
import { PublicationRelays } from '../../publish/src/relay';
const key = new Uint8Array(32).fill(7),
  author = getPublicKey(key);
const manifest = (kind: number) =>
  finalizeEvent(
    { kind, content: 'fixture', created_at: 100, tags: kind === 35129 ? [['d', 'fixture']] : [] },
    key,
  );
const events = [manifest(5129), manifest(35129)];
const targets = { relay: 'ws://127.0.0.1:1234/', mirrors: [] as string[] };
const list = (urls: string[], created_at = 100) =>
  finalizeEvent(
    { kind: 10002, created_at, content: '', tags: urls.map((url) => ['r', url, 'write']) },
    key,
  );
const urls = Array.from({ length: 8 }, (_, i) => `ws://127.0.0.1:${5000 + i}/`);

test('outbox policy applies canonical length, endpoint policy, signature verification and newest list selection', async () => {
  const long = 'ws://127.0.0.1/' + 'a'.repeat(300),
    expanded = 'ws://127.0.0.1/' + '界'.repeat(30);
  expect(expanded.length).toBeLessThan(256);
  expect(() => checkedEndpoint(expanded, 'local', true)).toThrow();
  const old = list([urls[7]], 99),
    valid = list([urls[0], long, expanded, 'wss://public.example', targets.relay]);
  const invalid = { ...list([urls[1]], 101), sig: '0'.repeat(128) };
  const result = await resolveOutbox(async () => [old, valid, invalid], author, targets, 'local');
  expect(result).toMatchObject({
    source: 'nip65',
    eventId: valid.id,
    relays: [urls[0]],
    ignored: 3,
  });
  expect(
    await resolveOutbox(
      async () => [list([targets.relay.slice(0, -1), urls[0]])],
      author,
      targets,
      'local',
    ),
  ).toMatchObject({ relays: [urls[0]] });
});

test('optional delivery runs at most four destinations concurrently and keeps per-destination event order', async () => {
  const state: CopyState = { mirrors: {} },
    received = new Map<string, string[]>();
  let active = 0,
    peak = 0,
    closes = 0;
  await copyPublication({
    pubkey: author,
    targets,
    network: 'local',
    events,
    state,
    io: () => ({
      read: async () => [list(urls)],
      close: () => {
        closes++;
      },
      ensure: async (url, e) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        received.set(url, [...(received.get(url) ?? []), e.id]);
        active--;
      },
    }),
    save: async () => {
      // Inventory is persisted before the first network write.
      if (!received.size) expect(state.outboxHistory).toEqual(urls);
      outboxSchema.parse(state.outbox);
    },
  });
  expect(peak).toBe(4);
  expect(closes).toBe(1);
  expect(Object.values(state.outbox!.copies)).toEqual(Array(8).fill(true));
  for (const relay of urls) expect(received.get(relay)).toEqual(events.map((e) => e.id));
});

test('one deadline covers lookup, mirrors and outbox copies; queued destinations get retry diagnostics', async () => {
  const state: CopyState = { mirrors: {} };
  let calls = 0,
    closed = false;
  const started = Date.now();
  await copyPublication({
    pubkey: author,
    targets: { ...targets, mirrors: [urls[7]] },
    network: 'local',
    events,
    state,
    timeoutMs: 70,
    io: (signal) => ({
      read: async () => [list(urls)],
      close: () => {
        closed = true;
      },
      ensure: async () => {
        calls++;
        await new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
    }),
    save: async () => {},
  });
  expect(Date.now() - started).toBeLessThan(1000);
  expect(calls).toBe(4);
  expect(closed).toBe(true);
  expect(state.mirrors[urls[7]]).toBe(false);
  expect(Object.keys(state.outbox!.errors)).toHaveLength(7);
  for (const failure of Object.values(state.outbox!.errors))
    expect(failure.diagnostic).toMatchObject({ code: 'OPTIONAL_COPY_TIMEOUT', retryable: true });
  const lookupState: CopyState = { mirrors: {} };
  await copyPublication({
    pubkey: author,
    targets,
    network: 'local',
    events,
    state: lookupState,
    timeoutMs: 30,
    io: () => ({
      read: async () => new Promise(() => {}),
      ensure: async () => {
        throw new Error('must not send after lookup deadline');
      },
      close() {},
    }),
    save: async () => {},
  });
  expect(lookupState.outbox!.lookupError!.code).toBe('OPTIONAL_COPY_TIMEOUT');
  expect(lookupState.outboxHistory).toEqual([]);
});

test('destination history survives changed lists and partial failures; a full history skips new copies', async () => {
  const state: CopyState = { mirrors: {} };
  let currentList = list([urls[0]]),
    failed = true;
  const options = {
    pubkey: author,
    targets,
    network: 'local' as const,
    events,
    state,
    io: () => ({
      read: async () => [currentList],
      close() {},
      ensure: async (_url: string, e: any) => {
        if (failed && e.kind === 35129) throw new Error('fixture partial delivery');
      },
    }),
    save: async () => {},
  };
  await copyPublication(options);
  expect(state.outbox!.copies[urls[0]]).toBe(false);
  currentList = list([urls[1]], 101);
  failed = false;
  await copyPublication(options);
  expect(state.outbox!.relays).toEqual([urls[1]]);
  expect(publicationDestinations([{ ...state, plan: { targets } }])).toEqual([
    targets.relay,
    urls[0],
    urls[1],
  ]);
  state.outboxHistory = Array.from(
    { length: MAX_KNOWN_COPY_RELAYS },
    (_, i) => `ws://127.0.0.1:${6000 + i}/`,
  );
  state.outbox = undefined;
  let writes = 0;
  await copyPublication({
    ...options,
    io: () => ({
      read: async () => [currentList],
      ensure: async () => {
        writes++;
      },
      close() {},
    }),
  });
  expect(writes).toBe(0);
  expect(state.outbox!.ignored).toBe(1);
  expect(state.outboxHistory).toHaveLength(MAX_KNOWN_COPY_RELAYS);
});

test('real relay cancellation stops the optional phase and prevents later events after a delayed acknowledgement', async () => {
  const sent: number[] = [],
    timers: ReturnType<typeof setTimeout>[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('upgrade', { status: 400 });
    },
    websocket: {
      message(ws, data) {
        const message = JSON.parse(String(data));
        if (message[0] === 'REQ') ws.send(JSON.stringify(['EOSE', message[1]]));
        else if (message[0] === 'EVENT') {
          sent.push(message[1].kind);
          timers.push(
            setTimeout(() => ws.send(JSON.stringify(['OK', message[1].id, true, 'saved'])), 400),
          );
        }
      },
    },
  });
  const url = `ws://127.0.0.1:${server.port}/`;
  const state: CopyState = { mirrors: {} },
    started = Date.now();
  try {
    await copyPublication({
      pubkey: author,
      targets,
      network: 'local',
      events,
      state,
      timeoutMs: 150,
      io: (signal) => {
        const relays = new PublicationRelays(signal);
        return {
          read: async () => [list([url])],
          ensure: relays.ensure.bind(relays),
          close: () => relays.close(),
        };
      },
      save: async () => {},
    });
    expect(Date.now() - started).toBeLessThan(1200);
    expect(state.outbox!.copies[url]).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(sent).toEqual([5129]); // No current manifest is sent after the deadline.
  } finally {
    for (const timer of timers) clearTimeout(timer);
    await server.stop(true);
  }
});

test('cancelling a required relay acknowledgement preserves the actionable publication-cancelled cause', async () => {
  const controller = new AbortController();
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('upgrade', { status: 400 });
    },
    websocket: {
      message(ws, data) {
        const message = JSON.parse(String(data));
        if (message[0] === 'REQ') ws.send(JSON.stringify(['EOSE', message[1]]));
        else if (message[0] === 'EVENT') controller.abort();
      },
    },
  });
  const relays = new PublicationRelays(controller.signal);
  try {
    await expect(relays.ensure(`ws://127.0.0.1:${server.port}/`, events[0])).rejects.toMatchObject({
      code: 'PUBLISH_CANCELLED',
      stage: 'relay',
      retryable: true,
    });
  } finally {
    relays.close();
    await server.stop(true);
  }
});
