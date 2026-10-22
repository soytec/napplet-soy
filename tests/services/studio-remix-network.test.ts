import { expect, test } from 'bun:test';
import { chown, mkdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
import { freezeFixture } from '../../packages/publish/src/testing';

const root = process.env.SPACE_TEST_REMIX_NETWORK;
const uid = Number(process.env.SPACE_TEST_REMIX_UID ?? 65534);
const gid = Number(process.env.SPACE_TEST_REMIX_GID ?? 65534);
// scripts/test-studio-remix-network.sh supplies an isolated Linux network namespace,
// real Studio nftables rules and a public-shaped TLS relay/Blossom fixture.
test.skipIf(!root)(
  'hosted remix imports exact source through WSS/HTTPS with loopback egress blocked',
  async () => {
    const cwd = join(root!, 'draft');
    await mkdir(cwd, { mode: 0o700 });
    await chown(cwd, uid, gid);
    const artifact = new TextEncoder().encode('<!doctype html><p>Exact published game</p>');
    const files = new Map(
      Object.entries({
        'index.html': '<p>Published source</p>',
        'src/main.ts': 'export const exactSource = "original game";',
        'dist/index.html': new TextDecoder().decode(artifact),
        LICENSE: 'Original MIT attribution',
        'napplet.json': JSON.stringify({
          schema: 'space-local-project/v1',
          name: 'Original',
          entry: 'dist/index.html',
          identifier: 'original',
          previewId: crypto.randomUUID(),
          license: 'MIT',
        }),
      }).map(([path, value]) => [path, new TextEncoder().encode(value)]),
    );
    const frozen = await freezeFixture(join(root!, 'source'), files, 1800000000);
    const archive = await readFile(join(root!, 'source/source.tar'));
    const key = generateSecretKey();
    const event = finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: 'Published game',
        tags: [
          ['d', 'original'],
          ['name', 'Original'],
          ['x', await sha256(artifact)],
          ['server', 'https://soy-remix.example.com'],
          ['source-archive', `https://soy-remix.example.com/${frozen.archiveHash}`],
          ['source-commit', frozen.commit],
        ],
      },
      key,
    );
    const unrelated = finalizeEvent({ ...event, tags: [['d', 'other']] }, key);
    const requests: string[] = [];
    const server = Bun.serve({
      hostname: '11.51.0.1',
      port: 443,
      tls: { cert: Bun.file(join(root!, 'cert.pem')), key: Bun.file(join(root!, 'key.pem')) },
      fetch(request, server) {
        expect(request.headers.get('authorization')).toBeNull();
        if (server.upgrade(request)) return;
        const path = new URL(request.url).pathname;
        requests.push(path);
        if (path === '/redirect') return Response.redirect('https://soy-private.example.com/');
        return new Response(path === `/${frozen.archiveHash}` ? archive : artifact);
      },
      websocket: {
        message(socket, raw) {
          const message = JSON.parse(String(raw));
          expect(['REQ', 'CLOSE']).toContain(message[0]);
          if (message[0] !== 'REQ') return;
          for (const candidate of [unrelated, { ...event, content: 'forged' }, event])
            socket.send(JSON.stringify(['EVENT', message[1], candidate]));
          socket.send(JSON.stringify(['EOSE', message[1]]));
        },
      },
    });
    const env = {
      PATH: process.env.PATH,
      HOME: cwd,
      SPACE_PUBLIC_NETWORK_NODE: '1',
      SPACE_ACCOUNT_HOME: join(cwd, 'accounts'),
      NODE_EXTRA_CA_CERTS: join(root!, 'cert.pem'),
    };
    async function command(args: string[], extra = {}) {
      const child = Bun.spawn(
        [
          'setpriv',
          `--reuid=${uid}`,
          `--regid=${gid}`,
          '--clear-groups',
          process.execPath,
          '--no-env-file',
          ...args,
        ],
        {
          cwd,
          env: { ...env, ...extra },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { code, output: out + err };
    }
    try {
      const link = nip19.neventEncode({ id: event.id, relays: ['wss://soy-remix.example.com'] });
      const result = await command([
        resolve('apps/cli/src/index.ts'),
        'remix',
        link,
        'workspace',
        '--identity',
        'later',
        '--no-install',
      ]);
      expect(result.output).not.toContain('REMIX_RELAYS_UNAVAILABLE');
      expect(result.code, result.output).toBe(0);
      expect(await readFile(join(cwd, 'workspace/src/main.ts'), 'utf8')).toBe(
        'export const exactSource = "original game";',
      );
      const config = JSON.parse(await readFile(join(cwd, 'workspace/napplet.json'), 'utf8'));
      expect(config.remix.revision).toBe(event.id);
      expect(requests).toContain(`/${frozen.archiveHash}`);
      expect(requests).toContain(`/${await sha256(artifact)}`);
      const guard = await command([
        '-e',
        `
      import { fetchPublicBytes } from ${JSON.stringify(resolve('packages/backend/src/blossom.ts'))};
      import { diagnose, formatDiagnostic } from ${JSON.stringify(resolve('packages/diagnostics/src/index.ts'))};
      for (const url of ['https://127.0.0.1/', 'https://soy-private.example.com/', 'https://soy-remix.example.com/redirect']) {
        try { await fetchPublicBytes(new URL(url), AbortSignal.timeout(3000), 1024); throw Error('GUARD_BYPASSED'); }
        catch (error) { console.log(formatDiagnostic(diagnose(error))); }
      }
    `,
      ]);
      expect(guard.code).toBe(0);
      expect(guard.output).not.toContain('GUARD_BYPASSED');
      expect(guard.output.match(/Private network destination/g)?.length).toBe(2);
      expect(guard.output).toContain('Blossom response refused (302)');
      const tls = await command(
        [
          '-e',
          `
      import { fetchPublicBytes } from ${JSON.stringify(resolve('packages/backend/src/blossom.ts'))};
      try { await fetchPublicBytes(new URL('https://soy-remix.example.com/'), AbortSignal.timeout(3000), 1024); process.exitCode=2; }
      catch (error) { console.log(String(error.context?.detail ?? error)); }
    `,
        ],
        { NODE_EXTRA_CA_CERTS: '' },
      );
      expect(tls.code).toBe(0);
      expect(tls.output).toContain('certificate');
    } finally {
      server.stop(true);
      await rm(cwd, { recursive: true, force: true });
    }
  },
  45000,
);
