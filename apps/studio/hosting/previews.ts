import { pathToFileURL } from 'node:url';
import { startPreviewServer } from '../../cli/src/preview/server';
import { previewAssets } from '../../cli/src/preview/assets';
import { studioPreviewHtml } from '../preview-layout';
import { DiagnosticError } from '../../../packages/diagnostics/src';
import type { StudioSessions } from './sessions';

/** Trusted preview host around the existing opaque-origin napplet sandbox.
 * An HttpOnly, path-scoped grant protects source; user HTML is never served as a page. */
export class HostedPreviews {
  private previews = new Map<
    string,
    { owner: string; server: ReturnType<typeof startPreviewServer> }
  >();
  private grants = new Map<string, { id: string; client: string; expires: number }>();
  private cookies = new Map<string, { id: string; client: string }>();
  constructor(
    private origin: string,
    private sessions: StudioSessions,
  ) {}
  async open(owner: string, directory: string) {
    if (this.previews.size >= 128)
      throw new DiagnosticError(
        'STUDIO_PREVIEW',
        'The host has too many open previews. Try again later.',
      );
    const assets = await previewAssets();
    const server = startPreviewServer(
      pathToFileURL(directory + '/'),
      0,
      false,
      { ...assets, html: studioPreviewHtml(assets.html) },
      { network: 'public', readOnly: true },
    );
    const id = crypto.randomUUID();
    this.previews.set(id, { owner, server });
    return {
      url: this.origin + '/api/studio/preview/' + id + '/',
      stop: () => {
        server.stop(true);
        this.previews.delete(id);
        for (const [key, entry] of this.cookies) if (entry.id === id) this.cookies.delete(key);
        for (const [key, entry] of this.grants) if (entry.id === id) this.grants.delete(key);
      },
    };
  }
  grant(owner: string, client: string, url: string) {
    const id = new URL(url).pathname.match(/^\/api\/studio\/preview\/([a-f0-9-]{36})\/$/)?.[1];
    if (!id || this.previews.get(id)?.owner !== owner)
      throw new DiagnosticError('STUDIO_PREVIEW', 'This preview is unavailable.');
    for (const [key, value] of this.grants) if (value.expires < Date.now()) this.grants.delete(key);
    if (this.grants.size >= 512)
      throw new DiagnosticError('STUDIO_PREVIEW', 'Too many preview requests. Retry shortly.');
    const access = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
    this.grants.set(access, { id, client, expires: Date.now() + 60000 });
    return url + '?access=' + access;
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const headers = {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    };
    const denied = () =>
      new Response('Reconnect Studio to open this private preview.', { status: 403, headers });
    const match = /^\/api\/studio\/preview\/([a-f0-9-]{36})(\/.*)$/.exec(url.pathname);
    if (
      !match ||
      request.method !== 'GET' ||
      url.origin !== this.origin ||
      request.headers.get('Sec-Fetch-Site') === 'cross-site'
    )
      return denied();
    const [, id, path] = match;
    const entry = this.previews.get(id);
    if (!entry) return denied();
    const cookieName = '__Secure-studio-preview-' + id;
    const cookie = request.headers
      .get('Cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1);
    const existing = cookie ? this.cookies.get(cookie) : undefined;
    let authorized = false;
    try {
      authorized =
        !!existing &&
        existing.id === id &&
        this.sessions.client(existing.client).owner === entry.owner;
    } catch {
      /* expired */
    }
    const access = url.searchParams.get('access');
    if (access) {
      const grant = this.grants.get(access);
      this.grants.delete(access);
      if (!grant || grant.id !== id || grant.expires < Date.now()) {
        if (!authorized) return denied();
        url.searchParams.delete('access');
        return new Response(null, { status: 302, headers: { ...headers, Location: url.href } });
      }
      try {
        if (this.sessions.client(grant.client).owner !== entry.owner) return denied();
      } catch {
        return denied();
      }
      for (const [key, value] of this.cookies) {
        try {
          this.sessions.client(value.client);
          if (value.client === grant.client && value.id === id) this.cookies.delete(key);
        } catch {
          this.cookies.delete(key);
        }
      }
      if (this.cookies.size >= 512) return denied();
      const cookie = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
      this.cookies.set(cookie, { id, client: grant.client });
      url.searchParams.delete('access');
      return new Response(null, {
        status: 302,
        headers: {
          ...headers,
          Location: url.href,
          'Set-Cookie': `${cookieName}=${cookie}; Path=/api/studio/preview/${id}/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`,
        },
      });
    }
    if (!authorized) return denied();
    // No manager, workshop, arbitrary path or mutation can enter the preview proxy.
    if (
      !/^\/(?:runtime\.js|revision|artifacts\/[a-f0-9]{64}|[a-f0-9]{64}(?:\.[a-z0-9]+)?)?$/.test(
        path,
      )
    )
      return denied();
    const response = await entry.server.fetch(
      new Request(new URL(path, entry.server.url), { signal: request.signal }),
    );
    const resultHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(headers)) resultHeaders.set(key, value);
    if (path === '/revision' && response.ok) {
      const revision = await response.json();
      revision.servers = revision.servers.map((s: string) =>
        s === entry.server.url.origin ? `${this.origin}/api/studio/preview/${id}` : s,
      );
      return Response.json(revision, { headers: resultHeaders });
    }
    return new Response(response.body, { status: response.status, headers: resultHeaders });
  }
  close() {
    for (const entry of this.previews.values()) entry.server.stop(true);
    this.previews.clear();
    this.grants.clear();
    this.cookies.clear();
  }
}
