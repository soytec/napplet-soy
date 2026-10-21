import { expect, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('the public HTTPS worker runs from a private draft directory and preserves the refusal cause', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'soy-http-worker-'));
  try {
    const entry = new URL('./public-http-node.ts', import.meta.url).pathname;
    const diagnostics = new URL('../../diagnostics/src/index.ts', import.meta.url).pathname;
    const child = Bun.spawn(
      [
        process.execPath,
        '--no-env-file',
        '-e',
        `
      import { fetchPublicBytesInNode } from ${JSON.stringify(entry)};
      import { diagnose, formatDiagnostic } from ${JSON.stringify(diagnostics)};
      try {
        await fetchPublicBytesInNode(new URL('https://127.0.0.1/'), AbortSignal.timeout(8000), 1024);
        process.exitCode = 2;
      } catch (error) { console.error(formatDiagnostic(diagnose(error))); process.exitCode = 1; }
    `,
      ],
      { cwd, stdout: 'pipe', stderr: 'pipe', env: { PATH: process.env.PATH } },
    );
    const output = await new Response(child.stderr).text();
    expect(await child.exited).toBe(1);
    expect(output).toContain('Private network destination');
    expect(output).toContain('download public HTTPS bytes');
    expect(await readdir(cwd)).toEqual([]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 15000);
