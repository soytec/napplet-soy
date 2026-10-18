import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { sourceGit } from '../../../packages/grasp/src/client';
import { checkSource, regularFile } from '../../../packages/publish/src/project';
import { DiagnosticError } from '../../../packages/diagnostics/src';
import { jobLimits, jobPath, validateJobFiles, type JobFiles } from './container';

const error = (message: string) =>
  new DiagnosticError('STUDIO_WORKSPACE', message, {
    recovery: 'Inspect the draft changes before retrying. Nothing may fall back to host execution.',
  });
export const protectedPath = (p: string) =>
  /^(?:package\.json|.*lock.*|vite\.config\.[^/]+|tsconfig[^/]*|AGENTS\.md|CLAUDE\.md)$/.test(p) ||
  /^(?:docs|tests|\.agents|\.claude)(?:\/|$)/.test(p);

/** Export source via Git's index/ignore policy, never credentials or dependencies.
 * The runner can also return dist/ bytes, but they remain untrusted until verification. */
export async function workspaceFiles(root: string): Promise<JobFiles> {
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink())
    throw error('Invalid workspace directory.');
  const paths = (
    await sourceGit(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  )
    .split('\0')
    .filter(Boolean);
  // Builds produce ignored dist/ files that subsequent check/capture jobs require.
  // Do not export other ignored caches, reports, local state or dependency trees.
  async function built(path: string) {
    const stat = await lstat(join(root, path)).catch((e) => {
      if (e.code === 'ENOENT') return undefined;
      throw e;
    });
    if (!stat) return;
    if (stat.isSymbolicLink()) throw error('Built output contains a link.');
    if (stat.isDirectory()) {
      for (const entry of await readdir(join(root, path))) await built(path + '/' + entry);
    } else paths.push(path);
    if (paths.length > jobLimits.files) throw error('Workspace contains too many source files.');
  }
  await built('dist');
  const files: JobFiles = Object.create(null);
  let bytes = 0;
  for (const path of new Set(paths)) {
    if (!jobPath(path)) continue;
    let data: Uint8Array;
    try {
      data = await regularFile(root, path, jobLimits.bytes - bytes);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    checkSource(path, data);
    bytes += data.length;
    files[path] = Buffer.from(data).toString('base64');
    if (Object.keys(files).length > jobLimits.files)
      throw error('Workspace contains too many source files.');
  }
  return validateJobFiles(files);
}

/** Validate the whole changeset before touching disk. Existing Git history is never
 * imported from the job. The caller owns Studio's exclusive mutation slot. */
export async function applyWorkspace(
  root: string,
  before: JobFiles,
  after: JobFiles,
  mode: 'agent' | 'build',
) {
  validateJobFiles(after);
  const current = await workspaceFiles(root);
  if (
    JSON.stringify(Object.entries(current).sort()) !== JSON.stringify(Object.entries(before).sort())
  )
    throw error(
      'The workspace changed while its container was running. Retry from the current draft.',
    );
  const changes = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (p) => before[p] !== after[p],
  );
  const names = new Set<string>();
  for (const p of Object.keys(after)) {
    const lower = p.toLowerCase();
    if (
      names.has(lower) ||
      p.split('/').some((_, i, parts) => i > 0 && after[parts.slice(0, i).join('/')] !== undefined)
    )
      throw error('The job returned colliding file paths.');
    names.add(lower);
  }
  for (const path of changes) {
    if (protectedPath(path) || (mode === 'build' && !path.startsWith('dist/')))
      throw error(`The job changed a protected file: ${path}. No changes were imported.`);
    if (after[path] !== undefined) checkSource(path, Buffer.from(after[path], 'base64'));
    // Check every ancestor, including ignored paths absent from the source export.
    let cursor = root;
    for (const part of path.split('/')) {
      cursor = join(cursor, part);
      const stat = await lstat(cursor).catch((e) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (
        stat &&
        (stat.isSymbolicLink() ||
          (!stat.isDirectory() && cursor !== join(root, path)) ||
          (stat.nlink > 1 && stat.isFile()))
      )
        throw error('The output path intersects a link or non-directory.');
    }
  }
  // Keep rollback bytes in controller memory. A failed write restores prior bytes.
  const applied: Array<{ path: string; bytes?: Buffer; mode?: number }> = [];
  try {
    for (const path of changes) {
      const target = join(root, path);
      const stat = await lstat(target).catch((e) => {
        if (e.code === 'ENOENT') return undefined;
        throw e;
      });
      if (stat && !stat.isFile()) throw error('Output would replace a directory.');
      applied.push({
        path: target,
        bytes: stat ? await readFile(target) : undefined,
        mode: stat?.mode,
      });
      if (after[path] === undefined) await rm(target);
      else {
        await mkdir(dirname(target), { recursive: true });
        const temp = target + '.studio-' + crypto.randomUUID();
        try {
          await writeFile(temp, Buffer.from(after[path], 'base64'), {
            mode: stat?.mode ?? 0o644,
            flag: 'wx',
          });
          await rename(temp, target);
        } finally {
          await rm(temp, { force: true });
        }
      }
    }
  } catch (cause) {
    for (const entry of applied.reverse()) {
      if (entry.bytes) await writeFile(entry.path, entry.bytes, { mode: entry.mode });
      else await rm(entry.path, { force: true });
    }
    throw cause;
  }
}
