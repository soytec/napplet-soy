import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { matchFilters, type Filter, type NostrEvent } from 'nostr-tools';

test('browser runtime delegates token backfill once and keeps unchanged nutzap subscriptions on refresh', async () => {
  // Isolate the browser build from bun:test's already-loaded JSON module cache.
  const build = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    const result = await Bun.build({ entrypoints: ['tests/fixtures/wallet-loading.ts'], target: 'browser' });
    if (!result.success) throw new Error(result.logs.join('\\n'));
    process.stdout.write(await result.outputs[0].text());
  `,
    ],
    { stdout: 'pipe', stderr: 'inherit' },
  );
  const bundle = await new Response(build.stdout).text();
  expect(await build.exited).toBe(0);
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      return new URL(request.url).pathname === '/fixture.js'
        ? new Response(bundle, { headers: { 'content-type': 'text/javascript' } })
        : new Response('<!doctype html><title>Wallet loading</title>', {
            headers: { 'content-type': 'text/html' },
          });
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const requests: { relay: string; filters: Filter[] }[] = [];
    let events: NostrEvent[] = [];
    await page.route('https://**', (route) =>
      route.fulfill({
        contentType: 'application/nostr+json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ supported_nips: [], limitation: { max_limit: 500 } }),
      }),
    );
    await page.routeWebSocket(/.*/, (socket) => {
      socket.onMessage((message) => {
        const [type, id, ...filters] = JSON.parse(String(message));
        if (type === 'REQ') {
          requests.push({ relay: socket.url(), filters });
          for (const event of events)
            if (matchFilters(filters, event)) socket.send(JSON.stringify(['EVENT', id, event]));
          socket.send(JSON.stringify(['EOSE', id]));
        } else if (type === 'EVENT') {
          socket.send(JSON.stringify(['OK', id.id, true, 'stored']));
        }
      });
    });
    await page.goto(server.url.href);
    const fixture = await page.evaluate(
      async (path) => (await import(path)).setup(),
      '/fixture.js',
    );
    events = fixture.events;
    expect(await page.evaluate(async (path) => (await import(path)).open(), '/fixture.js')).toEqual(
      { 'https://mint.test': 8 },
    );
    const metadata = () =>
      requests.filter(({ filters }) => filters.some((f) => f.kinds?.includes(10019)));
    const tokenBackfill = () =>
      requests.filter(({ filters }) =>
        filters.some((f) => f.kinds?.includes(7375) && f.limit !== undefined),
      );
    const nutzaps = () =>
      requests.filter(({ filters }) => filters.some((f) => f.kinds?.includes(9321)));
    expect(
      metadata()
        .map((r) => new URL(r.relay).hostname)
        .sort(),
    ).toEqual(['bootstrap.example', 'wallet.example']);
    expect(tokenBackfill()).toHaveLength(2); // One native backfill per relay.
    expect(nutzaps()).toHaveLength(2);
    for (const { filters } of metadata()) {
      expect(filters).toEqual([{ kinds: [10019, 10002, 17375], authors: [fixture.pubkey] }]);
    }
    expect(
      await page.evaluate(async (path) => (await import(path)).refresh(), '/fixture.js'),
    ).toEqual({ 'https://mint.test': 8 });
    expect(metadata()).toHaveLength(4);
    expect(tokenBackfill()).toHaveLength(4); // Exactly one further sync per relay.
    expect(nutzaps()).toHaveLength(2); // No replay of unchanged incoming history.
    await page.evaluate(
      async (path) => (await import(path)).closeWithPendingOperation(),
      '/fixture.js',
    );
    const stoppedRequests = requests.length;
    expect(
      await page.evaluate(async (path) => {
        try {
          await (await import(path)).refresh();
          return 'unexpected refresh';
        } catch (error) {
          return (error as Error).message;
        }
      }, '/fixture.js'),
    ).toContain('Reconnect this wallet');
    expect(
      await page.evaluate(
        async (path) => (await import(path)).finishPendingOperation(),
        '/fixture.js',
      ),
    ).toBe('saved-after-disable');
    await page.waitForFunction(async (path) => (await import(path)).closedStorage(), '/fixture.js');
    expect(requests).toHaveLength(stoppedRequests);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);
