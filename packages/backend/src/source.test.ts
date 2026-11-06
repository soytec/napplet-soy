import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeEvent } from 'nostr-tools';
import { aggregateHash, sha256, type SignedEvent } from '../../protocol/src';
import { freezeFixture as freezeSource } from '../../publish/src/testing';
import { sourceGit } from '../../grasp/src/client';
import { initializePolicy, updatePolicy } from '../../moderation/src/policy';
import { createSourceBrowser, downloadSourceArchive, SOURCE_TEXT_LIMIT } from './source';

let directory: string, tar: Uint8Array, hash: string, artifactHash: string;
const html = new TextEncoder().encode(
  '<!doctype html><script>window.sourceWasExecuted = true</script>',
);
const key = new Uint8Array(32);
key[31] = 1; // Public test fixture only.
let serial = 0;
async function manifest(tags: string[][] = []) {
  return finalizeEvent(
    {
      kind: 35129,
      created_at: ++serial,
      content: '',
      tags: [
        ['d', 'source-test'],
        ['title', 'Little source world'],
        ['path', '/index.html', artifactHash],
        ['x', await aggregateHash([{ path: '/index.html', hash: artifactHash }]), 'aggregate'],
        ...tags,
      ],
    },
    key,
  );
}
function browser(events: SignedEvent[], download = async () => tar) {
  return createSourceBrowser({
    manifest: async (id) => events.find((e) => e.id === id) ?? null,
    artifact: async () => html,
    download,
  });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'source-test-'));
  artifactHash = await sha256(html);
  await freezeSource(
    directory,
    new Map([
      [
        'README.md',
        new TextEncoder().encode(
          '# A small world\n<script>window.sourceWasExecuted = true</script>',
        ),
      ],
      ['src/main.ts', new TextEncoder().encode('export const greeting = "hello";')],
      ['assets/sound.wav', new Uint8Array([0, 255, 0, 10])],
      ['large.txt', new Uint8Array(SOURCE_TEXT_LIMIT + 1).fill(65)],
      ['LICENSE', new TextEncoder().encode('MIT\nOriginal author credit')],
      ['index.html', html],
    ]),
    1800000000,
  );
  tar = await Bun.file(join(directory, 'source.tar')).bytes();
  hash = await sha256(tar);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

test('pinned archive tree, safe file projection, license, downloads and request deduplication', async () => {
  const event = await manifest([
    ['source-archive', `https://assets.example/${hash}`],
    ['source-commit', 'a'.repeat(40)],
    ['source', 'https://git.example/project'],
  ]);
  let calls = 0;
  const service = browser([event], async () => {
    calls++;
    await Bun.sleep(20);
    return tar;
  });
  const input = { revision: event.id, view: 'project' as const };
  const [a, b] = await Promise.all([service.view(input), service.view(input)]);
  expect(calls).toBe(1);
  expect(a).toEqual(b);
  expect(a?.archiveHash).toBe(hash);
  expect(a?.files.length).toBe(6);
  expect(a?.licenseFile).toBe('LICENSE');
  expect(a?.selected?.path).toBe('README.md');
  expect(a?.selected?.text).toContain('<script>');
  expect(a?.commit).toBe('a'.repeat(40));
  expect((await service.view({ ...input, file: 'assets/sound.wav' }))?.selected?.state).toBe(
    'binary',
  );
  expect((await service.view({ ...input, file: 'large.txt' }))?.selected).toMatchObject({
    state: 'large',
    text: null,
  });
  expect((await service.view({ ...input, file: '../../secret' }))?.selected?.state).toBe('missing');
  expect(await service.download({ ...input, file: '../../secret' })).toBeNull();
  expect((await service.download({ ...input, file: 'src/main.ts' }))?.bytes).toEqual(
    new TextEncoder().encode('export const greeting = "hello";'),
  );
  expect((await service.download(input, true))?.bytes).toEqual(tar);
  expect(calls).toBe(1);
});

test('source browser lists and reads a pinned source archive beyond 128 files', async () => {
  const folder = join(directory, 'many-files');
  await Promise.all(
    Array.from({ length: 129 }, (_, i) =>
      Bun.write(join(folder, `file-${String(i).padStart(3, '0')}.ts`), `export const n = ${i};`),
    ),
  );
  await sourceGit(folder, ['init', '--initial-branch=main']);
  await sourceGit(folder, ['add', '.']);
  await sourceGit(folder, ['commit', '-m', 'Source beyond the old file limit']);
  const archive = join(folder, 'source.tar');
  await sourceGit(folder, ['archive', '--format=tar', `--output=${archive}`, 'HEAD']);
  const bytes = await Bun.file(archive).bytes();
  const event = await manifest([
    ['source-archive', `https://assets.example/${await sha256(bytes)}`],
  ]);
  const service = browser([event], async () => bytes);
  const input = { revision: event.id, view: 'project' as const, file: 'file-128.ts' };
  const view = await service.view(input);
  expect(view?.files).toHaveLength(129);
  expect(view?.selected).toMatchObject({ path: 'file-128.ts', text: 'export const n = 128;' });
  expect((await service.download(input))?.bytes).toEqual(
    new TextEncoder().encode('export const n = 128;'),
  );
});

