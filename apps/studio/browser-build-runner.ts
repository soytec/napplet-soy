import {
  browserBuildLimits,
  type BrowserBuildTransfer,
  type BrowserBuildResult,
} from './browser-build-contract';

type CompilerWorker = Pick<Worker, 'onmessage' | 'onerror' | 'postMessage' | 'terminate'>;

/** Reuse the compiler/WASM and one input snapshot until disabled, failed or closed. */
export class BrowserBuildRunner {
  private worker?: CompilerWorker;
  private cancel?: (reason: Error) => void;
  base?: string;

  constructor(
    private createWorker: () => CompilerWorker,
    private timeoutMs = browserBuildLimits.timeoutMs - 5000,
  ) {}

  dispose() {
    this.cancel?.(new Error('Browser build cancelled.'));
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
    }
    this.worker?.terminate();
    this.worker = undefined;
    this.base = undefined;
  }

  build(job: BrowserBuildTransfer): Promise<BrowserBuildResult> {
    if (this.cancel) return Promise.reject(new Error('The browser compiler is already busy.'));
    return new Promise((resolve, reject) => {
      const fail = (error: Error) => {
        clearTimeout(deadline);
        this.cancel = undefined;
        this.dispose();
        reject(error);
      };
      const deadline = setTimeout(
        () => fail(new Error('Browser build timed out.')),
        this.timeoutMs,
      );
      this.cancel = fail;
      try {
        const worker = (this.worker ??= this.createWorker());
        worker.onmessage = (event: MessageEvent<BrowserBuildResult>) => {
          if (event.data.id !== job.id || event.data.revision !== job.revision) {
            fail(new Error('The browser compiler returned a stale result.'));
            return;
          }
          clearTimeout(deadline);
          this.cancel = undefined;
          if (event.data.errorKind) this.dispose();
          else this.base = job.id;
          resolve(event.data);
        };
        worker.onerror = (event) => fail(new Error(event.message || 'Browser compiler failed.'));
        worker.postMessage(job);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
