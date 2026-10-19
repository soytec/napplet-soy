import { redactDiagnostic } from '../../packages/diagnostics/src';
import type { GitCommand } from './browser-git-contract';

export class BrowserGitClient {
  private worker = new Worker(new URL('./browser-git.worker.ts', import.meta.url), {
    type: 'module',
  });
  private closed = false;
  private pending?: {
    id: string;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private scope: string,
    private progress: (text: string) => void = () => {},
  ) {
    this.worker.onmessage = (event) => {
      const p = this.pending;
      if (!p || event.data.id !== p.id) return;
      if (event.data.progress) {
        this.progress(event.data.progress);
        return;
      }
      this.pending = undefined;
      clearTimeout(p.timer);
      if (event.data.error) p.reject(new Error(event.data.error));
      else p.resolve(event.data.value);
    };
    this.worker.onerror = (event) =>
      this.dispose(
        `Browser Git worker failed: ${redactDiagnostic(event.message || 'Worker startup failed', 600)}. Reload the browser copy; Studio files are unchanged.`,
      );
  }
  call<T>(command: GitCommand): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Reload this panel to reopen browser Git.'));
    if (this.pending) return Promise.reject(new Error('Browser Git is already working.'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(
        () =>
          this.dispose(
            'Browser Git timed out. Reload to inspect its saved checkpoint before retrying.',
          ),
        120000,
      );
      this.pending = { id, resolve, reject, timer };
      this.worker.postMessage({ id, scope: this.scope, command });
    });
  }
  dispose(message = 'Browser Git closed. Saved browser checkpoints remain on this device.') {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error(message));
      this.pending = undefined;
    }
    this.closed = true;
    this.worker.terminate();
  }
}
