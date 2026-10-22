import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, getPublicKey } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { socialScope, likeTemplate, commentTemplate } from '../../packages/protocol/src/social';
import { CommunityStore } from '../../packages/community/src/store';
import { directWallet } from '../fixtures/direct-wallet';
import fixtures from '../../packages/backend/data/catalog.json';

test('gallery social locks, counts, ranking rails, focused comments and anonymous QR invoices', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-gallery-social-')),
    root = resolve(import.meta.dir, '../..');
  const key = new Uint8Array(32);
  key[31] = 1; // Explicit public fixture key, never an account credential.
  const fixture = fixtures[0],
    events = new Map<string, SignedEvent>([
      [fixture.current.id, fixture.current],
      [fixture.snapshot.id, fixture.snapshot],
    ]);
  const index = new IndexStore(join(directory, 'index'), true);
  const store = new CommunityStore(join(directory, 'community'));
  const visitor = new Uint8Array(32);
  visitor[31] = 2;
  const now = Math.floor(Date.now() / 1000);
  for (const item of fixtures) {
    index.admit(item.current);
    await Bun.write(
      join(directory, 'index/artifacts', `${item.artifactHash}.html`),
      Bun.file(join(root, 'packages/backend/data/artifacts', `${item.artifactHash}.html`)),
    );
    const entry = await publicNapplet(item.current);
    index.project(
      item.current.id,
      { ...entry, availability: 'ready' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
    events.set(item.current.id, item.current);
    const scope = socialScope(item.current);
    const reactions = [
      finalizeEvent(likeTemplate(scope, item.current, now - 3), visitor),
      finalizeEvent(commentTemplate(scope, 'A gallery conversation', undefined, now - 2), visitor),
    ];
    reactions.forEach((event) => events.set(event.id, event));
    store.put(scope.key, [item.current, ...reactions]);
  }
  // The original release disappears from the relay after an update. Its
  // addressed likes/comments must still be visible in a fresh browser.
  const updated = finalizeEvent({ ...fixture.current, created_at: now - 1 }, key);
  index.admit(updated);
  index.project(
    updated.id,
    { ...(await publicNapplet(updated)), availability: 'ready' },
    Date.now() + 3600000,
    Date.now() + 3600000,
  );
  events.delete(fixture.current.id);
  events.delete(fixture.snapshot.id);
  events.set(updated.id, updated);
  store.close();
  index.close();
  let rejected = 0;
  let onPublish: ((event: SignedEvent) => boolean) | undefined;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      // Gallery like/comment totals use NIP-45 COUNT, selected through NIP-11.
      return Response.json(
        { supported_nips: [1, 11, 45] },
        { headers: { 'access-control-allow-origin': '*' } },
      );
    },
    websocket: {
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'COUNT') {
          const count = [...events.values()].filter((e) => matchFilters(message.slice(2), e));
          socket.send(JSON.stringify(['COUNT', message[1], { count: count.length }]));
        } else if (message[0] === 'REQ') {
          for (const e of events.values())
            if (matchFilters(message.slice(2), e))
              socket.send(JSON.stringify(['EVENT', message[1], e]));
          socket.send(JSON.stringify(['EOSE', message[1]]));
        } else if (message[0] === 'EVENT') {
          try {
            const e = verifiedEvent(message[1]);
            if (onPublish && !onPublish(e)) {
              socket.send(JSON.stringify(['OK', e.id, false, 'Test delivery unavailable']));
              return;
            }
            events.set(e.id, e);
            socket.send(JSON.stringify(['OK', e.id, true, '']));
          } catch {
            rejected++;
          }
        }
      },
    },
  });
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`,
    relayUrl = `ws://127.0.0.1:${relay.port}/`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_INDEX_RELAYS: relayUrl,
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_DIR: join(directory, 'index'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let accountSignatures = 0;
    await page.exposeFunction('testSign', async (template: Parameters<typeof finalizeEvent>[0]) => {
      accountSignatures++;
      return JSON.parse(JSON.stringify(finalizeEvent(template, key)));
    });
    await page.addInitScript((pubkey) => {
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, getPublicKey(key));
    const walletOptions = { plainDescription: false };
    const wallet = await directWallet(page, events, key, relayUrl, walletOptions);
    // directWallet aliases wss://relay.example's WebSocket; its NIP-11 document is HTTP.
    await page.route('https://relay.example/', async (route) =>
      route.fulfill({
        json: await (await fetch(`http://127.0.0.1:${relay.port}/`)).json(),
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    await page.route('http://localhost:19348/*', async (route) => {
      const hash = new URL(route.request().url()).pathname.slice(1);
      const file = Bun.file(join(root, 'packages/backend/data/artifacts', `${hash}.html`));
      await route.fulfill({
        contentType: 'text/html',
        body: Buffer.from(await file.arrayBuffer()),
        headers: { 'access-control-allow-origin': '*' },
      });
    });
    await page.goto(origin);
    const card = page
      .locator('.napplet-grid > .napplet-card')
      .filter({ has: page.getByRole('link', { name: fixture.title, exact: true }) });
    await page.waitForFunction(() =>
      document.querySelector('.napplet-grid .card-social')?.textContent?.includes('1'),
    );
    expect(await card.getByRole('button', { name: /^Like .*sign in required/ }).isDisabled()).toBe(
      true,
    );
    expect(
      await card.getByRole('button', { name: /^Comment on .*sign in required/ }).isDisabled(),
    ).toBe(true);
    // The landing story has its own iframe; only napplet players count here.
    expect(await page.locator('.napplet-card iframe').count()).toBe(0);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const details = await card
      .getByRole('link', { name: fixture.title, exact: true })
      .getAttribute('href');
    await card.getByRole('button', { name: `Share ${fixture.title}`, exact: true }).click();
    await page.getByRole('button', { name: 'Copy player link', exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}${details}/play`,
    );
    await page.keyboard.press('Escape');

    await page.getByRole('heading', { name: 'Most liked', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Most zapped', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Most commented', exact: true }).waitFor();
    expect(await page.getByLabel('Sort napplets').locator('option').allTextContents()).toEqual([
      'Newest',
      'Recently updated',
      'Featured',
    ]);
    expect(
      await page.evaluate(() => {
        const rail = document.querySelector('.social-discovery')!;
        const tools = document.querySelector('.gallery-tools')!;
        const grid = document.querySelector('.napplet-grid')!;
        return (
          !!(rail.compareDocumentPosition(tools) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          !!(tools.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      }),
    ).toBe(true);

    expect(await page.locator('.social-rail-liked .napplet-card').count()).toBe(6);
    expect(await card.getByRole('button', { name: /^Like .*1 likes/ }).count()).toBe(1);
    expect(await card.getByRole('button', { name: /^Comment on .*1 comments/ }).count()).toBe(1);
    // Anonymous visitors can create an invoice without touching the installed signer.
    for (let i = 0; i < 2; i++) {
      walletOptions.plainDescription = i === 1;
      await card.getByRole('button', { name: /^Zap / }).click();
      await page.getByRole('button', { name: 'Create anonymous zap invoice', exact: true }).click();
      await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          (document.querySelector('.lightning-code canvas') as HTMLCanvasElement)?.width === 280,
      );
      expect(
        await page.getByRole('link', { name: 'Open Lightning wallet' }).getAttribute('href'),
      ).toBe(`lightning:${wallet.invoices[i]}`);
      if (i === 1) {
        wallet.settle(i, false); // LUD-21 works before any relay receives the receipt.
        await page.getByText('Zap sent!', { exact: true }).waitFor();
      } else {
        expect(await page.getByText('Zap sent!', { exact: true }).count()).toBe(0);
        await page.getByRole('button', { name: 'Close', exact: true }).click();
      }
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    expect(await card.getByRole('button', { name: /^Zap .*1 zaps, 21 sats/ }).count()).toBe(1);
    wallet.settle(1);
    expect(accountSignatures).toBe(0);
    expect(wallet.requests[0].pubkey).not.toBe(fixture.pubkey);
    expect(wallet.requests[0].pubkey).not.toBe(wallet.requests[1].pubkey);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const attempts: string[] = [];
    onPublish = (event) => {
      attempts.push(JSON.stringify(event));
      return attempts.length !== 1;
    };
    await card.getByRole('button', { name: /^Like / }).click();
    await card.getByRole('button', { name: 'Retry like', exact: true }).waitFor();
    expect(await page.locator('.gallery-pending, .card-social-feedback').count()).toBe(0);
    await card.getByRole('button', { name: 'Retry like', exact: true }).click();
    await card.getByRole('button', { name: /^Unlike .*2 likes/ }).waitFor();
    expect(await card.getByText('Liked.', { exact: true }).count()).toBe(0);
    expect(attempts[0]).toBe(attempts[1]);
    expect(accountSignatures).toBe(1);
    await card.getByRole('button', { name: /^Unlike / }).click();
    await card.getByRole('button', { name: /^Like .*1 likes/ }).waitFor();
    expect(await card.getByText('Like removed.', { exact: true }).count()).toBe(0);
    // One canonical comment destination from every copy of a card; hydration focuses the field.
    await card.getByRole('link', { name: /^Comment on / }).click();
    await page.getByLabel('Leave a little note').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'napplet-comment');
    expect(new URL(page.url()).hash).toBe('#comments');
    await page.getByLabel('Leave a little note').fill('From the gallery bubble.');
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    await page.getByText('From the gallery bubble.', { exact: true }).waitFor();
    await page.goBack();
    await card.getByRole('link', { name: /^Comment on .*2 comments/ }).waitFor();
    // Rails and the main grid own one active player, even for repeated cards.
    const likedCard = page.locator('.social-rail-liked .napplet-card').filter({
      has: page.getByRole('link', { name: fixture.title, exact: true }),
    });
    await likedCard.locator('.card-preview').click();
    await likedCard.locator('iframe').waitFor();
    expect(await page.locator('.napplet-card iframe').count()).toBe(1);
    await card.locator('.card-preview').click();
    await card.locator('iframe').waitFor();
    expect(await page.locator('.napplet-card iframe').count()).toBe(1);
    await card.getByRole('button', { name: 'Stop napplet', exact: true }).click();
    expect(await page.locator('.napplet-card iframe').count()).toBe(0);
    // Explicit anonymous mode also bypasses the connected profile signer.
    const signedBefore = accountSignatures;
    await card.getByRole('button', { name: /^Zap / }).click();
    await page.getByLabel('Zap anonymously', { exact: true }).check();
    await page.getByRole('button', { name: 'Create anonymous zap invoice' }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
    expect(accountSignatures).toBe(signedBefore);
    expect(wallet.requests[2].pubkey).not.toBe(fixture.pubkey);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await mkdir(join(root, '.local/gallery-social-check'), { recursive: true });
    await page.locator('.social-discovery').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: join(root, '.local/gallery-social-check/desktop.png'),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.social-rail-liked').scrollIntoViewIfNeeded();
    const track = page.locator('.social-rail-liked .social-rail-track');
    expect(await track.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: 'Next most liked', exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector('.social-rail-liked .social-rail-track')!.scrollLeft > 100,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: join(root, '.local/gallery-social-check/mobile.png'),
      animations: 'disabled',
    });
    await card.getByRole('button', { name: /^Zap / }).click();
    await page.getByLabel('Zap anonymously', { exact: true }).check();
    await page.getByRole('button', { name: 'Create anonymous zap invoice' }).click();
    await page.getByLabel('Lightning invoice', { exact: true }).waitFor();
    const box = await page.getByRole('dialog').boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    await page.screenshot({
      path: join(root, '.local/gallery-social-check/anonymous-zap.png'),
      animations: 'disabled',
    });
    expect(rejected).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
