import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { finalizeEvent, generateSecretKey, getPublicKey, nip19, matchFilters } from 'nostr-tools';

export const currentPajaPath = resolve(
  process.env.SOY_CURRENT_PAJA ?? '.local/current-shell/client/node_modules/@kehto/paja',
);

/** Only fixture relay/Blossom transport. All resolution, verification, CSP, injection,
 * permissions and NAP dispatch belong to the unchanged independent host. */
export async function currentShell(
  html: string,
  options: { absent?: boolean; corrupt?: boolean } = {},
) {
  const pkg = await Bun.file(join(currentPajaPath, 'package.json')).json();
  if (pkg.version !== '0.24.4') throw new Error(`Expected Paja 0.24.4, got ${pkg.version}`);
  const paja = await import(pathToFileURL(join(currentPajaPath, 'dist/index.js')).href);
  const hash = new Bun.CryptoHasher('sha256').update(html).digest('hex');
  let event: ReturnType<typeof finalizeEvent>;
  let host = '';
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === '/relay' && server.upgrade(request)) return;
      const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      if (path === `/${hash}` || path === `/${hash}.html`) {
        requests.push(path);
        return new Response(options.corrupt ? html + ' ' : html, {
          headers: { ...headers, 'content-type': 'text/html' },
        });
      }
      if (path.endsWith('/browser-host.js'))
        return new Response(Bun.file(join(currentPajaPath, 'dist/browser-host.js')), {
          headers: { ...headers, 'content-type': 'text/javascript' },
        });
      if (path === '/')
        return new Response(host, { headers: { ...headers, 'content-type': 'text/html' } });
      return new Response('Not found', { status: 404, headers });
    },
    websocket: {
      message(ws, raw) {
        const [type, id, ...filters] = JSON.parse(String(raw));
        if (type !== 'REQ') return;
        if (matchFilters(filters, event)) ws.send(JSON.stringify(['EVENT', id, event]));
        ws.send(JSON.stringify(['EOSE', id]));
      },
    },
  });
  const url = server.url.origin,
    relay = url.replace('http:', 'ws:') + '/relay';
  const key = generateSecretKey();
  event = finalizeEvent(
    {
      kind: 35129,
      created_at: Math.floor(Date.now() / 1000),
      content: 'Independent current-manifest interaction fixture.',
      tags: [
        ['d', 'current-shell-fixture'],
        ['x', hash],
        ['server', url],
        // Intentional optional source extension must not become a playback gate.
        [
          'source',
          `nostr://${nip19.npubEncode(getPublicKey(key))}/${encodeURIComponent(relay)}/fixture`,
        ],
      ],
    },
    key,
  );
  const config = paja.createPajaRuntimeHostConfig({
    pointer: nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: 'current-shell-fixture',
      relays: [relay],
    }),
    relays: [relay],
    blossomServers: [url],
    maxWaitMs: 4000,
    simulation: {
      relay: { mode: 'live', urls: [relay] },
      acl: { mode: 'allow' },
      capabilities: options.absent ? { domains: { storage: false, media: false } } : undefined,
    },
  });
  host = paja.renderPajaHtml(config);
  return { url, hash, event, requests, close: () => server.stop(true) };
}
