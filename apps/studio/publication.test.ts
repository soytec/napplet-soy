import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { BrowserSigning } from './signing';
import { prepareRelease, publishReviewed, reviewedMedia } from './publication';
import { cleanEnvironment } from './agent';
import { sourceGit, sourceUrls } from '../../packages/grasp/src/client';
import { sha256, verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import { publishProject, type PublishOptions } from '../../packages/publish/src';
import { checkPublication } from '../cli/src/publish-check';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const png = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
    'base64',
  ),
);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'studio-release-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'workspace'),
    storage = join(directory, 'reviews');
  await mkdir(root);
  await writeFile(
    join(root, 'napplet.json'),
    JSON.stringify({
      schema: 'space-local-project/v1',
      name: 'Toy',
      entry: 'index.html',
      license: 'MIT',
      previewId: crypto.randomUUID(),
      description: 'A toy',
      topics: [],
    }),
  );
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Orbit</title><p>Pop</p>');
  await writeFile(join(root, 'LICENSE'), 'MIT license');
  await writeFile(join(root, '.gitignore'), '.napplet-space/\n');
  await sourceGit(root, ['init', '--initial-branch=main']);
  const checkpoint = async (label: string) => {
    await sourceGit(root, ['add', '--all']);
    await sourceGit(root, ['commit', '--allow-empty', '-m', label]);
    return sourceGit(root, ['rev-parse', 'HEAD']);
  };
  await checkpoint('Start');
  const key = generateSecretKey(),
    pubkey = getPublicKey(key),
    bridge = new BrowserSigning();
  cleanup.push(async () => bridge.close());
  const session = bridge.connect(pubkey);
  const controller = new AbortController();
  cleanup.push(async () => controller.abort());
  let signatures = 0;
  const timer = setInterval(() => {
    const request = bridge.next(session.id);
    if (request) {
      signatures++;
      bridge.reply(session.id, request.id, finalizeEvent(request.template, key));
    }
  }, 5);
  cleanup.push(async () => clearInterval(timer));
  const accounts = bridge.accounts(session.id, controller.signal);
  let captures = 0;
  const hooks = {
    env: cleanEnvironment(),
    checkpoint,
    verify: async () => {},
    stage: async () => {},
    capture: async (_root: string, _pubkey: string, target: string) => {
      captures++;
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'cover.png'), png);
    },
  };
  const input = {
    title: 'Orbit Pop',
    description: 'Tap the stars',
    topics: ['game'],
    video: false,
    portrait: true,
  };
  const prepare = () => prepareRelease(root, storage, pubkey, input, controller.signal, hooks);
  const events: SignedEvent[] = [];
  const blobs = new Map<string, Uint8Array>();
  let failUpload = false;
  const record = (event: SignedEvent) => {
    verifiedEvent(event);
    if (!events.some((e) => e.id === event.id)) events.push(event);
  };
  const dependencies: NonNullable<PublishOptions['dependencies']> = {
    relays: {
      latest: async (_url, author, d, kind) =>
        events
          .filter(
            (e) =>
              e.pubkey === author &&
              e.kind === kind &&
              e.tags.some((t) => t[0] === 'd' && t[1] === d),
          )
          .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0] ?? null,
      read: async () => [],
      ensure: async (_url, e) => record(e),
      close() {},
    },
    source: async (input) => {
      record(input.publication.announcement);
      record(input.publication.state);
      return {
        ...input.publication,
        ...sourceUrls(
          input.origin,
          input.publication.state.pubkey,
          input.publication.state.tags.find((t) => t[0] === 'd')![1],
          input.local,
        ),
        commit: input.publication.state.tags.find((t) => t[0] === 'refs/heads/main')![1],
        refs: [],
        changed: true,
      };
    },
    owned: async () => new Set(blobs.keys()),
    verified: async (_origin, hash, length) => blobs.get(hash)?.length === length,
    upload: async ({ bytes, origin, type, signer }) => {
      if (failUpload) {
        failUpload = false;
        throw new Error('Fixture Blossom unavailable');
      }
      const hash = await sha256(bytes);
      await signer.signEvent({
        kind: 24242,
        created_at: Math.floor(Date.now() / 1000),
        content: 'Upload',
        tags: [
          ['t', 'upload'],
          ['x', hash],
        ],
      });
      blobs.set(hash, bytes);
      return {
        descriptor: {
          sha256: hash,
          size: bytes.length,
          type,
          uploaded: 1,
          url: `${origin}/${hash}`,
        },
        created: true,
      };
    },
    website: async () => ({ ready: true, checkedAt: Date.now(), reason: 'ready' }),
  };
  const checker: PublishOptions['check'] = async (contents) => ({
    profile: 'test',
    browser: 'test',
    preview: contents.get(
      JSON.parse(new TextDecoder().decode(contents.get('napplet.json'))).preview.image,
    ),
  });
  const publish = (review: Awaited<ReturnType<typeof prepare>>, resume = false) =>
    publishReviewed(
      root,
      review,
      accounts,
      controller.signal,
      () => {},
      resume,
      dependencies,
      checker,
    );
  return {
    root,
    storage,
    bridge,
    session,
    key,
    pubkey,
    accounts,
    controller,
    input,
    hooks,
    prepare,
    publish,
    checkpoint,
    events,
    blobs,
    dependencies,
    checker,
    signatures: () => signatures,
    captures: () => captures,
    fail: () => {
      failUpload = true;
    },
  };
}

