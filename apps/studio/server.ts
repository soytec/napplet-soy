import { MAX_ASSET_BYTES } from '../../packages/assets/src';
import { z } from 'zod';
import { readBytes } from '../../packages/client/src/bytes';
import { diagnose, formatDiagnostic } from '../../packages/diagnostics/src';
import type { StudioSurface } from './surface';
import { proposalInput } from './proposal';
import { listingSchema } from './publication';
import { localHost, studioRoute, validSource } from './navigation';
import { browserBuildLimits } from './browser-build-contract';

const promptSchema = z.object({ prompt: z.string().trim().min(1).max(10000) }).strict();
const createSchema = promptSchema.extend({
  title: z.string().trim().min(1).max(80),
  source: z
    .string()
    .trim()
    .max(4096)
    .refine(validSource, 'Use an HTTPS napplet link, Nostr identifier or loopback HTTP link.')
    .optional(),
});
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
          if (request.method === 'GET') {
            if (url.pathname === '/api/state') return json(await studio.state());
            const browserBuild = /^\/api\/browser-builds\/([a-f0-9-]{36})$/.exec(url.pathname);
            if (browserBuild)
              return json(
                await studio.browserBuilds.next(
                  browserBuild[1],
                  url.searchParams.get('base') ?? undefined,
                ),
              );
            const signing = /^\/api\/signers\/([a-f0-9-]{36})$/.exec(url.pathname);
            if (signing) return json(await studio.signing.next(signing[1]));
            const match =
              /^\/api\/projects\/([a-f0-9-]{36})\/(files|file|diff|preview|listing|media|assets|asset)$/.exec(
                url.pathname,
              );
            if (match) {
              const [, id, action] = match;
              if (action === 'assets') return json(await studio.assets(id));
              if (action === 'asset') {
                const asset = await studio.assetMedia(id, url.searchParams.get('name') ?? '');
                return new Response(asset.bytes, {
                  headers: {
                    ...headers,
                    'Content-Type': asset.mime,
                    'Content-Disposition': 'inline',
                  },
                });
              }
              if (action === 'files') return json(await studio.files(id));
              if (action === 'file')
                return json(await studio.file(id, url.searchParams.get('path') ?? ''));
              if (action === 'diff') return json(await studio.diff(id));
              if (action === 'preview') return json({ url: await studio.preview(id) });
              if (action === 'listing') return json(await studio.listing(id));
              if (action === 'media') {
                const media = await studio.publicationMedia(
                  id,
                  url.searchParams.get('review') ?? '',
                  url.searchParams.get('name') ?? '',
                );
                return new Response(media.bytes, {
                  headers: { ...headers, 'Content-Type': media.mime },
                });
              }
            }
          }
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
              let result: unknown;
              if (/^\/api\/browser-builds\/[a-f0-9-]{36}$/.test(url.pathname)) {
                await studio.browserBuilds.reply(url.pathname.split('/').pop()!, body);
                result = { ok: true };
              } else if (/^\/api\/connections\/(save|select|remove|test)$/.test(url.pathname)) {
                result = await studio.connectionAction(url.pathname.split('/').pop()!, body);
              } else if (url.pathname === '/api/signers') {
                result = await studio.signing.connect(
                  z
                    .object({ pubkey: z.string().regex(/^[a-f0-9]{64}$/) })
                    .strict()
                    .parse(body).pubkey,
                );
              } else if (/^\/api\/signers\/([a-f0-9-]{36})$/.test(url.pathname)) {
                const input = z
                  .object({ requestId: z.uuid(), event: z.unknown().optional() })
                  .strict()
                  .parse(body);
                await studio.signing.reply(
                  url.pathname.split('/').pop()!,
                  input.requestId,
                  input.event,
                );
                result = { ok: true };
              } else if (url.pathname === '/api/projects') {
                const input = createSchema.parse(body);
                result = { id: await studio.create(input.title, input.prompt, input.source) };
              } else {
                const match =
                  /^\/api\/projects\/([a-f0-9-]{36})\/(messages|stop|check|restore|prepare-publication|publish|prepare-proposal|propose|refresh-publication|fix-publication)$/.exec(
                    url.pathname,
                  );
                if (!match) return json({ error: 'Not found.' }, 404);
                const [, id, action] = match;
                if (action === 'messages') {
                  const input = promptSchema
                    .extend({ browserSession: z.uuid().optional() })
                    .parse(body);
                  await studio.send(id, input.prompt, input.browserSession);
                }
                if (action === 'prepare-publication') {
                  const input = z
                    .object({ session: z.uuid(), listing: listingSchema })
                    .strict()
                    .parse(body);
                  await studio.preparePublication(id, input.session, input.listing);
                }
                if (action === 'prepare-proposal') {
                  const input = z
                    .object({ session: z.uuid(), proposal: proposalInput })
                    .strict()
                    .parse(body);
                  await studio.prepareProposal(id, input.session, input.proposal);
                }
                if (action === 'publish' || action === 'propose') {
                  const input = z
                    .object({
                      session: z.uuid(),
                      review: z.uuid(),
                      resume: z.boolean(),
                      confirmed: z.literal(true),
                    })
                    .strict()
                    .parse(body);
                  if (action === 'propose')
                    await studio.propose(id, input.session, input.review, input.resume);
                  else await studio.publish(id, input.session, input.review, input.resume);
                }
                if (action === 'refresh-publication' || action === 'fix-publication') {
                  z.object({}).strict().parse(body);
                  if (action === 'refresh-publication') await studio.refreshPublication(id);
                  else await studio.fixPublication(id);
                }
                if (action === 'stop') {
                  z.object({}).strict().parse(body);
                  await studio.stop(id);
                }
                if (action === 'check') {
                  const input = z
                    .object({ browserSession: z.uuid().optional() })
                    .strict()
                    .parse(body);
                  await studio.check(id, input.browserSession);
                }
                if (action === 'restore')
                  await studio.restore(
                    id,
                    z
                      .object({ commit: z.string().regex(/^[a-f0-9]{40}$/) })
                      .strict()
                      .parse(body).commit,
                  );
                result = { ok: true };
              }
              return json(result);
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
