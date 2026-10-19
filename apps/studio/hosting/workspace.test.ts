import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceGit } from '../../../packages/grasp/src/client';
import { workspaceFiles, applyWorkspace } from './workspace';

const encode = (text: string) => Buffer.from(text).toString('base64');
test('container edits preserve history, reject protected/secret changes atomically and detect concurrent edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-import-'));
  try {
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/main.ts'), 'before');
    await writeFile(join(root, 'package.json'), '{}');
    await writeFile(join(root, '.gitignore'), '.env\ndist/\n');
    await writeFile(join(root, '.env'), 'PRIVATE_TEST_VALUE=never-export');
    await sourceGit(root, ['init', '-q']);
    await sourceGit(root, ['add', '.']);
    await sourceGit(root, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@localhost',
      'commit',
      '-qm',
      'baseline',
    ]);
    const head = await sourceGit(root, ['rev-parse', 'HEAD']);
    const before = await workspaceFiles(root);
    expect(before['.env']).toBeUndefined();
    expect(before['.git/config']).toBeUndefined();
    await expect(
      applyWorkspace(
        root,
        before,
        {
          ...before,
          'src/main.ts': encode('new'),
          'package.json': encode('{"scripts":{"build":"evil"}}'),
        },
        'agent',
      ),
    ).rejects.toThrow('protected');
    expect(await readFile(join(root, 'src/main.ts'), 'utf8')).toBe('before');
    await expect(
      applyWorkspace(root, before, { ...before, '.env': encode('private') }, 'agent'),
    ).rejects.toThrow();
    await expect(
      applyWorkspace(
        root,
        before,
        { ...before, 'src/main.ts': encode('unexpected build edit') },
        'build',
      ),
    ).rejects.toThrow('protected');
    await applyWorkspace(root, before, { ...before, 'src/main.ts': encode('new') }, 'agent');
    expect(await sourceGit(root, ['rev-parse', 'HEAD'])).toBe(head);
    await expect(applyWorkspace(root, before, before, 'agent')).rejects.toThrow('changed while');
    const fresh = await workspaceFiles(root);
    await applyWorkspace(
      root,
      fresh,
      { ...fresh, 'dist/index.html': encode('<html>built</html>') },
      'build',
    );
    expect(await readFile(join(root, 'dist/index.html'), 'utf8')).toBe('<html>built</html>');
    await rm(join(root, 'dist'), { recursive: true });
    await symlink(join(root, 'src'), join(root, 'dist'));
    await expect(
      applyWorkspace(root, fresh, { ...fresh, 'dist/main.ts': encode('escape') }, 'build'),
    ).rejects.toThrow('link');
    expect(await readFile(join(root, 'src/main.ts'), 'utf8')).toBe('new');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
