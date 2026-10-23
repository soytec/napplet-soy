import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, nip19 } from 'nostr-tools';
import sharp from 'sharp';
import fixtures from '../../packages/backend/data/catalog.json';
import { CommunityStore } from '../../packages/community/src/store';
import { commentTemplate, deletionTemplate, socialScope } from '../../packages/protocol/src/social';

test('rich comments use opt-in sandboxed napplets, lazy media, one player and deletion cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soyli-rich-comments-')),
    root = resolve(import.meta.dir, '../..');
  const scope = socialScope(fixtures[0].current),
    key = new Uint8Array(32);
  key[31] = 12;
  const comment = finalizeEvent(
    commentTemplate(
      scope,
      `Look at this little world.\nnostr:${fixtures[1].naddr}\nhttps://media.example/world.png\nhttps://media.example/clip.webm\nnostr:${fixtures[2].naddr}\n<script>throw new Error('unsafe')</script>`,
    ),
    key,
  );
  const missing = finalizeEvent(
    commentTemplate(
      scope,
      `nostr:${nip19.noteEncode('f'.repeat(64))}`,
      undefined,
      comment.created_at - 1,
    ),
    key,
  );
  const events = [fixtures[0].current, fixtures[1].current, fixtures[2].current, comment, missing];
  const store = new CommunityStore(join(directory, 'community'));
  store.put(scope.key, events);
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      const hash = new URL(req.url).pathname.slice(1);
      return new Response(Bun.file(join(root, 'packages/backend/data/artifacts', `${hash}.html`)), {
        headers: { 'access-control-allow-origin': '*' },
      });
    },
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          for (const e of events)
            if (matchFilters(m.slice(2), e)) socket.send(JSON.stringify(['EVENT', m[1], e]));
          socket.send(JSON.stringify(['EOSE', m[1]]));
        }
      },
    },
  });
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }),
    port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_INDEX_RELAYS: `ws://127.0.0.1:${relay.port}/`,
      SPACE_INDEX_LOCAL_BLOSSOM: `http://127.0.0.1:${relay.port}`,
      SPACE_PUBLICDEV: '0',
    },
    stdout: 'ignore',
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
    const errors: string[] = [],
      mediaRequests: string[] = [],
      remoteRequests: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => {
      if (r.url().startsWith('https://media.example')) remoteRequests.push(r.url());
    });
    const png = await sharp({
      create: { width: 360, height: 180, channels: 3, background: '#72985e' },
    })
      .png()
      .toBuffer();
    const video = await Bun.file(join(root, 'tests/fixtures/preview.webm')).bytes();
    let failImage = false;
    await page.route('https://media.example/**', (route) => {
      const url = route.request().url();
      mediaRequests.push(url);
      const image = new URL(url).pathname.endsWith('.png');
      if (image && failImage)
        return route.fulfill({
          status: 404,
          headers: { 'Cache-Control': 'no-store' },
          json: { error: 'This media is unavailable.' },
        });
      return route.fulfill({
        status: 200,
        headers: { 'Cache-Control': 'no-store' },
        contentType: image ? 'image/png' : 'video/webm',
        body: image ? png : Buffer.from(video),
      });
    });
    await page.goto(`${origin}/n/${fixtures[0].naddr}`);
    const body = page.locator(`#comment-${comment.id}`),
      attachments = body.locator('.comment-napplet');
    await body.getByText('Look at this little world.', { exact: true }).waitFor();
    expect(await page.locator('iframe').count()).toBe(0);
    expect(mediaRequests).toHaveLength(0);
    await page.getByRole('button', { name: `Start ${fixtures[0].title}`, exact: true }).click();
    await browserExpect(page.locator('iframe')).toHaveCount(1);
    await attachments.first().scrollIntoViewIfNeeded();
    await browserExpect(attachments.first().locator('.comment-napplet-caption > a')).toHaveText(
      fixtures[1].title,
    );
    await attachments.first().getByRole('button', { name: 'Play here', exact: true }).click();
    await browserExpect(attachments.first().locator('iframe')).toHaveCount(1);
    await browserExpect(page.locator('iframe')).toHaveCount(1); // Main player was stopped.
    expect(await attachments.first().locator('iframe').getAttribute('sandbox')).not.toContain(
      'allow-same-origin',
    );
    await attachments
      .first()
      .locator('iframe')
      .evaluate((frame) => frame.setAttribute('data-session-test', 'same'));
    await attachments.first().getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await browserExpect(attachments.first().locator('.player-expanded')).toBeVisible();
    await attachments
      .first()
      .getByRole('button', { name: 'Back to comments', exact: true })
      .click();
    await browserExpect(attachments.first().locator('iframe')).toHaveAttribute(
      'data-session-test',
      'same',
    );
    await attachments.first().getByRole('button', { name: 'Stop napplet', exact: true }).click();
    await browserExpect(page.locator('iframe')).toHaveCount(0);
    const media = body.locator('.comment-media'),
      image = media.first().locator('img');
    await media.first().scrollIntoViewIfNeeded();
    await browserExpect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
      .toBe(true);
    expect(mediaRequests.every((u) => new URL(u).pathname.endsWith('.png'))).toBe(true);
    await media.nth(1).getByRole('button', { name: 'Load video', exact: true }).click();
    const clip = media.nth(1).locator('video');
    await browserExpect
      .poll(() => clip.evaluate((v: HTMLVideoElement) => v.readyState >= 1))
      .toBe(true);
    expect(await clip.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await clip.evaluate((v: HTMLVideoElement) => v.play());
    await browserExpect.poll(() => clip.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
    await attachments.nth(1).getByRole('button', { name: 'Play here', exact: true }).click();
    await browserExpect(attachments.nth(1).locator('iframe')).toHaveCount(1);
    await browserExpect(clip).toHaveCount(0);
    await attachments
      .nth(1)
      .locator('iframe')
      .evaluate((frame) => {
        frame.setAttribute('data-session-test', 'scrolled-session');
      });
    expect(
      await page.evaluate(() => {
        window.scrollTo(0, 0);
        const frame = document.querySelector('iframe[data-session-test="scrolled-session"]')!;
        const bounds = frame.getBoundingClientRect();
        return bounds.top >= innerHeight || bounds.bottom <= 0;
      }),
    ).toBe(true);
    // Let IntersectionObserver and the resulting React update run before asserting retention.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await browserExpect(image).toHaveCount(0);
    // Scrolling away unloads decorative media, but retains explicitly started gameplay.
    await browserExpect(attachments.nth(1).locator('iframe')).toHaveAttribute(
      'data-session-test',
      'scrolled-session',
    );
    failImage = true;
    // Native decoded-image caches may reuse an earlier successful URL. Start a new document
    // to exercise a fresh failed original URL without adding private cache-busting parameters.
    await page.reload();
    await media.first().scrollIntoViewIfNeeded();
    await media.first().getByRole('button', { name: 'Retry media', exact: true }).waitFor();
    failImage = false;
    await media.first().getByRole('button', { name: 'Retry media', exact: true }).click();
    await browserExpect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth > 0))
      .toBe(true);
    const absent = page.locator(`#comment-${missing.id}`);
    await absent.getByRole('button', { name: 'Play here', exact: true }).click();
    await absent.getByRole('button', { name: 'Retry napplet', exact: true }).waitFor();
    expect(await absent.locator('iframe').count()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await attachments.first().scrollIntoViewIfNeeded();
    await mkdir('.local/rich-comments', { recursive: true });
    await page.screenshot({ path: '.local/rich-comments/mobile.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.setViewportSize({ width: 1365, height: 1000 });
    await page.screenshot({ path: '.local/rich-comments/desktop.png' });
    events.push(finalizeEvent(deletionTemplate([comment]), key));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await body.getByText('Comment deleted by its author.', { exact: true }).waitFor();
    expect(await body.locator('.comment-attachment').count()).toBe(0);
    expect(remoteRequests).toEqual(mediaRequests);
    expect(remoteRequests.some((url) => url.endsWith('.webm'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    relay.stop(true);
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
