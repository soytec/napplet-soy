import { test, expect } from 'bun:test';
import { expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { browserEngine } from '../../apps/cli/src/browser';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, type Event } from 'nostr-tools';
import { encodeAddress, sha256 } from '../../packages/protocol/src';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { initializePolicy } from '../../packages/moderation/src/policy';
const source = `<!doctype html><title>Tool fixture</title><p id="state">Starting</p><button id="manual">Manual increment</button><script>
let count=0;document.querySelector('#manual').onclick=()=>{count++;};
(async()=>{await napplet.shell.ready();
await napplet.webmcp.registerTool({name:'increment',description:'Increment a counter',inputSchema:{type:'object',properties:{expected:{type:'integer'}},required:['expected'],additionalProperties:false}},args=>{if(args.expected!==count)throw new Error('Stale counter');return {count:++count};});
await napplet.webmcp.registerTool({name:'wait',description:'Wait until stopped',inputSchema:{type:'object'}},(_,ctx)=>new Promise(resolve=>{ctx.progress('Waiting safely');ctx.signal.addEventListener('abort',()=>resolve({stopped:true}),{once:true});}));
await napplet.webmcp.registerTool({name:'read',description:'Read counter',inputSchema:{type:'object'},readOnly:true},()=>({count}));
document.querySelector('#state').textContent='Registered';})();
</script>`;
const napplets: Record<string, string> = { fixture: source };
if (process.env.NAPPAKURA_ARTIFACT)
  napplets.nappakura = await Bun.file(process.env.NAPPAKURA_ARTIFACT).text();

export async function toolCall(page: Page, name: string, args: unknown) {
  await page.getByLabel('Agent tool', { exact: true }).selectOption({ label: name });
  await page.getByLabel('Tool arguments', { exact: true }).fill(JSON.stringify(args));
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await browserExpect(page.getByLabel('Tool result', { exact: true })).not.toHaveText('Running…');
  return page.getByLabel('Tool result', { exact: true }).innerText();
}
async function openTools(page: Page) {
  if (await page.locator('.player-corner-trigger').count())
    await page.locator('.player-corner-trigger').hover();
  await page.getByRole('button', { name: 'Agent tools', exact: true }).click();
  await page.getByText(/tools · inspect and try a call/).click();
  await page.getByLabel('Allow shell tool access for this document', { exact: true }).check();
}

