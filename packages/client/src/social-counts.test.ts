import { test, expect } from 'bun:test';
import { finalizeEvent, type Filter } from 'nostr-tools';
import { RelayPool } from 'applesauce-relay';
import { createCountService } from 'applesauce-loaders/loaders';
import { filter, firstValueFrom, type Observable } from 'rxjs';
import { countTarget, firstCountRelay, likesMetric } from './social-counts';
import { socialScope } from '../../protocol/src/social';
import fixtures from '../../backend/data/catalog.json';

const author = new Uint8Array(32);
author[31] = 1; // Public fixture key only.

test('the count relay is the first configured relay advertising NIP-45, without waiting on later ones', async () => {
  const supported: Record<string, Promise<number[] | null>> = {
    'wss://a': Promise.resolve([1, 11]),
    'wss://b': new Promise((resolve) => setTimeout(resolve, 20, [1, 45])),
    'wss://c': Promise.resolve([45]),
    'wss://d': new Promise(() => {}), // Never answers.
  };
  const relays = Object.keys(supported);
  expect(await firstCountRelay(relays, (url) => supported[url])).toBe('wss://b');
  expect(
    await firstCountRelay(['wss://a', 'wss://d'], (url) => supported[url], 30),
  ).toBeUndefined();
  expect(
    await firstCountRelay(['wss://x', 'wss://c'], (url) =>
      url === 'wss://x' ? Promise.reject(new Error('offline')) : supported[url],
    ),
  ).toBe('wss://c');
});

test('addressed napplets count likes and comments across revisions; pinned snapshots by ID', async () => {
  const addressed = finalizeEvent(fixtures[0].current, author);
  const scope = socialScope(addressed);
  expect(scope.address).toBeTruthy();
  const target = countTarget(addressed);
  expect(target.address).toBe(scope.address!);
  expect(likesMetric.filters(target)).toEqual([{ kinds: [7], '#a': [scope.address!] }]);
  expect(likesMetric.filters({ ...target, address: undefined })).toEqual([
    { kinds: [7], '#e': [addressed.id] },
  ]);

  const counted: Filter[][] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(r, server) {
      if (server.upgrade(r)) return;
      return new Response();
    },
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] !== 'COUNT') return;
        counted.push(m.slice(2));
        socket.send(JSON.stringify(['COUNT', m[1], { count: m[2].kinds[0] === 7 ? 3 : 0 }]));
      },
    },
  });
  const pool = new RelayPool();
  const counts = createCountService(pool, { relays: [`ws://127.0.0.1:${relay.port}`] });
  try {
    const handle = counts.event(target);
    const answered = <T extends { value?: number }>(source: Observable<T>) =>
      firstValueFrom(source.pipe(filter((s) => s.value !== undefined)));
    const [likes, comments] = await Promise.all([
      answered(handle.metric(likesMetric)),
      answered(handle.comments),
    ]);
    // Zero is an answer, not a missing value.
    expect([likes.value, comments.value]).toEqual([3, 0]);
    expect(counted).toContainEqual([{ kinds: [7], '#a': [scope.address!] }]);
    expect(counted).toContainEqual([{ kinds: [1111], '#A': [scope.address!] }]);
  } finally {
    counts.stop();
    pool.close();
    relay.stop(true);
  }
});
