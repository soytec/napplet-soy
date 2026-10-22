import { z } from 'zod';
import { readBytes } from '../../../packages/client/src/bytes';
import { diagnose } from '../../../packages/diagnostics/src';
import type { StudioSessions } from './sessions';
import type { StudioTransfers } from './transfers';
import type { BackendProvider } from '../../../packages/multiplayer/src/client';

/** HTTPS carries only account authorization and private binary transfers.
 * Editing/build/signing/publication commands use encrypted CVM. */
export function studioHttp(options: {
  origin: string;
  provider: BackendProvider;
  sessions: StudioSessions;
  transfers: StudioTransfers;
}) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  };
  let authorizations = 0,
    windowStart = Date.now(),
    uploads = 0;
  return async (request: Request) => {
    const url = new URL(request.url);
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
    if (
      url.origin !== options.origin ||
      (request.headers.has('Origin') && request.headers.get('Origin') !== options.origin) ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site'
    )
      return json({ error: 'Forbidden origin.' }, 403);
    try {
      if (url.pathname === '/api/studio/config' && request.method === 'GET')
        return json({ provider: options.provider });
      if (url.pathname === '/api/studio/session' && request.method === 'POST') {
        if (Date.now() - windowStart > 60000) {
          windowStart = Date.now();
          authorizations = 0;
        }
        if (++authorizations > 60)
          return json({ error: 'Too many connection attempts. Try again in a minute.' }, 429);
        const body = new TextDecoder().decode(await readBytes(new Response(request.body), 1024));
        const session = await options.sessions.authorize(
          request.headers.get('Authorization') ?? '',
          body,
        );
        return json({ token: session.token, expires: session.expires });
      }
      const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      const session = options.sessions.bearer(token ?? '');
      if (url.pathname === '/api/studio/session' && request.method === 'DELETE') {
        options.sessions.revoke(session.client);
        return json({ ok: true });
      }
      if (url.pathname === '/api/studio/transfers' && request.method === 'POST') {
        if (request.headers.get('Content-Type') !== 'application/octet-stream')
          return json({ error: 'Binary transfer required.' }, 400);
        if (uploads >= 4) return json({ error: 'Transfer service busy. Retry shortly.' }, 429);
        uploads++;
        try {
          const bytes = await readBytes(new Response(request.body), 32 * 1024 * 1024);
          // A session can be revoked while the body is streaming.
          options.sessions.bearer(token!);
          return json({ id: options.transfers.put(session.owner, bytes) });
        } finally {
          uploads--;
        }
      }
      const id = /^\/api\/studio\/transfers\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
      if (id && request.method === 'GET') {
        z.uuid().parse(id);
        const entry = options.transfers.get(session.owner, id);
        return new Response(new Uint8Array(entry.bytes), {
          headers: { ...headers, 'Content-Type': entry.mime },
        });
      }
      if (id && request.method === 'DELETE') {
        options.transfers.remove(session.owner, id);
        return json({ ok: true });
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      const d = diagnose(error, 'Studio authorization');
      return json(
        {
          error: d.code.startsWith('STUDIO_') ? d.message : 'Invalid Studio request.',
          code: d.code,
        },
        d.code === 'STUDIO_AUTH' ? 401 : 400,
      );
    }
  };
}
