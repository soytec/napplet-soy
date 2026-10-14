import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sourceGit } from '../../grasp/src/client';
import { encodeAddress } from '../../protocol/src';
import { inspectHistory } from './git-source';
import { checkSource } from './project';

const path = '.napplet-space/soy-backend.json';
const publicContext = {
  version: 1,
  napplet: encodeAddress({ kind: 35129, pubkey: 'a'.repeat(64), identifier: 'test-world' }),
  provider: { pubkey: 'b'.repeat(64), relays: ['wss://relay.example.com/'] },
  boards: ['scores'],
  modules: ['world'],
};

async function history(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'soy-history-'));
  await sourceGit(root, ['init']);
  for (const [file, text] of Object.entries(files)) await Bun.write(join(root, file), text);
  await sourceGit(root, ['add', '.']);
  await sourceGit(root, ['commit', '-m', 'Old authoring guidance']);
  const original = await sourceGit(root, ['rev-parse', 'HEAD']);
  const blob = await sourceGit(root, ['rev-parse', `${original}:${Object.keys(files)[0]}`]);
  await sourceGit(root, ['rm', '-r', '.']);
  await Bun.write(join(root, '.gitignore'), '.napplet-space/\n');
  await sourceGit(root, ['add', '.']);
  await sourceGit(root, ['commit', '-m', 'Keep generated context ignored']);
  const head = await sourceGit(root, ['rev-parse', 'HEAD']);
  return { root, original, blob, head, close: () => rm(root, { recursive: true, force: true }) };
}

test('removed legacy public backend context remains publishable without rewriting history', async () => {
  const f = await history({ [path]: JSON.stringify(publicContext, null, 2) });
  try {
    const result = await inspectHistory(f.root, f.head);
    expect(result).toMatchObject({
      commit: f.head,
      legacyPublicContexts: [{ path, object: f.blob, commit: f.original }],
    });
    expect(await sourceGit(f.root, ['rev-parse', 'HEAD'])).toBe(f.head);
    expect(await sourceGit(f.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await sourceGit(f.root, ['status', '--porcelain'])).toBe('');
    // This is an ancestry-only compatibility rule, never a source-selection exemption.
    expect(() =>
      checkSource(path, new TextEncoder().encode(JSON.stringify(publicContext))),
    ).toThrow('private or generated');
    await expect(inspectHistory(f.root, f.original)).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
      context: {
        recovery: expect.stringContaining('Remove the generated context from Git tracking'),
      },
    });
  } finally {
    await f.close();
  }
});

test('history rejection identifies path, blob and containing commit without printing contents', async () => {
  const f = await history({
    '.napplet-space/project.json': '{"privateKey":"fixture-secret-value"}',
  });
  try {
    await expect(inspectHistory(f.root, f.head)).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
      message: expect.stringContaining('Git history'),
      context: {
        detail: expect.stringContaining(f.blob),
        recovery: expect.stringContaining('history'),
      },
    });
  } finally {
    await f.close();
  }
});

test('legacy compatibility rejects unknown fields, credentials, malformed and oversized metadata', async () => {
  const variants = [
    JSON.stringify({ ...publicContext, secret: 'fixture-secret-value' }),
    JSON.stringify({
      ...publicContext,
      provider: { ...publicContext.provider, token: 'fixture-secret-value' },
    }),
    JSON.stringify({
      ...publicContext,
      provider: {
        ...publicContext.provider,
        relays: ['wss://relay.example.com/?secret=fixture-secret-value'],
      },
    }),
    JSON.stringify({ ...publicContext, modules: ['nsec1' + 'q'.repeat(58)] }),
    JSON.stringify({
      ...publicContext,
      provider: {
        ...publicContext.provider,
        relays: ['wss://relay.example.com/nsec1' + 'q'.repeat(58)],
      },
    }),
    JSON.stringify({ ...publicContext, napplet: 'not-an-address' }),
    JSON.stringify({ ...publicContext, version: 2 }),
    '{"version":1,"provider":',
    '{"modules":["fixture-secret-value"],' + JSON.stringify(publicContext).slice(1),
    ' '.repeat(16385) + JSON.stringify(publicContext),
  ];
  for (const [index, text] of variants.entries()) {
    const f = await history({ [path]: text });
    try {
      await expect(inspectHistory(f.root, f.head)).rejects.toMatchObject({ code: 'SOURCE_SECRET' });
      if (index === 0)
        await expect(inspectHistory(f.root, f.original)).rejects.toMatchObject({
          code: 'SOURCE_SECRET',
          context: { recovery: expect.stringContaining('history cleanup') },
        });
    } finally {
      await f.close();
    }
  }
}, 15000);

