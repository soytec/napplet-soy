import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Run after `bun run build`: exercise the real provider tree, not a mock shell.
test('production shell renders account-backed Studio and preserves missing-route responses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-shell-'));
  const child = Bun.spawn([process.execPath, '--no-env-file', 'apps/web/server.ts'], {
    cwd: resolve(import.meta.dir, '../..'),
    env: {
      PATH: process.env.PATH,
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_SITE_ORIGIN: 'https://napplet.example',
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_ARTIFACT_DIR: join(directory, 'artifacts'),
      SPACE_PUBLICDEV: '0',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const errors = new Response(child.stderr).text();
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
  try {
    const reader = child.stdout.getReader();
    let output = '', origin = '';
    while (!origin) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Server exited before listening: ${await errors}`);
      output += new TextDecoder().decode(chunk.value);
      origin = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? '';
    }
    reader.releaseLock();
    for (const path of ['/studio', '/studio/create']) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain('Opening Studio');
      expect(html).toContain('Create in browser');
      expect(html).not.toContain('NostrProvider missing');
    }
    for (const path of ['media', 'resources', 'relay-read']) {
      const response = await fetch(`${origin}/api/${path}`, {
        method: 'POST',
        headers: { Origin: 'https://napplet.example', 'X-Space-Host': '1', 'Content-Type': 'application/json' },
        body: '{',
      });
      expect(response.status).toBe(404);
    }
  } finally {
    clearTimeout(timeout);
    child.kill();
    await child.exited;
    await errors;
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
