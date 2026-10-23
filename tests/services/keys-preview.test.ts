import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent } from 'nostr-tools';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { encodeAddress, sha256 } from '../../packages/protocol/src';
import { pathToFileURL } from 'node:url';
import { browserEngine } from '../../apps/cli/src/browser';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import type { Page } from '@playwright/test';

async function switchAwayAndBack(page: Page) {
  // Drive visibility deterministically through the real player and opaque iframe:
  // automated Chromium pages can remain visible even when another page is focused.
  // Allow React to process the hidden state before returning to the foreground.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test('game keys and live sessions survive tab switches in the preview and website hosts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-keys-'));
  let preview: ReturnType<typeof startPreviewServer> | undefined;
  let web: ReturnType<typeof Bun.spawn> | undefined;
  let storage: ReturnType<typeof Bun.serve> | undefined;
  const browser = await (await browserEngine()).chromium.launch();
  try {
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Keyboard specimen',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
        relays: [],
        servers: [],
      }),
    );
    // Reproduces Puddlehop: pointer controls work; keyboard movement uses NAP-KEYS.
    await Bun.write(
      join(root, 'index.html'),
      `<!doctype html>
      <button id="hop">Hop</button><output id="distance">0</output>
      <input aria-label="Name"><textarea aria-label="Note"></textarea>
      <div contenteditable="true" role="textbox" aria-label="Editor"></div>
      <output id="ready">waiting</output>
      <script>
      let distance=0;
      window.shellInitCount=0;
      window.addEventListener('message', event=>{
        if(event.source===parent && event.data?.type==='shell.init') window.shellInitCount++;
      });
      const hop=()=>document.querySelector('#distance').textContent=String(++distance);
      document.querySelector('#hop').onclick=hop;
      (async()=>{
        if (!window.napplet.keys) return;
        await napplet.keys.registerAction({id:'hop',label:'Hop forward',defaultKey:'ArrowUp'});
        napplet.keys.onAction('hop',hop);
        await napplet.keys.registerAction({id:'wasd',label:'Hop forward',defaultKey:'w'});
        napplet.keys.onAction('wasd',hop);
        document.querySelector('#ready').textContent='ready';
      })();
      </script>`,
    );
    preview = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    const html = await Bun.file(join(root, 'index.html')).text();
    const hash = await sha256(html);
    storage = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response(html, { headers: { 'access-control-allow-origin': '*' } }),
    });
    const serverUrl = storage.url.origin;
    const event = finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: 'Keyboard fixture',
        tags: [
          ['d', 'keyboard-fixture'],
          ['title', 'Keyboard specimen'],
          ['x', hash],
          ['R', 'keys'],
          ['server', serverUrl],
        ],
      },
      new Uint8Array(32).fill(57),
    );
    const index = new IndexStore(join(root, 'index'), true);
    index.admit(event);
    index.project(
      event.id,
      { ...(await publicNapplet(event)), bytes: html.length, availability: 'ready' },
      Date.now() + 60000,
      Date.now() + 60000,
    );
    index.close();
    await Bun.write(join(root, 'index/artifacts', hash + '.html'), html);
    web = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
      env: {
        ...process.env,
        HOST: '127.0.0.1',
        PORT: '0',
        SPACE_PUBLICDEV: '0',
        SPACE_INDEX_DIR: join(root, 'index'),
        SPACE_INDEX_LOCAL_BLOSSOM: serverUrl,
        SPACE_INDEX_RELAYS: '',
        SPACE_COMMUNITY_DIR: join(root, 'community'),
      },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    let output = '',
      origin = '';
    for await (const chunk of web.stdout as ReadableStream<Uint8Array>) {
      output += new TextDecoder().decode(chunk);
      origin = /listening on (http:\/\/[^\s/]+)/.exec(output)?.[1] ?? '';
      if (origin) break;
    }
    expect(origin).not.toBe('');
    const path =
      '/n/' +
      encodeAddress({ kind: 35129, pubkey: event.pubkey, identifier: 'keyboard-fixture' }) +
      '/play';
    for (const url of [preview.url.href, origin + path]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.routeWebSocket(/wss?:\/\//, (route) => route.close());
      await page.addInitScript((serverUrl) => {
        if (window === top)
          localStorage.setItem(
            'napplet:network',
            JSON.stringify({ relays: [], blossom: [serverUrl] }),
          );
      }, serverUrl);
      await page.goto(url);
      const frame = page.frameLocator('iframe');
      await frame.locator('#hop').click();
      expect(await frame.locator('#distance').textContent()).toBe('1');
      // Fast, bounded failure on the missing domain instead of a 30-second registration timeout.
      await frame.locator('#ready').filter({ hasText: 'ready' }).waitFor({ timeout: 3000 });
      await page.keyboard.press('ArrowUp');
      await frame.locator('#distance').filter({ hasText: '2' }).waitFor({ timeout: 3000 });
      await page.keyboard.press('w');
      await frame.locator('#distance').filter({ hasText: '3' }).waitFor({ timeout: 3000 });
      for (const name of ['Name', 'Note', 'Editor']) {
        await frame.getByRole('textbox', { name, exact: true }).fill('');
        await page.keyboard.press('w');
        await page.keyboard.press('ArrowUp');
        expect(await frame.locator('#distance').textContent()).toBe('3');
      }
      const child = page.frames().find((f) => f.parentFrame())!;
      await child.evaluate(() => (window as any).napplet.keys.unregisterAction('hop'));
      await frame.locator('#hop').click();
      await page.keyboard.press('ArrowUp');
      expect(await frame.locator('#distance').textContent()).toBe('4');
      await child.evaluate(() =>
        (window as any).napplet.storage.instance.setItem('visibility-marker', 'kept'),
      );
      for (let switchCount = 0; switchCount < 2; switchCount++) {
        await switchAwayAndBack(page);
        // Neither the JS world nor the host's transient storage/bootstrap may reset.
        expect(child.isDetached()).toBe(false);
        expect(await frame.locator('#distance').textContent()).toBe('4');
        expect(await child.evaluate(() => (window as any).shellInitCount)).toBe(1);
        expect(
          await child.evaluate(() =>
            (window as any).napplet.storage.instance.getItem('visibility-marker'),
          ),
        ).toBe('kept');
      }
      await frame.locator('#hop').focus();
      await page.keyboard.press('w');
      expect(await frame.locator('#distance').textContent()).toBe('5');
      await page.reload();
      await frame.locator('#ready').filter({ hasText: 'ready' }).waitFor({ timeout: 3000 });
      expect(child.isDetached()).toBe(true);
      const reloaded = page.frames().find((f) => f.parentFrame())!;
      expect(
        await reloaded.evaluate(() =>
          (window as any).napplet.storage.instance.getItem('visibility-marker'),
        ),
      ).toBeNull();
      await frame.locator('#hop').click();
      await page.keyboard.press('ArrowUp');
      await frame.locator('#distance').filter({ hasText: '2' }).waitFor({ timeout: 3000 });
      if (url.startsWith(origin)) {
        // Native fullscreen is a separate layer; the ordinary /play route uses CSS expansion.
        await page.keyboard.press('Escape');
        await page.waitForURL((u) => !u.pathname.endsWith('/play'), { timeout: 3000 });
        await switchAwayAndBack(page);
        expect(reloaded.isDetached()).toBe(false);
        expect(await frame.locator('#distance').textContent()).toBe('2');
      }
      await context.close();
    }
  } finally {
    web?.kill();
    if (web) await web.exited;
    storage?.stop(true);
    await browser.close();
    preview?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
