import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { run, type RunOptions } from '../process';
import { DiagnosticError } from '../../../packages/diagnostics/src';
import cpuCheck from '../../../scripts/deploy-cpu-check.sh' with { type: 'text' };
import worker from './container-worker.js' with { type: 'text' };

export const containerLimits = {
  memoryMiB: 2048,
  workspaceMiB: 1024,
  // Linux counts threads here, including Chromium, OpenCode, Bun and esbuild.
  pids: 512,
  cpus: 1,
  timeoutMs: 600000,
} as const;
export const jobLimits = { bytes: 32 * 1024 * 1024, files: 2048 } as const;
// After the execution budget expires, allow the worker to export recoverable edits.
export const recoveryTimeoutMs = 30_000;
export function jobPath(path: string) {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !path.includes('\\') &&
    !/[\x00-\x1f]/.test(path) &&
    path.split('/').every((p) => p && p !== '.' && p !== '..') &&
    !path.startsWith('/') &&
    !path
      .split('/')
      .some(
        (p) =>
          ['.git', '.napplet-space', 'node_modules', '.env'].includes(p) || p.startsWith('.env.'),
      )
  );
}
export type JobFiles = Record<string, string>; // base64 bytes, not host paths
export type JobOptions = Omit<RunOptions, 'cwd' | 'env'> & {
  /** Controller-owned job metadata. Never put reusable credentials here. */
  context?: unknown;
  /** Mount a job-specific capability (e.g. inference socket) in this private input dir. */
  prepare?: (inputDirectory: string) => Promise<() => Promise<void>>;
};
export function validateJobFiles(value: unknown): JobFiles {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid job files.');
  const entries = Object.entries(value);
  if (entries.length > jobLimits.files) throw new Error('Too many job files.');
  let bytes = 0;
  for (const [path, data] of entries) {
    if (
      !jobPath(path) ||
      typeof data !== 'string' ||
      data.length > Math.ceil(jobLimits.bytes / 3) * 4 ||
      Buffer.from(data, 'base64').toString('base64') !== data
    )
      throw new Error('Invalid job file path or encoding.');
    bytes += Buffer.byteLength(data, 'base64');
    if (bytes > jobLimits.bytes) throw new Error('Job files exceed 32 MiB.');
  }
  return value as JobFiles;
}
export function containerCommand(
  image: string,
  staging: string,
  name: string,
  profile: 'standard' | 'legacy-x64' = 'standard',
) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('Pin a locally installed Docker image by its exact sha256 ID.');
  if (
    !/^soy-studio-[a-f0-9-]{36}$/.test(name) ||
    !staging.startsWith('/') ||
    /[,\n\r]/.test(staging)
  )
    throw new Error('Invalid operator container configuration.');
  return [
    'docker',
    'run',
    '--rm',
    '--init',
    '--pull=never',
    '--name',
    name,
    '--network=none',
    '--read-only',
    '--user=1000:1000',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--pids-limit=' + containerLimits.pids,
    '--memory=' + containerLimits.memoryMiB + 'm',
    '--memory-swap=' + containerLimits.memoryMiB + 'm',
    '--cpus=' + containerLimits.cpus,
    '--ulimit=nofile=1024:1024',
    '--ulimit=core=0:0',
    // Project-local package binaries (tsc, vite, esbuild) must execute here.
    // Docker's tmpfs default is noexec; root/input remain read-only and offline.
    '--tmpfs=/workspace:rw,exec,nosuid,nodev,size=' +
      containerLimits.workspaceMiB +
      'm,uid=1000,gid=1000,mode=700',
    '--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=128m,uid=1000,gid=1000,mode=700',
    '--mount',
    `type=bind,source=${staging},target=/input,readonly`,
    '--workdir=/workspace',
    '--env=HOME=/workspace',
    '--env=TMPDIR=/tmp',
    '--entrypoint=/bin/bash',
    image,
    '--noprofile',
    '--norc',
    '-c',
    profile === 'legacy-x64'
      ? '. /input/check-cpu.sh; napplet_check_cpu Linux "$(uname -m)" /proc/cpuinfo legacy-x64 >/dev/null || exit 78; test "$(/usr/local/bin/bun --version)" = 1.3.8 || exit 78; exec /usr/local/bin/node /input/job.mjs'
      : '. /input/check-cpu.sh; napplet_check_cpu >/dev/null || exit 78; exec /usr/local/bin/node /input/job.mjs',
  ];
}

/** A bounded offline execution boundary. No credentials, Docker socket, live checkout,
 * controller store or host home are mounted. Hosted inference requires its own broker. */
