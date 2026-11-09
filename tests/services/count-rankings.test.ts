import { expect, test } from 'bun:test';
import { browserEngine } from '../../apps/cli/src/browser';

test('ranking retry rechecks NIP-45 support, recovers real counts and retains known ranks', async () => {
  const bundle = await Bun.build({
    entrypoints: ['tests/fixtures/count-rankings.tsx'],
    target: 'browser',
  });
  if (!bundle.success) throw Error(String(bundle.logs));
  let supported = false,
    metadataReads = 0,
    countRequests = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      if (request.headers.get('accept')?.includes('application/nostr+json')) {
        metadataReads++;
        return Response.json({ supported_nips: supported ? [1, 45] : [1] });
      }
      if (new URL(request.url).pathname === '/app.js')
        return new Response(bundle.outputs[0], {
          headers: { 'content-type': 'application/javascript' },
        });
      return new Response('<div id="app"></div><script type="module" src="/app.js"></script>', {
        headers: { 'content-type': 'text/html' },
      });
    },
    websocket: {
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] !== 'COUNT') return;
        countRequests++;
        socket.send(
          JSON.stringify(['COUNT', message[1], { count: message[2].kinds[0] === 7 ? 4 : 0 }]),
        );
      },
    },
  });
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(String(server.url));
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-state]')].every(
        (el) => el.textContent === 'unavailable',
      ),
    );
    expect(countRequests).toBe(0);
    expect(await page.locator('p[role="status"]').first().innerText()).toContain('unavailable');
    const firstReads = metadataReads;
    supported = true;
    await page.getByRole('button', { name: 'Retry counts' }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-state]')].every((el) => el.textContent === 'ready'),
    );
    expect(metadataReads).toBeGreaterThan(firstReads);
    expect(countRequests).toBeGreaterThanOrEqual(4);
    expect(
      await page.getByRole('region', { name: 'liked', exact: true }).getByRole('listitem').count(),
    ).toBe(2);
    expect(
      await page
        .getByRole('region', { name: 'commented', exact: true })
        .getByRole('listitem')
        .count(),
    ).toBe(0);
    supported = false;
    await page.getByRole('button', { name: 'Retry counts' }).click();
    await page.waitForFunction(
      () => document.querySelector('[data-state]')?.textContent === 'partial',
    );
    expect(
      await page.getByRole('region', { name: 'liked', exact: true }).getByRole('listitem').count(),
    ).toBe(2);
    expect(await page.locator('p[role="status"]').first().innerText()).toContain('already received');
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 20000);
