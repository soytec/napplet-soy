import { test, expect } from 'bun:test';
import { lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceGit } from '../../grasp/src/client';
import { checkpoint, committedSource, inspectHistory } from '../../publish/src/git-source';
import { cloneUrl, selectCloneUrls, mergeReviewed } from './git';
import { diagnose, formatDiagnostic } from '../../diagnostics/src';

test('real Git merge preflight preserves conflict filenames from stdout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-merge-errors-'));
  try {
    await Bun.write(join(root, 'game.txt'), 'original\n');
    const base = await checkpoint(root, 'Original');
    await Bun.write(join(root, 'game.txt'), 'maintainer change\n');
    const target = await checkpoint(root, 'Maintainer');
    await sourceGit(root, ['checkout', '--detach', base.commit]);
    await Bun.write(join(root, 'game.txt'), 'proposed change\n');
    const proposed = await checkpoint(root, 'Proposal');
    await sourceGit(root, ['checkout', '--detach', target.commit]);
    let failure: unknown;
    try {
      await sourceGit(root, ['merge-tree', '--write-tree', target.commit, proposed.commit]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeTruthy();
    const diagnostic = diagnose(failure);
    expect(diagnostic.details).toContain('Exit status: 1');
    expect(formatDiagnostic(diagnostic)).toContain('CONFLICT');
    expect(formatDiagnostic(diagnostic)).toContain('game.txt');
    expect(await sourceGit(root, ['rev-parse', 'HEAD'])).toBe(target.commit);
    expect(await sourceGit(root, ['status', '--porcelain'])).toBe('');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checkpoints are explicit, preserve authorship, and uncommitted work cannot be shared', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-git-'));
  try {
    await Bun.write(join(root, 'index.html'), '<p>hi</p>');
    await expect(committedSource(root)).rejects.toMatchObject({ code: 'COMMIT_REQUIRED' });
    await committedSource(root).catch((error) => {
      expect(formatDiagnostic(diagnose(error))).toContain('Git rev-parse');
      expect(formatDiagnostic(diagnose(error))).toContain('Exit status:');
    });
    const first = await checkpoint(root, 'An idea', 'Alice');
    expect(await sourceGit(root, ['log', '-1', '--format=%an'])).toBe('Alice');
    await Bun.write(join(root, 'index.html'), '<p>better</p>');
    await expect(committedSource(root)).rejects.toMatchObject({ code: 'SOURCE_DIRTY' });
    const next = await checkpoint(root, 'Improve it', 'Bob');
    expect(await sourceGit(root, ['rev-parse', 'HEAD^'])).toBe(first.commit);
    await inspectHistory(root, next.commit);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('deleted credentials in reachable Git history and source symlinks are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-git-'));
  try {
    await sourceGit(root, ['init', '--initial-branch=main']);
    await Bun.write(join(root, '.env'), 'SECRET=private');
    await sourceGit(root, ['add', '.env']);
    await sourceGit(root, ['commit', '-m', 'Accidental secret']);
    await sourceGit(root, ['rm', '.env']);
    await sourceGit(root, ['commit', '-m', 'Delete it']);
    await expect(inspectHistory(root, await committedSource(root))).rejects.toMatchObject({
      code: 'SOURCE_SECRET',
    });
    await symlink('/etc/passwd', join(root, 'leak'));
    await sourceGit(root, ['add', 'leak']);
    await sourceGit(root, ['commit', '-m', 'Bad link']);
    await expect(inspectHistory(root, await committedSource(root))).rejects.toMatchObject({
      code: 'SOURCE_PATH',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('proposal clone transports never invoke Git helpers or accept private hosts', () => {
  for (const url of [
    'file:///etc/passwd',
    'ext::sh',
    'https://127.0.0.1/repo',
    'https://user:secret@git.example/repo',
    'http://git.example/repo',
  ])
    expect(() => cloneUrl(url)).toThrow();
  expect(cloneUrl('https://git.example/repo')).toBe('https://git.example/repo');
  expect(cloneUrl('http://127.0.0.1:8082/repo', true)).toContain('8082');
});

async function aliasMergeFixture(removeTarget: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'soy-merge-alias-'));
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    await Bun.write(join(root, 'AGENTS.md'), 'Public guidance\n');
    await Bun.write(join(root, 'README.md'), 'Original game\n');
    await checkpoint(root, 'Base');
    await sourceGit(root, ['branch', 'proposal']);
    if (removeTarget) await rm(join(root, 'AGENTS.md'));
    else await Bun.write(join(root, 'README.md'), 'Improved game\n');
    const target = (await checkpoint(root, 'Maintainer change')).commit;
    await sourceGit(root, ['checkout', 'proposal']);
    await symlink('AGENTS.md', join(root, 'CLAUDE.md'));
    const head = (await checkpoint(root, 'Proposal adds guidance alias')).commit;
    await sourceGit(root, ['checkout', 'main']);
    await sourceGit(root, ['update-server-info']);
    // Real Git's read-only dumb HTTP transport, with only fixture object paths.
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname.replace(/^\/repo.git\//, '');
        if (
          request.method !== 'GET' ||
          !/^(?:HEAD|info\/refs|objects\/info\/packs|objects\/[a-f0-9]{2}\/[a-f0-9]{38})$/.test(
            path,
          )
        )
          return new Response('Not found', { status: 404 });
        return new Response(Bun.file(join(root, '.git', path)));
      },
    });
    return {
      root,
      head,
      target,
      input: {
        head,
        target,
        revision: 'c'.repeat(64),
        clones: [`http://127.0.0.1:${server.port}/repo.git`],
        local: true,
        author: 'Alice',
      },
      close: async () => {
        server?.stop(true);
        await rm(root, { recursive: true, force: true });
      },
    };
  } catch (cause) {
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

test('reviewed merge refuses a dangling alias created by otherwise valid branches before writing history', async () => {
  const fixture = await aliasMergeFixture(true);
  try {
    await inspectHistory(fixture.root, fixture.target);
    await inspectHistory(fixture.root, fixture.head);
    const refs = await sourceGit(fixture.root, ['show-ref']);
    let failure: unknown;
    try {
      await mergeReviewed(fixture.root, fixture.input);
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toMatchObject({ code: 'GIT_MERGE_SOURCE' });
    const diagnostic = formatDiagnostic(diagnose(failure));
    expect(diagnostic).toContain('CLAUDE.md');
    expect(diagnostic).toContain('unchanged');
    expect(diagnostic).toContain('SOURCE_PATH');
    expect(await committedSource(fixture.root)).toBe(fixture.target);
    expect(await sourceGit(fixture.root, ['show-ref'])).toBe(refs);
    expect(await Bun.file(join(fixture.root, 'CLAUDE.md')).exists()).toBe(false);
    await inspectHistory(fixture.root, fixture.target);
  } finally {
    await fixture.close();
  }
});

test('reviewed merge preserves valid aliases and uses its supplied author without configured Git identity', async () => {
  const fixture = await aliasMergeFixture(false);
  try {
    await sourceGit(fixture.root, ['config', 'user.name', '']);
    await sourceGit(fixture.root, ['config', 'user.email', '']);
    expect(await sourceGit(fixture.root, ['config', '--get', 'user.name'])).toBe('');
    expect(await sourceGit(fixture.root, ['config', '--get', 'user.email'])).toBe('');
    const before = Number(await sourceGit(fixture.root, ['rev-list', '--all', '--count']));
    const result = await mergeReviewed(fixture.root, fixture.input);
    expect(result).toMatchObject({ state: 'merged_locally', released: false, pushed: false });
    expect(await sourceGit(fixture.root, ['show', '-s', '--format=%P', result.commit])).toBe(
      `${fixture.target} ${fixture.head}`,
    );
    expect(await sourceGit(fixture.root, ['show', '-s', '--format=%an', result.commit])).toBe(
      'Alice',
    );
    expect((await lstat(join(fixture.root, 'CLAUDE.md'))).isSymbolicLink()).toBe(true);
    expect((await inspectHistory(fixture.root, result.commit)).aliases).toEqual([
      { path: 'CLAUDE.md', target: 'AGENTS.md', executable: false },
    ]);
    expect(Number(await sourceGit(fixture.root, ['rev-list', '--all', '--count']))).toBe(
      before + 1,
    );
    expect(await sourceGit(fixture.root, ['status', '--porcelain'])).toBe('');
    const unreachable = await sourceGit(fixture.root, ['fsck', '--unreachable', '--no-reflogs']);
    const preview = /^unreachable commit ([a-f0-9]{40})$/m.exec(unreachable)?.[1];
    expect(preview).toBeTruthy();
    expect(
      await sourceGit(fixture.root, ['show', '-s', '--format=%an <%ae>%n%cn <%ce>', preview!]),
    ).toBe('Alice <Alice@nostr>\nAlice <Alice@nostr>');
  } finally {
    await fixture.close();
  }
});

test('proposal hosts select eligible alternatives before applying the four-host budget', () => {
  const blocked = [
    'ssh://git@example.org/repo',
    'git@example.org:repo',
    'file:///tmp/repo',
    'https://127.0.0.1/repo',
    'ext::sh',
  ];
  const publicHosts = Array.from({ length: 5 }, (_, i) => `https://host${i}.example/repo`);
  expect(selectCloneUrls([...blocked, publicHosts[0], ...publicHosts])).toEqual(
    publicHosts.slice(0, 4),
  );
  expect(
    selectCloneUrls(['ssh://git@example.org/repo', 'http://127.0.0.1:8082/repo'], true),
  ).toEqual(['http://127.0.0.1:8082/repo']);
  expect(() => selectCloneUrls(blocked)).toThrow('no supported Git clone URL');
  expect(() => selectCloneUrls([])).toThrow('no supported Git clone URL');
});
