import { Subscription } from 'rxjs';
import { z } from 'zod';
import { playbackFilters } from '../../nostr/src/playback';
import { readRelayUrl } from '../../nostr/src/relay-policy';
import { openPlaybackRelay } from './relay-tunnel';

const schema = z
  .object({
    manifest: z.string().regex(/^[a-f0-9]{64}$/),
    relay: z.string().max(256),
    filters: z.unknown().transform(playbackFilters),
    live: z.boolean(),
    timeoutMs: z.number().int().min(1).max(10000),
  })
  .strict();
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/** Same-origin, admitted, read-only Nostr streams for both browser hosts. */
export function createPlaybackRelayResponder(
  admit: (manifest: string) => Promise<{ localRelays?: string[] } | null>,
  origin?: () => string,
  open = openPlaybackRelay,
) {
  let active = 0;
  const budgets = new Map<string, { since: number; calls: number; active: number }>();
  return async (request: Request) => {
    const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
    if (
      request.method !== 'POST' ||
      request.headers.get('Origin') !== (origin?.() ?? new URL(request.url).origin) ||
      request.headers.get('X-Space-Host') !== '1'
    )
      return fail('Relay read not allowed', 403);
    let input: z.output<typeof schema>;
    try {
      const reader = request.body?.getReader();
      if (!reader) throw new Error();
      let bytes = 0;
      const chunks: Uint8Array[] = [];
      const timeout = setTimeout(() => void reader.cancel().catch(() => {}), 5000);
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          if ((bytes += next.value.length) > 24000) throw new Error();
          chunks.push(next.value);
        }
        input = schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } finally {
        clearTimeout(timeout);
        await reader.cancel().catch(() => {});
      }
    } catch {
      return fail('Invalid relay read', 400);
    }
    const admission = await admit(input.manifest);
    if (!admission) return fail('Napplet unavailable', 404);
    try {
      input.relay = readRelayUrl(input.relay, admission.localRelays);
    } catch {
      return fail('Relay is not allowed by host policy', 403);
    }
    if (request.signal.aborted) return fail('Relay read cancelled', 400);
    const now = Date.now();
    for (const [key, budget] of budgets)
      if (!budget.active && now - budget.since >= 60000) budgets.delete(key);
    const budget = budgets.get(input.manifest) ?? { since: now, calls: 0, active: 0 };
    if (now - budget.since >= 60000) {
      budget.since = now;
      budget.calls = 0;
    }
    if (
      active >= 64 ||
      budget.active >= 32 ||
      budget.calls >= 240 ||
      (budgets.size >= 1024 && !budgets.has(input.manifest))
    )
      return fail('Relay read limit reached', 429);
    budgets.set(input.manifest, budget);
    budget.calls++;
    budget.active++;
    active++;
    const lifetime = new AbortController();
    const group = new Subscription();
    let stopped = false;
    let output: ReadableStreamDefaultController<Uint8Array>;
    const close = () => {
      if (stopped) return;
      stopped = true;
      active--;
      budget.active--;
      request.signal.removeEventListener('abort', close);
      lifetime.abort();
      group.unsubscribe();
      try {
        output?.close();
      } catch {
        /* Reader cancellation already closed the stream. */
      }
    };
    request.signal.addEventListener('abort', close, { once: true });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        output = controller;
        const encoder = new TextEncoder();
        let total = 0,
          messages = 0;
        const send = (message: unknown) => {
          if (stopped) return;
          const bytes = encoder.encode(JSON.stringify(message) + '\n');
          if (
            bytes.length > 70000 ||
            (total += bytes.length) > 8 * 1024 ** 2 ||
            ++messages > 2000 ||
            (output.desiredSize ?? 0) < -16
          ) {
            close();
            return;
          }
          output.enqueue(bytes);
        };
        const timeout = setTimeout(
          () => {
            send({ type: 'CLOSED', reason: 'Relay read deadline reached' });
            close();
          },
          input.live ? 300000 : input.timeoutMs,
        );
        const heartbeat = setInterval(() => send({ type: 'PING' }), 20000);
        group.add(() => {
          clearTimeout(timeout);
          clearInterval(heartbeat);
        });
        void open(input.relay, lifetime.signal)
          .then((pool) => {
            group.add(() => pool.close());
            if (stopped) return;
            group.add(
              pool
                .req([input.relay], input.filters)
                .subscribe({
                  next(message) {
                    if (message.type === 'EVENT') send({ type: 'EVENT', event: message.event });
                    if (message.type === 'EOSE') {
                      send({ type: 'EOSE' });
                      if (!input.live) close();
                    }
                    if (message.type === 'CLOSED') {
                      send({ type: 'CLOSED', reason: 'Relay refused the read' });
                      close();
                    }
                  },
                  error() {
                    send({ type: 'CLOSED', reason: 'Relay connection failed' });
                    close();
                  },
                  complete: close,
                }),
            );
          })
          .catch(() => {
            send({ type: 'CLOSED', reason: 'Relay connection failed or destination blocked' });
            close();
          });
        if (request.signal.aborted) close();
      },
      cancel: close,
    });
    return new Response(body, {
      headers: { ...headers, 'Content-Type': 'application/x-ndjson', 'X-Accel-Buffering': 'no' },
    });
  };
}
