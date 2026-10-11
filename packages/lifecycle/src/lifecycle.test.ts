import { expect, test } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers';
import { matchFilter, nip19, type EventTemplate } from 'nostr-tools';
import { aggregateHash, sha256, type SignedEvent } from '../../protocol/src';
import {
  createLifecycleReceipt,
  executeLifecycle,
  planLifecycle,
  parseReceipt,
  lifecycleFinished,
  nappletKey,
} from './index';
import type { LifecycleIO } from './transport';

async function fixture(source = '<!doctype html><p>game</p>') {
  const signer = new PrivateKeySigner(),
    author = await signer.getPublicKey();
  const bytes = new TextEncoder().encode(source),
    hash = await sha256(bytes);
  const tags = [
    ['title', 'Little world'],
    ['server', 'https://blossom.example'],
    ['path', '/index.html', hash],
    ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
  ];
  const now = Math.floor(Date.now() / 1000) - 10;
  const sign = (t: EventTemplate) => signer.signEvent(t) as Promise<SignedEvent>;
  const current = await sign({
    kind: 35129,
    created_at: now,
    content: '',
    tags: [...tags, ['d', 'world']],
  });
  const snapshot = await sign({
    kind: 5129,
    created_at: now,
    content: '',
    tags: [...tags, ['a', nappletKey(current)]],
  });
  const relays = ['wss://one.example', 'wss://two.example'];
  const events = new Map(relays.map((r) => [r, [current, snapshot]]));
  const writes: SignedEvent[] = [],
    deletes: string[] = [],
    updates: string[] = [];
  let failRelay = '',
    failBlob = false,
    shared = false;
  const io: LifecycleIO = {
    async read(r, f) {
      if (failRelay === r) throw new Error('Relay offline');
      return (events.get(r) ?? []).filter((e) => matchFilter(f, e));
    },
    async publish(r, e) {
      if (failRelay === r) throw new Error('Relay offline nsec1do-not-print');
      writes.push(e);
      let rows = events.get(r) ?? [];
      if (e.kind === 5)
        rows = rows.filter(
          (t) =>
            t.pubkey !== e.pubkey ||
            t.created_at > e.created_at ||
            !e.tags.some(
              (x) =>
                (x[0] === 'e' && x[1] === t.id) ||
                (x[0] === 'a' && t.kind !== 5129 && x[1] === nappletKey(t)),
            ),
        );
      else if (e.kind === 35129)
        rows = rows.filter((t) => t.kind !== 35129 || nappletKey(t) !== nappletKey(e));
      events.set(r, [...rows.filter((t) => t.id !== e.id), e]);
    },
    async fetch(url, init) {
      if (init?.method === 'DELETE') {
        if (failBlob)
          return new Response(null, { status: 403, headers: { 'x-reason': 'owner mismatch' } });
        const auth = JSON.parse(
          atob((init.headers as Record<string, string>).Authorization.slice(6)),
        );
        expect(auth.pubkey).toBe(author);
        expect(auth.tags).toContainEqual(['x', hash]);
        deletes.push(url);
        return new Response(null, { status: 204 });
      }
      if (deletes.includes(url) && !shared) return new Response(null, { status: 404 });
      return new Response(init?.method === 'HEAD' ? null : bytes);
    },
  };
  const plan = () => planLifecycle({ manifest: current, relays, io });
  const save = async (r: any) => {
    updates.push(r.steps.map((s: any) => s.state).join(','));
  };
  return {
    signer,
    sign,
    author,
    current,
    snapshot,
    relays,
    events,
    writes,
    deletes,
    updates,
    bytes,
    hash,
    io,
    plan,
    save,
    setFailRelay: (v: string) => (failRelay = v),
    setFailBlob: (v: boolean) => (failBlob = v),
    setShared: () => (shared = true),
  };
}
test('unpublish is confirmed separately, preserves files, retries exact signatures and republishes a fresh listing', async () => {
  const f = await fixture(),
    plan = await f.plan();
  expect(f.writes).toHaveLength(0);
  expect(f.deletes).toHaveLength(0);
  const receipt = createLifecycleReceipt(plan, 'unpublish');
  f.setFailRelay(f.relays[1]);
  await executeLifecycle(receipt, { io: f.io, signer: f.signer, save: f.save });
  expect(receipt.steps.map((s) => s.state)).toEqual(['done', 'failed']);
  expect(JSON.stringify(receipt)).not.toContain('nsec1do-not-print');
  expect(f.updates.some((v) => v.includes('running'))).toBe(true);
  expect(f.deletes).toHaveLength(0);
  const id = receipt.events.deletion.id;
  f.setFailRelay('');
  await executeLifecycle(parseReceipt(receipt), { io: f.io, signer: f.signer, save: f.save });
  expect(f.writes.every((e) => e.id === id)).toBe(true);
  const republish = createLifecycleReceipt(plan, 'republish');
  await executeLifecycle(republish, { io: f.io, signer: f.signer, save: f.save });
  expect(lifecycleFinished(republish)).toBe(true);
  expect(nappletKey(republish.events.listing)).toBe(plan.key);
  expect(republish.events.listing.created_at).toBeGreaterThan(receipt.events.deletion.created_at);
  expect(republish.events.listing.id).not.toBe(f.current.id);
  expect(f.events.get(f.relays[0])!.some((e) => e.id === f.snapshot.id)).toBe(false);
});
test('large playable artifacts retain lifecycle resource inventory and republishing', async () => {
  const asset = 'a'.repeat(64);
  const f = await fixture(
    `<!doctype html><p>Large game</p><!-- blossom:sha256:${asset} -->`.padEnd(
      12 * 1024 * 1024,
      ' ',
    ),
  );
  const plan = await f.plan();
  expect(plan.complete).toBe(true);
  expect(
    plan.blobs.some((blob) => blob.hash === asset && blob.labels.includes('Runtime asset')),
  ).toBe(true);
  const receipt = createLifecycleReceipt(plan, 'republish');
  await executeLifecycle(receipt, { io: f.io, signer: f.signer, save: f.save });
  expect(lifecycleFinished(receipt)).toBe(true);
  expect(receipt.events.listing.tags).toContainEqual(['path', '/index.html', f.hash]);
});
test('deletion reports physical absence and a failed blob can be retried without redoing completed relay steps', async () => {
  const f = await fixture(),
    r = createLifecycleReceipt(await f.plan(), 'delete');
  f.setFailBlob(true);
  await executeLifecycle(r, { io: f.io, signer: f.signer, save: f.save });
  expect(r.steps.at(-1)?.state).toBe('failed');
  expect(r.steps.at(-1)?.message).toContain('403');
  const published = f.writes.length;
  f.setFailBlob(false);
  await executeLifecycle(r, { io: f.io, signer: f.signer, save: f.save });
  expect(f.writes.length).toBe(published);
  expect(r.steps.at(-1)?.state).toBe('done');
  expect(f.deletes.length).toBe(1);
  const republish = createLifecycleReceipt(r.plan, 'republish');
  await expect(
    executeLifecycle(republish, { io: f.io, signer: f.signer, save: f.save }),
  ).rejects.toThrow('saved build is no longer available');
});
test('other uploaders retained by Blossom are not falsely reported as physically deleted', async () => {
  const f = await fixture();
  f.setShared();
  const r = createLifecycleReceipt(await f.plan(), 'delete');
  await executeLifecycle(r, { io: f.io, signer: f.signer, save: f.save });
  expect(r.steps.at(-1)?.state).toBe('retained');
  expect(r.steps.at(-1)?.message).toContain('shared bytes');
});
test('same-author reuse is protected and incomplete relay inventory cannot delete hosted files', async () => {
  const f = await fixture();
  const other = await f.sign({
    ...f.current,
    tags: f.current.tags.map((t) => (t[0] === 'd' ? ['d', 'another'] : t)),
  });
  for (const rows of f.events.values()) rows.push(other);
  const p = await f.plan();
  expect(p.blobs[0].retained).toContain('another napplet');
  const r = createLifecycleReceipt(p, 'delete');
  await executeLifecycle(r, { io: f.io, signer: f.signer, save: f.save });
  expect(f.deletes).toHaveLength(0);
  const g = await fixture();
  g.setFailRelay(g.relays[1]);
  const partial = await g.plan();
  expect(partial.complete).toBe(false);
  expect(partial.blobs[0].retained).toContain('Inventory incomplete');
});
test('new publication after inventory blocks destructive actions and wrong signer cannot sign requests', async () => {
  const f = await fixture(),
    r = createLifecycleReceipt(await f.plan(), 'delete');
  const next = await f.sign({ ...f.current, created_at: f.current.created_at + 1 });
  f.events.get(f.relays[0])!.push(next);
  await expect(executeLifecycle(r, { io: f.io, signer: f.signer, save: f.save })).rejects.toThrow(
    'different listing',
  );
  expect(f.writes).toHaveLength(0);
  expect(f.deletes).toHaveLength(0);
  const g = await fixture(),
    other = new PrivateKeySigner();
  await expect(
    executeLifecycle(createLifecycleReceipt(await g.plan(), 'unpublish'), {
      io: g.io,
      signer: other,
      save: g.save,
    }),
  ).rejects.toThrow('different identity');
  expect(g.writes).toHaveLength(0);
});
test('recovery records cannot redirect completed steps or include unrelated manifests', async () => {
  const f = await fixture(),
    r = createLifecycleReceipt(await f.plan(), 'delete');
  r.steps[0].target = 'wss://attacker.example';
  expect(() => parseReceipt(r)).toThrow('targets were changed');
  const next = createLifecycleReceipt(await f.plan(), 'delete');
  next.plan.manifests.push(
    await f.sign({
      ...f.current,
      tags: f.current.tags.map((t) => (t[0] === 'd' ? ['d', 'other'] : t)),
    }),
  );
  expect(() => parseReceipt(next)).toThrow('unrelated release');
});

