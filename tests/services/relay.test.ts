import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RelayPool } from 'applesauce-relay';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { lastValueFrom, toArray } from 'rxjs';
import { buildRelay, localFixtureTarget, seedLocalRelay } from '../../scripts/relay';
import { verifiedEvent } from '../../packages/protocol/src';

let directory: string;
let binary: string;
let child: ReturnType<typeof Bun.spawn> | undefined;
let url: string;
async function start() {
  child = Bun.spawn([binary], {
    env: {
      ...process.env,
      SPACE_SERVICE_DATA: join(directory, 'data'),
      SPACE_SERVICE_BIND: '127.0.0.1:0',
      SPACE_SERVICE_URL: 'https://relay.example',
      SPACE_SERVICE_ALIASES: 'https://napplet.example/relay',
      SPACE_SERVICE_INSTANCE: 'test',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = child.stdout as ReadableStream<Uint8Array>;
  const reader = output.getReader();
  let text = '';
  try {
    await Promise.race([
      (async () => {
        while (true) {
          const next = await reader.read();
          if (next.done) throw new Error('Relay exited before listening');
          text += new TextDecoder().decode(next.value);
          const match = text.match(/listening on http:\/\/(127\.0\.0\.1:\d+)/);
          if (match) {
            url = `ws://${match[1]}/relay`;
            return;
          }
        }
      })(),
      Bun.sleep(15_000).then(() => {
        throw new Error('Relay startup timed out');
      }),
    ]);
  } finally {
    reader.releaseLock();
  }
}
async function stop() {
  if (!child) return;
  child.kill('SIGTERM');
  const exit = await Promise.race([
    child.exited,
    Bun.sleep(12_000).then(() => {
      child?.kill('SIGKILL');
      throw new Error('Relay did not stop gracefully');
    }),
  ]);
  child = undefined;
  expect(exit).toBe(0);
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-relay-'));
  binary = join(directory, 'napplet-relay');
  await buildRelay(binary);
  await start();
}, 120_000);
afterAll(async () => {
  await stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('fixture publication refuses non-loopback destinations', () => {
  for (const address of [
    'wss://relay.damus.io',
    'ws://localhost:19347',
    'ws://127.0.0.1.evil.example',
    'ws://example.org',
    'ws://user:secret@127.0.0.1',
    'ws://127.0.0.1/private',
  ])
    expect(() => localFixtureTarget(address)).toThrow();
});
test('Applesauce publishes, verifies and idempotently seeds the real relay', async () => {
  expect(await seedLocalRelay(url)).toMatchObject({ events: 12, published: 12 });
  expect(await seedLocalRelay(url)).toMatchObject({ events: 12, published: 0 });
  const pool = new RelayPool();
  try {
    const found = await lastValueFrom(
      pool
        .relay(url)
        .request(
          { kinds: [35129], search: '"Soft orbit"', '#t': ['generative'], limit: 1 },
          { timeout: 5000, reconnect: false, waitForAuth: false },
        )
        .pipe(toArray()),
    );
    expect(found.map(verifiedEvent)).toHaveLength(1);
    expect(found[0].tags).toContainEqual(['title', 'Soft orbit']);
  } finally {
    pool.close();
  }
}, 20_000);
test('signed publications survive process restart', async () => {
  await stop();
  await start();
  expect(await seedLocalRelay(url)).toMatchObject({ events: 12, published: 0 });
  const info = await fetch(url.replace('ws:', 'http:'), {
    headers: { Accept: 'application/nostr+json' },
  }).then((r) => r.json());
  expect(info.supported_nips).toContain(50);
  expect(info.supported_nips).toContain(45);
  expect(info.supported_nips).toContain(77);
}, 20_000);

test('NIP-42 authenticates the direct URL before accepting protected events', async () => {
  const pool = new RelayPool();
  const relay = pool.relay(url);
  const key = generateSecretKey();
  const event = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      content: 'Local protected transport test',
      tags: [['-']],
    },
    key,
  );
  try {
    // Raw EVENT raises auth-required refusals in applesauce v7.
    await expect(lastValueFrom(relay.event(event))).rejects.toThrow(/^auth-required:/);
    expect(
      (await relay.authenticate({ signEvent: (template) => finalizeEvent(template, key) })).ok,
    ).toBe(true);
    expect((await lastValueFrom(relay.event(event))).ok).toBe(true);
  } finally {
    pool.close();
  }
}, 10_000);
