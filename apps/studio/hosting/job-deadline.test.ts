import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../process';
import { withJobDeadline } from './job-deadline';
import { ContainerJobs, recoveryTimeoutMs } from './container';
import { diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';

test('the controller budget reaches execution and preserves a typed timeout after recovery', async () => {
  const jobs = new ContainerJobs('sha256:' + 'a'.repeat(64), async (args, options) => {
    if (args[1] !== 'run') return '';
    const staging = args[args.indexOf('--mount') + 1].split('source=')[1].split(',')[0];
    const { timeoutMs } = JSON.parse(await readFile(join(staging, 'input.json'), 'utf8'));
    expect(timeoutMs).toBe(200);
    expect(options.timeoutMs).toBe(200 + recoveryTimeoutMs);
    return run(
      [
        process.execPath,
        '--no-env-file',
        '-e',
        `
        import { withJobDeadline } from ${JSON.stringify(import.meta.dir + '/job-deadline.ts')};
        import { run } from ${JSON.stringify(import.meta.dir + '/../process.ts')};
        import { diagnose, formatDiagnostic } from ${JSON.stringify(import.meta.dir + '/../../../packages/diagnostics/src')};
        try {
          await withJobDeadline(${timeoutMs}, signal => run([
            process.execPath, '-e', 'console.log("working"); setTimeout(() => {}, 60000)'
          ], { cwd: process.cwd(), env: process.env, signal, operation: 'OpenCode inference' }));
        } catch (error) {
          const diagnostic = diagnose(error, 'execute isolated project');
          if (diagnostic.code === 'STUDIO_TIMEOUT') console.log('SOY_JOB_TIMEOUT');
          console.error(formatDiagnostic(diagnostic));
        }
        console.log('SOY_JOB_FILE:' + JSON.stringify({
          path: 'src/main.ts', data: Buffer.from('saved game').toString('base64'), final: true
        }));
        console.log('SOY_JOB_STATUS:1');
        console.log('SOY_JOB_DONE');
        `,
      ],
      options,
    );
  });
  const result = await jobs.run({}, ['bun'], {
    timeoutMs: 200,
    signal: new AbortController().signal,
    operation: 'run isolated OpenCode',
  });
  expect(result.failure?.code).toBe('STUDIO_TIMEOUT');
  expect(Buffer.from(result.files['src/main.ts'], 'base64').toString()).toBe('saved game');
  const message = formatDiagnostic(diagnose(result.failure));
  expect(message).toContain('time limit');
  expect(message).not.toContain('ETIMEDOUT');
  expect(message).not.toContain('connectivity');
  expect(message).not.toContain('SOY_JOB_');
});

test('completed jobs release their deadline and ordinary tool errors keep their cause', async () => {
  let observed!: AbortSignal;
  expect(
    await withJobDeadline(20, async (signal) => {
      observed = signal;
      return 'done';
    }),
  ).toBe('done');
  await Bun.sleep(30);
  expect(observed.aborted).toBe(false);
  const root = await mkdtemp(join(tmpdir(), 'studio-deadline-'));
  try {
    await expect(
      withJobDeadline(3000, (signal) =>
        run([process.execPath, '-e', 'console.error("TS2322: wrong type"); process.exit(2)'], {
          cwd: root,
          env: process.env,
          signal,
          operation: 'check isolated project',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'STUDIO_TOOL',
      context: { exitCode: 2, detail: 'TS2322: wrong type' },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
