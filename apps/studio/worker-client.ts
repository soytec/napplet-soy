import { tmpdir } from 'node:os';
import { z } from 'zod';
import { DiagnosticError, ToolOutput, type Diagnostic } from '../../packages/diagnostics/src';
import { cleanEnvironment } from './agent';
import type { StudioSurface } from './surface';

export const workerConfig = z
  .object({
    directory: z.string().startsWith('/'),
    owner: z.string(),
    soyli: z.array(z.string()).min(1).max(4),
    agent: z
      .object({
        directory: z.string().startsWith('/'),
        executable: z.string().startsWith('/'),
        model: z.string().max(120),
        key: z.string().max(4096),
      })
      .strict(),
  })
  .strict();
export type WorkerConfig = z.infer<typeof workerConfig>;
const protocol = 1;
const failure = (code: string, message: string, context = {}) =>
  new DiagnosticError(code, message, {
    operation: 'studio worker',
    recovery:
      'Restart the studio, inspect the saved draft and explicitly continue. No inference is retried automatically.',
    ...context,
  });

/** Own the worker and its reported process groups; never retry an ambiguous mutation. */
export class StudioWorker {
  readonly client: StudioSurface;
  readonly pid: number;
  private child: Bun.Subprocess;
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private groups = new Set<number>();
  private dead?: Error;
  private closing?: Promise<void>;
  private output = new ToolOutput();
  private scrub: (s: string) => string;
  private ready: Promise<unknown>;
  constructor(config: WorkerConfig, executable = new URL('./worker.ts', import.meta.url).pathname) {
    config = workerConfig.parse(config);
    this.scrub = (s) =>
      config.agent.key ? s.replaceAll(config.agent.key, '[provider credential redacted]') : s;
    this.child = Bun.spawn([process.execPath, '--no-env-file', executable], {
      cwd: tmpdir(),
      env: cleanEnvironment(),
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
      serialization: 'advanced',
      ipc: (message) => this.receive(message),
    });
    const child = this.child;
    this.pid = child.pid;
    const drained = (async () => {
      for await (const chunk of child.stderr as ReadableStream<Uint8Array>) this.output.push(chunk);
      this.output.finish();
    })();
    void this.child.exited.then(async (code) => {
      for (const pid of this.groups) this.killGroup(pid);
      this.groups.clear();
      await drained;
      this.rejectAll(
        failure('STUDIO_WORKER_EXIT', 'The studio worker stopped.', {
          exitCode: code,
          tool: 'bun',
          detail: this.scrub(this.output.text),
        }),
      );
    });
    this.ready = this.call('initialize', [config], 30000).catch(async (error) => {
      this.child.kill('SIGKILL');
      await this.child.exited;
      throw error;
    });
    // start() is the readiness gate; prevent an unhandled rejection before it is called.
    void this.ready.catch(() => {});
    const call = (method: string, ...args: unknown[]) => this.call(method, args);
    this.client = {
      state: () => call('state'),
      connectionAction: (...args) => call('connectionAction', ...args),
      assets: (...args) => call('assets', ...args),
      importAsset: (...args) => call('importAsset', ...args),
      assetMedia: (...args) => call('assetMedia', ...args),
      create: (...args) => call('create', ...args),
      send: (...args) => call('send', ...args),
      stop: (...args) => call('stop', ...args),
      check: (...args) => call('check', ...args),
      restore: (...args) => call('restore', ...args),
      files: (...args) => call('files', ...args),
      file: (...args) => call('file', ...args),
      diff: (...args) => call('diff', ...args),
      preview: (...args) => call('preview', ...args),
      listing: (...args) => call('listing', ...args),
      preparePublication: (...args) => call('preparePublication', ...args),
      prepareProposal: (...args) => call('prepareProposal', ...args),
      propose: (...args) => call('propose', ...args),
      publish: (...args) => call('publish', ...args),
      refreshPublication: (...args) => call('refreshPublication', ...args),
      fixPublication: (...args) => call('fixPublication', ...args),
      publicationMedia: (...args) => call('publicationMedia', ...args),
      close: () => this.close(),
      signing: {
        connect: (...args) => call('signerConnect', ...args),
        next: (...args) => call('signerNext', ...args),
        reply: (...args) => call('signerReply', ...args),
      },
    };
  }
  async start() {
    await this.ready;
    return this.client;
  }
  private killGroup(pid: number) {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
        console.error('Could not stop a studio-owned process group.');
    }
  }
  private rejectAll(error: Error) {
    this.dead ??= error;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  private receive(value: any) {
    if (value?.protocol !== protocol) return;
    if (value.type === 'process' && Number.isSafeInteger(value.pid) && value.pid > 1) {
      if (value.active) this.groups.add(value.pid);
      else this.groups.delete(value.pid);
      return;
    }
    const pending = this.pending.get(value.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(value.id);
    if (value.type === 'result') pending.resolve(value.value);
    else if (value.type === 'error') {
      const d = value.diagnostic as Diagnostic;
      pending.reject(
        failure(d.code, this.scrub(d.message), {
          operation: d.operation,
          recovery: d.recovery,
          detail: this.scrub(d.details?.join('\n') ?? ''),
        }),
      );
    } else
      pending.reject(
        failure('STUDIO_WORKER_PROTOCOL', 'The worker returned an unsupported response.'),
      );
  }
  private call(method: string, args: unknown[], timeout = 30000): Promise<any> {
    if (this.dead) return Promise.reject(this.dead);
    if (this.pending.size >= 64)
      return Promise.reject(failure('STUDIO_BUSY', 'Too many pending studio requests.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // The request may have started work. Terminate instead of replaying it.
        this.rejectAll(
          failure(
            'STUDIO_WORKER_TIMEOUT',
            'The studio worker did not respond within its deadline.',
          ),
        );
        this.child.kill('SIGTERM');
        const kill = setTimeout(() => this.child.kill('SIGKILL'), 2000);
        kill.unref();
        void this.child.exited.then(() => clearTimeout(kill));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.child.send({ protocol, type: 'request', id, method, args });
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(failure('STUDIO_WORKER_EXIT', 'The worker connection closed.'));
      }
    });
  }
  close() {
    return (this.closing ??= (async () => {
      try {
        if (!this.dead) await this.call('close', [], 10000);
      } finally {
        if (this.child.exitCode === null) this.child.kill('SIGTERM');
        const timer = setTimeout(() => this.child.kill('SIGKILL'), 2000);
        await this.child.exited;
        clearTimeout(timer);
      }
    })());
  }
}