export class ContainerJobs {
  private active = false;
  constructor(
    private image: string,
    private execute: typeof run = run,
    private profile: 'standard' | 'legacy-x64' = 'standard',
  ) {}
  async run(files: JobFiles, command: string[], options: JobOptions) {
    if (this.active)
      throw new DiagnosticError('STUDIO_BUSY', 'One container job may run at a time on this host.');
    validateJobFiles(files);
    if (
      !command.length ||
      command.length > 256 ||
      command.some((v) => typeof v !== 'string' || v.includes('\0')) ||
      JSON.stringify(command).length > 128000
    )
      throw new Error('Invalid container command.');
    this.active = true;
    const parent = await mkdtemp(join(tmpdir(), 'soy-studio-job-')).catch((error) => {
      this.active = false;
      throw error;
    });
    const staging = join(parent, 'input'),
      name = 'soy-studio-' + crypto.randomUUID();
    let dispose: (() => Promise<void>) | undefined;
    try {
      await chmod(parent, 0o700);
      await mkdir(staging, { mode: 0o755 });
      // The controller uses umask 0077. Docker mounts only this child directory,
      // so give its different UID read/traverse access while keeping the host
      // parent private. Creation modes alone are reduced by the process umask.
      await chmod(staging, 0o755);
      const timeoutMs = Math.min(
        options.timeoutMs ?? containerLimits.timeoutMs,
        containerLimits.timeoutMs,
      );
      const input = JSON.stringify({ files, command, context: options.context, timeoutMs });
      if (input.length > 48 * 1024 * 1024)
        throw new Error('Job input exceeds its transfer budget.');
      await writeFile(join(staging, 'input.json'), input, {
        mode: 0o644,
      });
      await writeFile(join(staging, 'check-cpu.sh'), cpuCheck, { mode: 0o644 });
      await writeFile(join(staging, 'job.mjs'), worker, { mode: 0o644 });
      for (const file of ['input.json', 'check-cpu.sh', 'job.mjs'])
        await chmod(join(staging, file), 0o644);
      dispose = await options.prepare?.(staging);
      let exitCode = 0,
        timedOut = false;
      let result: JobFiles | undefined,
        transferred = 0;
      const received: JobFiles = Object.create(null),
        completed = new Set<string>();
      // Process output remains bounded by run(); result is exported separately below.
      const output = await this.execute(
        containerCommand(this.image, resolve(staging), name, this.profile),
        {
          ...options,
          includeStderr: true,
          cwd: parent,
          env: { PATH: process.env.PATH },
          timeoutMs: timeoutMs + recoveryTimeoutMs,
          retainStdout: (line) => !line.startsWith('SOY_JOB_') && !line.startsWith('SOY_AGENT:'),
          onLine: (line) => {
            if (line === 'SOY_JOB_TIMEOUT') {
              timedOut = true;
            } else if (line.startsWith('SOY_JOB_STATUS:')) {
              const status = line.slice(15);
              if (!/^(?:0|[1-9][0-9]{0,2})$/.test(status) || Number(status) > 255 || result)
                throw new Error('Invalid job exit status.');
              exitCode = Number(status);
            } else if (line === 'SOY_JOB_DONE') {
              if (result || completed.size !== Object.keys(received).length)
                throw new Error('Invalid container result.');
              result = validateJobFiles(received);
            } else if (line.startsWith('SOY_JOB_FILE:')) {
              const frame = JSON.parse(line.slice('SOY_JOB_FILE:'.length));
              if (
                result ||
                typeof frame.path !== 'string' ||
                !jobPath(frame.path) ||
                typeof frame.data !== 'string' ||
                typeof frame.final !== 'boolean' ||
                completed.has(frame.path)
              )
                throw new Error('Invalid container file frame.');
              transferred += frame.data.length;
              if (transferred > Math.ceil(jobLimits.bytes / 3) * 4 + jobLimits.files * 4)
                throw new Error('Container output exceeds its byte budget.');
              received[frame.path] = (received[frame.path] ?? '') + frame.data;
              if (Object.keys(received).length > jobLimits.files)
                throw new Error('Too many container output files.');
              if (frame.final) completed.add(frame.path);
            } else options.onLine?.(line);
          },
        },
      );
      if (!result) throw new Error('Container exited without exporting its source changes.');
      const text = output.trim();
      return {
        files: result,
        output: text,
        ...(exitCode
          ? {
              failure: new DiagnosticError(
                timedOut ? 'STUDIO_TIMEOUT' : 'STUDIO_EXECUTION',
                timedOut
                  ? 'The isolated job reached its time limit. Its recoverable edits were saved.'
                  : 'The isolated job failed. Its recoverable edits were saved.',
                {
                  tool: command[0],
                  exitCode,
                  operation: options.operation,
                  detail: text,
                  recovery:
                    'Inspect the diagnostics and ask the maker to repair the saved draft. Your last passing preview is retained.',
                },
              ),
            }
          : {}),
      };
    } finally {
      // Killing docker's client does not reliably kill its container. Always remove the owned name.
      try {
        await this.execute(['docker', 'rm', '--force', name], {
          cwd: parent,
          env: { PATH: process.env.PATH },
          signal: AbortSignal.timeout(10000),
          operation: 'stop studio container',
          timeoutMs: 10000,
        });
      } catch (error) {
        // Auto-removal on normal exit is expected. Verify absence before accepting cleanup.
        const ids = await this.execute(
          ['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$'],
          {
            cwd: parent,
            env: { PATH: process.env.PATH },
            signal: AbortSignal.timeout(10000),
            operation: 'verify studio container cleanup',
            timeoutMs: 10000,
          },
        );
        if (ids.trim()) throw error;
      } finally {
        try {
          await dispose?.();
        } finally {
          await rm(parent, { recursive: true, force: true });
          this.active = false;
        }
      }
    }
  }
}
