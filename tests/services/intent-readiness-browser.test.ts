import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';

/** Same shared host, production binding, verified manifest/artifact and opaque sandbox; no SHELL traffic. */
test('INTENT presence, cold delivery and document retirement work without SHELL in a real browser', async () => {
  const { browser, server } = await harnessServer();
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url.href);
    await page.waitForFunction(() => !!(window as any).intentHarness, undefined, { timeout: 3000 });
    const ids = await page.evaluate(async () => {
      const h = (window as any).intentHarness;
      return {
        source: await h.install('source'),
        target: await h.install('receiver', true),
        unsupported: await h.install('review'),
      };
    });
    await page.evaluate(async (id) => (window as any).intentHarness.create(id, true), ids.source);
    const source = page.frameLocator('iframe[title="source"]');
    await source.locator('h1').waitFor();
    const sourceFrame = page
      .frames()
      .find((frame) => frame.parentFrame() && frame.url() === 'about:srcdoc')!;
    const availability = await sourceFrame.evaluate(async () =>
      (window as any).napplet.intent.available('profile'),
    );
    expect(availability.candidates.map((entry: any) => entry.id)).toEqual([ids.target]);
    expect(await sourceFrame.evaluate(() => !!(window as any).napplet.shell)).toBe(false);
    const result = await sourceFrame.evaluate(async () =>
      (window as any).napplet.intent.open('napplet:profile/open', {
        payload: { pubkey: 'opaque' },
      }),
    );
    expect(result).toMatchObject({ ok: true, handler: ids.target });
    await page.frameLocator('iframe[title="receiver"]').locator('h1').waitFor();
    const target = page.frames().find((frame) => frame.parentFrame() && frame !== sourceFrame)!;
    await page.waitForFunction(
      () =>
        (window as any).intentHarness.wire.filter((type: string) => type === 'soy.frame.ready')
          .length === 2,
    );
    expect(await target.evaluate(() => (window as any).deliveries)).toEqual([]);
    await page.evaluate((id) => (window as any).intentHarness.close(id), ids.source);
    await target.evaluate(() => (window as any).receive());
    expect(await target.evaluate(() => (window as any).deliveries)).toEqual([
      {
        sender: ids.source,
        archetype: 'profile',
        action: 'open',
        convention: 'napplet:profile/open',
        payload: { pubkey: 'opaque' },
      },
    ]);
    await page.evaluate(
      async (id) => (window as any).intentHarness.create(id, false),
      ids.unsupported,
    );
    await page.frameLocator('iframe[title="review"]').locator('h1').waitFor();
    const review = page.frames().find((frame) => frame.parentFrame() && frame !== target)!;
    expect(await review.evaluate(() => !!(window as any).napplet.intent)).toBe(false);
    const admission = await page.evaluate(async () => {
      const h = (window as any).intentHarness,
        id = await h.install('required', false, true);
      try {
        await h.create(id, false);
        return 'unexpected success';
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(admission).toContain('unsupported capabilities: intent');
    expect(
      await page.evaluate(() =>
        (window as any).intentHarness.wire.some((type: string) => type.startsWith('shell.')),
      ),
    ).toBe(false);

    // The same WindowProxy survives navigation; the verified document's private retirement must revoke it.
    await target.evaluate(() => {
      // Author listeners cannot suppress the earlier host retirement listener.
      for (const type of ['beforeunload', 'pagehide'])
        window.addEventListener(type, (event) => event.stopImmediatePropagation(), {
          capture: true,
        });
      location.href = 'about:blank';
    });
    await target.waitForURL('about:blank');
    await target.evaluate(() => {
      (window as any).replies = [];
      window.addEventListener('message', (event) => (window as any).replies.push(event.data));
      window.parent.postMessage({ type: 'intent.handlers', id: 'new-document' }, '*');
      window.parent.postMessage({ type: 'shell.ready' }, '*');
    });
    await page.waitForFunction(() =>
      (window as any).intentHarness.wire.includes('soy.frame.retired'),
    );
    await page.waitForTimeout(100);
    expect(await target.evaluate(() => (window as any).replies)).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);

async function harnessServer() {
  const build = await Bun.build({
    entrypoints: ['tests/fixtures/intent-host.ts'],
    target: 'browser',
    format: 'esm',
    define: {
      NAPPLET_TEST_SHIM: JSON.stringify(
        await Bun.file(Bun.resolveSync('@napplet/shim/prelude.global', import.meta.dir)).text(),
      ),
    },
  });
  if (!build.success) throw new Error(build.logs.join('\n'));
  const script = await build.outputs[0].text();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/host.js'
        ? new Response(script, { headers: { 'Content-Type': 'text/javascript' } })
        : new Response('<!doctype html><script type="module" src="/host.js"></script>', {
            headers: { 'Content-Type': 'text/html' },
          }),
  });
  try {
    const browser = await chromium.launch();
    return { browser, server };
  } catch (error) {
    server.stop(true);
    throw error;
  }
}

test('unready and foreign document signals cannot release a cold delivery', async () => {
  const { browser, server } = await harnessServer();
  try {
    const page = await browser.newPage();
    await page.goto(server.url.href);
    await page.waitForFunction(() => !!(window as any).intentHarness);
    const ids = await page.evaluate(async () => {
      const h = (window as any).intentHarness;
      const source = await h.install('source'),
        target = await h.install('receiver', true);
      h.defer(target);
      await h.create(source, true);
      return { source, target };
    });
    await page.frameLocator('iframe[title="source"]').locator('h1').waitFor();
    const source = page.frames().find((frame) => frame.parentFrame())!;
    expect(
      await source.evaluate(async () =>
        (window as any).napplet.intent.open('napplet:profile/open'),
      ),
    ).toMatchObject({ ok: true });
    await page.frameLocator('iframe[title="receiver"]').locator('h1').waitFor();
    const target = page.frames().find((frame) => frame.parentFrame() && frame !== source)!;
    await target.evaluate(() => (window as any).receive());
    const session = await page.evaluate(
      (id) => (window as any).intentHarness.session(id),
      ids.target,
    );
    await source.evaluate(
      (session) => window.parent.postMessage({ type: 'soy.frame.ready', session }, '*'),
      session,
    );
    await target.evaluate(() =>
      window.parent.postMessage({ type: 'soy.frame.ready', session: 'old-document' }, '*'),
    );
    await page.waitForTimeout(50);
    expect(await target.evaluate(() => (window as any).deliveries)).toEqual([]);
    const bootstrap = await page.evaluate(
      (id) => (window as any).intentHarness.arm(id),
      ids.target,
    );
    await target.evaluate(bootstrap);
    await target.waitForFunction(() => (window as any).deliveries.length === 1);
    expect(await target.evaluate(() => (window as any).deliveries[0].sender)).toBe(ids.source);
    await target.evaluate(bootstrap);
    await page.waitForTimeout(50);
    expect(await target.evaluate(() => (window as any).deliveries.length)).toBe(1);
    expect(
      await page.evaluate(() =>
        (window as any).intentHarness.wire.some((type: string) => type.startsWith('shell.')),
      ),
    ).toBe(false);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);