test('the same historical blob cannot hide a forbidden alias behind its public context path', async () => {
  const text = JSON.stringify(publicContext);
  const f = await history({ [path]: text, '.napplet-space/world.db': text });
  try {
    await expect(inspectHistory(f.root, f.head)).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
      message: expect.stringContaining('.napplet-space/world.db'),
    });
  } finally {
    await f.close();
  }
});

async function linkedHistory(
  links: Record<string, string>,
  files: Record<string, string> = { 'AGENTS.md': 'Public authoring guidance\n' },
) {
  const root = await mkdtemp(join(tmpdir(), 'soy-link-history-'));
  await sourceGit(root, ['init']);
  for (const [file, text] of Object.entries(files)) await Bun.write(join(root, file), text);
  for (const [file, target] of Object.entries(links)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await symlink(target, join(root, file));
  }
  await sourceGit(root, ['add', '.']);
  await sourceGit(root, ['commit', '-m', 'Historical source aliases']);
  const original = await sourceGit(root, ['rev-parse', 'HEAD']);
  await sourceGit(root, ['rm', '-r', '.']);
  await Bun.write(join(root, 'CLAUDE.md'), 'Current regular source file\n');
  await sourceGit(root, ['add', '.']);
  await sourceGit(root, ['commit', '-m', 'Replace source aliases with regular files']);
  const head = await sourceGit(root, ['rev-parse', 'HEAD']);
  return { root, original, head, close: () => rm(root, { recursive: true, force: true }) };
}

