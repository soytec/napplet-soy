import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { RelayPool } from 'applesauce-relay';
import { lastValueFrom, toArray } from 'rxjs';
import { buildGrasp, graspBinary, graspVersion } from '../../scripts/grasp-build';
import { graspEnvironment, graspHealth, seedLocalGrasp } from '../../scripts/grasp';
import {
  prepareSource,
  publishSource,
  sourceGit,
  sourceUrls,
  graspOrigin,
  type SourcePublication,
} from '../../packages/grasp/src/client';

let directory: string;
let origin: string;
let child: ReturnType<typeof Bun.spawn> | undefined;
let publication: SourcePublication;
let repo: string;
let boundPort = 0;
const owner = new PrivateKeySigner();
let operatorKey: string;
let logs = '';
async function start(local = true) {
  const state = join(directory, local ? 'state' : 'production-state');
  await mkdir(state, { recursive: true });
  child = Bun.spawn([graspBinary], {
    cwd: state,
    env: {
      ...graspEnvironment({
        origin: local ? `http://127.0.0.1:${boundPort || 1}` : 'https://git.napplet.example',
        directory: state,
        local,
        instance: 'test',
        bind: `127.0.0.1:${boundPort}`,
      }),
      NGIT_DOMAIN: local ? (boundPort ? `127.0.0.1:${boundPort}` : '') : 'git.napplet.example',
      // Local mode must not adopt credentials or network defaults from a production shell.
      ...(local
        ? {
            NGIT_RELAY_OWNER_NSEC: 'invalid-production-value-must-be-ignored',
            NGIT_USER_INDEX_RELAYS: 'wss://must-not-contact.invalid',
            NGIT_SYNC_PLUS_ENABLED: 'true',
          }
        : {}),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timeout = setTimeout(() => child?.kill('SIGKILL'), 15000);
  const output = child.stdout as ReadableStream<Uint8Array>;
  const errors = child.stderr as ReadableStream<Uint8Array>;
  const reader = output.getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done)
        throw new Error(`GRASP did not start: ${logs}\n${await new Response(errors).text()}`);
      logs += new TextDecoder().decode(part.value);
      const match = logs.match(/Starting HTTP server on 127\.0\.0\.1:(\d+)/);
      if (match) {
        boundPort = Number(match[1]);
        origin = `http://127.0.0.1:${boundPort}`;
        break;
      }
    }
  } finally {
    clearTimeout(timeout);
    reader.releaseLock();
  }
  // Drain logs so the native service cannot block on its stdout pipe.
  void (async () => {
    for await (const chunk of output) logs += new TextDecoder().decode(chunk);
  })();
  for (let i = 0; i < 50; i++) {
    if (await graspHealth(origin)) return;
    await Bun.sleep(100);
  }
  throw new Error('GRASP listener is not ready');
}
async function stop(force = false) {
  if (!child || child.exitCode !== null) return;
  child.kill(force ? 'SIGKILL' : 'SIGTERM');
  const timer = setTimeout(() => child?.kill('SIGKILL'), 14000);
  try {
    const code = await child.exited;
    if (!force) expect(code).toBe(0);
  } finally {
    clearTimeout(timer);
    child = undefined;
    logs = '';
  }
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-grasp-'));
  await buildGrasp();
  await start();
  operatorKey = (await graspHealth(origin))!.pubkey;
  repo = join(directory, 'source');
  await mkdir(repo);
  await sourceGit(repo, ['init', '--initial-branch=main']);
  await Bun.write(join(repo, 'index.html'), '<!doctype html><h1>Source round trip</h1>');
  await sourceGit(repo, ['add', 'index.html']);
  await sourceGit(repo, ['commit', '-m', 'First source revision']);
}, 600000);
afterAll(async () => {
  await stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('upstream NIP-11 advertises the pinned build and local mode generates a persistent private service key', async () => {
  expect(await graspHealth(origin)).toMatchObject({
    version: await graspVersion(),
    name: 'Napplet Space Git (test)',
  });
  expect((await graspHealth(origin))!.supported_grasps).not.toContain('GRASP-03');
  expect((await stat(join(directory, 'state/.relay-owner.nsec'))).mode & 0o777).toBe(0o600);
  expect(logs).not.toContain('Connected to wss://must-not-contact.invalid');
});
test('Git rejects an unannounced repository, then Applesauce authorizes a source push and independent clone', async () => {
  const urls = sourceUrls(origin, await owner.getPublicKey(), 'round-trip', true);
  await expect(sourceGit(repo, ['push', urls.clone, 'HEAD:refs/heads/main'])).rejects.toThrow();
  publication = await prepareSource({
    directory: repo,
    identifier: 'round-trip',
    title: 'Round trip',
    origin,
    signer: owner,
    local: true,
  });
  expect((await publishSource({ directory: repo, origin, publication, local: true })).changed).toBe(
    true,
  );
  const clone = join(directory, 'independent-clone');
  await sourceGit(directory, ['clone', urls.clone, clone]);
  expect(await Bun.file(join(clone, 'index.html')).text()).toContain('Source round trip');
  expect(await sourceGit(clone, ['rev-parse', 'HEAD'])).toBe(
    await sourceGit(repo, ['rev-parse', 'HEAD']),
  );
  expect((await publishSource({ directory: repo, origin, publication, local: true })).changed).toBe(
    false,
  );
});
test('a different signer or unsigned branch state cannot authorize a new Git tip', async () => {
  const urls = sourceUrls(origin, await owner.getPublicKey(), 'round-trip', true);
  await Bun.write(join(repo, 'index.html'), '<!doctype html><h1>Second source revision</h1>');
  await sourceGit(repo, ['add', 'index.html']);
  await sourceGit(repo, ['commit', '-m', 'Second revision']);
  await expect(
    sourceGit(repo, ['push', '--force', urls.clone, 'HEAD:refs/heads/main']),
  ).rejects.toThrow();
  const attacker = new PrivateKeySigner();
  const event = await attacker.signEvent({
    kind: 30618,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['d', 'round-trip'],
      ['refs/heads/main', await sourceGit(repo, ['rev-parse', 'HEAD'])],
      ['HEAD', 'ref: refs/heads/main'],
    ],
  });
  const pool = new RelayPool();
  try {
    await pool
      .relay(urls.relay)
      .publish(event, { timeout: 3000, retries: false, reconnect: false });
  } finally {
    pool.close();
  }
  await expect(
    sourceGit(repo, ['push', '--force', urls.clone, 'HEAD:refs/heads/main']),
  ).rejects.toThrow();
  publication = await prepareSource({
    directory: repo,
    identifier: 'round-trip',
    title: 'Round trip',
    origin,
    signer: owner,
    local: true,
    createdAt: publication.state.created_at + 1,
  });
  expect((await publishSource({ directory: repo, origin, publication, local: true })).changed).toBe(
    true,
  );
});
test('source refs, signed authorization and service identity survive process restart', async () => {
  for (const force of [false, true]) {
    await stop(force);
    await start();
    expect((await graspHealth(origin))!.pubkey).toBe(operatorKey);
    expect(
      (await publishSource({ directory: repo, origin, publication, local: true })).changed,
    ).toBe(false);
  }
}, 40000);
test('a non-maintainer hosts PR roots and updates on upstream immutable refs without a fork', async () => {
  const urls = sourceUrls(origin, await owner.getPublicKey(), 'round-trip', true);
  const contributor = new PrivateKeySigner();
  const branch = join(directory, 'forkless-contributor');
  await sourceGit(directory, ['clone', urls.clone, branch]);
  const before = await sourceGit(branch, ['ls-remote', '--heads', '--tags', urls.clone]);
  const base = await sourceGit(branch, ['rev-parse', 'HEAD']);
  const pool = new RelayPool();
  try {
    const relay = pool.relay(urls.relay);
    let root = '';
    for (const revision of [0, 1]) {
      await Bun.write(join(branch, 'contribution.txt'), `Revision ${revision}`);
      await sourceGit(branch, ['add', '.']);
      await sourceGit(branch, ['commit', '-m', `Contributor revision ${revision}`]);
      const commit = await sourceGit(branch, ['rev-parse', 'HEAD']);
      const event = await contributor.signEvent({
        kind: revision ? 1619 : 1618,
        created_at: Math.floor(Date.now() / 1000) + revision,
        content: 'Forkless contribution',
        tags: [
          ['a', `30617:${await owner.getPublicKey()}:round-trip`],
          ['p', await owner.getPublicKey()],
          ['c', commit],
          ['clone', urls.clone],
          ['merge-base', base],
          ...(revision
            ? [
                ['E', root],
                ['P', await contributor.getPublicKey()],
              ]
            : [
                ['subject', 'Forkless contribution'],
                ['branch-name', 'pr/forkless'],
              ]),
        ],
      });
      root ||= event.id;
      expect(
        (await relay.publish(event, { timeout: 5000, retries: false, reconnect: false })).ok,
      ).toBe(true);
      // Acknowledgement precedes object delivery and does not imply discoverability.
      expect(
        await lastValueFrom(
          relay
            .request({ ids: [event.id] }, { timeout: 3000, reconnect: false, waitForAuth: false })
            .pipe(toArray()),
        ),
      ).toHaveLength(0);
      await sourceGit(branch, ['push', urls.clone, `${commit}:refs/nostr/${event.id}`]);
      expect(
        await lastValueFrom(
          relay
            .request({ ids: [event.id] }, { timeout: 3000, reconnect: false, waitForAuth: false })
            .pipe(toArray()),
        ),
      ).toHaveLength(1);
      const observer = join(directory, `forkless-observer-${revision}`);
      await mkdir(observer);
      await sourceGit(observer, ['init']);
      await sourceGit(observer, ['fetch', urls.clone, commit]);
      expect(await sourceGit(observer, ['rev-parse', 'FETCH_HEAD'])).toBe(commit);
      // Redelivery and push are idempotent.
      expect(
        (await relay.publish(event, { timeout: 5000, retries: false, reconnect: false })).ok,
      ).toBe(true);
      await sourceGit(branch, ['push', urls.clone, `${commit}:refs/nostr/${event.id}`]);
      expect(await sourceGit(branch, ['ls-remote', '--heads', '--tags', urls.clone])).toBe(before);
    }
    expect(
      await lastValueFrom(
        relay
          .request(
            { kinds: [30617, 30618], authors: [await contributor.getPublicKey()] },
            { timeout: 3000, reconnect: false, waitForAuth: false },
          )
          .pipe(toArray()),
      ),
    ).toHaveLength(0);
    await expect(sourceGit(branch, ['push', urls.clone, 'HEAD:refs/heads/main'])).rejects.toThrow();
  } finally {
    pool.close();
  }
}, 30000);
test('a second process cannot open the same state directory', async () => {
  const second = Bun.spawn([graspBinary], {
    cwd: join(directory, 'state'),
    env: {
      ...graspEnvironment({
        origin,
        directory: join(directory, 'state'),
        local: true,
        instance: 'second',
        bind: '127.0.0.1:0',
      }),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timer = setTimeout(() => second.kill('SIGKILL'), 5000);
  try {
    expect(await second.exited).not.toBe(0);
    expect(await new Response(second.stderr).text()).toContain('already in use');
  } finally {
    clearTimeout(timer);
    if (second.exitCode === null) second.kill('SIGKILL');
  }
});
test('six starter repositories are seeded through Git/Nostr and checked without duplicate publications', async () => {
  expect(await seedLocalGrasp(origin, join(directory, 'fixtures'))).toMatchObject({
    repositories: 6,
    published: 6,
  });
  expect(await seedLocalGrasp(origin, join(directory, 'fixtures'))).toMatchObject({
    repositories: 6,
    published: 0,
  });
}, 30000);
test('local source profiles reject remote targets and signer/target substitution', async () => {
  for (const target of [
    'https://git.example',
    'http://localhost',
    'http://127.0.0.1.evil.test',
    'http://user@127.0.0.1',
    'http://127.0.0.1/path',
  ])
    expect(() => graspOrigin(target, true)).toThrow();
  await expect(
    publishSource({ directory: repo, origin: 'http://127.0.0.1:1', publication, local: true }),
  ).rejects.toThrow('targets differ');
  const pool = new RelayPool();
  try {
    const relay = pool.relay(origin.replace('http:', 'ws:'));
    const forged = { ...publication.announcement, content: 'tampered' };
    expect(
      (await relay.publish(forged, { timeout: 3000, retries: false, reconnect: false })).ok,
    ).toBe(false);
    const rows = await lastValueFrom(
      relay
        .request(
          { ids: [publication.announcement.id] },
          { timeout: 3000, reconnect: false, waitForAuth: false },
        )
        .pipe(toArray()),
    );
    expect(rows).toHaveLength(1);
  } finally {
    pool.close();
  }
});
test('the production service profile starts with an HTTPS identity and no default index publication', async () => {
  await stop();
  await start(false);
  const health = await graspHealth(origin);
  expect(health?.version).toBe(await graspVersion());
  expect(health?.name).toBe('Napplet Space Git (test)');
  expect(health?.pubkey).not.toBe(operatorKey);
  expect(logs).not.toContain('Bootstrap relay configured');
  const response = await fetch(`${origin}/`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://napplet.example', 'Access-Control-Request-Method': 'POST' },
  });
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe('*');
});
