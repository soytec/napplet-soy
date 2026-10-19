import { sourceGit } from '../../packages/grasp/src/client';
import { inspectHistory } from '../../packages/publish/src/git-source';
import { regularFile, checkSource } from '../../packages/publish/src/project';
import { readBounded } from '../../packages/blossom/src/client';
import { cleanEnvironment } from './agent';
import { gitDigest, gitLimits, gitPath, type GitSnapshot } from './browser-git-contract';
import { DiagnosticError, ToolOutput } from '../../packages/diagnostics/src';

/** Read-only transfer: ordinary Git objects and source bytes, never .git/config or credentials. */
export async function exportBrowserGit(root: string): Promise<GitSnapshot> {
  const read = async () => {
    const head = await sourceGit(root, ['rev-parse', 'HEAD']);
    const paths = [
      ...new Set(
        (await sourceGit(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']))
          .split('\0')
          .filter(Boolean),
      ),
    ].sort();
    if (paths.length > gitLimits.files)
      throw new Error('Browser Git supports up to 1,024 source files.');
    let total = 0;
    const files: GitSnapshot['files'] = [];
    for (const path of paths) {
      gitPath(path);
      let bytes: Uint8Array;
      try {
        bytes = await regularFile(root, path, gitLimits.bytes);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw e;
      }
      checkSource(path, bytes);
      if ((total += bytes.length) > gitLimits.bytes)
        throw new Error('Browser source exceeds 40 MiB.');
      files.push({ path, data: Buffer.from(bytes).toString('base64') });
    }
    return { head, files, revision: await gitDigest(JSON.stringify({ head, files })) };
  };
  const snapshot = await read();
  await inspectHistory(root, snapshot.head);
  const child = Bun.spawn(
    ['git', '-c', 'core.hooksPath=/dev/null', 'pack-objects', '--stdout', '--revs'],
    {
      cwd: root,
      env: { ...cleanEnvironment(), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      stdin: new Blob([snapshot.head + '\n']),
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const stderr = new ToolOutput();
  const drain = (async () => {
    for await (const chunk of child.stderr) stderr.push(chunk);
    stderr.finish();
  })();
  try {
    const bytes = await readBounded(new Response(child.stdout), gitLimits.packBytes);
    const code = await child.exited;
    await drain;
    if (code)
      throw new DiagnosticError('STUDIO_GIT_EXPORT', 'Git could not export the browser copy.', {
        tool: 'git',
        operation: 'export Git objects',
        exitCode: code,
        detail: stderr.text,
      });
    if ((await read()).revision !== snapshot.revision)
      throw new Error(
        'Studio source changed during export. Wait for the edit to finish, then retry.',
      );
    return { ...snapshot, pack: Buffer.from(bytes).toString('base64') };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await child.exited;
    }
    await drain;
  }
}