for (const mode of ['cached', 'pending', 'failed'] as const)
  test(`a stable archive URL cannot reuse ${mode} results for a different signed hash`, async () => {
    const folder = join(directory, `stable-url-${mode}`);
    await freezeSource(
      folder,
      new Map([['README.md', new TextEncoder().encode('# The new revision')]]),
      1800000001,
    );
    const next = await Bun.file(join(folder, 'source.tar')).bytes();
    const nextHash = await sha256(next);
    const events = await Promise.all(
      [hash, nextHash].map((h) =>
        manifest([['source-archive', 'https://assets.example/source.tar', h, 'application/x-tar']]),
      ),
    );
    let calls = 0;
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const downloading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const service = browser(events, async () => {
      const first = calls++ === 0;
      if (first) {
        started();
        if (mode === 'pending') await gate;
      }
      return first && mode !== 'failed' ? tar : next;
    });
    const input = (i: number) => ({ revision: events[i].id, view: 'project' as const });
    const old = service.view(input(0));
    await downloading;
    if (mode !== 'pending') await old;
    const fresh = service.view(input(1));
    release();
    const [before, after] = await Promise.all([old, fresh]);
    if (mode === 'failed') expect(before?.message).toContain('could not');
    else expect(before?.selected?.text).toContain('# A small world');
    expect(after?.archiveHash).toBe(nextHash);
    expect(after?.selected?.text).toBe('# The new revision');
    expect((await service.readme(events[1].id))?.lines).toEqual(['# The new revision']);
    const download = await service.download(input(1), true);
    expect(await sha256(download!.bytes)).toBe(nextHash);
    expect(calls).toBe(2);
  });

test('missing and invalid source remain explicit; verified HTML is an independent fallback', async () => {
  const event = await manifest([['source', 'nostr://repository-reference']]);
  let calls = 0;
  const service = browser([event], async () => {
    calls++;
    return tar;
  });
  const input = { revision: event.id, view: 'project' as const };
  const project = await service.view(input);
  expect(project?.files).toEqual([]);
  expect(project?.message).toContain('not attached');
  expect(project?.sourceReference).toBe('nostr://repository-reference');
  expect(project?.sourceUrl).toBeNull();
  const built = await service.view({ ...input, view: 'html' });
  expect(built?.selected?.text).toBe(new TextDecoder().decode(html));
  expect(built?.licenseFile).toBeNull();
  expect(calls).toBe(0);
  const corrupt = await manifest([['source-archive', `https://assets.example/${'f'.repeat(64)}`]]);
  const unsafe = await manifest([
    ['source-archive', `https://user:password@assets.example/${hash}`],
  ]);
  const activeLink = await manifest([['source', 'javascript:alert(1)']]);
  const s = browser([corrupt, unsafe, activeLink]);
  expect((await s.view({ ...input, revision: corrupt.id }))?.message).toContain('could not');
  expect((await s.view({ ...input, revision: unsafe.id }))?.message).toContain('invalid');
  expect((await s.view({ ...input, revision: activeLink.id }))?.sourceUrl).toBeNull();
  const wrongArtifact = createSourceBrowser({
    manifest: async () => event,
    artifact: async () => new Uint8Array([1]),
    download: async () => tar,
  });
  expect((await wrongArtifact.view({ ...input, view: 'html' }))?.selected).toBeNull();
  expect(await wrongArtifact.view({ ...input, revision: 'a'.repeat(64) })).toBeNull();
});

