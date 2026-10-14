import { test, expect } from 'bun:test';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { NappletOutbox, OutboxPublisher } from './outbox-session';
import type { SignedEvent } from '../../protocol/src';
const key = new Uint8Array(32).fill(37);
const template = { kind: 1, content: 'hello', tags: [], created_at: 1700000000 };
function fixture(overrides: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const state = {
    signs: 0,
    prompts: 0,
    writes: [] as SignedEvent[],
    deny: false,
    reject: '',
    delay: async () => {},
  };
  const session = new NappletOutbox({
    pubkey: getPublicKey(key),
    signal: controller.signal,
    sign: async (_, event) => {
      state.signs++;
      await state.delay();
      return finalizeEvent(event, key);
    },
    consent: async () => {
      state.prompts++;
      return !state.deny;
    },
    plan: async () => ['wss://a.example/', 'wss://b.example/'],
    io: {
      publish: async (relay, event) => {
        state.writes.push(event);
        if (state.reject === relay)
          throw new Error('restricted: storage quota exceeded; token=hidden-value');
      },
    },
    ...overrides,
  });
  return { session, state, controller };
}
test('one immutable signature, strict fanout, replay ID deduplication and conflicting ID rejection', async () => {
  const f = fixture();
  const message = { id: 'one', event: template };
  const [a, b] = await Promise.all([f.session.handle(message), f.session.handle(message)]);
  expect(a).toEqual(b);
  expect(a.ok).toBe(true);
  expect(f.state.signs).toBe(1);
  expect(f.state.writes).toHaveLength(2);
  expect(f.state.writes[0]).toEqual(f.state.writes[1]);
  expect(
    (await f.session.handle({ ...message, event: { ...template, content: 'changed' } })).ok,
  ).toBe(false);
  expect(f.state.signs).toBe(1);
  f.session.close();
});
test('partial required delivery returns event and full per-relay map, preserving safe cause', async () => {
  const f = fixture();
  f.state.reject = 'wss://b.example/';
  const result = await f.session.handle({ id: 'partial', event: template });
  expect(result.ok).toBe(false);
  expect(result.eventId).toBeDefined();
  expect(result.relays).toEqual({ 'wss://a.example/': true, 'wss://b.example/': false });
  expect(result.error).toContain('storage quota exceeded');
  expect(result.error).not.toContain('hidden-value');
  f.session.close();
});
test('consent denial, failed routing and protected kinds never sign', async () => {
  const f = fixture();
  f.state.deny = true;
  expect((await f.session.handle({ id: 'deny', event: template })).ok).toBe(false);
  for (const kind of [30078, 35858, 5])
    expect(
      (await f.session.handle({ id: String(kind), event: { ...template, kind } })).error,
    ).toContain('policy-denied');
  expect(f.state.signs).toBe(0);
  expect(f.state.writes).toHaveLength(0);
  f.session.close();
  const missing = fixture({
    plan: async () => {
      throw new Error('Required inbox unavailable.');
    },
  });
  expect((await missing.session.handle({ id: 'missing', event: template })).error).toContain(
    'Required inbox',
  );
  expect(missing.state.prompts).toBe(0);
  missing.session.close();
});
test('late signer after timeout or close cannot publish', async () => {
  for (const close of [false, true]) {
    const f = fixture({ requestTimeoutMs: 20 });
    let release!: () => void;
    f.state.delay = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    const pending = f.session.handle({ id: 'late', event: template });
    await Bun.sleep(5);
    if (close) f.session.close();
    expect((await pending).ok).toBe(false);
    release();
    await Bun.sleep(5);
    expect(f.state.writes).toHaveLength(0);
    f.session.close();
  }
});
test('real Applesauce relay transport receives OK/rejection and preserves exact signed bytes', async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response('websocket')),
    websocket: {
      message(socket, data) {
        const message = JSON.parse(String(data));
        if (message[0] !== 'EVENT') return;
        received.push(message[1]);
        socket.send(
          JSON.stringify([
            'OK',
            message[1].id,
            message[1].content !== 'reject',
            'restricted: storage quota exceeded; token=hidden-value',
          ]),
        );
      },
    },
  });
  const transport = new OutboxPublisher();
  const event = finalizeEvent(structuredClone(template), key);
  try {
    await transport.publish(`ws://127.0.0.1:${server.port}`, event, AbortSignal.timeout(3000));
    expect(received[0]).toEqual(JSON.parse(JSON.stringify(event)));
    await expect(
      transport.publish(
        `ws://127.0.0.1:${server.port}`,
        finalizeEvent({ ...template, content: 'reject' }, key),
        AbortSignal.timeout(3000),
      ),
    ).rejects.toThrow('storage quota exceeded');
    expect(received).toHaveLength(2);
  } finally {
    transport.close();
    server.stop(true);
  }
});
test('mutated signer response and signed-field input fail without transport writes', async () => {
  const f = fixture({
    sign: async (_: string, value: typeof template) =>
      finalizeEvent({ ...value, content: 'changed' }, key),
  });
  expect((await f.session.handle({ id: 'mismatch', event: template })).error).toContain(
    'signer-mismatch',
  );
  expect(
    (await f.session.handle({ id: 'signed', event: { ...template, pubkey: getPublicKey(key) } }))
      .error,
  ).toContain('invalid-event');
  expect(f.state.writes).toHaveLength(0);
  f.session.close();
});
test('request replay accounting never evicts an already signed request', async () => {
  const f = fixture();
  f.state.deny = true;
  for (let i = 0; i < 256; i++) await f.session.handle({ id: String(i), event: template });
  expect((await f.session.handle({ id: 'overflow', event: template })).error).toContain(
    'publication-limit',
  );
  expect(f.state.prompts).toBe(256);
  await f.session.handle({ id: '0', event: template });
  expect(f.state.prompts).toBe(256);
  f.session.close();
});
test('NIP-01 empty tag arrays are preserved by exact signing', async () => {
  const f = fixture();
  const result = await f.session.handle({ id: 'empty-tag', event: { ...template, tags: [[]] } });
  expect(result.ok).toBe(true);
  expect(f.state.writes[0].tags).toEqual([[]]);
  f.session.close();
});
test('publication replay cache has a 16 MiB byte budget as well as count bound', async () => {
  const f = fixture();
  f.state.deny = true;
  let rejected = false;
  for (let i = 0; i < 256; i++) {
    const result = await f.session.handle({
      id: String(i),
      event: { ...template, content: 'a'.repeat(65536) },
    });
    if (String(result.error).includes('publication-limit')) {
      rejected = true;
      break;
    }
  }
  expect(rejected).toBe(true);
  expect(f.state.prompts).toBeLessThan(256);
  f.session.close();
});
test('lost acknowledgement retries identical event once and close prevents future writes', async () => {
  const received: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response('websocket')),
    websocket: {
      message(socket, data) {
        const message = JSON.parse(String(data));
        if (message[0] !== 'EVENT') return;
        received.push(message[1]);
        if (received.length === 2) socket.send(JSON.stringify(['OK', message[1].id, true, '']));
      },
    },
  });
  const transport = new OutboxPublisher(30);
  try {
    const event = finalizeEvent(structuredClone(template), key);
    await transport.publish(`ws://127.0.0.1:${server.port}`, event, AbortSignal.timeout(3000));
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(received[1]);
    transport.close();
    await expect(
      transport.publish(`ws://127.0.0.1:${server.port}`, event, new AbortController().signal),
    ).rejects.toThrow();
    expect(received).toHaveLength(2);
  } finally {
    transport.close();
    server.stop(true);
  }
});
test('projected signed envelope admits the exact ASCII boundary and rejects one byte over before routing', async () => {
  const overhead = new TextEncoder().encode(
    JSON.stringify({
      ...template,
      content: '',
      id: '0'.repeat(64),
      pubkey: getPublicKey(key),
      sig: '0'.repeat(128),
    }),
  ).length;
  const valid = fixture();
  const result = await valid.session.handle({
    id: 'boundary',
    event: { ...template, content: 'x'.repeat(65536 - overhead) },
  });
  expect(result.ok).toBe(true);
  expect(valid.state.signs).toBe(1);
  expect(new TextEncoder().encode(JSON.stringify(result.event)).length).toBe(65536);
  valid.session.close();
  let plans = 0;
  const invalid = fixture({
    plan: async () => {
      plans++;
      return ['wss://a.example/'];
    },
  });
  const oversized = await invalid.session.handle({
    id: 'oversized',
    event: { ...template, content: 'x'.repeat(65537 - overhead) },
  });
  expect(oversized.error).toContain('signed event would exceed 64 KiB');
  expect(plans).toBe(0);
  expect(invalid.state.prompts).toBe(0);
  expect(invalid.state.signs).toBe(0);
  invalid.session.close();
});
test('projected envelope counts multibyte content and tags before consent or signing', async () => {
  for (const event of [
    { ...template, content: '🌱'.repeat(17000) },
    { ...template, tags: Array.from({ length: 9 }, () => ['t', '🌱'.repeat(2000)]) },
  ]) {
    let plans = 0;
    const f = fixture({
      plan: async () => {
        plans++;
        return ['wss://a.example/'];
      },
    });
    expect((await f.session.handle({ id: 'multibyte', event })).error).toContain(
      'signed event would exceed 64 KiB',
    );
    expect(plans).toBe(0);
    expect(f.state.prompts).toBe(0);
    expect(f.state.signs).toBe(0);
    f.session.close();
  }
});
