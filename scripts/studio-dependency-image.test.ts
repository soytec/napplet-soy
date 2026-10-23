import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('operator profile context includes only dependency inputs and installs frozen without scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-dependency-context-'));
  try {
    const project = join(root, 'project'),
      output = join(root, 'image');
    await mkdir(project);
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({
        packageManager: 'pnpm@10.8.0',
        dependencies: { three: '0.177.0' },
        scripts: { postinstall: 'DO_NOT_EXECUTE_PROJECT_HOOK' },
      }),
    );
    await writeFile(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
    await writeFile(join(project, '.env'), 'PRIVATE_PROVIDER_KEY=do-not-copy');
    await writeFile(join(project, '.npmrc'), '//registry.example/:_authToken=do-not-copy');
    await writeFile(join(project, 'source.ts'), 'DO_NOT_COPY_SOURCE');
    const child = Bun.spawn(
      [
        process.execPath,
        'scripts/studio-dependency-image.ts',
        output,
        'sha256:' + 'a'.repeat(64),
        project,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    );
    const error = await new Response(child.stderr).text();
    expect(await child.exited).toBe(0);
    expect(error).toBe('');
    const [id] = await readdir(join(output, 'profiles'));
    expect((await readdir(join(output, 'profiles', id!))).sort()).toEqual([
      'package.json',
      'pnpm-lock.yaml',
    ]);
    expect(await readFile(join(output, 'profiles', id!, 'package.json'), 'utf8')).not.toContain(
      'postinstall',
    );
    const docker = await readFile(join(output, 'Dockerfile'), 'utf8');
    expect(docker).toContain('--frozen-lockfile --ignore-scripts');
    expect(docker).not.toContain('COPY .');
    expect(docker).toContain('USER 1000:1000');
    const build = await readFile(join(output, 'build.sh'), 'utf8');
    expect(build).toContain("docker image inspect 'sha256:" + 'a'.repeat(64));
    expect(build).toContain('docker build --pull=false');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
