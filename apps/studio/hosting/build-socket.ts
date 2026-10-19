import { chmod } from 'node:fs/promises';
import { readBytes } from '../../../packages/client/src/bytes';
import { validateJobFiles, type JobFiles } from './container';
import { DiagnosticError, diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';

/** Job-scoped bridge for the agent's check tool. It cannot execute controller commands. */
export async function buildSocket(
  path: string,
  signal: AbortSignal,
  check: (files: JobFiles) => Promise<string>,
) {
  let active = false;
  const server = Bun.serve({
    unix: path,
    maxRequestBodySize: 48 * 1024 * 1024,
    async fetch(request) {
      if (signal.aborted) return new Response('Job ended.', { status: 410 });
      if (active || request.method !== 'POST' || new URL(request.url).pathname !== '/check')
        return new Response('Check unavailable.', { status: 409 });
      active = true;
      try {
        const bytes = await readBytes(new Response(request.body), 48 * 1024 * 1024);
        const files = validateJobFiles(JSON.parse(new TextDecoder().decode(bytes)));
        return Response.json({ result: await check(files) });
      } catch (cause) {
        return Response.json(
          {
            result: formatDiagnostic(
              diagnose(
                new DiagnosticError(
                  'STUDIO_BROWSER_CHECK',
                  'The workspace check failed. The last passing preview is retained.',
                  {
                    cause,
                    operation: 'check isolated workspace in browser',
                    recovery: 'Address the reported cause, then run studio_check again.',
                  },
                ),
              ),
            ),
          },
          { status: 400 },
        );
      } finally {
        active = false;
      }
    },
  });
  await chmod(path, 0o666);
  return { close: () => server.stop(true) };
}