test('release preparation is unsigned; reviewed publisher uses exact media, source and stable listing identity', async () => {
  const f = await fixture();
  const review = await f.prepare();
  expect(f.signatures()).toBe(0);
  expect(f.events).toHaveLength(0);
  expect(review.media).toHaveLength(2);
  expect((await reviewedMedia(f.storage, review, review.media[0].name)).bytes).toEqual(png);
  const result = await f.publish(review);
  expect(result.websiteReady).toBe(true);
  expect(result.sourceCommit).toBe(review.plan.sourceCommit);
  expect(result.artifactHash).toBe(review.plan.artifactHash);
  expect(f.signatures()).toBeGreaterThan(2);
  const manifest = f.events.find((e) => e.id === result.currentId)!;
  expect(manifest.kind).toBe(35129);
  expect(
    manifest.tags.some((t) => t[0] === 'source-commit' && t[1] === review.plan.sourceCommit),
  ).toBe(true);
  const captures = f.captures(),
    signatures = f.signatures();
  expect((await f.publish(review, true)).currentId).toBe(result.currentId);
  expect(f.captures()).toBe(captures);
  expect(f.signatures()).toBe(signatures);
  await writeFile(join(f.root, 'index.html'), '<!doctype html><title>New</title><p>Changed</p>');
  await f.checkpoint('Improve');
  const next = await f.prepare();
  const updated = await f.publish(next);
  expect(updated.naddr).toBe(result.naddr);
  expect(updated.currentId).not.toBe(result.currentId);
}, 20000);

test('changed source or metadata cannot publish the old review; frozen retry survives subsequent edits', async () => {
  const f = await fixture();
  const review = await f.prepare();
  await writeFile(join(f.root, 'index.html'), 'changed');
  await expect(f.publish(review)).rejects.toThrow();
  expect(f.signatures()).toBe(0);
  await sourceGit(f.root, ['restore', 'index.html']);
  f.fail();
  await expect(f.publish(review)).rejects.toThrow('Fixture Blossom unavailable');
  const count = f.captures();
  await writeFile(join(f.root, 'index.html'), 'new unfinished draft');
  const result = await f.publish(review, true);
  expect(result.sourceCommit).toBe(review.plan.sourceCommit);
  expect(await readFile(join(f.root, 'index.html'), 'utf8')).toBe('new unfinished draft');
  expect(f.captures()).toBe(count);
  await expect(f.publish({ ...review, fingerprint: '0'.repeat(64) }, true)).rejects.toThrow(
    'does not match',
  );
  await expect(
    f.publish(
      { ...review, repository: { ...review.repository, address: `30617:${f.pubkey}:other` } },
      true,
    ),
  ).rejects.toThrow('saved source repository does not match');
}, 20000);

test('publisher rechecks review fingerprint after entry even if caller bypasses studio checks', async () => {
  const f = await fixture();
  const review = await f.prepare();
  await expect(
    publishProject({
      directory: f.root,
      network: 'public',
      accounts: f.accounts,
      expectedFingerprint: '0'.repeat(64),
      dependencies: f.dependencies,
      check: f.checker,
    }),
  ).rejects.toThrow('changed after review');
  expect(f.signatures()).toBe(0);
  expect(review.plan.pubkey).toBe(f.pubkey);
  await expect(
    publishProject({
      directory: f.root,
      network: 'public',
      accounts: f.accounts,
      expectedFingerprint: review.fingerprint,
      expectedRepository: `30617:${f.pubkey}:other`,
      dependencies: f.dependencies,
      check: f.checker,
    }),
  ).rejects.toThrow('source repository changed after review');
  expect(f.signatures()).toBe(0);
});

test('browser bridge rejects tampering, account swaps, replays and cancelled requests', async () => {
  const bridge = new BrowserSigning();
  cleanup.push(async () => bridge.close());
  const key = generateSecretKey(),
    pubkey = getPublicKey(key),
    session = bridge.connect(pubkey),
    controller = new AbortController();
  const signer = await bridge.accounts(session.id, controller.signal).signer();
  const template = {
    kind: 35129,
    created_at: Math.floor(Date.now() / 1000),
    content: 'Reviewed',
    tags: [['d', 'test']],
  };
  for (const changed of [
    finalizeEvent({ ...template, content: 'Other' }, key),
    finalizeEvent(structuredClone(template), generateSecretKey()),
  ]) {
    const rejected = signer.signEvent(template).catch((error) => error);
    const request = bridge.next(session.id)!;
    expect(() => bridge.reply(session.id, request.id, changed)).toThrow();
    expect((await rejected).message).toContain('different event');
    expect(() =>
      bridge.reply(session.id, request.id, finalizeEvent(structuredClone(template), key)),
    ).toThrow('no longer active');
  }
  const rejected = signer.signEvent(template).catch((error) => error);
  controller.abort();
  expect((await rejected).message).toContain('cancelled');
  expect(bridge.next(session.id)).toBeNull();
});

test('capture rejects an unsupported viewport before opening browsers or files', async () => {
  await expect(
    checkPublication(new Map(), true, undefined, false, undefined, { width: 360, height: 2000 }),
  ).rejects.toThrow('Capture sizes');
});
