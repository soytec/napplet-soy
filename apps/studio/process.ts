import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { DiagnosticError, ToolOutput } from '../../packages/diagnostics/src';

export type RunOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  operation: string;
  timeoutMs?: number;
  onLine?: (line: string) => void;
  includeStderr?: boolean;
  scrub?: (text: string) => string;
};

let processReporter: ((pid: number, active: boolean) => void) | undefined;
export function reportProcessGroups(report: (pid: number, active: boolean) => void) {
  processReporter = report;
}

/** Own one process group, including build grandchildren. No shell interpolation. */
export async function run(command: string[], options: RunOptions): Promise<string> {
  options.signal.throwIfAborted();
  const child = spawn(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (child.pid) processReporter?.(child.pid, true);
  let output = '',
    pending = '',
    failure: Error | undefined,
    exceeded = false;
  const scrub = options.scrub ?? ((text: string) => text);
  const decoder = new StringDecoder('utf8');
  const errors = new ToolOutput();
  const kill = (signal: NodeJS.Signals) => {
    if (!child.pid) return;
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= error as Error;
    }
  };
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    kill('SIGTERM');
    escalation ??= setTimeout(() => kill('SIGKILL'), 600);
  };
  options.signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(
    () => {
      exceeded = true;
      stop();
    },
    options.timeoutMs ?? 10 * 60_000,
  );
  child.stdout.on('data', (bytes: Buffer) => {
    pending += decoder.write(bytes);
    if (pending.length > 2 * 1024 * 1024) {
      failure = new Error('Tool output exceeded its line limit.');
      stop();
      return;
    }
    let at: number;
    while ((at = pending.indexOf('\n')) >= 0) {
      const line = scrub(pending.slice(0, at));
      pending = pending.slice(at + 1);
      output = (output + line + '\n').slice(-256 * 1024);
      try {
        options.onLine?.(line);
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error('Invalid tool output.');
        stop();
      }
    }
  });
  child.stderr.on('data', (bytes: Buffer) => errors.push(bytes));
  const code = await new Promise<number | null>((resolve) => {
    child.once('error', (error) => {
      failure = error;
      resolve(null);
    });
    child.once('close', resolve);
  });
  pending += decoder.end();
  if (pending) {
    const line = scrub(pending);
    output = (output + line).slice(-256 * 1024);
    try {
      options.onLine?.(line);
    } catch (error) {
      failure ??= error instanceof Error ? error : new Error('Invalid tool output.');
    }
  }
  errors.finish();
  clearTimeout(timer);
  options.signal.removeEventListener('abort', stop);
  // A command must not leave a watcher/server behind, even on successful exit.
  kill('SIGKILL');
  if (child.pid) processReporter?.(child.pid, false);
  if (escalation) clearTimeout(escalation);
  options.signal.throwIfAborted();
  if (code !== 0 || failure || exceeded)
    throw new DiagnosticError(
      exceeded ? 'STUDIO_TIMEOUT' : 'STUDIO_TOOL',
      exceeded ? `${options.operation} exceeded its time budget.` : `${options.operation} failed.`,
      {
        operation: options.operation,
        tool: command[0].split('/').pop(),
        exitCode: code ?? undefined,
        detail: scrub(errors.text || output.slice(-8000)),
        cause: failure,
        recovery:
          'Inspect the check details, then retry or ask the agent to repair the project. Your last passing preview is retained.',
      },
    );
  return output + (options.includeStderr && errors.text ? '\n' + scrub(errors.text) : '');
}
