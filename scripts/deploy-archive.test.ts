import { expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDeploymentArchive } from './deploy';

test('uploaded source starts the CLI and scaffolds its bundled creator guides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-deploy-archive-'));
  const release = join(directory, 'release');
  const archive = join(directory, 'release.tar.gz');
  const root = resolve(import.meta.dir, '..');
  try {
    await mkdir(release);
    await createDeploymentArchive(archive);
    const extract = Bun.spawn(['tar', '-xzf', archive, '-C', release], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, error] = await Promise.all([extract.exited, new Response(extract.stderr).text()]);
    expect(code, error).toBe(0);
    for (const path of ['AGENDA.md', '.git', '.env', '.local', 'node_modules'])
      expect(await lstat(join(release, path)).catch(() => null), path).toBeNull();

    // Reuse installed dependencies, but resolve every project import from the
    // extracted release, so local source files cannot hide packaging omissions.
    await symlink(join(root, 'node_modules'), join(release, 'node_modules'), 'dir');
    async function cli(args: string[]) {
      const child = Bun.spawn(
        [process.execPath, join(release, 'apps/cli/src/index.ts'), ...args, '--json'],
        {
          cwd: directory,
          env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: join(directory, 'accounts') },
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(code, stderr || stdout).toBe(0);
      return JSON.parse(stdout);
    }
    expect(await cli(['account', 'show'])).toEqual({ account: null });
    await cli([
      'new',
      'example',
      '--template',
      'boilerplate',
      '--identity',
      'later',
      '--no-install',
    ]);
    expect(await Bun.file(join(directory, 'example/docs/napplet-actions.md')).text()).toBe(
      await Bun.file(join(root, 'docs/RUNTIME-ACTIONS.md')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/napplet-backend.md')).text()).toBe(
      await Bun.file(join(root, 'docs/BACKEND-CREATOR.md')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/napplet-dynamic-backends.md')).text()).toBe(
      await Bun.file(join(root, 'docs/DYNAMIC-BACKENDS-CREATOR.md')).text(),
    );
    for (const agent of ['.agents', '.claude'])
      expect(
        await Bun.file(join(directory, `example/${agent}/skills/soy-backends/SKILL.md`)).text(),
      ).toBe(await Bun.file(join(root, 'apps/cli/templates/soy-backends.SKILL.md')).text());
    expect(await Bun.file(join(directory, 'example/docs/examples/backend-client.ts')).text()).toBe(
      await Bun.file(join(root, 'apps/cli/templates/backend-client.ts.txt')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/napplet-data.md')).text()).toBe(
      await Bun.file(join(root, 'docs/SHARED-DATA.md')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/napplet-outbox.md')).text()).toBe(
      await Bun.file(join(root, 'docs/OUTBOX.md')).text(),
    );
    expect(
      await Bun.file(join(directory, 'example/docs/examples/coordinated-audio.ts')).text(),
    ).toBe(await Bun.file(join(root, 'docs/examples/coordinated-audio.ts')).text());
    expect(await Bun.file(join(directory, 'example/docs/napplet-controllers.md')).text()).toBe(
      await Bun.file(join(root, 'docs/CONTROLLERS.md')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/napplet-mobile.md')).text()).toBe(
      await Bun.file(join(root, 'docs/MOBILE.md')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/napplet-visual-design.md')).text()).toBe(
      await Bun.file(join(root, 'docs/VISUAL-DESIGN.md')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/napplet-manifest.md')).text()).toBe(
      await Bun.file(join(root, 'docs/NIP5D-CREATOR.md')).text(),
    );
    expect(await Bun.file(join(directory, 'example/docs/examples/gamepad.ts')).text()).toBe(
      await Bun.file(join(root, 'packages/input/src/gamepad.ts')).text(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
