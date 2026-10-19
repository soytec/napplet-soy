import type { ContainerJobs } from './container';
import { DiagnosticError } from '../../../packages/diagnostics/src';

/** FIFO admission for the VPS's single isolated worker. Waiting never starts inference. */
export class StudioQueue {
  private running = false;
  private waiting: {
    resolve: () => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
    abort: () => void;
  }[] = [];
  constructor(private jobs: Pick<ContainerJobs, 'run'>) {}
  private async acquire(signal: AbortSignal) {
    signal.throwIfAborted();
    if (!this.running) {
      this.running = true;
      return;
    }
    if (this.waiting.length >= 4)
      throw new DiagnosticError(
        'STUDIO_BUSY',
        'The Studio worker queue is full. Try again shortly; no inference was started.',
      );
    await new Promise<void>((resolve, reject) => {
      const entry = {
        resolve,
        reject,
        signal,
        abort: () => {
          this.waiting = this.waiting.filter((e) => e !== entry);
          reject(signal.reason ?? new Error('Queued job cancelled.'));
        },
      };
      this.waiting.push(entry);
      signal.addEventListener('abort', entry.abort, { once: true });
    });
  }
  private release() {
    const next = this.waiting.shift();
    if (next) {
      next.signal.removeEventListener('abort', next.abort);
      next.resolve();
    } else this.running = false;
  }
  run: ContainerJobs['run'] = async (files, command, options) => {
    const activity = (text: string) =>
      options.onLine?.(
        (options.context as { operation?: string })?.operation === 'agent'
          ? 'SOY_AGENT:' + JSON.stringify({ type: 'activity', text })
          : text,
      );
    if (this.running)
      activity(`Waiting for a Studio worker · ${this.waiting.length + 1} job(s) ahead.`);
    await this.acquire(options.signal);
    activity('Studio worker ready.');
    try {
      options.signal.throwIfAborted();
      return await this.jobs.run(files, command, options);
    } finally {
      this.release();
    }
  };
}
