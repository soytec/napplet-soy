import { readdir, lstat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { DiagnosticError } from '../../../packages/diagnostics/src';

/** Admission guards supplement the deployment's dedicated, size-limited volume.
 * Credentials and drafts are retained when admission is refused. */
export async function studioCapacity(directory: string, owner: string) {
  if (!/^[a-f0-9]{64}$/.test(owner)) throw new Error('Invalid owner.');
  const volume = await statfs(directory);
  if (volume.bavail * volume.bsize < 256 * 1024 * 1024)
    throw new DiagnosticError(
      'STUDIO_STORAGE',
      'The Studio host is low on workspace space. Existing drafts are retained; try again after the operator adds space.',
    );
  let size = 0,
    files = 0;
  async function walk(path: string) {
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (++files > 100000)
        throw new DiagnosticError(
          'STUDIO_STORAGE',
          'This account reached its workspace file limit. Export existing drafts before creating more.',
        );
      const file = join(path, entry.name);
      if (entry.isDirectory()) await walk(file);
      else size += (await lstat(file)).size;
      if (size > 256 * 1024 * 1024)
        throw new DiagnosticError(
          'STUDIO_STORAGE',
          'This account reached its 256 MiB hosted workspace allowance. Existing drafts remain available.',
        );
    }
  }
  await walk(join(directory, owner));
}
