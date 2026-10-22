import { DiagnosticError } from '../../../packages/diagnostics/src';

/** The controller owns the budget. Leave export/cleanup to the worker after this stops. */
export async function withJobDeadline<T>(
  timeoutMs: number,
  execute: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('Invalid isolated job deadline.');
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DiagnosticError('STUDIO_TIMEOUT', 'The isolated job reached its time limit.', {
          operation: 'execute isolated project',
          recovery:
            'Recoverable edits will be saved and checked. Send a follow-up if more work is needed.',
        }),
      ),
    timeoutMs,
  );
  try {
    const value = await execute(controller.signal);
    controller.signal.throwIfAborted();
    return value;
  } catch (error) {
    controller.signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
