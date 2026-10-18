import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from './container-worker.js' with { type: 'text' };

test('worker exports complete binary chunks after a child makes stdout non-blocking', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'studio-worker-output-'));
  try {
    const workspace = join(directory, 'workspace');
    const input = join(directory, 'input.json');
    await mkdir(workspace);
    const node = Bun.which('node');
    if (!node) throw new Error('The Studio toolchain regression requires Node.');
    const expected = Buffer.from(Array.from({ length: 256 * 1024 }, (_, i) => i % 256));
    await writeFile(
      input,
      JSON.stringify({
        files: { 'assets/probe.bin': expected.toString('base64') },
        command: [
          node,
          '-e',
          'process.stdout._handle.setBlocking(false); console.log("tool finished")',
        ],
      }),
    );
    // Relocate only the fixed container paths; execute the maintained worker body.
    const script = worker
      .replaceAll("'/input/input.json'", JSON.stringify(input))
      .replaceAll("'/workspace/.git/HEAD'", JSON.stringify(join(workspace, '.git/HEAD')))
      .replaceAll("'/workspace'", JSON.stringify(workspace));
    const entry = join(directory, 'worker.mjs');
    await writeFile(entry, script);
    const child = Bun.spawn([process.execPath, '--no-env-file', entry], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    const lines = stdout.trimEnd().split('\n');
    expect(lines[0]).toBe('tool finished');
    expect(lines.at(-1)).toBe('SOY_JOB_DONE');
    const chunks = lines
      .filter((line) => line.startsWith('SOY_JOB_FILE:'))
      .map((line) => JSON.parse(line.slice('SOY_JOB_FILE:'.length)));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.path === 'assets/probe.bin')).toBe(true);
    expect(chunks.at(-1).final).toBe(true);
    expect(Buffer.from(chunks.map((chunk) => chunk.data).join(''), 'base64')).toEqual(expected);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
