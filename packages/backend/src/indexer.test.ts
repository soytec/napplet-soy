import { publicNapplet } from './public-model';
import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  matchFilter,
  type Filter,
} from 'nostr-tools';
import { aggregateHash, encodeAddress, sha256, type SignedEvent } from '../../protocol/src';
import { IndexWorker, indexConfig } from './index-worker';
import { manifestKey, indexedProjection } from './index-store';
import { indexedLookup, indexStore, indexedArtifact } from './indexed-catalog';
import { communityEntries } from './public-catalog';
import { browseGallery } from './gallery';
import { publicationResponse } from './publication-response';
import { confirmWebsite } from '../../publish/src/website';

const oldDirectory = process.env.SPACE_INDEX_DIR;
let directory = '',
  worker: IndexWorker | undefined;
afterEach(async () => {
  if (oldDirectory === undefined) delete process.env.SPACE_INDEX_DIR;
  else process.env.SPACE_INDEX_DIR = oldDirectory;
  indexStore();
  worker?.close();
  worker = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup() {
  directory = await mkdtemp(join(tmpdir(), 'napplet-index-'));
  const config = { directory, relays: ['wss://relay.example'], release: 'test' };
  worker = new IndexWorker(config);
  process.env.SPACE_INDEX_DIR = directory;
  return worker;
}
async function release(created_at = Math.floor(Date.now() / 1000) - 2) {
  const secret = generateSecretKey(),
    pubkey = getPublicKey(secret);
  const bytes = new TextEncoder().encode(
    '<!doctype html><title>Indexed creation</title><p>hello</p>',
  );
  const hash = await sha256(bytes),
    aggregate = await aggregateHash([{ path: '/index.html', hash }]);
  const identity = { kind: 35129 as const, pubkey, identifier: 'index-test' };
  const tags = [
    ['title', 'Indexed creation'],
    ['path', '/index.html', hash],
    ['x', aggregate, 'aggregate'],
    ['t', 'visual'],
    ['server', 'https://blossom.example'],
  ];
  const current = finalizeEvent(
    { kind: 35129, created_at, content: '', tags: [...tags, ['d', identity.identifier]] },
    secret,
  );
  const snapshot = finalizeEvent(
    { kind: 5129, created_at, content: '', tags: [...tags, ['a', manifestKey(current)]] },
    secret,
  );
  return { secret, bytes, hash, identity, current, snapshot, naddr: encodeAddress(identity) };
}
const hydrate = (w: IndexWorker, bytes: Uint8Array, now?: number) =>
  w.hydrate(AbortSignal.timeout(3000), {
    download: async () => bytes,
    metadata: async () => [],
    now,
  });
test('gallery search reaches records older than the previous 200-event window', async () => {
  const w = await setup(),
    r = await release();
  for (let i = 0; i < 205; i++)
    w.store.admit(
      finalizeEvent(
        {
          ...r.current,
          created_at: r.current.created_at - i,
          tags: r.current.tags
            .filter((t) => !['d', 'title'].includes(t[0]))
            .concat([
              ['d', `item-${i}`],
              ['title', i === 204 ? 'Oldest rare creation' : `Creation ${i}`],
            ]),
        },
        r.secret,
      ),
    );
  const result = await browseGallery({ q: 'Oldest rare', tag: '', sort: 'new', unavailable: true });
  expect(result.matches).toBe(1);
  expect(result.napplets[0].title).toBe('Oldest rare creation');
  expect(
    (await browseGallery({ q: '', tag: '', sort: 'new', unavailable: true, page: 9 })).napplets,
  ).toHaveLength(13);
});
test('ordinary signed current and snapshot become playable, survive restart, and form one gallery card', async () => {
  let w = await setup();
  const r = await release();
  expect(w.store.admit(r.current)).toBe(true);
  expect(w.store.admit(r.snapshot)).toBe(true);
  await hydrate(w, r.bytes);
  expect((await indexedLookup({ type: 'address', naddr: r.naddr })).entry?.availability).toBe(
    'ready',
  );
  expect((await communityEntries()).filter((e) => e.pubkey === r.current.pubkey)).toHaveLength(1);
  const config = w.config;
  w.close();
  worker = undefined;
  worker = w = new IndexWorker(config);
  expect(w.store.admit(r.current)).toBe(false);
  expect(await (await indexedArtifact(r.hash))?.bytes()).toEqual(r.bytes);
  expect((await indexedLookup({ type: 'snapshot', id: r.snapshot.id })).entry?.manifest.id).toBe(
    r.snapshot.id,
  );
});
test('replacement, deterministic timestamp ties, and invalid updates cannot revive older content', async () => {
  const w = await setup(),
    r = await release();
  w.store.admit(r.current);
  w.store.admit(r.snapshot);
  await hydrate(w, r.bytes);
  const bad = finalizeEvent(
    {
      ...r.current,
      created_at: r.current.created_at + 1,
      tags: [...r.current.tags, ['d', 'duplicate']],
    },
    r.secret,
  );
  w.store.admit(bad);
  expect(w.store.admit(r.current)).toBe(false);
  expect(await indexedLookup({ type: 'address', naddr: r.naddr })).toEqual({
    known: true,
    entry: null,
  });
  expect((await indexedLookup({ type: 'snapshot', id: r.snapshot.id })).entry?.availability).toBe(
    'ready',
  );
  const fixed = finalizeEvent({ ...r.current, created_at: bad.created_at + 1 }, r.secret);
  const tie = finalizeEvent({ ...fixed, content: 'tie' }, r.secret);
  w.store.admit(tie);
  w.store.admit(fixed);
  expect(w.store.row(manifestKey(fixed))!.id).toBe([tie.id, fixed.id].sort()[0]);
  expect(() => w.store.admit({ ...fixed, sig: '0'.repeat(128) })).toThrow();
});
test('signed named revisions retain exact pinned playback after replacement and honor deletion', async () => {
  let w = await setup();
  const r = await release();
  const first = finalizeEvent(
    {
      kind: 35129,
      created_at: r.current.created_at - 2,
      content: 'First standalone release',
      tags: [
        ['d', 'index-test'],
        ['x', r.hash],
        ['title', 'First version'],
      ],
    },
    r.secret,
  );
  const nextBytes = new TextEncoder().encode(
    '<!doctype html><title>Second version</title><p>new</p>',
  );
  const nextHash = await sha256(nextBytes);
  const second = finalizeEvent(
    {
      ...first,
      created_at: first.created_at + 1,
      tags: [
        ['d', 'index-test'],
        ['x', nextHash],
        ['title', 'Second version'],
      ],
    },
    r.secret,
  );
  w.store.admit(first);
  await hydrate(w, r.bytes);
  w.store.admit(second);
  await hydrate(w, nextBytes);
  expect(w.store.rows().map((row) => row.id)).toEqual([second.id]);
  expect((await indexedLookup({ type: 'snapshot', id: first.id })).entry?.title).toBe(
    'First version',
  );
  expect(await (await indexedArtifact(r.hash))?.bytes()).toEqual(r.bytes);
  expect((await communityEntries()).map((entry) => entry.revisionId)).toEqual([second.id]);
  const config = w.config;
  w.close();
  worker = undefined;
  worker = w = new IndexWorker(config);
  expect((await indexedLookup({ type: 'snapshot', id: first.id })).entry?.availability).toBe(
    'ready',
  );
  // A late older revision can be retained without becoming the current version.
  const older = finalizeEvent(
    { ...first, created_at: first.created_at - 1, content: 'Older' },
    r.secret,
  );
  expect(w.store.admit(older)).toBe(true);
  expect(w.store.row(manifestKey(first))?.id).toBe(second.id);
  await hydrate(w, r.bytes);
  expect((await indexedLookup({ type: 'snapshot', id: older.id })).entry?.availability).toBe(
    'ready',
  );
  w.store.admit(
    finalizeEvent(
      { kind: 5, created_at: second.created_at, tags: [['e', first.id]], content: '' },
      generateSecretKey(),
    ),
  );
  expect((await indexedLookup({ type: 'snapshot', id: first.id })).entry).not.toBeNull();
  w.store.admit(
    finalizeEvent(
      { kind: 5, created_at: second.created_at, tags: [['a', manifestKey(first)]], content: '' },
      r.secret,
    ),
  );
  expect(await indexedLookup({ type: 'snapshot', id: first.id })).toEqual({
    known: true,
    entry: null,
  });
  expect(await indexedLookup({ type: 'snapshot', id: older.id })).toEqual({
    known: true,
    entry: null,
  });
  expect(await indexedArtifact(r.hash)).toBeNull();
  expect(w.store.references().some((reference) => reference.hash === r.hash)).toBe(false);
  // An in-flight artifact/preview result cannot restore references after deletion.
  const entry = await indexedProjection({ ...w.store.revision(first.id)!, projection: null }, []);
  w.store.project(first.id, entry, 0, 0);
  expect(w.store.revision(first.id)?.projection).toBeNull();
});
test('authenticated deletions and expiration survive restart without hiding another author', async () => {
  const w = await setup(),
    r = await release();
  const deletion = (secret: Uint8Array) =>
    finalizeEvent(
      { kind: 5, created_at: r.current.created_at + 1, content: '', tags: [['e', r.current.id]] },
      secret,
    );
  w.store.admit(deletion(generateSecretKey()));
  w.store.admit(r.current);
  await hydrate(w, r.bytes);
  expect((await indexedLookup({ type: 'address', naddr: r.naddr })).entry?.availability).toBe(
    'ready',
  );
  w.store.admit(deletion(r.secret));
  expect(w.store.row(manifestKey(r.current))!.projection).toBeNull();
  expect((await indexedLookup({ type: 'address', naddr: r.naddr })).entry).toBeNull();
  const config = w.config;
  w.close();
  worker = new IndexWorker(config);
  expect(worker.store.removed(r.current)).toBe(true);
  const expired = finalizeEvent(
    { ...r.snapshot, tags: [...r.snapshot.tags, ['expiration', '1']] },
    r.secret,
  );
  worker.store.admit(expired);
  expect((await indexedLookup({ type: 'snapshot', id: expired.id })).entry).toBeNull();
});
test('corrupt blobs stay unavailable and recover on retry; missing host domains never execute', async () => {
  const w = await setup(),
    r = await release();
  w.store.admit(r.current);
  await hydrate(w, new Uint8Array([1, 2, 3]));
  expect(await indexedArtifact(r.hash)).toBeNull();
  await hydrate(w, r.bytes, Date.now() + 31000);
  expect(await indexedArtifact(r.hash)).not.toBeNull();
  await Bun.write(join(directory, 'artifacts', `${r.hash}.html`), 'damaged');
  expect(await indexedArtifact(r.hash)).toBeNull();
  const other = await release();
  const required = finalizeEvent(
    { ...other.current, tags: [...other.current.tags, ['requires', 'unknown-host']] },
    other.secret,
  );
  w.store.admit(required);
  await w.hydrate(AbortSignal.timeout(3000), {
    download: async () => {
      throw new Error('must not download');
    },
    metadata: async () => [],
  });
  expect((await indexedProjection(w.store.row(manifestKey(required))!, []))?.availability).toBe(
    'host-required',
  );
});
test('pagination overlaps timestamp boundaries and retains its cursor on saturation or relay failure', async () => {
  const w = await setup(),
    r = await release();
  // Test transport pagination with validated events admitted through the real store.
  const events = Array.from({ length: 205 }, (_, i) =>
    finalizeEvent(
      { ...r.snapshot, created_at: r.snapshot.created_at - i, content: String(i) },
      r.secret,
    ),
  );
  const filters: Filter[] = [];
  const read = async (_relay: string, filter: Filter) => {
    filters.push(filter);
    for (const [key, values] of Object.entries(filter))
      if (key.startsWith('#') && Array.isArray(values) && values.length > 64)
        throw new Error('restricted: invalid tag filter');
    return events
      .filter(
        (e) =>
          filter.kinds!.includes(e.kind) &&
          e.created_at <= filter.until! &&
          e.created_at >= (filter.since ?? 0),
      )
      .slice(0, 200);
  };
  expect(await w.collect(read)).toEqual([]);
  expect(w.store.rows()).toHaveLength(205);
  expect(filters.filter((f) => f.kinds![0] === 5129)).toHaveLength(2);
  const key = `cursor:${w.config.relays[0]}:5129`,
    cursor = w.store.state<number>(key);
  const saturated = Array.from({ length: 200 }, (_, i) =>
    finalizeEvent({ ...r.snapshot, content: `crowded-${i}` }, r.secret),
  );
  const errors = await w.collect(async (_url, f) => (f.kinds![0] === 5129 ? saturated : []));
  expect(errors.join(' ')).toContain('saturated');
  expect(w.store.state<number>(key)).toEqual(cursor);
  expect(
    await w.collect(async () => {
      throw new Error('offline');
    }),
  ).toEqual(
    expect.arrayContaining([
      expect.stringContaining('5129: offline'),
      expect.stringContaining('napplet-deletions: offline'),
      expect.stringContaining('deletion-targets:#e:0: offline'),
    ]),
  );
});
test('discovery scopes deletions while retaining kind-tagged and legacy target deletions', async () => {
  const w = await setup(),
    r = await release();
  const deletion = (tags: string[][]) =>
    finalizeEvent(
      {
        kind: 5,
        created_at: r.current.created_at + 1,
        content: '',
        tags,
      },
      r.secret,
    );
  const unrelated = deletion([
    ['e', 'f'.repeat(64)],
    ['k', '1'],
  ]);
  const legacy = deletion([['e', r.snapshot.id]]);
  const addressDeletion = deletion([['a', manifestKey(r.current)]]);
  const futureTarget = finalizeEvent({ ...r.snapshot, content: 'later arrival' }, r.secret);
  const tagged = deletion([
    ['e', futureTarget.id],
    ['k', '5129'],
  ]);
  const events = [r.current, r.snapshot, unrelated, legacy, addressDeletion, tagged];
  const filters: Filter[] = [];
  const read = async (_relay: string, filter: Filter) => {
    filters.push(filter);
    return events.filter((event) => matchFilter(filter, event));
  };
  expect(await w.collect(read)).toEqual([]);
  expect(
    filters.filter((f) => f.kinds?.includes(5)).every((f) => f['#k'] || f['#e'] || f['#a']),
  ).toBe(true);
  expect(w.store.removed(r.current)).toBe(true);
  expect(w.store.removed(r.snapshot)).toBe(true);
  w.store.admit(futureTarget);
  expect(w.store.removed(futureTarget)).toBe(true);
  // A newly discovered target still gets full deletion history after cursors exist.
  const late = finalizeEvent(
    { ...r.current, tags: [...r.current.tags.filter((t) => t[0] !== 'd'), ['d', 'late']] },
    r.secret,
  );
  events.push(late, deletion([['e', late.id]]));
  w.store.admit(late); // Backdated target discovered on another relay after our cursor.
  expect(await w.collect(read, Date.now() + 20 * 60000)).toEqual([]);
  expect(w.store.removed(late)).toBe(true);
});
test('website receipt requires matching signed manifests, healthy indexing and verified artifact bytes', async () => {
  const w = await setup(),
    r = await release();
  w.store.admit(r.current);
  w.store.admit(r.snapshot);
  await hydrate(w, r.bytes);
  const url = new URL('http://localhost/api/publications');
  url.search = new URLSearchParams({
    address: r.naddr,
    current: r.current.id,
    snapshot: r.snapshot.id,
  }).toString();
  expect((await (await publicationResponse(new Request(url))).json()).status).toBe('pending');
  w.store.setState('health', {
    checkedAt: Date.now(),
    release: 'test',
    relays: w.config.relays,
    errors: [],
  });
  const response = await publicationResponse(new Request(url));
  expect((await response.clone().json()).status).toBe('ready');
  const job = {
    plan: {
      pubkey: r.current.pubkey,
      identifier: r.identity.identifier,
      artifactHash: r.hash,
      targets: { site: 'http://localhost' },
    },
    current: r.current,
    snapshot: r.snapshot,
  };
  expect((await confirmWebsite(job, { fetch: async () => response.clone() })).ready).toBe(true);
  const falseReceipt = { ...(await response.json()), snapshot: r.current };
  expect(
    (await confirmWebsite(job, { fetch: async () => Response.json(falseReceipt) })).ready,
  ).toBe(false);
  expect(
    (await confirmWebsite(job, { fetch: async () => new Response('<html>hello</html>') })).ready,
  ).toBe(false);
  const next = finalizeEvent({ ...r.current, created_at: r.current.created_at + 1 }, r.secret);
  w.store.admit(next);
  expect((await (await publicationResponse(new Request(url))).json()).status).toBe('superseded');
});
test('operator local network exception is explicit and a second writer is rejected', async () => {
  const w = await setup();
  expect(() => new IndexWorker(w.config)).toThrow('Another index worker');
  for (const local of [
    'http://localhost:8081',
    'http://127.0.0.1:8081/private',
    'https://example.org',
    'http://127.0.0.1.evil.test',
  ])
    expect(() =>
      indexConfig({
        SPACE_INDEX_DIR: directory,
        SPACE_INDEX_RELAYS: 'wss://relay.example',
        SPACE_INDEX_LOCAL_BLOSSOM: local,
      }),
    ).toThrow();
  expect(
    indexConfig({
      SPACE_INDEX_DIR: directory,
      SPACE_INDEX_RELAYS: 'ws://127.0.0.1:19347/relay',
      SPACE_INDEX_LOCAL_BLOSSOM: 'http://127.0.0.1:8081',
    }).localBlossom,
  ).toBe('http://127.0.0.1:8081');
});

test('newest keeps the original publication date; recently updated uses the latest signed release after restart', async () => {
  const w = await setup(),
    old = await release(100),
    brandNew = await release(200);
  // Existing deployments may only retain the original legacy snapshot.
  w.store.admit(old.snapshot);
  await hydrate(w, old.bytes);
  const update = finalizeEvent({ ...old.current, created_at: 300 }, old.secret);
  w.store.admit(update);
  w.store.admit(brandNew.current);
  await hydrate(w, old.bytes);
  const newest = await browseGallery({ q: '', tag: '', sort: 'new', unavailable: true });
  expect(newest.napplets.map((n) => n.revisionId)).toEqual([brandNew.current.id, update.id]);
  expect(newest.napplets[1].firstPublishedAt).toBe(100);
  const updated = await browseGallery({ q: '', tag: '', sort: 'updated', unavailable: true });
  expect(updated.napplets.map((n) => n.revisionId)).toEqual([update.id, brandNew.current.id]);
  const config = w.config;
  w.close();
  worker = undefined;
  worker = new IndexWorker(config);
  expect(worker.store.firstPublishedAt(update)).toBe(100);
  const independent = finalizeEvent(
    {
      kind: 5129,
      created_at: 1,
      content: 'Independent child',
      tags: [
        ['x', old.hash],
        ['a', `35129:${old.current.pubkey}:${old.identity.identifier}`],
      ],
    },
    old.secret,
  );
  worker.store.admit(independent);
  const entry = await publicNapplet(independent);
  worker.store.project(independent.id, entry, 0, 0);
  expect(worker.store.firstPublishedAt(update)).toBe(100);
  expect(worker.store.firstPublishedAt(independent)).toBe(1);
});

test('website confirmation accepts a named-only release while still validating an explicitly requested snapshot', async () => {
  const w = await setup(),
    r = await release();
  w.store.admit(r.current);
  await hydrate(w, r.bytes);
  w.store.setState('health', {
    checkedAt: Date.now(),
    release: 'test',
    relays: w.config.relays,
    errors: [],
  });
  const url = new URL('http://localhost/api/publications');
  url.search = new URLSearchParams({ address: r.naddr, current: r.current.id }).toString();
  const response = await publicationResponse(new Request(url));
  expect(response.status).toBe(200);
  const receipt = await response.clone().json();
  expect(receipt).toMatchObject({ status: 'ready', snapshot: null });
  const job = {
    plan: {
      pubkey: r.current.pubkey,
      identifier: r.identity.identifier,
      artifactHash: r.hash,
      targets: { site: 'http://localhost' },
    },
    current: r.current,
  };
  expect(
    await confirmWebsite(job, {
      fetch: async (requested) => {
        expect(requested.searchParams.has('snapshot')).toBe(false);
        return response.clone();
      },
    }),
  ).toMatchObject({ ready: true });
  expect(
    await confirmWebsite(job, {
      fetch: async () =>
        Response.json({ ...receipt, current: { ...r.current, content: 'forged' } }),
    }),
  ).toMatchObject({ ready: false });
  url.searchParams.set('snapshot', r.snapshot.id);
  expect((await (await publicationResponse(new Request(url))).json()).status).toBe('pending');
  url.searchParams.set('snapshot', 'malformed');
  expect((await publicationResponse(new Request(url))).status).toBe(400);
});

test('a previously unavailable 32 MiB standalone napplet is rechecked and included in the default gallery', async () => {
  const w = await setup(),
    r = await release();
  const bytes = new TextEncoder().encode(
    '<!doctype html><p>Large external app</p>'.padEnd(32 * 1024 * 1024, ' '),
  );
  const hash = await sha256(bytes);
  const manifest = finalizeEvent(
    {
      kind: 35129,
      created_at: r.current.created_at,
      content: 'Published independently',
      tags: [
        ['d', 'large-external'],
        ['x', hash],
        ['title', 'Large external app'],
      ],
    },
    r.secret,
  );
  w.store.admit(manifest);
  const entry = await publicNapplet(manifest);
  w.store.project(manifest.id, entry, Date.now() + 3600000, Date.now() + 3600000);
  w.store.setState('profile', 'previous-25-MiB-admission');
  await hydrate(w, bytes);
  const gallery = await browseGallery({ q: 'Large external app', tag: '', sort: 'new' });
  expect(gallery.napplets).toHaveLength(1);
  expect(gallery.napplets[0]).toMatchObject({ availability: 'ready', bytes: bytes.length });
  expect(await (await indexedArtifact(hash))?.bytes()).toEqual(bytes);
});