test('new publications cannot move old source permalinks; deletion and moderation revoke cached reads', async () => {
  const old = await manifest([['source-archive', `https://assets.example/${hash}`]]);
  const newer = await manifest();
  const events = [old, newer],
    service = browser(events);
  const input = { revision: old.id, view: 'project' as const };
  expect((await service.view(input))?.archiveHash).toBe(hash);
  expect(await service.readme(old.id)).not.toBeNull();
  expect((await service.view({ ...input, revision: newer.id }))?.archiveHash).toBeNull();
  const previous = process.env.SPACE_MODERATION_FILE;
  process.env.SPACE_MODERATION_FILE = join(directory, 'policy.json');
  initializePolicy(process.env.SPACE_MODERATION_FILE);
  try {
    updatePolicy(
      { action: 'block', type: 'hash', target: hash, reason: 'test', revision: 0 },
      old.pubkey,
      '1'.repeat(64),
    );
    expect((await service.view(input))?.archiveHash).toBeNull();
    expect(await service.download(input, true)).toBeNull();
    expect(await service.readme(old.id)).toBeNull();
    updatePolicy(
      { action: 'block', type: 'event', target: old.id, reason: 'test', revision: 1 },
      old.pubkey,
      '2'.repeat(64),
    );
    expect(await service.view(input)).toBeNull();
  } finally {
    if (previous === undefined) delete process.env.SPACE_MODERATION_FILE;
    else process.env.SPACE_MODERATION_FILE = previous;
  }
  events.splice(0, 1); // The repository no longer admits this release (e.g. an author deletion).
  expect(await service.view(input)).toBeNull();
  expect(await service.readme(old.id)).toBeNull();
  expect(await service.download(input, true)).toBeNull();
});

test('private-network archive URLs fail before a request unless explicitly configured as dev Blossom', async () => {
  const previous = process.env.SPACE_INDEX_LOCAL_BLOSSOM;
  delete process.env.SPACE_INDEX_LOCAL_BLOSSOM;
  const signal = AbortSignal.timeout(2000);
  try {
    await expect(
      downloadSourceArchive(new URL(`http://127.0.0.1:1/${hash}`), signal),
    ).rejects.toThrow('requires');
    await expect(
      downloadSourceArchive(new URL(`https://127.0.0.1/${hash}`), signal),
    ).rejects.toThrow();
    process.env.SPACE_INDEX_LOCAL_BLOSSOM = 'http://localhost:19348/blossom';
    for (const url of [
      `http://localhost:19349/blossom/${hash}`,
      `http://localhost:19348/admin/${hash}`,
      `http://localhost:19348/blossom/${hash}?action=delete`,
    ])
      await expect(downloadSourceArchive(new URL(url), signal)).rejects.toThrow('requires');
  } finally {
    if (previous === undefined) delete process.env.SPACE_INDEX_LOCAL_BLOSSOM;
    else process.env.SPACE_INDEX_LOCAL_BLOSSOM = previous;
  }
});

test('README excerpts keep the first ten lines, share verified archive reads, and bound long lines', async () => {
  const lines = [
    '# Little world',
    '',
    '<script>alert("inert")</script>',
    'x'.repeat(1200),
    ...Array.from({ length: 8 }, (_, i) => `Line ${i + 5}`),
  ];
  const folder = join(directory, 'excerpt');
  await freezeSource(
    folder,
    new Map([
      ['readme.MD', new TextEncoder().encode(lines.join('\r\n'))],
      ['README.txt', new TextEncoder().encode('Lower priority')],
      ['docs/README.md', new TextEncoder().encode('Nested README')],
    ]),
    1800000000,
  );
  const bytes = await Bun.file(join(folder, 'source.tar')).bytes();
  const event = await manifest([
    ['source-archive', `https://assets.example/${await sha256(bytes)}`],
  ]);
  let reads = 0;
  const service = browser([event], async () => {
    reads++;
    return bytes;
  });
  const [excerpt] = await Promise.all([
    service.readme(event.id),
    service.view({ revision: event.id, view: 'project' }),
  ]);
  expect(reads).toBe(1);
  expect(excerpt?.path).toBe('readme.MD');
  expect(excerpt?.lines).toHaveLength(10);
  expect(excerpt?.lines.slice(0, 3)).toEqual(lines.slice(0, 3));
  expect(excerpt?.lines[3]).toBe('x'.repeat(999) + '…');
  expect(excerpt?.lines[9]).toBe('Line 10');
  expect(excerpt?.truncated).toBe(true);
});

test('optional README excerpts omit missing, binary, oversized and unverified sources', async () => {
  for (const [name, content] of [
    ['docs/README.md', new TextEncoder().encode('Not the root README')],
    ['README', new Uint8Array([0, 255])],
    ['README.md', new Uint8Array(SOURCE_TEXT_LIMIT + 1).fill(65)],
    ['README.txt', new Uint8Array()],
  ] as const) {
    const folder = join(directory, `missing-excerpt-${serial}`);
    await freezeSource(folder, new Map([[name, content]]), 1800000000);
    const bytes = await Bun.file(join(folder, 'source.tar')).bytes();
    const event = await manifest([
      ['source-archive', `https://assets.example/${await sha256(bytes)}`],
    ]);
    expect(await browser([event], async () => bytes).readme(event.id)).toBeNull();
  }
  const missing = await manifest();
  const invalid = await manifest([['source-archive', `https://assets.example/${'0'.repeat(64)}`]]);
  expect(await browser([missing]).readme(missing.id)).toBeNull();
  expect(await browser([invalid]).readme(invalid.id)).toBeNull();
});
