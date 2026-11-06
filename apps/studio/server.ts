import { MAX_ASSET_BYTES } from '../../packages/assets/src';
import { readBytes } from '../../packages/client/src/bytes';
import { diagnose, formatDiagnostic } from '../../packages/diagnostics/src';
import type { StudioSurface } from './surface';
import { dispatchStudio } from './dispatch';
import { localHost, studioRoute } from './navigation';
import { browserBuildLimits } from './browser-build-contract';

function withHeaders(response: Response, headers: Record<string, string>) {
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
export async function serveStudio(
  studio: StudioSurface,
  port = 4195,
  shellOrigin = 'http://127.0.0.1:3000',
) {
  const shell = new URL(shellOrigin);
  if (
    shell.protocol !== 'http:' ||
    !localHost(shell.hostname) ||
    shell.username ||
    shell.password ||
    shell.pathname !== '/' ||
    shell.search ||
    shell.hash
  )
    throw new Error('The local Studio shell must be an HTTP loopback origin.');
  const token = crypto.randomUUID();
  const headers = {
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': shell.origin,
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src blob:; connect-src 'self'; frame-src http://127.0.0.1:*; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
  const responses = new Map<string, { fingerprint: string; result: Promise<Response> }>();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    idleTimeout: 30,
    maxRequestBodySize: MAX_ASSET_BYTES,
    async fetch(request) {
      const url = new URL(request.url);
      const origin = server.url.origin;
      const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
      if (
        url.origin !== origin ||
        (request.headers.has('Origin') &&
          ![origin, shell.origin].includes(request.headers.get('Origin')!))
      )
        return json({ error: 'Forbidden origin.' }, 403);
      const document = request.method === 'GET' && studioRoute(url).view !== 'missing';
      const navigation =
        document &&
        request.headers.get('Sec-Fetch-Mode') === 'navigate' &&
        request.headers.get('Sec-Fetch-Dest') === 'document';
      if (
        request.headers.get('Sec-Fetch-Site') === 'cross-site' &&
        !navigation &&
        request.headers.get('Origin') !== shell.origin
      )
        return json({ error: 'Cross-site access is not allowed.' }, 403);
      try {
        if (
          request.method === 'OPTIONS' &&
          request.headers.get('Origin') === shell.origin &&
          url.pathname.startsWith('/api/')
        )
          return new Response(null, {
            status: 204,
            headers: {
              ...headers,
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers':
                'Content-Type, X-Studio-Token, X-Request-ID, X-Asset-Info',
            },
          });
        if (request.method === 'GET' && url.pathname === '/api/session') return json({ token });
        if (url.pathname.startsWith('/api/')) {
          if (request.headers.get('X-Studio-Token') !== token)
            return json({ error: 'Reload the studio to reconnect.' }, 403);
          if (request.method === 'GET')
            return await dispatchStudio(studio, url.pathname.slice(5) + url.search).then((r) =>
              withHeaders(r, headers),
            );
          if (
            request.method === 'POST' &&
            /^\/api\/projects\/[a-f0-9-]{36}\/assets$/.test(url.pathname)
          ) {
            if (
              ![origin, shell.origin].includes(request.headers.get('Origin') ?? '') ||
              request.headers.get('Content-Type') !== 'application/octet-stream'
            )
              return json({ error: 'Same-origin file upload required.' }, 403);
            const metadata = request.headers.get('X-Asset-Info') ?? '';
            if (metadata.length > 8192) return json({ error: 'Asset metadata is too large.' }, 400);
            const bytes = await readBytes(new Response(request.body), MAX_ASSET_BYTES);
            const input = JSON.parse(decodeURIComponent(metadata));
            return json(await studio.importAsset(url.pathname.split('/')[3], input, bytes));
          }
          if (request.method === 'POST') {
            if (
              ![origin, shell.origin].includes(request.headers.get('Origin') ?? '') ||
              request.headers.get('Content-Type') !== 'application/json'
            )
              return json({ error: 'Same-origin JSON required.' }, 403);
            const body = JSON.parse(
              new TextDecoder().decode(
                await readBytes(
                  new Response(request.body),
                  /^\/api\/browser-builds\/[a-f0-9-]{36}$/.test(url.pathname)
                    ? browserBuildLimits.outputBytes + 1024 * 1024
                    : /^\/api\/signers\/[a-f0-9-]{36}$/.test(url.pathname)
                      ? 128 * 1024
                      : url.pathname === '/api/connections/llm-start'
                        ? 8 * 1024 * 1024
                        : 16384,
                ),
              ),
            );
            const key = request.headers.get('X-Request-ID');
            if (!key || !/^[a-f0-9-]{36}$/.test(key))
              return json({ error: 'Missing request ID.' }, 400);
            const fingerprint = new Bun.CryptoHasher('sha256')
              .update(url.pathname + JSON.stringify(body))
              .digest('hex');
            const cached = responses.get(key);
            if (cached)
              return cached.fingerprint === fingerprint
                ? (await cached.result).clone()
                : json({ error: 'Request ID already used.' }, 409);
            const response = (async () => {
              return withHeaders(
                await dispatchStudio(studio, url.pathname.slice(5) + url.search, body),
                headers,
              );
            })();
            responses.set(key, { fingerprint, result: response });
            // Cache the in-flight request too: separate IPC calls must not duplicate a click.
            try {
              const result = await response;
              if (responses.size > 500) responses.delete(responses.keys().next().value!);
              return result.clone();
            } catch (error) {
              responses.delete(key);
              throw error;
            }
          }
          return json({ error: 'Not found.' }, 404);
        }
        if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
        // Old local bookmarks lead to the shell; this listener owns execution only.
        if (document) {
          const target = new URL(url.pathname + url.search, shell);
          if (target.pathname === '/') target.pathname = '/studio';
          if (target.pathname === '/create') target.pathname = '/studio/create';
          return new Response(null, {
            status: 302,
            headers: { ...headers, Location: target.href },
          });
        }
        if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
        return json({ error: 'Not found.' }, 404);
      } catch (error) {
        const diagnostic = diagnose(error, 'local studio');
        return json(
          { error: formatDiagnostic(diagnostic), diagnostic },
          diagnostic.code === 'STUDIO_BUSY' ? 409 : 400,
        );
      }
    },
  });
  return server;
}
