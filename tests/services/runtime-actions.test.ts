import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  finalizeEvent,
  getPublicKey,
  matchFilters,
  nip19,
  verifyEvent,
  type NostrEvent,
} from 'nostr-tools';
import { sha256 } from '../../packages/protocol/src';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';

// Offline identities and transports. No real user's account or public relay is involved.
test('real shim: file imports, lists, follows, reactions/reports and direct Blossom uploads work in preview and website', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-runtime-actions-'));
  const creator = new Uint8Array(32).fill(24),
    viewer = new Uint8Array(32).fill(25);
  const pubkey = getPublicKey(viewer),
    events: NostrEvent[] = [];
  const html = '<!doctype html><title>Actions fixture</title><h1>Interactive specimen</h1>';
  const bytes = new TextEncoder().encode(html),
    artifactHash = await sha256(bytes);
  const blobs = new Map([[artifactHash, bytes]]);
  let puts = 0;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SHA-256',
  };
  const storage = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const path = new URL(request.url).pathname;
      if (path === '/upload' && request.method === 'PUT') {
        const auth = JSON.parse(atob(request.headers.get('authorization')!.slice(6)));
        const data = new Uint8Array(await request.arrayBuffer()),
          hash = await sha256(data);
        if (
          !verifyEvent(auth) ||
          auth.pubkey !== pubkey ||
          !auth.tags.some((t: string[]) => t[0] === 'x' && t[1] === hash)
        )
          return new Response('bad auth', { status: 403, headers: cors });
        puts++;
        blobs.set(hash, data);
        return Response.json(
          { sha256: hash, size: data.length, url: `http://127.0.0.1:${storage.port}/${hash}` },
          { status: 201, headers: cors },
        );
      }
      const data = blobs.get(path.slice(1));
      return new Response(data ?? null, { status: data ? 200 : 404, headers: cors });
    },
  });
  const blossom = `http://127.0.0.1:${storage.port}`;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (r, server) => (server.upgrade(r) ? undefined : new Response()),
    websocket: {
      message(ws, raw) {
        const [type, value, ...filters] = JSON.parse(String(raw));
        if (type === 'REQ') {
          // Sort newest first and apply each filter's limit like a normal relay.
          const matching = new Map<string, NostrEvent>();
          for (const filter of filters)
            for (const e of events
              .filter((e) => matchFilters([filter], e))
              .sort((a, b) => b.created_at - a.created_at)
              .slice(0, filter.limit ?? 100))
              matching.set(e.id, e);
          for (const e of matching.values()) ws.send(JSON.stringify(['EVENT', value, e]));
          ws.send(JSON.stringify(['EOSE', value]));
        } else if (type === 'EVENT') {
          const valid = verifyEvent(value);
          if (valid) events.push(value);
          ws.send(JSON.stringify(['OK', value.id, valid, '']));
        }
      },
    },
  });
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const manifest = finalizeEvent(
    {
      kind: 35129,
      content: '',
      created_at: Math.floor(Date.now() / 1000) - 20,
      tags: [
        ['d', 'action-test'],
        ['title', 'Actions fixture'],
        ['path', '/index.html', artifactHash],
        ['server', blossom],
        ...['fs', 'upload', 'common', 'lists'].map((domain) => ['requires', domain]),
      ],
    },
    creator,
  );
  events.push(manifest);
  let preview: ReturnType<typeof startPreviewServer> | undefined,
    web: ReturnType<typeof Bun.spawn> | undefined;
  const browser = await chromium.launch();
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Actions fixture',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        relays: [relayUrl],
        servers: [blossom],
      }),
    );
    await Bun.write(join(root, 'index.html'), html);
    preview = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    web = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        SPACE_PUBLICDEV: '0',
        SPACE_INDEX_DIR: '',
        SPACE_COMMUNITY_DIR: join(root, 'community'),
        SPACE_INDEX_RELAYS: relayUrl,
        SPACE_INDEX_LOCAL_BLOSSOM: blossom,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const reader = (web.stdout as ReadableStream<Uint8Array>).getReader();
    let output = '',
      webOrigin = '';
    while (!webOrigin) {
      const part = await reader.read();
      if (part.done)
        throw new Error(
          'Website exited: ' + (await new Response(web.stderr as ReadableStream).text()),
        );
      output += new TextDecoder().decode(part.value);
      webOrigin = /listening on (http:\/\/[^\s/]+)/.exec(output)?.[1] ?? '';
    }
    reader.releaseLock();
    for (const mode of ['preview', 'website']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      page.setDefaultTimeout(12000);
      await page.exposeFunction('fixtureSign', (template: any) => finalizeEvent(template, viewer));
      await page.addInitScript(
        ({ pubkey, relayUrl, blossom }) => {
          if (window !== top) return;
          localStorage.setItem(
            'napplet:network',
            JSON.stringify({ relays: [relayUrl], blossom: [blossom] }),
          );
          (window as any).nostr = {
            getPublicKey: async () => pubkey,
            signEvent: (t: any) => (window as any).fixtureSign(t),
          };
        },
        { pubkey, relayUrl, blossom },
      );
      await page.goto(
        mode === 'preview'
          ? preview.url.href
          : `${webOrigin}/n/${nip19.naddrEncode({ kind: 35129, pubkey: manifest.pubkey, identifier: 'action-test', relays: [relayUrl] })}`,
      );
      if (mode === 'website') {
        await page.locator('.player-cover').click();
      }
      await ui(
        page.frameLocator('iframe').getByRole('heading', { name: 'Interactive specimen' }),
      ).toBeVisible();
      const frame = page.frames().find((f) => f.parentFrame())!;
      const call = (script: string) => frame.evaluate(async (s) => (0, eval)(s), script);
      const support = await call('napplet.lists.supported()');
      expect(support.some((s: any) => s.kind === 10003)).toBe(true);
      expect(
        await call('napplet.common.follow("' + nip19.npubEncode(manifest.pubkey) + '")'),
      ).toMatchObject({ ok: false, error: 'not-signed-in' });
      const pick = call('napplet.fs.pickFile({accept:[{extension:".txt"}]})');
      await page.getByLabel('Choose files for napplet').setInputFiles({
        name: 'hello.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('user-selected bytes'),
      });
      const selected = await pick;
      expect(
        await call(`napplet.fs.read(${JSON.stringify(selected.entries[0].path)})`),
      ).toMatchObject({ data: btoa('user-selected bytes') });
      if (mode === 'website') {
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
      await ui.poll(() => call('napplet.identity.getPublicKey()')).toBe(pubkey);
      // An explicit host cancellation has no side effects.
      const before = events.length;
      const denied = call(`napplet.common.react(${JSON.stringify(manifest.id)}, "+")`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await denied).toMatchObject({ ok: false, error: 'user-denied' });
      expect(events.length).toBe(before);
      for (const script of [
        `napplet.common.react(${JSON.stringify(manifest.id)}, "🚀")`,
        `napplet.common.report({type:"event",id:${JSON.stringify(manifest.id)}}, "other", "Offline fixture")`,
        `napplet.lists.add({kind:30000,identifier:${JSON.stringify(mode)}}, [{itemType:"pubkey",value:${JSON.stringify(manifest.pubkey)}}], {create:true,title:"Friends"})`,
        ...(mode === 'preview'
          ? [`napplet.common.follow(${JSON.stringify(nip19.npubEncode(manifest.pubkey))})`]
          : []),
      ]) {
        const action = call(script);
        await ui(page.getByRole('button', { name: 'Approve & publish' })).toBeVisible();
        await page.getByRole('button', { name: 'Approve & publish' }).click();
        expect(await action).toMatchObject({ ok: true });
      }
      const initial = await call(
        `napplet.upload.upload({ data: new Blob(["uploaded from ${mode}"], {type:"text/plain"}), filename:"hello.txt", noTransform:true })`,
      );
      expect(initial.status).toBe('uploading');
      await page.getByRole('button', { name: 'Approve upload' }).click();
      await ui
        .poll(() =>
          call(`napplet.upload.status(${JSON.stringify(initial.uploadId)})`).then(
            (s: any) => s.status,
          ),
        )
        .toBe('complete');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(await call('typeof window.nostr')).toBe('undefined');
      await page.close();
    }
    expect(puts).toBe(2);
    expect(events.filter((e) => e.kind === 7)).toHaveLength(2);
    expect(events.filter((e) => e.kind === 1984)).toHaveLength(2);
    expect(events.filter((e) => e.kind === 30000)).toHaveLength(2);
  } finally {
    await browser.close();
    preview?.stop(true);
    web?.kill();
    if (web) await web.exited;
    relay.stop(true);
    storage.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
