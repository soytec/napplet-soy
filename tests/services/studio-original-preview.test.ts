import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey, matchFilters } from 'nostr-tools';
import { browserEngine } from '../../apps/cli/src/browser';
import { sha256 } from '../../packages/protocol/src';

test('a remix opens verified original gameplay before inference, then keeps and replaces passing previews in both build modes', async () => {
  const html =
    '<!doctype html><style>html,body{margin:0;height:100%;overflow:hidden;background:#c2f0d8}button{font-size:28px;margin:30px}</style><button>Launch original</button><output>0</output><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent="1"</script>';
  const hash = await sha256(html);
  const event = finalizeEvent(
    {
      kind: 35129,
      created_at: Math.floor(Date.now() / 1000),
      content: 'An original game',
      tags: [
        ['d', 'original'],
        ['title', 'Original game'],
        ['x', hash],
      ],
    },
    generateSecretKey(),
  );
  const bundle = await Bun.build({
    entrypoints: [import.meta.dir + '/fixtures/studio-original-preview.tsx'],
    target: 'browser',
    format: 'esm',
    define: { 'import.meta.env': '{"DEV":true}' },
    plugins: [
      {
        name: 'fixture-shell',
        setup(build) {
          build.onResolve({ filter: /^radix-ui$/ }, () => ({
            path: Bun.resolveSync('radix-ui', import.meta.dir + '/../../apps/web'),
          }));
          build.onResolve({ filter: /^pino$/ }, ({ resolveDir }) => ({
            path: Bun.resolveSync('pino', resolveDir).replace(/pino\.js$/, 'browser.js'),
          }));
          // Supply only the surrounding signed-out account context. Player, protocol
          // lookup, integrity checks, host bridge and the entire Studio view are real.
          build.onResolve({ filter: /\/nostr-provider$/ }, () => ({
            path: 'account',
            namespace: 'fixture',
          }));
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const useNostr=()=>({pubkey:null,ready:true});',
            loader: 'js',
          }));
          build.onResolve({ filter: /^@napplet\/shim\/prelude\.global\?raw$/ }, () => ({
            path: import.meta.resolve('@napplet/shim/prelude.global').replace('file://', ''),
            namespace: 'raw',
          }));
          build.onLoad({ filter: /.*/, namespace: 'raw' }, async ({ path }) => ({
            contents: 'export default ' + JSON.stringify(await Bun.file(path).text()),
            loader: 'js',
          }));
        },
      },
    ],
  });
  if (!bundle.success) throw Error(bundle.logs.join('\n'));
  const css =
    (await Bun.file('packages/runtime/src/appearance.css').text()) +
    (await Bun.file('apps/web/src/styles.css').text()).replace(/^@import .*;$/gm, '') +
    (await Bun.file('apps/studio/style.css').text());
  let corrupt = false;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === '/relay' && server.upgrade(request)) return;
      if (path === '/fixture') return Response.json({ id: event.id });
      if (path === '/app.js')
        return new Response(bundle.outputs[0], {
          headers: { 'content-type': 'application/javascript' },
        });
      if (path === '/style.css')
        return new Response(css, { headers: { 'content-type': 'text/css' } });
      if (path === '/' + hash)
        return new Response(corrupt ? '<script>parent.compromised=true</script>' : html, {
          headers: { 'content-type': 'text/html', 'content-length': String(html.length) },
        });
      if (path.startsWith('/draft/'))
        return new Response('<h1>Checked draft ' + path.slice(7) + '</h1>', {
          headers: { 'content-type': 'text/html' },
        });
      return new Response(
        '<!doctype html><link rel="stylesheet" href="/style.css"><style>body{margin:0}#root{height:100dvh}.studio-surface{height:100%;--shell-header-height:0px}</style><div id="root"></div><script type="module" src="/app.js"></script>',
        { headers: { 'content-type': 'text/html' } },
      );
    },
    websocket: {
      message(ws, input) {
        const message = JSON.parse(String(input));
        if (message[0] !== 'REQ') return;
        if (matchFilters(message.slice(2), event))
          ws.send(JSON.stringify(['EVENT', message[1], event]));
        ws.send(JSON.stringify(['EOSE', message[1]]));
      },
    },
  });
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    for (const browserBuild of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(server.url.href + (browserBuild ? '?browser=1' : ''));
      const game = page.frameLocator('iframe[title="Original game"]');
      await game.getByRole('button', { name: 'Launch original' }).click();
      expect(await game.locator('output').textContent()).toBe('1');
      expect(await page.locator('.preview-footer').textContent()).toContain('Original napplet');
      expect(
        await page.locator('iframe[title="Original game"]').getAttribute('sandbox'),
      ).not.toContain('allow-same-origin');
      expect(
        await page.evaluate(() =>
          (window as any).remixTest.requests.every((p: string) => p === 'state'),
        ),
      ).toBe(true);
      if (process.env.SPACE_TEST_SCREENSHOTS)
        await page.screenshot({
          path:
            process.env.SPACE_TEST_SCREENSHOTS +
            `/original-${browserBuild ? 'browser' : 'server'}.png`,
        });
      await page.evaluate(
        (revision) => (window as any).remixTest.update({ sourceRevision: revision }),
        event.id,
      );
      await page.waitForTimeout(1100);
      expect(await game.locator('output').textContent()).toBe('1');
      await page.evaluate(() => (window as any).remixTest.update({ phase: 'failed' }));
      await page.waitForTimeout(1100);
      expect(await game.locator('output').textContent()).toBe('1');
      await page.getByRole('button', { name: 'Phone preview' }).click();
      const dimensions = await page.locator('iframe[title="Original game"]').boundingBox();
      expect(dimensions!.width).toBeLessThanOrEqual(390);
      expect(dimensions!.height).toBeGreaterThan(200);
      await page.getByRole('button', { name: 'Player controls', exact: true }).click();
      await page.getByRole('button', { name: 'Restart napplet', exact: true }).click();
      await game.getByRole('button', { name: 'Launch original' }).waitFor();
      expect(await game.locator('output').textContent()).toBe('0');
      await page.keyboard.press('Escape');
      await game.getByRole('button', { name: 'Launch original' }).click();
      await page.evaluate(() => {
        (window as any).remixTest.delay();
        (window as any).remixTest.update({
          preview: 'one',
          previewValidation: 'browser',
          phase: 'ready',
        });
      });
      await page.waitForTimeout(1200);
      expect(await game.locator('output').textContent()).toBe('1');
      await page.evaluate(() => (window as any).remixTest.release());
      await page
        .frameLocator('iframe[title="Playable napplet preview"]')
        .getByRole('heading', { name: 'Checked draft one' })
        .waitFor();
      expect(await page.locator('iframe[title="Original game"]').count()).toBe(0);
      await page.evaluate(() => {
        (window as any).remixTest.delay();
        (window as any).remixTest.update({ preview: 'two', phase: 'ready' });
      });
      await page.waitForTimeout(1200);
      expect(
        await page
          .frameLocator('iframe[title="Playable napplet preview"]')
          .locator('h1')
          .textContent(),
      ).toBe('Checked draft one');
      await page.evaluate(() => (window as any).remixTest.release());
      await page
        .frameLocator('iframe[title="Playable napplet preview"]')
        .getByRole('heading', { name: 'Checked draft two' })
        .waitFor();
      await page.evaluate(() => (window as any).remixTest.fresh());
      await page.getByRole('heading', { name: 'A little idea is taking shape.' }).waitFor();
      expect(await page.locator('iframe').count()).toBe(0);
      expect(errors).toEqual([]);
      await page.close();
    }
    corrupt = true;
    const page = await browser.newPage();
    await page.goto(server.url.href);
    await page.getByRole('button', { name: 'Try again', exact: true }).waitFor();
    expect(await page.locator('iframe').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).compromised)).toBeUndefined();
    corrupt = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page
      .frameLocator('iframe[title="Original game"]')
      .getByRole('button', { name: 'Launch original' })
      .waitFor();
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 60000);
