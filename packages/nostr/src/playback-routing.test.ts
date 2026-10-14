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

test('live OUTBOX swaps routes on verified store updates without duplicate events or EOSE exposure', async () => {
  const key = new Uint8Array(32).fill(29);
  const time = Math.floor(Date.now() / 1000);
  const note = finalizeEvent({ kind: 1, tags: [], content: 'live', created_at: time }, key);
  const list = (relay: string, created_at: number) =>
    finalizeEvent({ kind: 10002, tags: [['r', relay, 'write']], content: '', created_at }, key);
  const old = list('wss://old.example/', time - 1);
  const routes: string[][] = [];
  let active = 0;
  const delivered: Record<string, unknown>[] = [];
  const host = new PlaybackNostr(
    ['wss://fallback.example/'],
    (message) => delivered.push(message),
    () => null,
    {
      close() {},
      req: (relays, filters) =>
        new Observable((output) => {
          if (filters[0].kinds?.includes(10002)) {
            output.next({ type: 'EVENT', from: relays[0], event: old });
            relays.forEach((from) => output.next({ type: 'EOSE', from }));
            output.complete();
            return;
          }
          routes.push(relays);
          active++;
          output.next({ type: 'EVENT', from: relays[0], event: note });
          relays.forEach((from) => output.next({ type: 'EOSE', from }));
          return () => {
            active--;
          };
        }),
    },
  );
  try {
    await host.handle({
      type: 'outbox.subscribe',
      subId: 'live',
      filters: { kinds: [1], authors: [note.pubkey] },
      options: { timeoutMs: 100 },
    });
    host.events.ingest(list('wss://new.example/', time));
    await new Promise((resolve) => setTimeout(resolve, 130));
    expect(routes).toEqual([['wss://old.example/'], ['wss://new.example/']]);
    expect(delivered.filter((message) => message.type === 'outbox.event')).toHaveLength(1);
    expect(
      delivered.some(
        (message) => message.type === 'outbox.eose' || message.type === 'outbox.closed',
      ),
    ).toBe(false);
    expect(active).toBe(1);
    await host.handle({ type: 'outbox.close', subId: 'live' });
    await host.handle({ type: 'outbox.close', subId: 'live' });
    expect(active).toBe(0);
    expect(delivered.filter((message) => message.type === 'outbox.closed')).toHaveLength(1);
  } finally {
    host.close();
  }
});

test('close during relay discovery cancels transport and prevents a late live REQ', async () => {
  let active = 0;
  let requests = 0;
  const delivered: Record<string, unknown>[] = [];
  const host = new PlaybackNostr(
    ['wss://fallback.example/'],
    (message) => delivered.push(message),
    () => null,
    {
      close() {},
      req: () =>
        new Observable(() => {
          active++;
          requests++;
          return () => {
            active--;
          };
        }),
    },
  );
  try {
    const opening = host.handle({
      type: 'outbox.subscribe',
      subId: 'pending',
      filters: { authors: ['a'.repeat(64)] },
    });
    expect(active).toBe(1);
    await host.handle({ type: 'outbox.close', subId: 'pending' });
    await opening.catch(() => {});
    expect(active).toBe(0);
    expect(requests).toBe(1);
    expect(delivered.filter((message) => message.type === 'outbox.closed')).toHaveLength(1);
  } finally {
    host.close();
  }
});

test('observed relay hints merge only with explicit host disclosure and ID lookups reject mismatches', async () => {
  const event = finalizeEvent(
    { kind: 1, tags: [], content: 'verified', created_at: Math.floor(Date.now() / 1000) },
    new Uint8Array(32).fill(30),
  );
  const create = (discloseRelayHints: boolean) =>
    new PlaybackNostr(
      ['wss://one.example/', 'wss://two.example/'],
      () => {},
      () => null,
      {
        close() {},
        req: (relays) =>
          new Observable((output) => {
            for (const from of relays) output.next({ type: 'EVENT', from, event });
            for (const from of relays) output.next({ type: 'EOSE', from });
            output.complete();
          }),
      },
      { discloseRelayHints },
    );
  for (const disclose of [false, true]) {
    const host = create(disclose);
    try {
      const result = (await host.handle({ type: 'outbox.query', filters: { kinds: [1] } })) as {
        events: { sidecar?: { relayHints: string[] } }[];
      };
      expect(result.events).toHaveLength(1);
      expect(result.events[0].sidecar).toEqual(
        disclose ? { relayHints: ['wss://one.example/', 'wss://two.example/'] } : undefined,
      );
      expect(await host.handle({ type: 'outbox.getEvent', eventId: 'a'.repeat(64) })).toMatchObject(
        { result: undefined },
      );
    } finally {
      host.close();
    }
  }
});

