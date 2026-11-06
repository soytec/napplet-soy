import { test, expect } from 'bun:test';
import { expect as browserExpect, type Browser } from '@playwright/test';
import { browserEngine } from '../../apps/cli/src/browser';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, type Event } from 'nostr-tools';
import { encodeAddress, sha256 } from '../../packages/protocol/src';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { initializePolicy } from '../../packages/moderation/src/policy';

// NIP-5D port-bound identity (dskvr/nips PR 14/15) in the production website
// player: every publisher's napplet gets the same binding and the same teardown.
const napplets = {
  bound: `<!doctype html><title>Bound</title><p id="state">waiting</p><script>
    const exposed = Object.getOwnPropertyNames(globalThis).filter(n => /RTC/.test(n) && globalThis[n] !== undefined);
    napplet.shell.ready()
      .then(() => napplet.identity.getPublicKey())
      .then(() => { document.querySelector('#state').textContent = exposed.length ? 'rtc:' + exposed : 'bound'; });
    </script>`,
  // A bundled pre-port SDK asks for its theme at window level.
  legacy: `<!doctype html><title>Legacy</title><script>
    setTimeout(() => parent.postMessage({ type: 'theme.get', id: 'legacy' }, '*'), 50);
    </script>`,
  reloading: `<!doctype html><title>Reloading</title><script>
    addEventListener('load', () => setTimeout(() => location.reload(), 50));
    </script>`,
  // Navigation before the first load fires no replacement evidence; the host
  // page's frame-src lock must stop it before unverified bytes run.
  escaping: `<!doctype html><title>Escaping</title><script>
    const page = '<script>parent.postMessage({ type: "escaped" }, "*")<' + '/script>';
    location.href = URL.createObjectURL(new Blob([page], { type: 'text/html' }));
    </script>`,
};

test('the website player binds every napplet to its port and removes replaced or legacy frames', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-nip5d-port-'));
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
  let browser: Browser | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      try {
        ready = (await fetch(origin)).ok;
      } catch {}
      if (!ready) await Bun.sleep(100);
    }
    if (!ready) throw new Error('Website test server did not start');
    browser = await (await browserEngine()).chromium.launch();
    let page!: Awaited<ReturnType<typeof browser.newPage>>;
    const violations: string[] = [];
    // Each napplet starts from a fresh browser context, like a cold shared link.
    const play = async (name: string) => {
      await page?.context().close();
      page = await browser!.newPage({ viewport: { width: 1200, height: 900 } });
      page.setDefaultTimeout(10000);
      page.on('console', (message) => {
        if (/Content Security Policy/.test(message.text())) violations.push(message.text());
      });
      await page.goto(`${origin}/n/${addresses[name]}/play`);
    };

    await play('bound');
    const frame = page.frameLocator('iframe');
    await browserExpect(frame.locator('#state')).toHaveText('bound');

    for (const name of ['legacy', 'reloading']) {
      await play(name);
      await browserExpect(page.getByRole('alert')).toContainText('was stopped');
      expect(await page.locator('iframe').count()).toBe(0);
      // "Try again" creates a fresh frame from the verified bytes; it is removed again.
      await page.getByRole('button', { name: 'Try again' }).click();
      await browserExpect(page.getByRole('alert')).toContainText('was stopped');
      expect(await page.locator('iframe').count()).toBe(0);
    }

    violations.length = 0;
    await play('escaping');
    await browserExpect.poll(() => violations.join('\n')).toContain('frame-src');
    // The minted document never ran: it would have posted at window level and been revoked.
    await page.waitForTimeout(300);
    const frames = page.frames().filter((f) => f.parentFrame());
    for (const f of frames) expect(f.url()).not.toStartWith('blob:');
    expect(await page.getByRole('alert').count()).toBe(0);
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    const stderr = await logs;
    await stdout;
    if (stderr) console.error(stderr.slice(-2000));
    storage.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