test('custom Blossom base paths remain exact throughout inventory, confirmation and deletion', async () => {
  const f = await fixture();
  const current = await f.sign({
    ...f.current,
    tags: f.current.tags.map((t) =>
      t[0] === 'server' ? ['server', 'https://blossom.example/files/'] : t,
    ),
  });
  for (const r of f.relays) f.events.set(r, [current]);
  const plan = await planLifecycle({ manifest: current, relays: f.relays, io: f.io });
  expect(plan.blobs[0].origin).toBe('https://blossom.example/files');
  const r = createLifecycleReceipt(plan, 'delete');
  expect(r.steps.at(-1)?.target).toBe(`https://blossom.example/files/${f.hash}`);
  await executeLifecycle(r, { io: f.io, signer: f.signer, save: f.save });
  expect(lifecycleFinished(r)).toBe(true);
  expect(f.deletes).toEqual([`https://blossom.example/files/${f.hash}`]);
});
test('known historical preview images remain in the deletion inventory; unpublish skips storage inspection', async () => {
  const f = await fixture(),
    address = `32267:${f.author}:world`;
  const current = await f.sign({ ...f.current, tags: [...f.current.tags, ['app', address]] });
  const metadata = await Promise.all(
    ['a', 'b'].map((h, i) =>
      f.sign({
        kind: 32267,
        created_at: current.created_at + i,
        content: '',
        tags: [
          ['d', 'world'],
          ['image', `https://blossom.example/media/${h.repeat(64)}.png`],
        ],
      }),
    ),
  );
  for (const r of f.relays) f.events.set(r, [current, ...metadata]);
  const plan = await planLifecycle({ manifest: current, relays: f.relays, io: f.io });
  expect(plan.metadata).toHaveLength(2);
  expect(
    plan.blobs
      .filter((b) => b.origin === 'https://blossom.example/media')
      .map((b) => b.hash)
      .sort(),
  ).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
  let downloads = 0;
  const unpublish = await planLifecycle({
    manifest: current,
    relays: f.relays,
    operation: 'unpublish',
    io: {
      ...f.io,
      fetch: async () => {
        downloads++;
        throw new Error('Storage unavailable');
      },
    },
  });
  expect(downloads).toBe(0);
  expect(unpublish.complete).toBe(true);
});
test('deleting a napplet keeps the creator’s own source repository but lists the hosted one', async () => {
  const f = await fixture();
  const npub = nip19.npubEncode(f.author);
  const relay = encodeURIComponent('wss://git.example/');
  const planFor = async (identifier: string) => {
    const manifest = await f.sign({
      ...f.current,
      tags: [...f.current.tags, ['source', `nostr://${npub}/${relay}/${identifier}`]],
    });
    for (const rows of f.events.values()) rows.push(manifest);
    return planLifecycle({ manifest, relays: f.relays, io: f.io });
  };
  const hosted = await planFor('world');
  expect(hosted.repositories).toHaveLength(1);
  expect(hosted.repositories[0].retained).toBeUndefined();
  // After moving to their own repository, the earlier hosted copy is still deleted.
  const own = await planFor('SuperSonicRCRevive');
  const retained = Object.fromEntries(
    own.repositories.map((r) => [r.address.split(':')[2], r.retained]),
  );
  expect(retained.world).toBeUndefined();
  expect(retained.SuperSonicRCRevive).toContain('Your own source repository is kept');
});

