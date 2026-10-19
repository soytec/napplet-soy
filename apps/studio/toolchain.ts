import { mkdir, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';

export const studioSoyli = (root: string, override?: string) =>
  override ? [override] : [process.execPath, join(root, 'apps/cli/src/index.ts')];

/** Agent shell commands must use the same soyLI as scaffold/setup/verification. */
export async function studioToolPath(directory: string, command: string[], path = '') {
  const bin = join(directory, 'tool-bin');
  await mkdir(bin, { recursive: true, mode: 0o700 });
  const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
  const shim = join(bin, 'soyli');
  await writeFile(shim, '#!/bin/sh\nexec ' + command.map(quote).join(' ') + ' "$@"\n', {
    mode: 0o700,
  });
  await chmod(shim, 0o700);
  return bin + ':' + path;
}