test('current and historical in-repository file aliases preserve publishable history', async () => {
  const f = await linkedHistory({
    'CLAUDE.md': 'AGENTS.md',
    'docs/CLAUDE.md': '../AGENTS.md',
    'alias.md': './CLAUDE.md',
  });
  try {
    expect(await inspectHistory(f.root, f.head)).toMatchObject({ commit: f.head });
    expect(await sourceGit(f.root, ['rev-parse', 'HEAD'])).toBe(f.head);
    expect(await sourceGit(f.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
    expect(await sourceGit(f.root, ['status', '--porcelain'])).toBe('');
    const current = await inspectHistory(f.root, f.original);
    expect(current.aliases).toHaveLength(3);
    for (const alias of current.aliases)
      expect(alias).toMatchObject({ target: 'AGENTS.md', executable: false });
  } finally {
    await f.close();
  }
});

test('historical file aliases reject escapes, private paths, dangling links, directories and cycles', async () => {
  const variants: {
    links: Record<string, string>;
    files?: Record<string, string>;
    code?: string;
  }[] = [
    { links: { 'CLAUDE.md': '/etc/passwd' } },
    { links: { 'CLAUDE.md': '../AGENTS.md' } },
    { links: { 'docs/CLAUDE.md': '../../AGENTS.md' } },
    { links: { 'CLAUDE.md': 'missing.md' } },
    { links: { 'CLAUDE.md': '.' } },
    { links: { 'CLAUDE.md': 'docs' }, files: { 'docs/AGENTS.md': 'public' } },
    { links: { 'CLAUDE.md': 'CLAUDE.md' } },
    { links: { 'CLAUDE.md': 'alias.md', 'alias.md': 'CLAUDE.md' } },
    { links: { 'CLAUDE.md': 'AGENTS.md\n' } },
    { links: { 'CLAUDE.md': 'AGENTS.md/../AGENTS.md' } },
    { links: { 'CLAUDE.md': 'C:/AGENTS.md' } },
    { links: { 'CLAUDE.md': 'docs\\AGENTS.md' } },
    { links: { 'CLAUDE.md': '.git/config' }, code: 'SOURCE_SECRET' },
    { links: { '.env': 'AGENTS.md' }, code: 'SOURCE_SECRET' },
    { links: { 'CLAUDE.md': '.env' }, files: { '.env': 'private' }, code: 'SOURCE_SECRET' },
    {
      links: { 'CLAUDE.md': '.napplet-space/../AGENTS.md' },
      code: 'SOURCE_SECRET',
    },
    {
      links: { 'CLAUDE.md': 'alias/AGENTS.md', alias: 'docs' },
      files: { 'docs/AGENTS.md': 'public' },
    },
    {
      links: { 'CLAUDE.md': 'AGENTS.md' },
      files: { 'AGENTS.md': '-----BEGIN OPENSSH PRIVATE KEY-----' },
      code: 'SOURCE_SECRET',
    },
  ];
  for (const variant of variants) {
    const f = await linkedHistory(variant.links, variant.files);
    try {
      await expect(inspectHistory(f.root, f.head)).rejects.toMatchObject({
        code: variant.code ?? 'SOURCE_PATH',
      });
    } finally {
      await f.close();
    }
  }
}, 15000);

test('a reused historical alias is resolved against every containing tree', async () => {
  const f = await linkedHistory({ 'CLAUDE.md': 'AGENTS.md' });
  try {
    await sourceGit(f.root, ['checkout', '--detach', f.original]);
    await sourceGit(f.root, ['rm', 'AGENTS.md']);
    await sourceGit(f.root, ['commit', '-m', 'Leave a historical dangling alias']);
    const dangling = await sourceGit(f.root, ['rev-parse', 'HEAD']);
    await Bun.write(join(f.root, 'AGENTS.md'), 'Public authoring guidance\n');
    await sourceGit(f.root, ['add', 'AGENTS.md']);
    await sourceGit(f.root, ['commit', '-m', 'Restore the public alias target']);
    await sourceGit(f.root, ['rm', 'CLAUDE.md']);
    await sourceGit(f.root, ['commit', '-m', 'Remove the alias from the release']);
    await expect(
      inspectHistory(f.root, await sourceGit(f.root, ['rev-parse', 'HEAD'])),
    ).rejects.toMatchObject({
      code: 'SOURCE_PATH',
      context: { detail: expect.stringContaining(dangling) },
    });
  } finally {
    await f.close();
  }
});

test('historical Git submodule references are allowed but release submodules are rejected', async () => {
  const f = await linkedHistory({ 'CLAUDE.md': 'AGENTS.md' });
  try {
    await sourceGit(f.root, ['checkout', '--detach', f.original]);
    await sourceGit(f.root, [
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${f.original},module`,
    ]);
    await sourceGit(f.root, ['commit', '-m', 'Historical submodule']);
    const submoduleCommit = await sourceGit(f.root, ['rev-parse', 'HEAD']);
    await expect(inspectHistory(f.root, submoduleCommit)).rejects.toMatchObject({
      code: 'SOURCE_PATH',
      message: expect.stringContaining('submodule entries'),
    });
    await sourceGit(f.root, ['rm', '-r', '--cached', '.']);
    await rm(join(f.root, 'CLAUDE.md'));
    await sourceGit(f.root, ['add', 'AGENTS.md']);
    await sourceGit(f.root, ['commit', '-m', 'Regular release source']);
    const head = await sourceGit(f.root, ['rev-parse', 'HEAD']);
    expect(await inspectHistory(f.root, head)).toMatchObject({ commit: head });
    expect(await sourceGit(f.root, ['rev-parse', 'HEAD'])).toBe(head);
  } finally {
    await f.close();
  }
});

test('ordinary Git metadata remains publishable in current trees and deleted history', async () => {
  for (const files of [
    { '.gitmodules': '', '.gitattributes': '* text=auto\n' },
    {
      '.gitmodules':
        '[submodule "library"]\n\tpath = library\n\turl = https://example.com/library.git\n',
      '.gitattributes': '*.png binary\n',
    },
  ]) {
    const f = await history(files);
    try {
      for (const [path, text] of Object.entries(files))
        expect(() => checkSource(path, new TextEncoder().encode(text))).not.toThrow();
      expect(await inspectHistory(f.root, f.original)).toMatchObject({ commit: f.original });
      expect(await inspectHistory(f.root, f.head)).toMatchObject({ commit: f.head });
      expect(await sourceGit(f.root, ['rev-list', '--count', 'HEAD'])).toBe('2');
      expect(await sourceGit(f.root, ['status', '--porcelain'])).toBe('');
    } finally {
      await f.close();
    }
  }
});

test('Git metadata still rejects detected credentials in current and deleted history', async () => {
  for (const path of ['.gitmodules', '.gitattributes']) {
    const text = '-----BEGIN OPENSSH PRIVATE KEY-----';
    const f = await history({ [path]: text });
    try {
      expect(() => checkSource(path, new TextEncoder().encode(text))).toThrow('likely credential');
      for (const commit of [f.original, f.head])
        await expect(inspectHistory(f.root, commit)).rejects.toMatchObject({
          code: 'SOURCE_SECRET',
          message: expect.stringContaining(path),
        });
    } finally {
      await f.close();
    }
  }
});