test('standalone lifecycle scopes never delete same-author parents and inventory raw HTML/icon hashes', async () => {
  const f = await fixture();
  const icon = 'c'.repeat(64);
  const snapshot = await f.sign({
    kind: 5129,
    created_at: f.current.created_at + 1,
    content: 'Standalone remix',
    tags: [
      ['x', f.hash],
      ['icon', icon, 'image/png'],
      ['server', 'https://blossom.example'],
      ['a', nappletKey(f.current)],
    ],
  });
  for (const rows of f.events.values()) rows.push(snapshot);
  expect(nappletKey(snapshot)).toBe(snapshot.id);
  const plan = await planLifecycle({ manifest: snapshot, relays: f.relays, io: f.io });
  expect(plan.manifests.map((e) => e.id)).toEqual([snapshot.id]);
  expect(plan.blobs.find((blob) => blob.hash === f.hash)?.retained).toContain('another napplet');
  expect(plan.blobs.find((blob) => blob.hash === icon)?.labels).toEqual(['Icon']);
  const receipt = createLifecycleReceipt(plan, 'unpublish');
  await executeLifecycle(receipt, { io: f.io, signer: f.signer, save: f.save });
  expect(f.events.get(f.relays[0])!.some((event) => event.id === f.current.id)).toBe(true);
  expect(f.events.get(f.relays[0])!.some((event) => event.id === f.snapshot.id)).toBe(true);
  expect(f.events.get(f.relays[0])!.some((event) => event.id === snapshot.id)).toBe(false);
  const namedPlan = await f.plan();
  expect(namedPlan.manifests.some((event) => event.id === snapshot.id)).toBe(false);
});