test('live backfill limit survives route replacement while post-EOSE events remain live', async () => {
  const key = new Uint8Array(32).fill(32);
  const now = Math.floor(Date.now() / 1000);
  const events = ['one', 'two', 'three'].map((content) =>
    finalizeEvent({ kind: 1, content, tags: [], created_at: now }, key),
  );
  const delivered: Record<string, unknown>[] = [];
  const host = new PlaybackNostr(
    ['wss://relay.example/'],
    (message) => delivered.push(message),
    () => null,
    {
      close() {},
      req: (relays) =>
        new Observable((output) => {
          output.next({ type: 'EVENT', from: relays[0], event: events[0] });
          output.next({ type: 'EVENT', from: relays[0], event: events[1] });
          output.next({ type: 'EOSE', from: relays[0] });
          output.next({ type: 'EVENT', from: relays[0], event: events[2] });
        }),
    },
  );
  try {
    await host.handle({
      type: 'outbox.subscribe',
      subId: 'limited',
      filters: { kinds: [1] },
      options: { limit: 1 },
    });
    expect(
      delivered
        .filter((message) => message.type === 'outbox.event')
        .map((message) => (message.result as { event: { content: string } }).event.content),
    ).toEqual(['one', 'three']);
  } finally {
    host.close();
  }
});

test('terminal relay closure retains its bounded cause and is emitted once', async () => {
  const delivered: Record<string, unknown>[] = [];
  const host = new PlaybackNostr(
    ['wss://relay.example/'],
    (message) => delivered.push(message),
    () => null,
    {
      close() {},
      req: (relays) =>
        new Observable((output) => {
          output.next({ type: 'CLOSED', from: relays[0], reason: 'blocked: subscription quota' });
          output.complete();
        }),
    },
  );
  try {
    await host.handle({ type: 'outbox.subscribe', subId: 'failed', filters: { kinds: [1] } });
    await host.handle({ type: 'outbox.close', subId: 'failed' });
    const closed = delivered.filter((message) => message.type === 'outbox.closed');
    expect(closed).toHaveLength(1);
    expect(closed[0].reason).toContain('blocked: subscription quota');
  } finally {
    host.close();
  }
});

test('read transport cannot forge source hints or completion from an unselected relay', async () => {
  const event = finalizeEvent(
    { kind: 1, content: 'unselected', tags: [], created_at: Math.floor(Date.now() / 1000) },
    new Uint8Array(32).fill(33),
  );
  const host = new PlaybackNostr(
    ['wss://selected.example/'],
    () => {},
    () => null,
    {
      close() {},
      req: () =>
        new Observable((output) => {
          output.next({ type: 'EVENT', from: 'wss://unselected.example/', event });
          output.next({ type: 'EOSE', from: 'wss://unselected.example/' });
          output.complete();
        }),
    },
    { discloseRelayHints: true },
  );
  try {
    expect(await host.handle({ type: 'outbox.query', filters: { kinds: [1] } })).toMatchObject({
      events: [],
      incomplete: true,
    });
  } finally {
    host.close();
  }
});

test('an observed relay-list refresh cannot amplify stalled discovery on repeated metadata', async () => {
  const key = new Uint8Array(32).fill(35);
  const now = Math.floor(Date.now() / 1000);
  const list = (relay: string, time: number) =>
    finalizeEvent(
      { kind: 10002, content: '', tags: [['r', relay, 'write']], created_at: time },
      key,
    );
  const old = list('wss://old.example/', now - 1);
  const newer = list('wss://new.example/', now);
  let discoveries = 0;
  let active = 0;
  const host = new PlaybackNostr(
    ['wss://fallback.example/'],
    () => {},
    () => null,
    {
      close() {},
      req: (relays, filters) =>
        new Observable((output) => {
          active++;
          if (filters[0].kinds?.includes(10002)) {
            discoveries++;
            if (discoveries === 1) {
              output.next({ type: 'EVENT', from: relays[0], event: old });
              output.next({ type: 'EOSE', from: relays[0] });
              output.complete();
            } else {
              output.next({ type: 'EVENT', from: relays[0], event: newer });
              output.next({ type: 'EVENT', from: relays[0], event: newer });
            }
          }
          return () => {
            active--;
          };
        }),
    },
  );
  try {
    await host.handle({
      type: 'outbox.subscribe',
      subId: 'bounded',
      filters: { authors: [old.pubkey], kinds: [1] },
      options: { timeoutMs: 300 },
    });
    host.events.ingest(newer);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(discoveries).toBe(2);
    expect(active).toBe(2);
    await host.handle({ type: 'outbox.close', subId: 'bounded' });
    expect(active).toBe(0);
    expect(discoveries).toBe(2);
  } finally {
    host.close();
  }
});

