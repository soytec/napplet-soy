import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { FipsNode, generateIdentity, toHex } from '@fips/core';
import { encodeAndHash, fromHex, LinkType } from '@hashtree/core';
import { WebSocketCarrier } from '../../packages/runtime/src/fips/test-support/websocket-carrier';
import { TcpBlobTransport } from '../../packages/runtime/src/fips/vendor/tcpBlobTransport';
import { FipsRpcEndpoint } from '../../packages/runtime/src/fips/rpc';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { exampleHtml } from '../../packages/examples/artifact';
import { browserEngine } from '../../apps/cli/src/browser';
const digest = async (b: Uint8Array) =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b))));

test('FIPS resource SDK crosses the real opaque shim in soyLI and optionally the website Player', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-fips-browser-'));
  const bytes = new Uint8Array(32768).fill(31),
    second = new Uint8Array(32768).fill(32);
  const hash = await digest(bytes),
    unusedHash = await digest(second);
  const nodeBytes = await encodeAndHash({
    type: LinkType.File,
    links: [hash, unusedHash].map((hash) => ({
      hash: fromHex(hash),
      size: bytes.length,
      type: LinkType.Blob,
    })),
  });
  const root = toHex(nodeBytes.hash),
    blocks = new Map([
      [root, nodeBytes.data],
      [hash, bytes],
      [unusedHash, second],
    ]),
    reads: string[] = [];
  const identity = await generateIdentity(),
    carrier = new WebSocketCarrier();
  const node = new FipsNode({
    identity,
    transports: [carrier],
    forwarding: false,
    routingMode: 'reply_learned',
  });
  const blobs = new TcpBlobTransport({
    endpoint: node,
    timeoutMs: 3000,
    localStore: {
      get: async () => null,
      has: async () => false,
      put: async () => false,
      delete: async () => false,
    },
    serveBlob: async (h) => {
      reads.push(toHex(h));
      return blocks.get(toHex(h)) ?? null;
    },
  });
  let rpcCalls = 0;
  const rpc = new FipsRpcEndpoint(node, async (req) => {
    rpcCalls++;
    return {
      status: 206,
      headers: { 'x-atlas-snapshot': req.root },
      bytes: new Uint8Array([0, 255, 21]),
    };
  });
  await node.start();
  const descriptor = {
    root,
    bytes: bytes.length * 2,
    chunkBytes: bytes.length,
    expires: Math.floor(Date.now() / 1000) + 300,
    providers: [
      {
        peerId: toHex(identity.publicKey),
        seedUrls: ['wss://fixture.example/fips'],
        servicePort: 39018,
        rpcPort: 39019,
      },
    ],
  };
  const sdk = await Bun.build({
    entrypoints: [new URL('../../packages/resource-client/src/index.ts', import.meta.url).pathname],
    target: 'browser',
    format: 'esm',
  });
  await Bun.write(
    join(directory, 'index.html'),
    `<!doctype html><body><p>Independent immutable document reader</p><script type="module">${await sdk.outputs[0]!.text()}globalThis.resources=fipsResources();globalThis.ready=resources.info();</script>`,
  );
  await Bun.write(
    join(directory, 'napplet.json'),
    JSON.stringify({
      entry: 'index.html',
      title: 'FIPS reader fixture',
      previewId: crypto.randomUUID(),
      requires: ['resource'],
    }),
  );
  const server = startPreviewServer(
    pathToFileURL(directory + '/'),
    0,
    false,
    await previewAssets(),
  );
  const browser = await (
    await browserEngine()
  ).chromium.launch({
    headless: true,
    ...(process.env.FIPS_TEST_BROWSER ? { executablePath: process.env.FIPS_TEST_BROWSER } : {}),
  });
  const proxies = new Set<WebSocket>();
  try {
    const targets = [
      { url: `http://127.0.0.1:${server.port}`, web: false },
      ...(process.env.FIPS_TEST_WEB_ORIGIN
        ? [{ url: process.env.FIPS_TEST_WEB_ORIGIN + '/@space-lab/soft-orbit', web: true }]
        : []),
    ];
    for (const target of targets) {
      const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } }),
        errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // Route only the seed socket to an isolated peer. Browser FIPS encryption,
      // TCP, resource policy, hash checks, shim and MessagePort are all real.
      await page.routeWebSocket('wss://fixture.example/fips', (socket) => {
        const peer = new WebSocket(carrier.url);
        proxies.add(peer);
        const queue: (string | Buffer)[] = [];
        socket.onMessage((data) => {
          if (peer.readyState === WebSocket.OPEN) peer.send(data);
          else queue.push(data);
        });
        peer.on('open', () => {
          for (const data of queue) peer.send(data);
          queue.length = 0;
        });
        peer.on('message', (data) => socket.send(Buffer.from(data as Buffer)));
        peer.on('close', () => {
          proxies.delete(peer);
          socket.close();
        });
        socket.onClose(() => peer.close());
        peer.on('error', () => socket.close());
      });
      page.setDefaultTimeout(12000);

      if (target.web)
        await page.route('https://blossom.napplet.soy/**', (route) =>
          route.fulfill({
            body: exampleHtml('soft-orbit'),
            contentType: 'text/html',
            headers: { 'access-control-allow-origin': '*' },
          }),
        );
      await page.goto(target.url);
      if (target.web)
        await page.getByRole('button', { name: 'Start Soft orbit', exact: true }).click();
      await page.locator('iframe').waitFor();
      expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
      expect(await page.locator('iframe').getAttribute('srcdoc')).toContain("connect-src 'none'");
      const frame = page.frames().find((f) => f.parentFrame())!;
      expect(
        await frame.evaluate(async () => {
          await (window as any).napplet.shell.ready();
          (window as any).resources = (window as any).napplet.resource.soyFips;
          return {
            profile: (await (window as any).resources.info()).profile,
            identity: await (window as any).napplet.identity.getPublicKey(),
            origin: location.origin,
          };
        }),
      ).toEqual({ profile: 'soy.fips/1', identity: '', origin: 'null' });

      const open = frame.evaluate(async (descriptor) => {
        (window as any).grant = (await (window as any).resources.open([descriptor]))[0];
      }, descriptor);
      void open.catch(() => {});
      await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();
      await open;
      const read = () =>
        frame.evaluate(
          async ({ root, hash }) => {
            const r = (window as any).resources,
              id = (window as any).grant;
            let denied = '';
            try {
              await r.bytes(id, hash);
            } catch (e) {
              denied = String(e);
            }
            await r.bytes(id, root);
            const value = await r.bytes(id, hash);
            await r.bytes(id, hash);
            return { denied, size: value.length, first: value[0], stats: (await r.info()).stats };
          },
          { root, hash },
        );
      const result = await read();
      expect(result.denied).toContain('descendant');
      expect(result.size).toBe(bytes.length);
      expect(result.first).toBe(31);
      expect(result.stats.cacheHits).toBeGreaterThan(0);
      expect(reads).not.toContain(unusedHash);
      expect(rpcCalls).toBe(target.web ? 1 : 0);
      const operation = frame.evaluate(async () => {
        const res = await (window as any).resources.request((window as any).grant, {
          method: 'GET',
          path: 'capabilities',
        });
        return { status: res.status, headers: res.headers, bytes: Array.from(res.bytes) };
      });
      await page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }).click();

      expect(await operation).toEqual({
        status: 206,
        headers: { 'x-atlas-snapshot': root },
        bytes: [0, 255, 21],
      });
      if (target.web) {
        await page.getByTitle('Account & settings', { exact: true }).click();
        const indicator = page.getByRole('link', { name: /FIPS: Connected\. Open FIPS dashboard/ });
        await indicator.waitFor();
        expect(await indicator.innerText()).toContain('1 peer');
        await page.getByRole('button', { name: 'Inspect FIPS connections', exact: true }).click();
        const inspect = page.getByRole('dialog', { name: 'Inspect FIPS connections', exact: true });
        await inspect.waitFor();
        expect(await page.locator('iframe').count()).toBe(1);
        const active = inspect.getByRole('region', { name: 'Active FIPS sessions', exact: true });
        await active.waitFor();
        expect(await active.locator('article').count()).toBe(1);
        await active.getByRole('button', { name: 'Clear cache', exact: true }).click();
        expect(
          await active
            .locator('.fips-session-summary > div')
            .filter({ hasText: 'Verified cache' })
            .locator('dd')
            .innerText(),
        ).toBe('0 B');
        const fresh = await frame.evaluate(async (hash) => {
          const w = window as any;
          const bytes = await w.resources.bytes(w.grant, hash);
          return { size: bytes.length, stats: (await w.resources.info()).stats };
        }, hash);
        expect(fresh.size).toBe(bytes.length);
        expect(fresh.stats.networkRequests).toBeGreaterThan(result.stats.networkRequests);
        await active.locator('summary').click();
        expect(await active.innerText()).toContain(descriptor.providers[0]!.peerId);
        expect(await active.innerText()).toContain('Map operations (RPC): approved');
        await active.getByRole('button', { name: 'Revoke root', exact: true }).click();
        expect(await active.innerText()).toContain('No approved resource roots.');
        await page.keyboard.press('Escape');
        expect(await inspect.count()).toBe(0);
      }
      const old = await frame.evaluate(async () => {
        const w = window as any;
        await w.resources.release(w.grant);
        try {
          await w.resources.bytes(w.grant, 'a'.repeat(64));
          return '';
        } catch (e) {
          return String(e);
        }
      });
      expect(old).toContain('revoked');
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.locator('iframe').isVisible()).toBe(true);
      const pending = frame.evaluate(async (descriptor) => {
        try {
          await (window as any).resources.open([descriptor]);
          return 'allowed';
        } catch (e) {
          return String(e);
        }
      }, descriptor);
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(await pending).toContain('not approved');
      if (target.web) {
        // Ordinary client-side navigation must close the player, while retaining
        // truthful final counters for the dashboard (not a fake live connection).
        await page.setViewportSize({ width: 1365, height: 1000 });
        await page.getByTitle('Account & settings', { exact: true }).click();
        await page.getByRole('link', { name: /Open FIPS dashboard/ }).click();
        const dashboard = page.getByRole('region', { name: 'FIPS dashboard', exact: true });
        await dashboard.waitFor();
        expect(page.url()).toEndWith('/manage#fips');
        expect(await page.locator('iframe').count()).toBe(0);
        expect(await dashboard.innerText()).toContain('No active FIPS sessions');
        const recent = page.getByRole('region', { name: 'Recent FIPS sessions', exact: true });
        expect(await recent.locator('article').count()).toBe(1);
        expect(await recent.innerText()).toContain('Closed');
        expect(
          await recent
            .locator('.fips-session-summary > div')
            .filter({ hasText: 'Received payload' })
            .locator('dd')
            .innerText(),
        ).not.toBe('0 B');
        await recent.getByText('Transfer details', { exact: true }).click();
        expect(await recent.innerText()).toContain('Verified blocks / cache hits');
        await page.setViewportSize({ width: 390, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          390,
        );
        await dashboard.getByLabel('Resource connections', { exact: true }).selectOption('block');
        expect(await dashboard.innerText()).toContain('Blocked');
        expect(errors).toEqual([]);
        // Switching accounts after the player is gone must clear old activity too.
        // This synthetic read-only extension cannot sign or publish anything.
        await page.evaluate(() => {
          (window as any).nostr = {
            getPublicKey: async () =>
              '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
            signEvent: async () => {
              throw new Error('Fixture signing disabled');
            },
          };
        });
        await page.getByTitle('Account & settings', { exact: true }).click();
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
        await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
        await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        expect(await recent.locator('article').count()).toBe(0);
        await page.reload();
        await dashboard.waitFor();
        expect(
          await dashboard.getByLabel('Resource connections', { exact: true }).inputValue(),
        ).toBe('block');
        expect(
          await page
            .getByRole('region', { name: 'Recent FIPS sessions', exact: true })
            .locator('article')
            .count(),
        ).toBe(0);
        await dashboard.getByLabel('Resource connections', { exact: true }).selectOption('ask');
      }
      // The production-only Studio client rejects this fixture's HTTP origin
      // after synthetic login. FIPS remains usable without Studio or HTTPS on
      // loopback; no other browser errors are expected.
      expect(
        errors.filter((error) => !(target.web && error === 'Hosted Studio requires HTTPS.')),
      ).toEqual([]);
      await page.close();
    }
  } finally {
    for (const proxy of proxies) proxy.terminate();
    await browser.close();
    server.stop(true);
    await Promise.all([blobs.close(), rpc.close()]);
    await node.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