test('standalone named publications unpublish and republish their original format and preserve independent snapshots', async () => {
  const f = await fixture();
  const current = await f.sign({
    kind: 35129,
    created_at: f.current.created_at,
    content: 'Raw-hash creation',
    tags: [
      ['d', 'world'],
      ['x', f.hash],
      ['server', 'https://blossom.example'],
      ['O', 'connect'],
    ],
  });
  const snapshot = await f.sign({
    ...current,
    kind: 5129,
    content: 'An independently published snapshot',
    tags: current.tags.filter((t) => t[0] !== 'd'),
  });
  for (const relay of f.relays) f.events.set(relay, [current, snapshot]);
  const plan = await planLifecycle({ manifest: current, relays: f.relays, io: f.io });
  expect(plan.manifests.map((e) => e.id)).toEqual([current.id]);
  expect(plan.blobs[0].hash).toBe(f.hash);
  expect(plan.blobs[0].retained).toContain('another napplet');
  const unpublish = createLifecycleReceipt(plan, 'unpublish');
  await executeLifecycle(unpublish, { io: f.io, signer: f.signer, save: f.save });
  expect(f.events.get(f.relays[0])!.some((e) => e.id === snapshot.id)).toBe(true);
  const republish = createLifecycleReceipt(plan, 'republish');
  await executeLifecycle(republish, { io: f.io, signer: f.signer, save: f.save });
  expect(lifecycleFinished(republish)).toBe(true);
  expect(republish.events.listing.content).toBe(current.content);
  expect(republish.events.listing.tags).toEqual(current.tags);
});

