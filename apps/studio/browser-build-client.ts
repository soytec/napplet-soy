import { useEffect, useState } from 'react';
import type { StudioClient } from './local-client';
import { type BrowserBuildTransfer, type BrowserBuildResult } from './browser-build-contract';
import { BrowserBuildRunner } from './browser-build-runner';

/** Session-local opt-in: reopening Studio never silently switches execution location. */
export function useBrowserBuild(client: StudioClient, available: boolean) {
  const [enabled, setEnabled] = useState(false);
  const active = enabled && available;
  const [session] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (!active) return;
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const runner = new BrowserBuildRunner(
      () => new Worker(new URL('./browser-build.worker.ts', import.meta.url), { type: 'module' }),
    );
    let last = '';
    const poll = async () => {
      try {
        const job = await client.api<BrowserBuildTransfer | null>(
          'browser-builds/' + session + (runner.base ? '?base=' + runner.base : ''),
        );
        if (!live) return;
        if (job && job.id !== last) {
          last = job.id;
          setStatus('Building in this browser…');
          let result: BrowserBuildResult;
          try {
            result = await runner.build(job);
          } catch (error) {
            result = {
              id: job.id,
              revision: job.revision,
              error: String(error).slice(0, 12000),
              errorKind: 'worker',
              typecheckMs: 0,
              buildMs: 0,
            };
          }
          if (!live) return;
          try {
            await client.api('browser-builds/' + session, result);
          } catch (error) {
            // The host did not acknowledge this snapshot. Never send a delta
            // against it on the next build, even if compilation succeeded.
            runner.dispose();
            throw error;
          }
          setStatus(
            result.error
              ? 'Browser diagnostics returned'
              : `Browser build: ${Math.round(result.typecheckMs + result.buildMs)} ms`,
          );
        }
      } catch (error) {
        if (live) setStatus((error as Error).message);
      } finally {
        if (live) timer = setTimeout(() => void poll(), 500);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      runner.dispose();
    };
  }, [active, session, client]);
  return { enabled: active, setEnabled, session: active ? session : undefined, status };
}
