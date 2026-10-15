import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, type NostrEvent } from 'nostr-tools';

// Real browser structured clone, installed shim, host, discovery and verified
// manifests. All network traffic stays on disposable local fixture servers.
test('INTENT shim transports structured payloads and discovery sees removed role tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-intent-'));
  const sourceRoot = resolve(import.meta.dir, '../..');
  const scripts = new Map<string, string>();
  let events: NostrEvent[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      const path = new URL(request.url).pathname;
      if (path === '/relay')
        return server.upgrade(request) ? undefined : new Response(null, { status: 400 });
      if (path === '/')
        return new Response('<script type="module" src="/host.js"></script>', {
          headers: { 'Content-Type': 'text/html' },
        });
      if (scripts.has(path))
        return new Response(scripts.get(path), {
          headers: { 'Content-Type': 'text/javascript', 'Access-Control-Allow-Origin': '*' },
        });
      return new Response('artifact', {
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Length': '8' },
      });
    },
    websocket: {
      message(ws, raw) {
        const [type, id, ...filters] = JSON.parse(String(raw));
        if (type !== 'REQ') return;
        for (const event of events.filter((event) => matchFilters(filters, event)))
          ws.send(JSON.stringify(['EVENT', id, event]));
        ws.send(JSON.stringify(['EOSE', id]));
      },
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const key = new Uint8Array(32).fill(83);
  const manifest = (kind: number, time: number, tags: string[][]) =>
    finalizeEvent(
      {
        kind,
        created_at: time,
        content: 'Fixture handler',
        tags: [
          ...(kind === 35129 ? [['d', 'handler']] : []),
          ['x', 'a'.repeat(64)],
          ['server', origin],
          ...tags,
        ],
      },
      key,
    );
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await Bun.write(
      join(root, 'client.ts'),
      `
      import { installNappletGlobal } from ${JSON.stringify(Bun.resolveSync('@napplet/shim', sourceRoot))};
      installNappletGlobal({ domains: ['shell', 'intent'] });
      window.napplet.shell.ready().then(() => { window.fixtureReady = true; });
    `,
    );
    await Bun.write(
      join(root, 'host.ts'),
      `
      import { attachNappletHost } from ${JSON.stringify(join(sourceRoot, 'packages/runtime/src/host.ts'))};
      import { IntentWorkspace } from ${JSON.stringify(join(sourceRoot, 'packages/runtime/src/intent-session.ts'))};
      import { createWebIntentWorkspace } from ${JSON.stringify(join(sourceRoot, 'apps/web/src/lib/intent-workspace-state.ts'))};
      import { queryCatalog } from ${JSON.stringify(join(sourceRoot, 'apps/web/src/lib/protocol-catalog.ts'))};
      import { configureClient } from ${JSON.stringify(join(sourceRoot, 'apps/web/src/lib/network.ts'))};
      const workspace = new IntentWorkspace({ choose: async () => null, launch: async () => {} });
      workspace.register({ id: 'source', contracts: [] });
      workspace.register({ id: 'target', contracts: [{ convention: 'napplet:test/open', params: [] }] });
      window.deliveries = [];
      workspace.attach('target', (message) => window.deliveries.push(message)).ready();
      const frame = document.createElement('iframe');
      frame.sandbox = 'allow-scripts'; document.documentElement.append(frame);
      const host = attachNappletHost({ frame, identity: 'source', manifestId: 'a'.repeat(64),
        relays: [], pubkey: null, prompt() {}, files() {}, intent: { workspace, catalogId: 'source' } });
      frame.srcdoc = '<script type="module" src="${origin}/client.js"><\\/script>';
      configureClient({ relays: ['ws://127.0.0.1:${server.port}/relay'], blossom: [${JSON.stringify(origin)}], rules: [], featured: [] });
      const ui = createWebIntentWorkspace(queryCatalog);
      ui.workspace.register({ id: 'catalog-source', contracts: [] });
      const source = ui.workspace.attach('catalog-source', () => {});
      window.availability = (role) => source.handle({ type: 'intent.available', archetype: role });
    `,
    );
    for (const name of ['host', 'client']) {
      const output = join(root, `${name}.js`);
      const build = Bun.spawn(
        [
          process.execPath,
          'build',
          join(root, `${name}.ts`),
          '--target=browser',
          '--format=esm',
          '--outfile',
          output,
        ],
        {
          cwd: sourceRoot,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      const [status, stdout, stderr] = await Promise.all([
        build.exited,
        new Response(build.stdout).text(),
        new Response(build.stderr).text(),
      ]);
      if (status !== 0)
        throw new Error(`Browser fixture build failed (${status}): ${stderr}${stdout}`);
      scripts.set(`/${name}.js`, await Bun.file(output).text());
    }
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(origin);
    await page.waitForSelector('iframe').catch((error) => {
      throw new Error(`${error.message}: ${errors.join('; ')}`);
    });
    const frame = page.frames().find((frame) => frame.parentFrame());
    expect(frame).toBeDefined();
    await frame!.waitForFunction(() => (window as any).fixtureReady);
    const results = await frame!.evaluate(async () => {
      const invoke = (payload: unknown) =>
        (window as any).napplet.intent.invoke('napplet:test/open', { payload });
      const cycle: any = {};
      cycle.self = cycle;
      return [
        await invoke(cycle),
        await invoke({ counter: 42n }),
        await invoke('x'.repeat(400 * 1024)),
        await invoke(new Uint8Array(400 * 1024)),
        await invoke('x'.repeat(1024 * 1024 + 1)),
      ];
    });
    expect(results.slice(0, 4).every((result) => result.ok === true)).toBe(true);
    expect(results[4]).toMatchObject({ ok: false, error: 'intent payload too large' });
    await page.waitForFunction(() => (window as any).deliveries.length === 4);
    expect(
      await page.evaluate(() => {
        const payloads = (window as any).deliveries.map((message: any) => message.delivery.payload);
        return [
          payloads[0].self === payloads[0],
          payloads[1].counter === 42n,
          payloads[2].length === 400 * 1024,
          payloads[3] instanceof Uint8Array && payloads[3].length === 400 * 1024,
        ];
      }),
    ).toEqual([true, true, true, true]);
    const now = Math.floor(Date.now() / 1000) - 10;
    for (const [index, kind] of [35129, 15129].entries()) {
      const role = `fixture-${kind}`;
      events = [
        manifest(kind, now + index * 2, [
          ['z', role],
          ['i', `napplet:${role}/open`],
        ]),
      ];
      expect(await page.evaluate((role) => (window as any).availability(role), role)).toMatchObject(
        { availability: { available: true } },
      );
      // No old z/i match exists at the relay. Only coordinate refresh can find this revision.
      events = [manifest(kind, now + index * 2 + 1, [])];
      expect(await page.evaluate((role) => (window as any).availability(role), role)).toMatchObject(
        { availability: { available: false } },
      );
    }
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
