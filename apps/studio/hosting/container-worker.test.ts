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
    const child = Bun.spawn([Bun.which('node')!, entry], {
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

test('failed worker exports edits and reports its original failure for controller recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-failed-job-'));
  try {
    const workspace = join(root, 'workspace');
    await mkdir(workspace);
    const input = join(root, 'input.json');
    await writeFile(
      input,
      JSON.stringify({
        files: { 'main.ts': Buffer.from('before').toString('base64') },
        command: [
          process.execPath,
          '-e',
          "await Bun.write('main.ts','recoverable'); console.error('TS2322: fixture type error'); process.exit(2)",
        ],
      }),
    );
    const entry = join(root, 'worker.mjs');
    await writeFile(
      entry,
      worker
        .replaceAll("'/input/input.json'", JSON.stringify(input))
        .replaceAll("'/workspace/.git/HEAD'", JSON.stringify(join(workspace, '.git/HEAD')))
        .replaceAll("'/workspace'", JSON.stringify(workspace)),
    );
    const child = Bun.spawn([Bun.which('node')!, entry], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [out, err, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(exit).toBe(0);
    expect(out).toContain('SOY_JOB_STATUS:2');
    expect(err).toContain('TS2322');
    const frame = JSON.parse(
      out
        .split('\n')
        .find((s) => s.startsWith('SOY_JOB_FILE:'))!
        .slice(13),
    );
    expect(Buffer.from(frame.data, 'base64').toString()).toBe('recoverable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worker preserves signal failures and recovers after a missing executable without leaking arguments', async () => {
  const node = Bun.which('node');
  if (!node) throw new Error('The Studio toolchain regression requires Node.');
  for (const [command, status, cause] of [
    [[node, '-e', 'process.kill(process.pid, "SIGKILL")'], 137, ''],
    [['/does-not-exist/private-provider-key', 'API_KEY=private-provider-key'], 127, 'ENOENT'],
  ] as const) {
    const root = await mkdtemp(join(tmpdir(), 'studio-worker-crash-'));
    try {
      const workspace = join(root, 'workspace'),
        input = join(root, 'input.json');
      await mkdir(workspace);
      await writeFile(
        input,
        JSON.stringify({
          files: { 'src/saved.ts': Buffer.from('saved source').toString('base64') },
          command,
        }),
      );
      const entry = join(root, 'worker.mjs');
      await writeFile(
        entry,
        worker
          .replaceAll("'/input/input.json'", JSON.stringify(input))
          .replaceAll("'/workspace/.git/HEAD'", JSON.stringify(join(workspace, '.git/HEAD')))
          .replaceAll("'/workspace'", JSON.stringify(workspace)),
      );
      const child = Bun.spawn([node, entry], { stdout: 'pipe', stderr: 'pipe' });
      const [out, err, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit, err).toBe(0);
      expect(out).toContain('SOY_JOB_STATUS:' + status);
      expect(out).toContain('SOY_JOB_DONE');
      expect(out).toContain(Buffer.from('saved source').toString('base64'));
      expect(err).toContain(cause);
      expect(out + err).not.toContain('private-provider-key');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
