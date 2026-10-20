import { expect, test } from 'bun:test';
import { containerCommand, ContainerJobs, validateJobFiles } from './container';
import { run } from '../process';

test('large recovery frames never enter the failure diagnostic or displace the useful output', async () => {
  const execute: typeof run = async (args, options) => {
    if (args[1] !== 'run') return '';
    return run(
      [
        process.execPath,
        '--no-env-file',
        '-e',
        `
        import { writeSync } from 'node:fs';
        console.log('Saved the changed game before stopping.');
        const data = Buffer.from('private recovered source\\n'.repeat(10000)).toString('base64');
        for (let at = 0; at < data.length; at += 256 * 1024)
          writeSync(1, 'SOY_JOB_FILE:' + JSON.stringify({
            path: 'src/main.ts', data: data.slice(at, at + 256 * 1024),
            final: at + 256 * 1024 >= data.length,
          }) + '\\n');
        console.error('STUDIO_TIMEOUT: The maker reached its time limit. API_KEY=do-not-show');
        console.log('SOY_JOB_STATUS:1');
        console.log('SOY_JOB_DONE');
        `,
      ],
      options,
    );
  };
  const jobs = new ContainerJobs('sha256:' + 'a'.repeat(64), execute);
  const result = await jobs.run({}, ['bun'], {
    signal: new AbortController().signal,
    operation: 'run isolated OpenCode',
  });
  expect(Buffer.from(result.files['src/main.ts'], 'base64').toString()).toContain(
    'private recovered source',
  );
  const { diagnose, formatDiagnostic } = await import('../../../packages/diagnostics/src');
  const message = formatDiagnostic(diagnose(result.failure));
  expect(message).toContain('STUDIO_TIMEOUT');
  expect(message).not.toContain('do-not-show');
  expect(message).not.toContain('cHJpdmF0ZS');
  expect(result.output).toContain('Saved the changed game before stopping.');
  expect(result.output).not.toContain('"final":');
  expect(result.output).not.toContain('SOY_JOB_');
});

test('private service umask still allows the isolated container user to read its job input', async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      '--no-env-file',
      '-e',
      `
    import { strict as assert } from 'node:assert';
    import { stat } from 'node:fs/promises';
    import { join, dirname } from 'node:path';
    import { ContainerJobs } from ${JSON.stringify(import.meta.dir + '/container.ts')};
    process.umask(0o077);
    const jobs = new ContainerJobs('sha256:' + 'a'.repeat(64), async (args, options) => {
      if (args[1] !== 'run') return '';
      const input = args[args.indexOf('--mount') + 1].split('source=')[1].split(',')[0];
      assert.equal((await stat(dirname(input))).mode & 0o777, 0o700, 'host parent must stay private');
      assert.equal((await stat(input)).mode & 0o007, 0o005, 'mounted input must be traversable');
      for (const name of ['input.json', 'check-cpu.sh', 'job.js'])
        assert.equal((await stat(join(input, name))).mode & 0o007, 0o004, name + ' must be readable');
      options.onLine('SOY_JOB_DONE');
      return '';
    });
    await jobs.run({}, ['bun'], { signal: AbortSignal.timeout(3000), operation: 'permission probe' });
  `,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(error).toBe('');
  expect(code).toBe(0);
});

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
    return 'build passed';
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
