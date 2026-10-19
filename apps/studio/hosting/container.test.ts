import { expect, test } from 'bun:test';
import { containerCommand, ContainerJobs, validateJobFiles } from './container';
import type { run } from '../process';

test('container job source transfer rejects host paths, private state, oversized files and malformed output', async () => {
  for (const name of [
    '../key',
    '/root/key',
    'a/../b',
    'a\\b',
    '.git/config',
    '.env.local',
    'a/.napplet-space/session.json',
  ])
    expect(() => validateJobFiles({ [name]: '' })).toThrow();
  expect(() => validateJobFiles({ 'file.txt': 'not base64' })).toThrow();
  expect(() =>
    validateJobFiles({ 'file.txt': Buffer.alloc(32 * 1024 * 1024 + 1).toString('base64') }),
  ).toThrow();
  expect(() =>
    containerCommand('oven/bun:latest', '/tmp/input', 'soy-studio-' + crypto.randomUUID()),
  ).toThrow();
  const calls: string[][] = [];
  const execute: typeof run = async (args, options) => {
    calls.push(args);
    if (args[1] === 'run')
      options.onLine!(
        'SOY_JOB_FILE:' + JSON.stringify({ path: '../outside', data: '', final: true }),
      );
    return '';
  };
  const runner = new ContainerJobs('sha256:' + 'a'.repeat(64), execute);
  await expect(
    runner.run({}, ['bun', '-e', '1'], {
      signal: new AbortController().signal,
      operation: 'probe',
    }),
  ).rejects.toThrow('Invalid container file');
  expect(calls.at(-1)!.slice(0, 3)).toEqual(['docker', 'rm', '--force']);
});

test('a shared container supervisor serializes jobs and exports bounded files without protocol output', async () => {
  let unblock!: () => void;
  const gate = new Promise<void>((r) => {
    unblock = r;
  });
  const execute: typeof run = async (args, options) => {
    if (args[1] !== 'run') return '';
    await gate;
    options.onLine!(
      'SOY_JOB_FILE:' +
        JSON.stringify({
          path: 'src/main.ts',
          data: Buffer.from('working').toString('base64'),
          final: true,
        }),
    );
    options.onLine!('SOY_JOB_DONE');
    return 'build passed\nSOY_JOB_DONE';
  };
  const runner = new ContainerJobs('sha256:' + 'a'.repeat(64), execute);
  const options = { signal: new AbortController().signal, operation: 'build' };
  const pending = runner.run({}, ['bun', 'build'], options);
  await expect(runner.run({}, ['bun', 'build'], options)).rejects.toMatchObject({
    code: 'STUDIO_BUSY',
  });
  unblock();
  const result = await pending;
  expect(Buffer.from(result.files['src/main.ts'], 'base64').toString()).toBe('working');
  expect(result.output).toBe('build passed');
});

test('failed jobs return validated recovery files and an actionable redacted failure', async () => {
  const execute: typeof run = async (args, options) => {
    if (args[1] !== 'run') return '';
    options.onLine!(
      'SOY_JOB_FILE:' +
        JSON.stringify({
          path: 'src/main.ts',
          data: Buffer.from('saved').toString('base64'),
          final: true,
        }),
    );
    options.onLine!('SOY_JOB_STATUS:2');
    options.onLine!('SOY_JOB_DONE');
    return 'TS2322: a string cannot be assigned to a number\nAPI_KEY=do-not-show';
  };
  const runner = new ContainerJobs('sha256:' + 'a'.repeat(64), execute);
  const result = await runner.run({}, ['bun'], {
    signal: new AbortController().signal,
    operation: 'build draft',
  });
  expect(Buffer.from(result.files['src/main.ts'], 'base64').toString()).toBe('saved');
  const { diagnose, formatDiagnostic } = await import('../../../packages/diagnostics/src');
  const message = formatDiagnostic(diagnose(result.failure));
  expect(message).toContain('TS2322');
  expect(message).toContain('2');
  expect(message).not.toContain('do-not-show');
});
