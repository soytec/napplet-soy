import { mkdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Independent host is deliberately outside application dependencies and old
// legacy-wrapper acceptance. Frozen resolution also pins its browser host bundle.
const root = resolve(import.meta.dir, '..');
const client = join(root, '.local/current-shell/client');
await mkdir(client, { recursive: true });
for (const file of ['package.json', 'bun.lock'])
  await copyFile(join(root, 'tests/fixtures/current-shell', file), join(client, file));
async function run(args: string[], cwd: string, operation: string) {
  const child = Bun.spawn(args, {
    cwd,
    env: { ...process.env, SOY_CURRENT_SHELL: '1' },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await child.exited;
  if (code !== 0)
    throw new Error(
      `${operation} failed (exit ${code}). See the tool's diagnostic above; no publication was attempted.`,
    );
}
await run(
  [process.execPath, 'install', '--frozen-lockfile', '--ignore-scripts'],
  client,
  'Install pinned independent Paja',
);
await run(
  [process.execPath, 'test', 'tests/services/current-shell.test.ts'],
  root,
  'Independent current-manifest acceptance',
);
if (process.env.SOY_REPAIRS_ROOT)
  await run(
    [process.execPath, 'test', 'tests/services/published-repairs.test.ts'],
    root,
    'Published-project repair acceptance',
  );
