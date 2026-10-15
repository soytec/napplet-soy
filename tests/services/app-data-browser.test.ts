import { test, expect } from 'bun:test';
import { chromium, expect as ui, type Page } from '@playwright/test';
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
import { creatorSkills } from '../../apps/cli/src/creator-kit';

test('shipped app-data helper: independent viewers share, update, retry and unpublish through the real shim in preview and website', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-app-data-'));
  const creator = new Uint8Array(32).fill(40),
    alice = new Uint8Array(32).fill(41),
    bob = new Uint8Array(32).fill(42);
  const events: NostrEvent[] = [];
  let refuse = false;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (r, server) => (server.upgrade(r) ? undefined : new Response()),
    websocket: {
      message(ws, raw) {
        const [type, value, ...filters] = JSON.parse(String(raw));
        if (type === 'REQ') {
          const matches = new Map<string, NostrEvent>();
          for (const filter of filters)
            for (const event of events
              .filter((e) => matchFilters([filter], e))
              .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
              .slice(0, filter.limit ?? 100))
              matches.set(event.id, event);
          for (const event of matches.values()) ws.send(JSON.stringify(['EVENT', value, event]));
          ws.send(JSON.stringify(['EOSE', value]));
        } else if (type === 'EVENT') {
          const valid = verifyEvent(value) && !(refuse && value.kind === 30078);
          if (valid && !events.some((e) => e.id === value.id)) events.push(value);
          ws.send(
            JSON.stringify([
              'OK',
              value.id,
              valid,
              valid ? '' : 'restricted: fixture storage is full',
            ]),
          );
        }
      },
    },
  });
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  for (const path of ['docs/examples/app-data.ts', 'docs/examples/app-data-contract.ts'])
    await Bun.write(join(root, path.split('/').at(-1)!), creatorSkills()[path]);
  await Bun.write(
    join(root, 'entry.ts'),
    `
    import { appDataCollection } from './app-data';
    globalThis.tracks = appDataCollection({collection:'tracks', schema:'example.track',version:1,
      validate(value) {
        if(!value || !Array.isArray(value.points) || !value.points.every(Number.isFinite)) throw new Error('Invalid track points');
        return value;
      }
    });
  `,
  );
  const build = await Bun.build({
    entrypoints: [join(root, 'entry.ts')],
    target: 'browser',
    format: 'iife',
  });
  expect(build.success).toBe(true);
  const script = await build.outputs[0].text();
  const html = `<!doctype html><title>Shared creations fixture</title><h1>Shared creations</h1><script>${script.replaceAll('</script', '<\\/script')}</script>`;
  const bytes = new TextEncoder().encode(html),
    artifact = await sha256(bytes);
  const storage = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (r) =>
      new URL(r.url).pathname === `/${artifact}`
        ? new Response(bytes, {
            headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/html' },
          })
        : new Response(null, { status: 404 }),
  });
  const blossom = `http://127.0.0.1:${storage.port}`;
  const manifest = finalizeEvent(
    {
      kind: 35129,
      created_at: Math.floor(Date.now() / 1000) - 10,
      content: '',
      tags: [
        ['d', 'shared-data'],
        ['title', 'Shared creations'],
        ['path', '/index.html', artifact],
        ['server', blossom],
        ['requires', 'outbox'],
        ['requires', 'identity'],
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
        name: 'Shared creations',
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
      origin = '';
    while (!origin) {
      const part = await reader.read();
      if (part.done)
        throw new Error(
          'Website exited: ' + (await new Response(web.stderr as ReadableStream).text()),
        );
      output += new TextDecoder().decode(part.value);
      origin = /listening on (http:\/\/[^\s/]+)/.exec(output)?.[1] ?? '';
    }
    reader.releaseLock();
    const route = `${origin}/n/${nip19.naddrEncode({ kind: 35129, pubkey: manifest.pubkey, identifier: 'shared-data', relays: [relayUrl] })}`;
    const call = async (page: Page, source: string) => {
      const frame = page.frames().find((f) => f.parentFrame())!;
      return frame.evaluate(async (s) => (0, eval)(s), source);
    };
    const open = async (page: Page, url: string, website: boolean) => {
      await page.goto(url);
      if (website) await page.locator('.player-cover').click();
      await ui(
        page.frameLocator('iframe').getByRole('heading', { name: 'Shared creations' }),
      ).toBeVisible();
      await call(page, 'tracks.then(t=>{globalThis.records=t; return t.policy})');
    };
    const connect = async (page: Page, key: Uint8Array, website: boolean) => {
      if ((await call(page, 'napplet.identity.getPublicKey()')) === getPublicKey(key)) return;
      if (website) {
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
      }
      await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
      await ui.poll(() => call(page, 'napplet.identity.getPublicKey()')).toBe(getPublicKey(key));
    };
    const publish = async (page: Page, expression: string) => {
      const pending = call(page, expression);
      await page.getByRole('button', { name: 'Approve & publish', exact: true }).click();
      return pending;
    };
    for (const mode of ['preview', 'website']) {
      const website = mode === 'website',
        url = website ? route : preview.url.href;
      const contexts = await Promise.all(
        [alice, bob].map(async (key) => {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
          await context.exposeFunction('fixtureSign', (template: any) =>
            finalizeEvent(template, key),
          );
          await context.addInitScript(
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
            { pubkey: getPublicKey(key), relayUrl, blossom },
          );
          return context;
        }),
      );
      try {
        const a = await contexts[0].newPage(),
          b = await contexts[1].newPage();
        a.setDefaultTimeout(15000);
        b.setDefaultTimeout(15000);
        await open(a, url, website);
        await open(b, url, website);
        expect(await call(b, 'records.list()')).toMatchObject({ records: [], incomplete: false });
        expect(
          await call(
            b,
            'records.prepare({id:"guest",title:"Guest",data:{points:[1]},base:null}).catch(e=>e.message)',
          ),
        ).toContain('not-signed-in');
        await connect(a, alice, website);
        await call(
          a,
          'records.prepare({id:"track",title:"My track",data:{points:[1,2]},base:null}).then(c=>{globalThis.change=c})',
        );
        const denied = call(a, 'change.publish().catch(e=>e.message)');
        await a.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(await denied).toContain('user-denied');
        const first = await publish(a, 'change.publish().then(r=>{globalThis.saved=r;return r})');
        expect(first.author).toBe(getPublicKey(alice));
        expect((await call(b, 'records.list()')).records).toHaveLength(1);
        await connect(b, bob, website);
        await call(
          b,
          `records.get(${JSON.stringify(first.author)},"track").then(r=>{globalThis.foreign=r.record;return r})`,
        );
        expect(
          await call(
            b,
            'records.prepare({id:"track",title:"Steal",data:{points:[9]},base:foreign}).catch(e=>e.message)',
          ),
        ).toContain('owner-mismatch');
        await call(
          b,
          'records.prepare({id:"copy",title:"My variation",data:foreign.data,base:null}).then(c=>{globalThis.change=c})',
        );
        await publish(b, 'change.publish()');
        await open(a, url, website);
        await connect(a, alice, website);
        const lookup = await call(
          a,
          `records.get(${JSON.stringify(first.author)},"track").then(r=>{globalThis.saved=r.record;return r})`,
        );
        expect(lookup.incomplete).toBe(false);
        expect(lookup.record.revision).toBe(first.revision);
        await call(
          a,
          'records.prepare({id:"track",title:"Improved",data:{points:[3,4]},base:saved}).then(c=>{globalThis.change=c})',
        );
        refuse = true;
        const error = await publish(a, 'change.publish().catch(e=>e.message)');
        expect(error).toContain('app-data-publish-failed');
        expect(error).toContain('fixture storage is full');
        refuse = false;
        const updated = await publish(
          a,
          'change.publish().then(r=>{globalThis.updated=r;return r})',
        );
        expect(updated.revision).not.toBe(first.revision);
        expect(
          await call(
            a,
            'records.prepare({id:"track",title:"Stale",data:{points:[8]},base:saved}).then(c=>c.publish()).catch(e=>e.message)',
          ),
        ).toContain('conflict');
        await call(
          a,
          'records.prepare({id:"track",title:updated.title,base:updated,deleted:true}).then(c=>{globalThis.change=c})',
        );
        await publish(a, 'change.publish()');
        expect((await call(b, 'records.list()')).records.map((r: any) => r.id)).toEqual(['copy']);
        expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        expect(await call(a, 'typeof window.nostr')).toBe('undefined');
      } finally {
        refuse = false;
        for (const context of contexts) await context.close();
      }
    }
  } finally {
    await browser.close();
    preview?.stop(true);
    web?.kill();
    if (web) await web.exited;
    relay.stop(true);
    storage.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