test('explicit verified publication pairs include exact snapshots only in the deletion inventory and survive recovery', async () => {
  const f = await fixture();
  const current = await f.sign({
    kind: 35129,
    created_at: f.current.created_at,
    content: 'Raw-hash creation',
    tags: [
      ['d', 'world'],
      ['x', f.hash],
      ['server', 'https://blossom.example'],
    ],
  });
  const snapshot = await f.sign({
    ...current,
    kind: 5129,
    tags: current.tags.filter((t) => t[0] !== 'd'),
  });
  const other = await f.sign({ ...snapshot, content: 'Separate snapshot with shared bytes' });
  for (const relay of f.relays) f.events.set(relay, [current, snapshot, other]);
  const plan = await planLifecycle({
    manifest: current,
    relays: f.relays,
    io: f.io,
    snapshotPairs: [{ current, snapshot }],
  });
  expect(plan.manifests.map((e) => e.id).sort()).toEqual([current.id, snapshot.id].sort());
  expect(plan.blobs[0].retained).toContain('another napplet');
  expect(nappletKey(snapshot)).toBe(snapshot.id);
  const receipt = parseReceipt(
    JSON.parse(JSON.stringify(createLifecycleReceipt(plan, 'unpublish'))),
  );
  await executeLifecycle(receipt, { io: f.io, signer: f.signer, save: f.save });
  expect(f.events.get(f.relays[0])!.some((e) => e.id === current.id || e.id === snapshot.id)).toBe(
    false,
  );
  expect(f.events.get(f.relays[0])!.some((e) => e.id === other.id)).toBe(true);
  await expect(
    planLifecycle({
      manifest: current,
      relays: f.relays,
      io: f.io,
      snapshotPairs: [{ current, snapshot: other }],
    }),
  ).rejects.toThrow('Release metadata mismatch');
  const altered = createLifecycleReceipt(plan, 'unpublish');
  altered.plan = {
    ...altered.plan,
    manifests: [current, other],
    snapshotPairs: [{ current: current.id, snapshot: other.id }],
  };
  const writes = f.writes.length;
  await expect(
    executeLifecycle(parseReceipt(altered), { io: f.io, signer: f.signer, save: f.save }),
  ).rejects.toThrow('Release metadata mismatch');
  expect(f.writes).toHaveLength(writes);
});

test('fresh inventory discovers exact same-author pairs and retains snapshots matched only by bytes, ancestry or time', async () => {
  const f = await fixture();
  const current = await f.sign({
    kind: 35129,
    created_at: f.current.created_at,
    content: 'Current description',
    tags: [
      ['d', 'world'],
      ['x', f.hash],
      ['server', 'https://blossom.example'],
    ],
  });
  const snapshot = await f.sign({
    ...current,
    kind: 5129,
    tags: current.tags.filter((tag) => tag[0] !== 'd'),
  });
  const changedTime = await f.sign({ ...snapshot, created_at: snapshot.created_at - 1 });
  const changedDescription = await f.sign({
    ...snapshot,
    content: 'Independent description',
    tags: [...snapshot.tags, ['a', nappletKey(current)]],
  });
  for (const relay of f.relays)
    f.events.set(relay, [current, snapshot, changedTime, changedDescription]);
  const plan = await planLifecycle({
    manifest: current,
    relays: f.relays,
    io: f.io,
    operation: 'unpublish',
  });
  expect(plan.snapshotPairs).toEqual([{ current: current.id, snapshot: snapshot.id }]);
  expect(plan.manifests.map((event) => event.id).sort()).toEqual([current.id, snapshot.id].sort());
  expect(f.writes).toHaveLength(0);
  const receipt = parseReceipt(createLifecycleReceipt(plan, 'unpublish'));
  await executeLifecycle(receipt, { io: f.io, signer: f.signer, save: f.save });
  expect(receipt.events.deletion.tags).toContainEqual(['e', snapshot.id]);
  expect(
    f.events
      .get(f.relays[0])!
      .filter((event) => event.kind === 5129)
      .map((event) => event.id)
      .sort(),
  ).toEqual([changedTime.id, changedDescription.id].sort());
});

