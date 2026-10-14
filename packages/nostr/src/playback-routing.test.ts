import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { Observable } from 'rxjs';
import { PlaybackNostr, type PlaybackReadPool } from './playback';

test('mixed-author OUTBOX queries read resolved write relays plus fallback and report missing coverage', async () => {
  const key = new Uint8Array(32).fill(43);
  const list = finalizeEvent(
    {
      kind: 10002,
      tags: [['r', 'wss://author.example', 'write']],
      content: '',
      created_at: Math.floor(Date.now() / 1000),
    },
    key,
  );
  const requested: string[][] = [];
  const host = new PlaybackNostr(
    ['wss://fallback.example/'],
    () => {},
    () => null,
    {
      close() {},
      req: (relays, filters) =>
        new Observable((output) => {
          requested.push(relays);
          for (const from of relays) {
            if (filters[0].kinds?.includes(10002))
              output.next({ type: 'EVENT', from, event: list });
            output.next({ type: 'EOSE', from });
          }
          output.complete();
        }),
    },
  );
  try {
    expect(
      await host.handle({
        type: 'outbox.query',
        filters: { kinds: [1], authors: [list.pubkey, 'a'.repeat(64)] },
      }),
    ).toMatchObject({ events: [], incomplete: true });
    expect(requested[1]).toEqual(['wss://author.example/', 'wss://fallback.example/']);
    // Fresh signed list reused; unresolved authors are discovered again.
    expect(
      await host.handle({ type: 'outbox.resolveRelays', target: { pubkey: list.pubkey } }),
    ).toEqual({ plan: { relays: ['wss://author.example/'], source: 'cache', missingAuthors: [] } });
    expect(requested).toHaveLength(2);
  } finally {
    host.close();
  }
});

test('explicit hints cannot hide OUTBOX relay coverage lost to the eight-relay limit', async () => {
  const host = new PlaybackNostr(
    ['wss://fallback.example/'],
    () => {},
    () => null,
    {
      close() {},
      req: (relays) =>
        new Observable((output) => {
          relays.forEach((from) => output.next({ type: 'EOSE', from }));
          output.complete();
        }),
    },
  );
  try {
    const relays = Array.from({ length: 8 }, (_, i) => `wss://hint${i}.example/`);
    expect(
      await host.handle({ type: 'outbox.query', filters: { kinds: [1] }, options: { relays } }),
    ).toMatchObject({ events: [], incomplete: true });
  } finally {
    host.close();
  }
});

test('explicit app-data storage reads do not contact unrelated discovery relays or require a NIP-65 profile', async () => {
  const requested: string[] = [];
  const host = new PlaybackNostr(
    ['wss://offline.example/'],
    () => {},
    () => null,
    {
      close() {},
      req: (relays) =>
        new Observable((output) => {
          for (const from of relays) {
            requested.push(from);
            if (from === 'wss://storage.example/') output.next({ type: 'EOSE', from });
          }
        }),
    },
  );
  try {
    const result = await host.handle({
      type: 'outbox.query',
      filters: {
        kinds: [30078],
        '#d': ['soy.app-data/1:scope:tracks:one'],
        authors: ['a'.repeat(64)],
      },
      options: { relays: ['wss://storage.example/'], timeoutMs: 500 },
    });
    expect(result).toMatchObject({ events: [], incomplete: false });
    expect(requested).toEqual(['wss://storage.example/']);
  } finally {
    host.close();
  }
});

test('an explicit station relay hint is read even when discovery relays do not have its event', async () => {
  const station = finalizeEvent(
    {
      kind: 31237,
      tags: [['d', 'station']],
      content: 'stream',
      created_at: Math.floor(Date.now() / 1000),
    },
    new Uint8Array(32).fill(2),
  );
  const reads: string[] = [];
  const pool: PlaybackReadPool = {
    close() {},
    req: (relays, filters) =>
      new Observable((output) => {
        for (const from of relays) {
          reads.push(from);
          if (from === 'wss://station.example/' && filters[0].kinds?.includes(31237))
            output.next({ type: 'EVENT', from, event: station });
          output.next({ type: 'EOSE', from });
        }
        output.complete();
      }),
  };
  const host = new PlaybackNostr(
    ['wss://discovery.example/'],
    () => {},
    () => null,
    pool,
  );
  try {
    const result = await host.handle({
      type: 'outbox.query',
      filters: { kinds: [31237], authors: [station.pubkey], '#d': ['station'], limit: 10 },
      options: { relays: ['wss://station.example'], timeoutMs: 1000 },
    });
    // Missing NIP-65 metadata does not make a complete explicit-relay read partial.
    expect(result).toMatchObject({ events: [{ event: station }], incomplete: false });
    expect(reads).toContain('wss://station.example/');
  } finally {
    host.close();
  }
});

test('a stalled discovery and fallback still deliver all collected events before the caller times out', async () => {
  const events = ['first', 'second'].map((content) =>
    finalizeEvent(
      { kind: 1, tags: [], content, created_at: Math.floor(Date.now() / 1000) },
      new Uint8Array(32).fill(3),
    ),
  );
  let active = 0;
  const host = new PlaybackNostr(
    ['wss://fallback.example/'],
    () => {},
    () => null,
    {
      close() {},
      req: (_relays, filters) =>
        new Observable((output) => {
          active++;
          const timers = filters[0].kinds?.includes(1)
            ? events.map((event, i) =>
                setTimeout(
                  () => output.next({ type: 'EVENT', from: 'wss://station.example/', event }),
                  20 + i * 150,
                ),
              )
            : [];
          // No EOSE: the deadline must return the verified partial collection.
          return () => {
            active--;
            timers.forEach(clearTimeout);
          };
        }),
    },
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      host.handle({
        type: 'outbox.query',
        filters: { kinds: [1], authors: [events[0].pubkey] },
        options: { relays: ['wss://station.example/'], timeoutMs: 800 },
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('caller timed out')), 800);
      }),
    ]);
    expect(result).toMatchObject({ events: events.map((event) => ({ event })), incomplete: true });
    expect(active).toBe(0);
  } finally {
    clearTimeout(timeout);
    host.close();
  }
});
