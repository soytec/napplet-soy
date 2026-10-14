import { expect, test } from 'bun:test';
import { chromium, expect as browserExpect, type Browser } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { matchFilters } from 'nostr-tools';
import type { SignedEvent } from '../../packages/protocol/src';
import { directWallet } from '../fixtures/direct-wallet';
import fixtures from '../../packages/backend/data/catalog.json';

test('a QR-paid invoice remains counted after reload while its public receipt is delayed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zap-confirmation-'));
  const fixture = fixtures[0];
  const key = new Uint8Array(32);
  key[31] = 1; // Public fixture key only.
  const events = new Map<string, SignedEvent>([
    [fixture.current.id, fixture.current],
    [fixture.snapshot.id, fixture.snapshot],
  ]);
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('fixture relay');
    },
    websocket: {
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] !== 'REQ') return;
        for (const event of events.values())
          if (matchFilters(message.slice(2), event))
            socket.send(JSON.stringify(['EVENT', message[1], event]));
        socket.send(JSON.stringify(['EOSE', message[1]]));
      },
    },
  });
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
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_INDEX_RELAYS: `ws://127.0.0.1:${relay.port}/`,
      SPACE_PUBLICDEV: '0',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  });
  let browser: Browser | undefined;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }
    expect(ready).toBe(true);
    browser = await chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const wallet = await directWallet(page, events, key, `ws://127.0.0.1:${relay.port}/`, {
      verificationPreimage: false,
    });
    await page.goto(`${origin}/n/${fixture.naddr}`);
    const header = page.locator('.napplet-social-actions');
    await header.getByRole('button', { name: `Zap ${fixture.title}`, exact: true }).click();
    await page.getByLabel('Satoshis', { exact: true }).fill('21');
    await page.getByRole('button', { name: 'Create anonymous zap invoice', exact: true }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
    expect(wallet.requests).toHaveLength(1);
    // An external QR wallet settles the invoice. The provider's LUD-21 response
    // confirms it, but the public NIP-57 receipt has not arrived on any relay yet.
    wallet.settle(0, false);
    await page.getByText('Zap sent!', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await browserExpect(header).toContainText('21 sats');
    expect([...events.values()].some((e) => e.kind === 9735)).toBe(false);
    await page.reload();
    await browserExpect(header).toContainText('21 sats');
    // A late public receipt must merge with the already-confirmed local payment.
    wallet.settle(0);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await browserExpect(header).toContainText('1 · 21 sats');

    // Reload while an external wallet has not yet settled. Reopening must resume
    // the exact invoice rather than generating another request or losing checks.
    await header.getByRole('button', { name: `Zap ${fixture.title}`, exact: true }).click();
    await page.getByLabel('Satoshis', { exact: true }).fill('34');
    await page.getByRole('button', { name: 'Create anonymous zap invoice', exact: true }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
    const pendingInvoice = await page.getByLabel('Lightning invoice', { exact: true }).inputValue();
    expect(wallet.requests).toHaveLength(2);
    await page.reload();
    await header.getByRole('button', { name: `Zap ${fixture.title}`, exact: true }).click();
    await browserExpect(page.getByLabel('Lightning invoice', { exact: true })).toHaveValue(
      pendingInvoice,
    );
    expect(wallet.requests).toHaveLength(2);
    wallet.settle(1, false);
    await page.getByText('Zap sent!', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await browserExpect(header).toContainText('2 · 55 sats');
    await page.reload();
    await browserExpect(header).toContainText('2 · 55 sats');

    // Closing the dialog does not abandon the QR invoice while its page remains
    // mounted. A third-party wallet may finish while the user continues browsing.
    await header.getByRole('button', { name: `Zap ${fixture.title}`, exact: true }).click();
    await page.getByLabel('Satoshis', { exact: true }).fill('13');
    await page.getByRole('button', { name: 'Create anonymous zap invoice', exact: true }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    wallet.settle(2, false);
    await browserExpect(header).toContainText('3 · 68 sats');
    await page.reload();
    await browserExpect(header).toContainText('3 · 68 sats');
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