test('retained signed revisions select historical pairs even when the relay pruned their named events', async () => {
  const f = await fixture();
  const old = await f.sign({
    kind: 35129,
    created_at: f.current.created_at - 1,
    content: 'Previous description',
    tags: [
      ['d', 'world'],
      ['x', f.hash],
      ['server', 'https://blossom.example'],
    ],
  });
  const oldSnapshot = await f.sign({
    ...old,
    kind: 5129,
    tags: old.tags.filter((tag) => tag[0] !== 'd'),
  });
  const current = await f.sign({
    ...old,
    created_at: f.current.created_at,
    content: 'Current description',
  });
  const snapshot = await f.sign({
    ...current,
    kind: 5129,
    tags: current.tags.filter((tag) => tag[0] !== 'd'),
  });
  for (const relay of f.relays) f.events.set(relay, [current, snapshot, oldSnapshot]);
  const noHistory = await planLifecycle({
    manifest: current,
    relays: f.relays,
    io: f.io,
    operation: 'unpublish',
  });
  expect(noHistory.manifests.some((event) => event.id === oldSnapshot.id)).toBe(false);
  const plan = await planLifecycle({
    manifest: current,
    relays: f.relays,
    io: f.io,
    operation: 'unpublish',
    history: {
      manifests: [old, oldSnapshot],
      complete: true,
      warnings: ['Retained history only.'],
    },
  });
  expect(plan.snapshotPairs).toContainEqual({ current: old.id, snapshot: oldSnapshot.id });
  expect(plan.manifests.map((event) => event.id).sort()).toEqual(
    [old.id, oldSnapshot.id, current.id, snapshot.id].sort(),
  );
  const receipt = createLifecycleReceipt(plan, 'unpublish');
  await executeLifecycle(receipt, { io: f.io, signer: f.signer, save: f.save });
  expect(receipt.events.deletion.tags).toContainEqual(['e', old.id]);
  expect(receipt.events.deletion.tags).toContainEqual(['e', oldSnapshot.id]);
  expect(f.events.get(f.relays[0])!.filter((event) => [35129, 5129].includes(event.kind))).toEqual(
    [],
  );
});

test('deletion retains a linked repository whose identifier equals the napplet, in shell and journal plans', async () => {
  const f = await fixture();
  const address = `30617:${f.author}:world`;
  const source = `nostr://${nip19.npubEncode(f.author)}/${encodeURIComponent('wss://git.example/')}/world`;
  const manifest = await f.sign({
    ...f.current,
    tags: [...f.current.tags, ['source', source], ['soy-source-repository', address, 'linked']],
  });
  for (const rows of f.events.values()) rows.push(manifest);
  const plan = await planLifecycle({ manifest, relays: f.relays, io: f.io });
  expect(plan.repositories).toHaveLength(1);
  expect(plan.repositories[0].retained).toContain('Your own source repository is kept');
  const receipt = createLifecycleReceipt(plan, 'delete');
  await executeLifecycle(receipt, { signer: f.signer, io: f.io, save: async () => {} });
  expect(receipt.events.deletion.tags).not.toContainEqual(['a', address]);
  const repositorySteps = receipt.steps.filter((s) => s.id.startsWith('repo:'));
  expect(repositorySteps).toHaveLength(1);
  expect(repositorySteps[0].state).toBe('retained');

  // Previously signed releases are also protected by the local job record.
  const old = await f.sign({ ...f.current, tags: [...f.current.tags, ['source', source]] });
  const journalPlan = await planLifecycle({
    manifest: old,
    relays: f.relays,
    io: f.io,
    retainedRepositories: [address],
  });
  expect(journalPlan.repositories.every((repo) => !!repo.retained)).toBe(true);
});

test('lifecycle refuses an excessive known relay inventory instead of silently truncating destinations', async () => {
  const f = await fixture();
  await expect(
    planLifecycle({
      manifest: f.current,
      io: f.io,
      relays: Array.from({ length: 257 }, (_, i) => `wss://relay${i}.example`),
    }),
  ).rejects.toMatchObject({ code: 'LIFECYCLE_RELAYS' });
  expect(f.writes).toHaveLength(0);
});
