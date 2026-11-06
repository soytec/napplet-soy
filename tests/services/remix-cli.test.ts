import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, cp, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { finalizeEvent, generateSecretKey, matchFilters, nip19 } from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
test('compiled standalone CLI remixes a pinned manifest through its installed symlink without Bun or account setup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-remix-binary-')),
    root = resolve(import.meta.dir, '../..');
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const bundle = join(directory, 'distribution'),
      binary = join(bundle, 'napplet-space');
    await mkdir(join(bundle, 'lib'), { recursive: true });
    // Compile in a fresh runtime, matching the release build isolation. Bun's in-process
    // test bundler can reuse stale resolver state for JSON dependencies.
    const build = Bun.spawn(
      [process.execPath, join(root, 'scripts/cli-compile.ts'), binary, 'test'],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    const [buildCode, buildOut, buildError] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    expect(buildCode, buildOut + buildError).toBe(0);
    await cp(dirname(Bun.resolveSync('ws/package.json', root)), join(bundle, 'lib/ws'), {
      recursive: true,
      dereference: true,
    });
    const link = join(directory, 'napplet-space');
    await symlink(binary, link);
    const html = new TextEncoder().encode(
        '<!doctype html><title>Original</title><p>Exact starting point.</p>',
      ),
      hash = await sha256(html);
    let manifest: ReturnType<typeof finalizeEvent>;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request, server) {
        if (server.upgrade(request, { data: undefined })) return;
        return new URL(request.url).pathname === `/${hash}`
          ? new Response(html)
          : new Response('missing', { status: 404 });
      },
      websocket: {
        message(socket, raw) {
          const m = JSON.parse(String(raw));
          if (m[0] === 'REQ') {
            if (matchFilters(m.slice(2), manifest))
              socket.send(JSON.stringify(['EVENT', m[1], manifest]));
            socket.send(JSON.stringify(['EOSE', m[1]]));
          }
        },
      },
    });
    manifest = finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: '',
        tags: [
          ['d', 'original'],
          ['path', '/index.html', hash],
          ['title', 'Original'],
          ['server', String(server.url).replace(/\/$/, '')],
        ],
      },
      generateSecretKey(),
    );
    const child = Bun.spawn(
      [
        link,
        'remix',
        nip19.neventEncode({ id: manifest.id, relays: [`ws://127.0.0.1:${server.port}`] }),
        'remixed',
        '--network',
        'local',
        '--identity',
        'later',
        '--json',
      ],
      {
        cwd: directory,
        env: { PATH: process.env.PATH, SPACE_ACCOUNT_HOME: join(directory, 'accounts') },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, out, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, error }).toEqual({ code: 0, error: '' });
    const config = await Bun.file(join(directory, 'remixed/napplet.json')).json();
    expect(config.remix.revision).toBe(manifest.id);
    expect(config.creator).toBeUndefined();
    expect(await Bun.file(join(directory, 'remixed/index.html')).bytes()).toEqual(html);
    expect(await Bun.file(join(directory, 'remixed/AGENTS.md')).exists()).toBe(true);
    expect(JSON.parse(out).directory).toBe(await realpath(join(directory, 'remixed')));
    const history = Bun.spawn(['git', 'log', '-1', '--format=%s'], {
      cwd: join(directory, 'remixed'),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const historyError = await new Response(history.stderr).text();
    expect(await history.exited, historyError).toBe(0);
    expect(await new Response(history.stdout).text()).toContain('Initialize');
    const status = Bun.spawn(['git', 'status', '--porcelain'], {
      cwd: join(directory, 'remixed'),
      stdout: 'pipe',
    });
    expect(await new Response(status.stdout).text()).toBe('');
    expect(await status.exited).toBe(0);
    for (const command of ['setup', 'build']) {
      const prepared = Bun.spawn([link, command, '--json'], {
        cwd: join(directory, 'remixed'),
        env: {
          PATH: process.env.PATH,
          SPACE_ACCOUNT_HOME: join(directory, 'accounts'),
          SPACE_TOOLCHAIN_CACHE: join(directory, 'empty-cache'),
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [exit, output, errors] = await Promise.all([
        prepared.exited,
        new Response(prepared.stdout).text(),
        new Response(prepared.stderr).text(),
      ]);
      expect(exit, errors).toBe(0);
      expect(JSON.parse(output).status).toBe(command === 'setup' ? 'ready' : 'built');
    }
    expect(await Bun.file(join(directory, 'remixed/index.html')).bytes()).toEqual(html);
    expect(await Bun.file(join(directory, 'remixed/pnpm-lock.yaml')).exists()).toBe(false);
  } finally {
    server?.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);
