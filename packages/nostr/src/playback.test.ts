import { test, expect } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { PlaybackNostr, playbackFilters } from './playback';

test('playback relay reads validate signatures and filters, deduplicate, and close without publishing', async () => {
  const key = new Uint8Array(32);
  key[31] = 2;
  const event = finalizeEvent(
    { kind: 1, tags: [], content: 'hello', created_at: Math.floor(Date.now() / 1000) },
    key,
  );
  const wrongKind = finalizeEvent(
    { kind: 2, tags: [], content: 'wrong kind', created_at: event.created_at },
    key,
  );
  const requests: unknown[][] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      message(ws, raw) {
        const message = JSON.parse(String(raw));
        requests.push(message);
        if (message[0] === 'REQ') {
          for (const e of [event, event, { ...event, content: 'forged' }, wrongKind])
            ws.send(JSON.stringify(['EVENT', message[1], e]));
          ws.send(JSON.stringify(['EOSE', message[1]]));
        }
      },
    },
  });
  const delivered: Record<string, unknown>[] = [];
  const client = new PlaybackNostr(
    [`ws://127.0.0.1:${relay.port}/`],
    (m) => delivered.push(m),
    () => null,
  );
  try {
    const result = await client.handle({ type: 'outbox.query', filters: { kinds: [1], limit: 5 } });
    expect(result).toMatchObject({ events: [{ event }], incomplete: false });
    await client.handle({
      type: 'relay.subscribe',
      subId: 'one',
      filters: { kinds: [1], limit: 5 },
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(delivered.filter((m) => m.type === 'relay.event')).toHaveLength(1);
    expect(delivered.some((m) => m.type === 'relay.eose')).toBe(true);
    await expect(client.handle({ type: 'relay.publish', event })).rejects.toThrow('disabled');
    await client.handle({
      type: 'relay.subscribe',
      subId: 'escape',
      relay: 'wss://127.0.0.1/',
      filters: {},
    });
    expect(
      delivered.find((message) => message.type === 'relay.closed' && message.subId === 'escape')
        ?.reason,
    ).toContain('not allowed');
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const before = requests.filter((r) => r[0] === 'REQ').length;
    expect(await client.query([{ kinds: [1] }])).toEqual([]);
    expect(requests.filter((r) => r[0] === 'REQ')).toHaveLength(before);
    expect(requests.some((r) => r[0] === 'EVENT' || r[0] === 'AUTH')).toBe(false);
    expect(delivered.some((m) => m.type === 'relay.closed')).toBe(true);
  } finally {
    client.close();
    relay.stop(true);
  }
});
test('playback filters are bounded and guest identity is explicit', async () => {
  for (const input of [
    { limit: 10000 },
    { authors: ['bad-key'] },
    Array(5).fill({}),
    { secret: ['x'] },
  ])
    expect(() => playbackFilters(input)).toThrow();
  const client = new PlaybackNostr(
    [],
    () => {},
    () => null,
  );
  expect(await client.identity('getPublicKey')).toEqual({ pubkey: '' });
  expect(await client.identity('getFollows')).toEqual({ pubkeys: [] });
  expect(await client.handle({ type: 'outbox.query', filters: {} })).toMatchObject({
    events: [],
    incomplete: true,
  });
  await expect(client.common({ type: 'common.follow', pubkeys: [] })).rejects.toThrow('disabled');
  client.close();
});

test('identity relay preferences use the latest verified NIP-65 record and route public write relays', async () => {
  const key = new Uint8Array(32);
  key[31] = 3;
  const now = Math.floor(Date.now() / 1000);
  const record = (tags: string[][], created_at = now) =>
    finalizeEvent({ kind: 10002, tags, content: '', created_at }, key);
  const latest = record([
    ['r', 'wss://both.example'],
    ['r', 'wss://read.example', 'read'],
    ['r', 'wss://write.example', 'write'],
    ['r', 'wss://merge.example', 'read'],
    ['r', 'wss://merge.example/', 'write'],
    ['r', 'https://invalid.example'],
    ['r', 'wss://unknown.example', 'other'],
    ['r', 'broken'],
    ['r', 'wss://user:secret@credentials.example'],
  ]);
  const old = record([['r', 'wss://old.example']], now - 1);
  let reads = 0;
  const relay = Bun.serve({
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
        reads++;
        for (const event of [old, latest, { ...latest, created_at: now + 1 }])
          ws.send(JSON.stringify(['EVENT', message[1], event]));
        ws.send(JSON.stringify(['EOSE', message[1]]));
      },
    },
  });
  let pubkey: string | null = latest.pubkey;
  const allowed = [`ws://127.0.0.1:${relay.port}/`];
  const client = new PlaybackNostr(
    allowed,
    () => {},
    () => pubkey,
  );
  try {
    expect(await client.identity('getRelays')).toEqual({
      relays: {
        'wss://both.example/': { read: true, write: true },
        'wss://read.example/': { read: true, write: false },
        'wss://write.example/': { read: false, write: true },
        'wss://merge.example/': { read: true, write: true },
      },
    });
    expect(await client.plan([latest.pubkey])).toMatchObject({
      relays: ['wss://both.example/', 'wss://write.example/', 'wss://merge.example/'],
      source: 'nip65',
    });
    await expect(
      client.handle({ type: 'relay.query', relay: 'wss://192.168.1.1/', filters: {} }),
    ).rejects.toThrow('not allowed');
    const before = reads;
    pubkey = null;
    expect(await client.identity('getRelays')).toEqual({ relays: {} });
    expect(reads).toBe(before);
    pubkey = 'f'.repeat(64);
    expect(await client.identity('getRelays')).toEqual({ relays: {} });
  } finally {
    client.close();
    relay.stop(true);
  }
});

test('COMMON nrelay encodes and decodes a public TLV identifier without exposing secrets', async () => {
  const client = new PlaybackNostr(
    [],
    () => {},
    () => null,
  );
  try {
    const encoded = await client.common({
      type: 'common.encodeNip19',
      input: { type: 'nrelay', relay: 'wss://relay.example/' },
    });
    expect(encoded).toMatchObject({ ok: true, nip19Type: 'nrelay' });
    expect(
      await client.common({
        type: 'common.decodeNip19',
        value: 'value' in encoded ? encoded.value : undefined,
      }),
    ).toEqual({ ok: true, nip19Type: 'nrelay', relay: 'wss://relay.example/' });
    await expect(
      client.common({
        type: 'common.encodeNip19',
        input: { type: 'nrelay', relay: 'https://not-a-relay.example/' },
      }),
    ).rejects.toThrow();
  } finally {
    client.close();
  }
});
