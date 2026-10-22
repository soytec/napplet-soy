import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import release from '../apps/cli/distribution/version.json';

test('installer crosses the ownership transfer, falls back only on canonical 404 and preserves working installs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-installer-transfer-'));
  const installer = new URL('../apps/web/public/install.sh', import.meta.url).pathname;
  const name = `soyli-${process.platform}-${process.arch}`;
  const calls: string[] = [];
  let canonicalStatus = 404,
    legacyStatus = 200,
    corrupt = false;
  const archive = join(root, `${name}.tar.gz`);
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      const status = path.startsWith('/soytec/') ? canonicalStatus : legacyStatus;
      if (status !== 200) return new Response('fixture service failure', { status });
      if (path.endsWith('.sha256'))
        return new Response(
          `${new Bun.CryptoHasher('sha256').update(await Bun.file(archive).bytes()).digest('hex')}  ${name}.tar.gz\n`,
        );
      return new Response(corrupt ? 'corrupt fixture bytes' : Bun.file(archive));
    },
  });
  const run = async (args: string[], env?: Record<string, string | undefined>) => {
    const child = Bun.spawn(args, {
      env: env ?? process.env,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, stdout, stderr };
  };
  try {
    await mkdir(join(root, name));
    await writeFile(
      join(root, name, 'soyli'),
      `#!/bin/sh\nprintf 'soyli ${release.version}\\n'\n`,
      { mode: 0o755 },
    );
    expect((await run(['tar', '-czf', archive, '-C', root, name])).code).toBe(0);
    await mkdir(join(root, 'tools'));
    // Route only the two real installer destinations to an HTTP fixture. Keep
    // curl's real exit codes, HTTP status output and downloaded bytes intact.
    const proxy = join(root, 'curl.ts');
    await writeFile(
      proxy,
      `
      const args = process.argv.slice(2).map(arg => {
        if (!arg.startsWith('https://')) return arg;
        const url = new URL(arg);
        if (url.hostname !== 'github.com' || !/^\\/(soytec|zeSchlausKwab)\\/napplet-soy\\/releases\\/download\\//.test(url.pathname))
          throw new Error('Unexpected download destination');
        return ${JSON.stringify(server.url.origin)} + url.pathname;
      });
      const child = Bun.spawn(['/usr/bin/curl', ...args], { stdout: 'inherit', stderr: 'inherit' });
      process.exit(await child.exited);
    `,
    );
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(
      join(root, 'tools/curl'),
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(proxy)} "$@"\n`,
      { mode: 0o755 },
    );
    const install = join(root, 'install'),
      bin = join(root, 'bin');
    await writeFile(join(root, 'identity-marker'), 'untouched account fixture');
    const env = {
      ...process.env,
      PATH: `${join(root, 'tools')}:/usr/bin:/bin:/usr/sbin`,
      NAPPLET_INSTALL_DIR: install,
      NAPPLET_BIN_DIR: bin,
      NAPPLET_DOWNLOAD_BASE: undefined,
      NAPPLET_RELEASE_VERSION: undefined,
    };
    const before = await run(['/bin/sh', installer], env);
    expect(before.code, before.stderr).toBe(0);
    expect(calls.map((path) => path.split('/')[1])).toEqual([
      'soytec',
      'zeSchlausKwab',
      'zeSchlausKwab',
    ]);
    const working = await readlink(join(bin, 'soyli'));
    calls.length = 0;
    canonicalStatus = 200;
    const after = await run(['/bin/sh', installer], env);
    expect(after.code, after.stderr).toBe(0);
    expect(calls.map((path) => path.split('/')[1])).toEqual(['soytec', 'soytec']);
    for (const status of [403, 429, 500]) {
      calls.length = 0;
      canonicalStatus = status;
      const failure = await run(['/bin/sh', installer], env);
      expect(failure.code).toBe(1);
      expect(failure.stderr).toContain(`HTTP ${status}`);
      expect(calls).toHaveLength(1);
      expect(await readlink(join(bin, 'soyli'))).toBe(working);
    }
    calls.length = 0;
    canonicalStatus = 404;
    legacyStatus = 404;
    const missing = await run(['/bin/sh', installer], env);
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain('404');
    expect(calls).toHaveLength(2);
    calls.length = 0;
    canonicalStatus = 200;
    corrupt = true;
    const bad = await run(['/bin/sh', installer], env);
    expect(bad.stderr).toContain('checksum mismatch');
    expect(bad.code).not.toBe(0);
    expect(calls.every((path) => path.startsWith('/soytec/'))).toBe(true);
    calls.length = 0;
    const explicit = await run(['/bin/sh', installer], {
      ...env,
      NAPPLET_DOWNLOAD_BASE: server.url.origin,
    });
    expect(explicit.code).not.toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toStartWith(`/${release.version}/`);
    expect(await readlink(join(bin, 'soyli'))).toBe(working);
    expect(await readFile(join(root, 'identity-marker'), 'utf8')).toBe('untouched account fixture');
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
