import { afterEach, expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BrowserGit } from './browser-git-engine';
import { exportBrowserGit } from './browser-git-export';
import { sourceGit } from '../../packages/grasp/src/client';
import { gitPath } from './browser-git-contract';

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await fs.rm(path, { recursive: true, force: true });
});
async function folder() {
  const path = await fs.mkdtemp(join(tmpdir(), 'studio-browser-git-'));
  temporary.push(path);
  return path;
}
async function repository() {
  const path = await folder();
  await sourceGit(path, ['init', '--initial-branch=main']);
  await fs.writeFile(join(path, 'index.html'), '<h1>First</h1>');
  await sourceGit(path, ['add', '.']);
  await sourceGit(path, ['commit', '-m', 'Original']);
  await fs.writeFile(join(path, 'README.md'), 'Second commit');
  await sourceGit(path, ['add', '.']);
  await sourceGit(path, ['commit', '-m', 'Readme']);
  return path;
}
async function browserDisk(existing?: string) {
  const root = existing ?? (await folder());
  // Same engine and filesystem interface as the worker, rooted in a disposable directory.
  const map = (path: string) => join(root, path);
  const pfs: any = {};
  for (const key of [
    'readFile',
    'writeFile',
    'mkdir',
    'rmdir',
    'unlink',
    'readdir',
    'stat',
    'lstat',
    'readlink',
    'chmod',
  ] as const) {
    pfs[key] = async (path: string, ...args: any[]) => (fs[key] as Function)(map(path), ...args);
  }
  pfs.rename = (a: string, b: string) => fs.rename(map(a), map(b));
  pfs.symlink = (target: string, path: string) => fs.symlink(target, map(path));
  const engine = new BrowserGit({ promises: pfs }, pfs);
  await engine.open();
  return { engine, root };
}

test('browser checkpoints preserve native ancestry, working files, reloads and backup round trips', async () => {
  const source = await repository();
  await fs.writeFile(join(source, 'README.md'), 'Uncommitted native edit');
  await fs.writeFile(join(source, 'extra.txt'), 'Untracked native file');
  await fs.unlink(join(source, 'index.html'));
  const before = await sourceGit(source, ['status', '--porcelain']);
  const snapshot = await exportBrowserGit(source);
  const { engine, root } = await browserDisk();
  const imported = await engine.import(snapshot);
  expect(imported.head).toBe(snapshot.head);
  expect(imported.log.map((c) => c.message)).toEqual(['Readme', 'Original']);
  expect(imported.changes).toHaveLength(3);
  expect(await engine.read('README.md')).toBe('Uncommitted native edit');
  expect(await engine.diff('README.md')).toMatchObject({
    before: 'Second commit',
    after: 'Uncommitted native edit',
  });
  await engine.write('README.md', 'Browser edit', 'Uncommitted native edit');
  const checkpoint = await engine.commit('Browser checkpoint', imported.head);
  expect(checkpoint.changes).toHaveLength(0);
  expect(checkpoint.log[1].oid).toBe(snapshot.head);
  const reopened = (await browserDisk(root)).engine;
  expect((await reopened.view()).head).toBe(checkpoint.head);
  const backup = await reopened.export();
  const restored = (await browserDisk()).engine;
  expect((await restored.import(backup)).head).toBe(checkpoint.head);
  expect(await restored.read('README.md')).toBe('Browser edit');
  expect(await sourceGit(source, ['status', '--porcelain'])).toBe(before);
  expect(await sourceGit(source, ['rev-parse', 'HEAD'])).toBe(snapshot.head);
});

test('stale edits, concurrent HEADs, corrupt imports and Studio refresh cannot overwrite browser work', async () => {
  const source = await repository();
  const snapshot = await exportBrowserGit(source);
  const { engine } = await browserDisk();
  await engine.import(snapshot);
  await engine.write('README.md', 'Browser work', 'Second commit');
  await expect(engine.write('README.md', 'Lost update', 'Second commit')).rejects.toThrow(
    'another tab',
  );
  await expect(engine.commit('stale', 'a'.repeat(40))).rejects.toThrow('HEAD changed');
  await fs.writeFile(join(source, 'README.md'), 'New Studio work');
  await expect(engine.import(await exportBrowserGit(source))).rejects.toThrow(
    'no files were overwritten',
  );
  // Same source snapshot is a no-op, including with unsaved browser changes.
  expect((await engine.import(snapshot)).changes).toHaveLength(1);
  expect(await engine.read('README.md')).toBe('Browser work');
  const other = (await browserDisk()).engine;
  await other.import(snapshot);
  const newer = await exportBrowserGit(source);
  await expect(other.import({ ...newer, pack: btoa('corrupt') })).rejects.toThrow();
  expect(await other.read('README.md')).toBe('Second commit');
});

test('native handoff refuses credential files and links without altering the project', async () => {
  const source = await repository();
  await fs.writeFile(join(source, '.env'), 'FAKE_KEY=not-a-real-key');
  await expect(exportBrowserGit(source)).rejects.toThrow('private files');
  await fs.unlink(join(source, '.env'));
  await fs.symlink('README.md', join(source, 'alias.md'));
  await expect(exportBrowserGit(source)).rejects.toThrow();
  expect((await fs.lstat(join(source, 'alias.md'))).isSymbolicLink()).toBe(true);
  for (const path of ['../escape', '/absolute', '.git/config', '.env', 'folder/.env.secret'])
    expect(() => gitPath(path)).toThrow();
});