test('query failures retain relay cause and target while redacting secrets through handle', async () => {
  const event = finalizeEvent(
    { kind: 1, content: 'partial survives', tags: [], created_at: Math.floor(Date.now() / 1000) },
    new Uint8Array(32).fill(37),
  );
  const host = new PlaybackNostr(
    ['wss://selected.example/'],
    () => {},
    () => null,
    {
      close() {},
      req: (relays) =>
        new Observable((output) => {
          output.next({ type: 'EVENT', from: relays[0], event });
          output.next({
            type: 'CLOSED',
            from: relays[0],
            reason:
              'blocked: rate limited at wss://alice:credential-value@selected.example/?secret=query-secret token=token-secret',
          });
          output.complete();
        }),
    },
  );
  try {
    const result = (await host.handle({ type: 'outbox.query', filters: { kinds: [1] } })) as {
      events: unknown[];
      incomplete: boolean;
      error: string;
    };
    expect(result.events).toHaveLength(1);
    expect(result.incomplete).toBe(true);
    expect(result.error).toContain('blocked: rate limited');
    expect(result.error).toContain('Target: wss://selected.example/');
    for (const secret of ['credential-value', 'query-secret', 'token-secret'])
      expect(result.error).not.toContain(secret);
  } finally {
    host.close();
  }
});

test('query transport errors, timeouts and message quotas have distinct actionable errors', async () => {
  for (const mode of ['transport', 'timeout', 'quota'] as const) {
    const host = new PlaybackNostr(
      ['wss://selected.example/'],
      () => {},
      () => null,
      {
        close() {},
        req: (relays) =>
          new Observable((output) => {
            if (mode === 'transport')
              output.error(
                new Error('ECONNREFUSED: fixture relay unavailable password=never-disclose'),
              );
            if (mode === 'quota')
              for (let i = 0; i < 2000; i++) output.next({ type: 'NOTICE', from: relays[0] });
          }),
      },
    );
    try {
      const result = (await host.handle({
        type: 'outbox.query',
        filters: { kinds: [1] },
        options: { timeoutMs: 100 },
      })) as { error: string; incomplete: boolean };
      expect(result.incomplete).toBe(true);
      expect(result.error).toContain(
        mode === 'transport' ? 'ECONNREFUSED' : mode === 'timeout' ? 'timed out' : 'quota',
      );
      expect(result.error).toContain('selected.example');
      expect(result.error).not.toContain('never-disclose');
    } finally {
      host.close();
    }
  }
});

test('query actual websocket CLOSED preserves Applesauce group ERROR cause without leaking relay secrets', async () => {
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      message(socket, data) {
        const message = JSON.parse(String(data));
        if (message[0] === 'REQ')
          socket.send(
            JSON.stringify([
              'CLOSED',
              message[1],
              'restricted: fixture policy wss://user:secret-password@relay.example/?token=secret-query',
            ]),
          );
      },
    },
  });
  const host = new PlaybackNostr(
    [`ws://127.0.0.1:${relay.port}/`],
    () => {},
    () => null,
  );
  try {
    const result = (await host.handle({
      type: 'outbox.query',
      filters: { kinds: [1] },
      options: { timeoutMs: 1000 },
    })) as { error: string; incomplete: boolean };
    expect(result.incomplete).toBe(true);
    expect(result.error).toContain('restricted: fixture policy');
    expect(result.error).toContain(`127.0.0.1:${relay.port}`);
    expect(result.error).not.toContain('secret-password');
    expect(result.error).not.toContain('secret-query');
  } finally {
    host.close();
    relay.stop(true);
  }
});

test('invalid subscribe emits one useful terminal lifecycle and unknown close acknowledges once', async () => {
  const delivered: Record<string, unknown>[] = [];
  const host = new PlaybackNostr(
    ['wss://selected.example/'],
    (message) => delivered.push(message),
    () => null,
    {
      close() {},
      req: () => new Observable(() => {}),
    },
  );
  try {
    expect(
      await host.handle({ type: 'outbox.subscribe', subId: 'invalid', filters: { limit: 10000 } }),
    ).toEqual({});
    await host.handle({ type: 'outbox.close', subId: 'invalid' });
    const terminal = delivered.filter((message) => message.subId === 'invalid');
    expect(terminal).toHaveLength(1);
    expect(terminal[0].type).toBe('outbox.closed');
    expect(terminal[0].reason).toContain('limit');
    await host.handle({ type: 'outbox.close', subId: 'unknown' });
    await host.handle({ type: 'outbox.close', subId: 'unknown' });
    expect(delivered.filter((message) => message.subId === 'unknown')).toEqual([
      {
        type: 'outbox.closed',
        subId: 'unknown',
        reason: 'Subscription already closed or unknown.',
      },
    ]);
  } finally {
    host.close();
  }
});
