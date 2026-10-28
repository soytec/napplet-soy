import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { managedNode } from '../../apps/cli/src/toolchain';

test('a package-manager build refuses soyli update and points doctor at that package manager', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soyli-packaged-')),
    root = resolve(import.meta.dir, '../..'),
    binary = join(directory, 'soyli');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      Response.json({
        tag_name: 'soyli-v99.0.0',
        draft: false,
        prerelease: false,
        assets: ['', '.sha256'].map((suffix) => ({
          name: `soyli-${process.platform}-${process.arch}.tar.gz${suffix}`,
          state: 'uploaded',
          size: 100,
        })),
      }),
  });
  try {
    // Compile in a fresh runtime, matching the release build isolation.
    const build = Bun.spawn(
      [
        process.execPath,
        join(root, 'scripts/cli-compile.ts'),
        binary,
        '0.0.1',
        '--distribution',
        'nix',
      ],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    const [buildCode, buildOut, buildError] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    expect(buildCode, buildOut + buildError).toBe(0);
    const run = async (args: string[]) => {
      const child = Bun.spawn([binary, ...args], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          SPACE_ACCOUNT_HOME: join(directory, 'accounts'),
          PLAYWRIGHT_BROWSERS_PATH: join(directory, 'browsers'),
          SOYLI_RELEASE_API: server.url.href,
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    const scaffold = await run(['new', 'example', '--identity', 'later', '--no-install', '--json']);
    expect(scaffold.code, scaffold.stdout + scaffold.stderr).toBe(0);
    expect(
      await Bun.file(join(directory, 'example/docs/examples/coordinated-audio.ts')).text(),
    ).toBe(await Bun.file(join(root, 'docs/examples/coordinated-audio.ts')).text());
    const refused = await run(['update', '--json']);
    expect(refused.code).toBe(1);
    const { error } = JSON.parse(refused.stdout);
    expect(error.code).toBe('UPDATE_INSTALLATION');
    expect(error.message).toContain('managed by nix');
    expect(error.recovery).toContain('nix flake update');
    const terminal = await run(['update']);
    expect(terminal.code).toBe(1);
    expect(terminal.stderr).toContain('Next: Update the flake input');
    const doctor = await run(['doctor']);
    expect(doctor.code, doctor.stdout + doctor.stderr).toBe(0);
    expect(doctor.stdout).toContain('99.0.0 available; update soyLI through nix');
    expect(doctor.stdout).not.toContain('run soyli update');
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

test('real packaged and regular CLI conformance commands reuse compatible browsers and distinguish installation policy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soyli-conformance-cache-'));
  const root = resolve(import.meta.dir, '../..');
  const project = join(directory, 'project');
  const binary = join(directory, 'soyli');
  const browserCache = join(directory, 'browser-store');
  const pnpm = join(directory, 'pnpm.cjs');
  const testRequire = createRequire(require.resolve('@playwright/test/package.json'));
  const playwrightRequire = createRequire(testRequire.resolve('playwright/package.json'));
  const core = dirname(playwrightRequire.resolve('playwright-core/package.json'));
  const node = await managedNode();
  let browserFiles: Array<{ name: string; path: string }> = [];
  try {
    const build = Bun.spawn(
      [
        process.execPath,
        join(root, 'scripts/cli-compile.ts'),
        binary,
        '0.0.1',
        '--distribution',
        'nix',
      ],
      {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [buildCode, buildOut, buildError] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    expect(buildCode, buildOut + buildError).toBe(0);
    const conformance = join(project, 'node_modules/@napplet/conformance-cli');
    const playwright = join(project, 'node_modules/playwright');
    await mkdir(conformance, { recursive: true });
    await mkdir(join(playwright, 'node_modules'), { recursive: true });
    await symlink(core, join(playwright, 'node_modules/playwright-core'));
    await writeFile(join(conformance, 'package.json'), '{"name":"@napplet/conformance-cli"}');
    await writeFile(
      join(playwright, 'package.json'),
      JSON.stringify({ name: 'playwright', version: require(join(core, 'package.json')).version }),
    );
    await writeFile(join(project, 'node_modules/.modules.yaml'), '');
    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ scripts: { 'test:conformance': 'node fixture.cjs' } }),
    );
    // Stub only the final project script and installer. Browser discovery uses
    // the real pinned Playwright registry; the NixOS VM launches real Chromium.
    await writeFile(pnpm, `console.log('CONFORMANCE_SCRIPT_RAN');`);
    const inspect = Bun.spawn(
      [
        node,
        '-e',
        `
      const {createRequire} = require('node:module');
      const r = createRequire(${JSON.stringify(join(core, 'package.json'))});
      const reg = r('./lib/coreBundle.js').registry.registry;
      console.log(JSON.stringify(['chromium-headless-shell', 'ffmpeg'].map(name => ({name, path: reg.findExecutable(name).executablePath()}))));
    `,
      ],
      {
        env: { PATH: process.env.PATH, PLAYWRIGHT_BROWSERS_PATH: browserCache },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [inspected, out, err] = await Promise.all([
      inspect.exited,
      new Response(inspect.stdout).text(),
      new Response(inspect.stderr).text(),
    ]);
    expect(inspected, err).toBe(0);
    browserFiles = JSON.parse(out);
    await writeFile(
      join(playwright, 'cli.js'),
      `
      const fs = require('node:fs'); const path = require('node:path');
      fs.writeFileSync(path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'INSTALLER_RAN'), process.argv.slice(2).join(' '));
      for (const entry of ${JSON.stringify(browserFiles)}) {
        fs.mkdirSync(path.dirname(entry.path), {recursive:true});
        fs.writeFileSync(entry.path, '#!/bin/sh\\nexit 0\\n', {mode:0o755});
      }
    `,
    );
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      SPACE_ACCOUNT_HOME: join(directory, 'accounts'),
      SPACE_TOOLCHAIN_CACHE: join(directory, 'toolchains'),
      SOYLI_NODE: node,
      SOYLI_PNPM: pnpm,
      PLAYWRIGHT_BROWSERS_PATH: browserCache,
    };
    const run = async (packaged: boolean, json = false) => {
      const child = Bun.spawn(
        [
          ...(packaged ? [binary] : [process.execPath, join(root, 'apps/cli/src/index.ts')]),
          'run',
          'test:conformance',
          ...(json ? ['--json'] : []),
        ],
        { cwd: project, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    for (const entry of browserFiles) {
      await mkdir(dirname(entry.path), { recursive: true });
      await writeFile(entry.path, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    }
    await chmod(browserCache, 0o555);
    for (const packaged of [true, false]) {
      const cached = await run(packaged);
      expect(cached.code, cached.stdout + cached.stderr).toBe(0);
      expect(cached.stderr + cached.stdout).toContain('CONFORMANCE_SCRIPT_RAN');
    }
    expect(await readdir(browserCache)).not.toContain('INSTALLER_RAN');
    expect(await readdir(browserCache)).not.toContain('.links');
    await chmod(browserCache, 0o755);
    await rm(browserFiles[0]!.path);
    // An installed browser of another revision must not count as compatible.
    await mkdir(join(browserCache, 'chromium_headless_shell-other-revision'));
    await writeFile(
      join(browserCache, 'chromium_headless_shell-other-revision', 'chrome'),
      '#!/bin/sh\nexit 0\n',
      { mode: 0o755 },
    );
    await chmod(browserCache, 0o555);
    const mismatch = await run(true, true);
    expect(mismatch.code).toBe(1);
    const { error } = JSON.parse(mismatch.stdout);
    expect(error.code).toBe('CONFORMANCE_BROWSER');
    expect(error.operation).toBe('prepare conformance browser');
    expect(error.details.join('\n')).toContain('Playwright');
    expect(error.details.join('\n')).toContain('chromium-headless-shell');
    expect(error.recovery).toContain('Nix');
    expect(error.recovery).toContain('PLAYWRIGHT_BROWSERS_PATH');
    expect(mismatch.stderr + mismatch.stdout).not.toContain('CONFORMANCE_SCRIPT_RAN');
    expect(await readdir(browserCache)).not.toContain('INSTALLER_RAN');
    const terminal = await run(true);
    expect(terminal.code).toBe(1);
    expect(terminal.stderr).toContain('CONFORMANCE_BROWSER');
    expect(terminal.stderr).toContain('No browser installer was run');
    // Ordinary installations preserve automatic downloads into writable caches.
    await chmod(browserCache, 0o755);
    const installed = await run(false);
    expect(installed.code, installed.stdout + installed.stderr).toBe(0);
    expect(installed.stderr + installed.stdout).toContain('CONFORMANCE_SCRIPT_RAN');
    expect(await Bun.file(join(browserCache, 'INSTALLER_RAN')).text()).toBe(
      'install --only-shell chromium',
    );
    // Exhausted installer failures still expose the cause through the real CLI,
    // with the synthetic credential removed from both terminal and JSON output.
    await rm(browserFiles[0]!.path);
    await writeFile(
      join(playwright, 'cli.js'),
      `
      console.error('ECONNREFUSED: could not download the project browser');
      console.error('Authorization: Bearer fixture-browser-token');
      process.exit(7);
    `,
    );
    for (const json of [false, true]) {
      const failed = await run(false, json);
      expect(failed.code).toBe(1);
      const output = failed.stdout + failed.stderr;
      expect(output).toContain('PROJECT_TOOL');
      expect(output).toContain('install project conformance browser');
      expect(output).toContain('ECONNREFUSED');
      expect(output).toContain('Exit status: 7');
      expect(output).not.toContain('fixture-browser-token');
    }
  } finally {
    await chmod(browserCache, 0o755).catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