test('website and local preview share private, revocable tools and preserve manual editing', async () => {
  const assets = await previewAssets();
  const directory = await mkdtemp(join(tmpdir(), 'space-webmcp-'));
  const key = new Uint8Array(32);
  key[31] = 7;
  const artifacts = new Map<string, Uint8Array>();
  const events: Event[] = [];
  const storage = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      const bytes = artifacts.get(new URL(request.url).pathname.slice(1));
      return new Response(bytes ? (bytes as BodyInit) : null, {
        status: bytes ? 200 : 404,
        headers: { 'access-control-allow-origin': '*' },
      });
    },
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] !== 'REQ') return;
        for (const e of events)
          if (matchFilters(m.slice(2), e)) socket.send(JSON.stringify(['EVENT', m[1], e]));
        socket.send(JSON.stringify(['EOSE', m[1]]));
      },
    },
  });
  const index = new IndexStore(join(directory, 'index'), true);
  const addresses: Record<string, string> = {};
  for (const [name, source] of Object.entries(napplets)) {
    const html = new TextEncoder().encode(source);
    const hash = await sha256(html);
    artifacts.set(hash, html);
    const event = finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: `${name} napplet`,
        tags: [
          ['d', name],
          ['x', hash],
          ['title', name],
          ['server', String(storage.url).replace(/\/$/, '')],
        ],
      },
      key,
    );
    events.push(event);
    index.admit(event);
    index.project(
      event.id,
      { ...(await publicNapplet(event)), bytes: html.length, availability: 'ready' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
    await Bun.write(join(directory, 'index/artifacts', `${hash}.html`), html);
    addresses[name] = encodeAddress({ kind: 35129, pubkey: event.pubkey, identifier: name });
  }
  index.close();
  const policy = join(directory, 'policy.json');
  initializePolicy(policy);
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: resolve(import.meta.dir, '../..'),
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_INDEX_RELAYS: `ws://127.0.0.1:${storage.port}`,
      SPACE_INDEX_LOCAL_BLOSSOM: String(storage.url),
      SPACE_PUBLICDEV: '0',
      SPACE_MODERATION_FILE: policy,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const logs = new Response(child.stderr).text(),
    stdout = new Response(child.stdout).text();

  const localDirectory = join(directory, 'project');
  await Bun.write(
    join(localDirectory, 'napplet.json'),
    JSON.stringify({
      title: 'Tool fixture',
      previewId: crypto.randomUUID(),
      entry: 'index.html',
      requires: [],
      relays: [],
      servers: [],
    }),
  );
  await Bun.write(join(localDirectory, 'index.html'), source);
  const preview = startPreviewServer(pathToFileURL(localDirectory + '/'), 0, false, assets, {
    network: 'local',
  });
  let browser: Browser | undefined;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    browser = await (await browserEngine()).chromium.launch();
    const pages: Page[] = [];
    for (const url of [`${origin}/n/${addresses.fixture}/play`, String(preview.url)]) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      pages.push(page);
      page.setDefaultTimeout(12000);
      await page.goto(url);
      const frame = page.frameLocator('iframe');
      await browserExpect(frame.locator('#state')).toHaveText('Registered');
      if (await page.locator('.player-corner-trigger').count())
        await page.locator('.player-corner-trigger').hover();
      await page.getByRole('button', { name: 'Agent tools', exact: true }).click();
      await page.getByText(/tools · inspect and try a call/).click();
      await browserExpect(
        page.getByRole('button', { name: 'Run tool', exact: true }),
      ).toBeDisabled();
      await page.getByLabel('Allow shell tool access for this document', { exact: true }).check();
      expect(JSON.parse(await toolCall(page, 'increment', { expected: 0 }))).toEqual({ count: 1 });
      expect(await toolCall(page, 'increment', { expected: 0 })).toContain('Stale counter');
      expect(await toolCall(page, 'increment', { bad: true })).toContain('schema');
      await page.getByLabel('Agent tool', { exact: true }).selectOption({ label: 'wait' });
      await page.getByLabel('Tool arguments', { exact: true }).fill('{}');
      await page.getByRole('button', { name: 'Run tool', exact: true }).click();
      await page.getByRole('button', { name: 'Stop calls', exact: true }).click();
      await browserExpect(page.getByLabel('Tool result', { exact: true })).toContainText('Stopped');
      await browserExpect(
        page.getByRole('button', { name: 'Run tool', exact: true }),
      ).toBeEnabled();
      expect(JSON.parse(await toolCall(page, 'read', {}))).toEqual({ count: 1 });
      await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
      await browserExpect(
        page.getByRole('button', { name: 'Run tool', exact: true }),
      ).toBeDisabled();
      await page.getByLabel('Close agent tools', { exact: true }).click();
      await frame.locator('#manual').click();
      await openTools(page);
      expect(JSON.parse(await toolCall(page, 'read', {}))).toEqual({ count: 2 });
      await page.reload();
      await browserExpect(frame.locator('#state')).toHaveText('Registered');
      if (await page.locator('.player-corner-trigger').count())
        await page.locator('.player-corner-trigger').hover();
      await page.getByRole('button', { name: 'Agent tools', exact: true }).click();
      await browserExpect(
        page.getByLabel('Allow shell tool access for this document', { exact: true }),
      ).not.toBeChecked();
    }
    const identities = await Promise.all(
      pages.map((p) => p.getByRole('dialog', { name: /Agent tools for/ }).innerText()),
    );
    expect(identities[0]).not.toBe(identities[1]);
    console.log(
      'PASS actual website and soyLI preview, separate contexts, withheld/read-only permissions, calls, stale errors, stop, revoke, reload. Native WebMCP available:',
      await pages[0].evaluate(() => !!(document as any).modelContext?.registerTool),
    );
    if (napplets.nappakura) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      page.setDefaultTimeout(15000);
      await page.goto(`${origin}/n/${addresses.nappakura}/play`);
      await openTools(page);
      const initial = JSON.parse(await toolCall(page, 'inspect_document', {}));
      expect(initial.vertices).toBeGreaterThan(0);
      expect(
        JSON.parse(
          await toolCall(page, 'create_primitive', {
            expectedRevision: initial.revision,
            kind: 'box',
            sizeMm: 40,
          }),
        ).polygons,
      ).toBe(6);
      console.log('PASS Nappakura tools in production website player.');
    }
  } finally {
    await browser?.close();
    preview.stop(true);
    child.kill();
    await child.exited;
    storage.stop(true);
    await rm(directory, { recursive: true, force: true });
    await logs;
    await stdout;
  }
}, 180000);
