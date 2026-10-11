import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey, matchFilter } from 'nostr-tools';
import { aggregateHash, encodeAddress, sha256, type SignedEvent } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import {
  executeMigration,
  copyMigratedManifest,
  migrationReceiptSchema,
  isManifestMigration,
  migrationTemplate,
  migrationToken,
  planMigration,
  type MigrationReceipt,
} from './index';
const key = new Uint8Array(32).fill(4),
  author = getPublicKey(key);
async function fixture(kind = 35129) {
  const bytes = new TextEncoder().encode('<!doctype html><p>unchanged migration bytes</p>'),
    hash = await sha256(bytes);
  const from = finalizeEvent(
    {
      kind,
      created_at: 100,
      content: '',
      tags: [
        ...(kind === 35129 ? [['d', 'game']] : []),
        ['title', 'Game'],
        ['description', 'Old description'],
        ['path', '/index.html', hash],
        ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
        ['requires', 'storage'],
        ['server', 'https://blossom.example'],
        ['source', 'https://git.example/source'],
        ['app', `32267:${author}:game`],
        ['a', `35129:${author}:ancestor`],
      ],
    },
    key,
  );
  let current: SignedEvent | undefined = from;
  let downloads = 0,
    signs = 0;
  const written: SignedEvent[] = [];
  const io = {
    read: async (_r: string, f: any) => (current && matchFilter(f, current) ? [current] : []),
    fetch: async () => {
      downloads++;
      return new Response(bytes);
    },
    publish: async (_r: string, e: SignedEvent) => {
      written.push(e);
      current = e;
    },
  };
  const signer = {
    signEvent: async (template: any) => {
      signs++;
      return finalizeEvent(template, key);
    },
  };
  return {
    from,
    hash,
    bytes,
    io,
    signer,
    written,
    setCurrent: (e: SignedEvent | undefined) => {
      current = e;
    },
    metrics: () => ({ downloads, signs }),
  };
}
test('manifest-only named/root migration reuses verified bytes, keeps source/media, and resumes the exact signed event', async () => {
  for (const kind of [35129, 15129]) {
    const f = await fixture(kind);
    const ref = encodeAddress({
      kind: kind as 35129 | 15129,
      pubkey: author,
      identifier: kind === 35129 ? 'game' : '',
    });
    const plan = await planMigration(ref, {
      primary: 'wss://relay.example',
      mirrors: [],
      network: 'public',
      io: f.io,
    });
    expect(f.metrics()).toEqual({ downloads: 1, signs: 0 });
    expect(plan.artifactHash).toBe(f.hash);
    expect(await migrationToken(plan)).toHaveLength(64);
    const receipt: MigrationReceipt = { plan, accepted: [] };
    let saved: MigrationReceipt | undefined;
    const original = f.io.publish;
    f.io.publish = async () => {
      throw new Error('fixture delivery interrupted');
    };
    await expect(
      executeMigration(receipt, {
        author,
        signer: f.signer,
        io: f.io,
        save: async (r) => {
          saved = structuredClone(r);
        },
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_PUBLISH' });
    expect(saved?.signed).toBeDefined();
    expect(f.metrics().signs).toBe(1);
    f.io.publish = original;
    await executeMigration(receipt, { author, signer: f.signer, io: f.io, save: async () => {} });
    expect(f.metrics().signs).toBe(1);
    expect(f.written[0].id).toBe(saved!.signed!.id);
    const parsed = await validateManifest(f.written[0]);
    expect(parsed).toMatchObject({
      format: 'standalone',
      artifactHash: f.hash,
      description: 'Old description',
      domains: ['storage'],
    });
    expect(f.written[0].tags).toContainEqual(['app', `32267:${author}:game`]);
    expect(f.written[0].tags).toContainEqual(['source', 'https://git.example/source']);
    expect(
      f.written[0].tags.some((t) => ['a', 'A', 'path', 'description', 'requires'].includes(t[0])),
    ).toBe(false);
    expect(await isManifestMigration(f.from, f.written[0])).toBe(true);
    expect(
      await isManifestMigration(
        f.from,
        finalizeEvent({ ...f.written[0], content: 'Changed content' }, key),
      ),
    ).toBe(false);
    await executeMigration(receipt, { author, signer: f.signer, io: f.io, save: async () => {} });
    expect(f.written).toHaveLength(1);
  }
});
test('migration refuses a different author, a stale current and wrong artifact bytes before signing', async () => {
  const f = await fixture();
  const ref = encodeAddress({ kind: 35129, pubkey: author, identifier: 'game' });
  const plan = await planMigration(ref, {
    primary: 'wss://relay.example',
    network: 'public',
    io: f.io,
  });
  const receipt: MigrationReceipt = { plan, accepted: [] };
  const options = { author, signer: f.signer, io: f.io, save: async () => {} };
  await expect(
    executeMigration(receipt, { ...options, author: 'b'.repeat(64) }),
  ).rejects.toMatchObject({ code: 'CREATOR_MISMATCH' });
  f.setCurrent(finalizeEvent({ ...f.from, created_at: 101 }, key));
  await expect(executeMigration(receipt, options)).rejects.toMatchObject({
    code: 'REMOTE_CONFLICT',
  });
  f.setCurrent(f.from);
  f.io.fetch = async () => new Response('wrong bytes');
  await expect(executeMigration(receipt, options)).rejects.toMatchObject({
    code: 'MIGRATION_ARTIFACT',
  });
  expect(f.metrics().signs).toBe(0);
  expect(f.written).toHaveLength(0);
});
test('migration refuses deleted publications, unsafe downloads and snapshot identity conversion', async () => {
  const f = await fixture();
  const ref = encodeAddress({ kind: 35129, pubkey: author, identifier: 'game' });
  const deletion = finalizeEvent(
    { kind: 5, created_at: 200, content: '', tags: [['a', `35129:${author}:game`]] },
    key,
  );
  f.io.read = async (_r, filt) => [f.from, deletion].filter((e) => matchFilter(filt, e));
  await expect(
    planMigration(ref, { primary: 'wss://relay.example', network: 'public', io: f.io }),
  ).rejects.toMatchObject({ code: 'MIGRATION_DELETED' });
  const snap = finalizeEvent(
    { ...f.from, kind: 5129, tags: f.from.tags.filter((t) => t[0] !== 'd') },
    key,
  );
  await expect(migrationTemplate(snap)).rejects.toMatchObject({ code: 'MIGRATION_SNAPSHOT' });
  const unsafe = finalizeEvent(
    {
      ...f.from,
      tags: f.from.tags.map((t) => (t[0] === 'server' ? ['server', 'http://127.0.0.1:9999'] : t)),
    },
    key,
  );
  f.setCurrent(unsafe);
  f.io.read = async (_r, filter) => (matchFilter(filter, unsafe) ? [unsafe] : []);
  await expect(
    planMigration(ref, { primary: 'wss://relay.example', network: 'public', io: f.io }),
  ).rejects.toMatchObject({ code: 'MIGRATION_ARTIFACT' });
  expect(f.metrics()).toEqual({ downloads: 0, signs: 0 });
});

test('manifest-only migration copies the existing signature to current outboxes and retains earlier attempted destinations', async () => {
  const f = await fixture();
  const ref = encodeAddress({ kind: 35129, pubkey: author, identifier: 'game' });
  const plan = await planMigration(ref, {
    primary: 'wss://relay.example',
    network: 'public',
    io: f.io,
  });
  const receipt: MigrationReceipt = { plan, accepted: [] };
  await executeMigration(receipt, { author, signer: f.signer, io: f.io, save: async () => {} });
  const originalSigns = f.metrics().signs;
  let destination = 'wss://one.example/';
  const writes: { url: string; id: string }[] = [];
  const options = {
    io: () => ({
      read: async () => [
        finalizeEvent(
          { kind: 10002, content: '', created_at: 100, tags: [['r', destination, 'write']] },
          key,
        ),
      ],
      ensure: async (url: string, event: SignedEvent) => {
        writes.push({ url, id: event.id });
      },
      close() {},
    }),
    save: async (value: MigrationReceipt) => {
      migrationReceiptSchema.parse(value);
    },
  };
  await copyMigratedManifest(receipt, options);
  destination = 'wss://two.example/';
  await copyMigratedManifest(receipt, options);
  expect(f.metrics().signs).toBe(originalSigns);
  expect(writes).toEqual([
    { url: 'wss://one.example/', id: receipt.signed!.id },
    { url: 'wss://two.example/', id: receipt.signed!.id },
  ]);
  expect(receipt.outboxHistory).toEqual(['wss://one.example/', 'wss://two.example/']);
});
