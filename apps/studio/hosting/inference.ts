import { chmod } from 'node:fs/promises';
import { providers, type ConnectionInput } from '../connections-model';
import { readBytes } from '../../../packages/client/src/bytes';
import { DiagnosticError } from '../../../packages/diagnostics/src';

export const inferenceLimits = {
  requestBytes: 2 * 1024 * 1024,
  responseBytes: 32 * 1024 * 1024,
};
type Connection = ConnectionInput & { key: string };
const fail = (message: string) => new DiagnosticError('STUDIO_INFERENCE', message);
export function hostedEndpoint(connection: Pick<ConnectionInput, 'provider' | 'endpoint'>) {
  const expected = providers[connection.provider].url.replace(/\/$/, '');
  if (!expected.startsWith('https:') || connection.endpoint.replace(/\/$/, '') !== expected)
    throw fail(
      'Hosted inference requires a listed cloud provider’s default endpoint. Local and custom endpoints remain available in local Studio.',
    );
  return expected;
}

/** A single job's only network capability. The socket is mounted, never the key.
 * Endpoint/model are selected by the controller; request headers cannot override them. */
export async function inferenceSocket(
  socket: string,
  connection: Connection,
  signal: AbortSignal,
  upstream: (url: string, options: RequestInit) => Promise<Response> = fetch,
) {
  const expected = hostedEndpoint(connection);
  if (!connection.key) throw fail('Select a saved API key before running hosted inference.');
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  let calls = 0,
    bytes = 0,
    active = 0;
  const server = Bun.serve({
    unix: socket,
    maxRequestBodySize: inferenceLimits.requestBytes,
    async fetch(request) {
      const error = (status: number, message: string) =>
        Response.json({ error: { message } }, { status });
      const path = new URL(request.url).pathname;
      if (abort.signal.aborted) return error(410, 'This inference run has ended.');
      if (
        request.method !== 'POST' ||
        (new URL(request.url).search && connection.provider !== 'google')
      )
        return error(400, 'Unsupported inference request.');
      const google = `/models/${connection.model}:`;
      const allowed =
        connection.provider === 'google'
          ? path === google + 'streamGenerateContent' || path === google + 'generateContent'
          : connection.provider === 'anthropic'
            ? path === '/messages'
            : path === '/chat/completions' ||
              (connection.provider === 'openai' && path === '/responses');
      if (!allowed) return error(403, 'This inference route is not available to this run.');
      if (active >= 2 || bytes >= inferenceLimits.responseBytes)
        return error(429, 'This inference run reached its concurrency or transfer budget.');
      let body: Record<string, any>;
      try {
        const data = await readBytes(
          new Response(request.body, { headers: request.headers }),
          inferenceLimits.requestBytes,
        );
        body = JSON.parse(new TextDecoder().decode(data));
        if (!body || Array.isArray(body) || typeof body !== 'object') throw Error();
        if (connection.provider !== 'google' && body.model !== connection.model) throw Error();
        if (body.background || body.store || body.web_search_options || body.previous_response_id)
          throw Error();
        if (
          Array.isArray(body.tools) &&
          body.tools.some((t: any) => t?.type && !['function', 'custom'].includes(t.type))
        )
          throw Error();
        if (connection.provider === 'google') {
          if (body.tools?.some((t: any) => t.googleSearch || t.codeExecution || t.urlContext))
            throw Error();
          const limit = body.generationConfig?.maxOutputTokens;
          if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw Error();
        } else {
          // Preserve model/provider budgets, including their defaults. Reasoning
          // may share the output budget; silently shrinking it can prevent edits.
          for (const key of ['max_output_tokens', 'max_completion_tokens', 'max_tokens']) {
            const limit = body[key];
            if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw Error();
          }
          if (path === '/responses') body.store = false;
        }
      } catch {
        return error(400, 'Invalid inference payload or model.');
      }
      // Reading request bodies yields; recheck before reserving an upstream call.
      if (abort.signal.aborted) return error(410, 'This inference run has ended.');
      if (active >= 2 || bytes >= inferenceLimits.responseBytes)
        return error(429, 'This inference run reached its concurrency or transfer budget.');
      calls++;
      active++;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (connection.provider === 'anthropic') {
        headers['x-api-key'] = connection.key;
        headers['anthropic-version'] = '2023-06-01';
      } else if (connection.provider === 'google') headers['x-goog-api-key'] = connection.key;
      else headers.Authorization = `Bearer ${connection.key}`;
      let response: Response;
      try {
        response = await upstream(
          expected + path + (path.endsWith(':streamGenerateContent') ? '?alt=sse' : ''),
          {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            redirect: 'error',
            signal: AbortSignal.any([abort.signal, request.signal]),
          },
        );
        if (!response.ok || !response.body) {
          active--;
          await response.body?.cancel();
          return error(
            response.status >= 400 ? response.status : 502,
            `The inference provider returned HTTP ${response.status}. Check this connection and its balance.`,
          );
        }
      } catch {
        active--;
        return error(
          502,
          'The inference provider could not be reached. Check the connection and retry explicitly.',
        );
      }
      const reader = response.body.getReader();
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          active--;
        }
      };
      return new Response(
        new ReadableStream({
          async pull(controller) {
            try {
              const part = await reader.read();
              if (part.done) {
                finish();
                controller.close();
                return;
              }
              bytes += part.value.length;
              if (bytes > inferenceLimits.responseBytes) {
                cancel();
                throw fail('Inference response budget reached.');
              }
              controller.enqueue(part.value);
            } catch (error) {
              finish();
              controller.error(error);
              await reader.cancel().catch(() => {});
            }
          },
          async cancel() {
            finish();
            await reader.cancel();
          },
        }),
        {
          headers: {
            'Content-Type': response.headers.get('content-type') ?? 'application/json',
            'Cache-Control': 'no-store',
          },
        },
      );
    },
  });
  await chmod(socket, 0o666); // The job's private bind mount supplies the capability.
  return {
    stats: () => ({ calls, bytes }),
    async close() {
      signal.removeEventListener('abort', cancel);
      cancel();
      await server.stop(true);
    },
  };
}
