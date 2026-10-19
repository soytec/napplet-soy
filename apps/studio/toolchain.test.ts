import { test, expect } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { studioSoyli, studioToolPath } from './toolchain';
import { cleanEnvironment } from './agent';
import { run } from './process';

test('local Studio uses checkout guidance and agent shell resolves the selected CLI, including literal arguments', async () => {
  expect(studioSoyli(resolve('.'))).toEqual([process.execPath, resolve('apps/cli/src/index.ts')]);
  expect(studioSoyli(resolve('.'), '/selected/soyli')).toEqual(['/selected/soyli']);
  const root = await mkdtemp(join(tmpdir(), "studio tool's "));
  try {
    const tool = join(root, 'cli.ts');
    await writeFile(tool, 'console.log(JSON.stringify(process.argv.slice(2)));');
    const env = cleanEnvironment();
    env.PATH = await studioToolPath(root, [process.execPath, tool], env.PATH);
    const result = await run(['soyli', 'run', 'verify', '`literal`', '$(literal)'], {
      cwd: root,
      env,
      signal: new AbortController().signal,
      operation: 'inspect selected CLI',
    });
    expect(JSON.parse(result)).toEqual(['run', 'verify', '`literal`', '$(literal)']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
