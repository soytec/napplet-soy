import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters } from 'nostr-tools';
import sharp from 'sharp';
import { sha256 } from '../../packages/protocol/src';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { IndexStore } from '../../packages/backend/src/index-store';
import { indexPreviewVideos } from '../../packages/backend/src/preview-videos';
import { indexPreviewImages } from '../../packages/backend/src/preview-images';
import { MANIFEST_PRESENTATION_PROFILE } from '../../packages/protocol/src/presentation';
import fixtures from '../../packages/backend/data/catalog.json';

for (const format of ['legacy', 'manifest'] as const) {
  test(`${format} featured clips autoplay while thumbnails stay clean, respect motion settings and leave OG static`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'soyli-video-gallery-'));
    const root = resolve(import.meta.dir, '../..');
    const key = new Uint8Array(32);
    key[31] = 1;
    const bytes = await Bun.file(join(root, 'tests/fixtures/preview.webm')).bytes(),
      hash = await sha256(bytes);
    const url = `https://media.example/${hash}${format === 'legacy' ? '.webm' : ''}`;
    const image = await sharp({
      create: { width: 120, height: 75, channels: 4, background: '#9354cf' },
    })
      .png()
      .toBuffer();
    const imageHash = await sha256(image);
    const at = Math.floor(Date.now() / 1000);
    const descriptor = finalizeEvent(
      {
        kind: 32267,
        created_at: at,
        content: url,
        tags: [
          ['d', 'clip'],
          ['imeta', `url ${url}`, 'm video/webm', `x ${hash}`],
        ],
      },
      key,
    );
    const current = finalizeEvent(
      {
        kind: 35129,
        created_at: at,
        content: format === 'manifest' ? 'A direct presentation fixture' : '',
        tags: [
          ...(format === 'legacy'
            ? fixtures[0].current.tags.filter((t) => !['app', 'd', 'title'].includes(t[0]))
            : [
                ['x', fixtures[0].artifactHash],
                ['server', 'https://media.example'],
                ['presentation', MANIFEST_PRESENTATION_PROFILE],
                ['screenshot', imageHash, 'image/png'],
                ['preview', hash, 'video/webm'],
              ]),
          ['d', 'video-demo'],
          ['title', 'Video demo'],
          ...(format === 'legacy'
            ? [['app', `32267:${descriptor.pubkey}:clip`, 'wss://relay.example']]
            : []),
        ],
      },
      key,
    );
    const entry = await publicNapplet(current);
    if (format === 'manifest') {
      await indexPreviewImages(join(directory, 'index'), [entry], [], AbortSignal.timeout(3000), {
        download: async () => image,
      });
      expect(entry.preview?.descriptor.id).toBe(current.id);
    }
    await indexPreviewVideos(
      join(directory, 'index'),
      [entry],
      format === 'legacy' ? [descriptor] : [],
      AbortSignal.timeout(3000),
      { download: async () => bytes },
    );
    expect(entry.video?.hash).toBe(hash);
    const store = new IndexStore(join(directory, 'index'), true);
    store.admit(current);
    await Bun.write(
      join(directory, 'index/artifacts', `${entry.artifactHash}.html`),
      Bun.file(join(root, 'packages/backend/data/artifacts', `${entry.artifactHash}.html`)),
    );
    store.project(
      current.id,
      { ...entry, availability: 'ready' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
    const fallback = fixtures[1].current;
    store.admit(fallback);
    store.project(
      fallback.id,
      { ...(await publicNapplet(fallback)), availability: 'ready' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
    store.close();
    await Bun.write(
      join(directory, 'policy.json'),
      JSON.stringify({
        version: 1,
        revision: 0,
        rules: [],
        admins: [],
        audit: [],
        used: [],
        featured: [current, fallback].map((e) => ({
          type: 'event',
          target: e.id,
          actor: e.pubkey,
          reason: 'Offline fixture',
          at: 0,
        })),
      }),
    );
    const relay = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response();
      },
      websocket: {
        message(socket, raw) {
          const m = JSON.parse(String(raw));
          if (m[0] === 'REQ') {
            for (const e of format === 'legacy'
              ? [current, descriptor, fallback]
              : [current, fallback])
              if (matchFilters(m.slice(2), e)) socket.send(JSON.stringify(['EVENT', m[1], e]));
            socket.send(JSON.stringify(['EOSE', m[1]]));
          }
        },
      },
    });
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
    const port = probe.port;
    probe.stop(true);
    const origin = `http://127.0.0.1:${port}`;
    const playbackUrl = format === 'manifest' ? `${origin}/api/previews/${current.id}/video` : url;
    const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOST: '127.0.0.1',
        PORT: String(port),
        SPACE_SITE_ORIGIN: origin,
        SPACE_INDEX_DIR: join(directory, 'index'),
        SPACE_INDEX_RELAYS: `ws://127.0.0.1:${relay.port}/`,
        SPACE_PUBLICDEV: '0',
        SPACE_MODERATION_FILE: join(directory, 'policy.json'),
        SPACE_COMMUNITY_DIR: join(directory, 'community'),
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
      if (format === 'manifest') {
        const coverResponse = await fetch(`${origin}/api/previews/${current.id}`);
        expect(coverResponse.headers.get('content-type')).toBe('image/png');
        expect((await sharp(await coverResponse.arrayBuffer()).metadata()).width).toBe(120);
        expect(
          (await fetch(`${origin}/api/previews/${current.id}`, { method: 'HEAD' })).status,
        ).toBe(200);
        const range = await fetch(playbackUrl, { headers: { Range: 'bytes=0-15' } });
        expect(range.status).toBe(206);
        expect(new Uint8Array(await range.arrayBuffer())).toEqual(bytes.slice(0, 16));
        expect((await fetch(playbackUrl, { method: 'HEAD' })).headers.get('content-type')).toBe(
          'video/webm',
        );
      }
      const page = await browser.newPage({
        viewport: { width: 1365, height: 1000 },
        reducedMotion: 'no-preference',
      });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      let videoRequests = 0;
      page.on('request', (req) => {
        if (req.url() === url) videoRequests++;
      });
      await page.route(url, (route) =>
        route.fulfill({ contentType: 'video/webm', body: Buffer.from(bytes) }),
      );
      await page.goto(origin);
      const hero = page.locator('.featured-hero');
      const featuredVideo = hero.locator('video').first();
      await browserExpect
        .poll(
          () => featuredVideo.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused),
          {
            timeout: 2000,
          },
        )
        .toBe(true);
      expect(await featuredVideo.evaluate((v: HTMLVideoElement) => v.muted && v.playsInline)).toBe(
        true,
      );
      await browserExpect(hero.locator('.clip-toggle')).toHaveCount(0);
      if (format === 'manifest') {
        expect(await featuredVideo.getAttribute('src')).toBe(`/api/previews/${current.id}/video`);
        expect(videoRequests).toBe(0);
        expect(await hero.locator('img').first().getAttribute('src')).toBe(
          `/api/previews/${current.id}`,
        );
      }
      await page.getByRole('button', { name: 'Pause featured clip', exact: true }).click();
      await browserExpect(featuredVideo).not.toHaveAttribute('src');
      await page.getByRole('button', { name: 'Play featured clip', exact: true }).click();
      await browserExpect
        .poll(() => featuredVideo.evaluate((v: HTMLVideoElement) => !v.paused))
        .toBe(true);
      await page.getByRole('button', { name: 'Next featured napplet' }).click();
      await browserExpect(featuredVideo).not.toHaveAttribute('src');
      await page.getByRole('button', { name: 'Previous featured napplet' }).click();
      await browserExpect
        .poll(() => featuredVideo.evaluate((v: HTMLVideoElement) => !v.paused))
        .toBe(true);
      const cover = page
        .locator('.napplet-grid .napplet-card')
        .filter({ has: page.getByRole('link', { name: 'Video demo', exact: true }) })
        .locator('.card-cover');
      const video = cover.locator('video');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await browserExpect(featuredVideo).not.toHaveAttribute('src');
      await cover.scrollIntoViewIfNeeded();
      await cover.hover();
      await browserExpect(cover.locator('button')).toHaveCount(0);
      await browserExpect(video).not.toHaveAttribute('src');
      expect(await page.locator('.player-stage iframe').count()).toBe(0);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await cover.hover();
      await browserExpect
        .poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2))
        .toBe(true);
      expect(await video.evaluate((v: HTMLVideoElement) => v.muted)).toBe(true);
      await mkdir('.local/video-preview', { recursive: true });
      await page.screenshot({ path: '.local/video-preview/gallery.png' });
      await page.mouse.move(0, 0);
      await browserExpect(video).not.toHaveAttribute('src');
      await page.evaluate(() => window.scrollTo(0, 0));
      await browserExpect(video).not.toHaveAttribute('src');
      expect((await fetch(`${origin}/api/og/${current.id}`)).headers.get('content-type')).toContain(
        'image/png',
      );
      await cover.scrollIntoViewIfNeeded();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: '.local/video-preview/gallery-mobile.png' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      const phone = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      await phone.addInitScript(() =>
        Object.defineProperty(navigator, 'connection', { value: { saveData: true } }),
      );
      await phone.route(url, (route) =>
        route.fulfill({ contentType: 'video/webm', body: Buffer.from(bytes) }),
      );
      const mobile = await phone.newPage();
      await mobile.goto(origin);
      await mobile.locator('.featured-slider').scrollIntoViewIfNeeded();
      const mobileVideo = mobile.locator('.featured-hero video').first();
      await browserExpect(mobileVideo).not.toHaveAttribute('src');
      await mobile.getByRole('button', { name: 'Play featured clip', exact: true }).click();
      await browserExpect
        .poll(() => mobileVideo.evaluate((v: HTMLVideoElement) => !v.paused && v.readyState >= 2))
        .toBe(true);
      await browserExpect
        .poll(() => mobileVideo.evaluate((v: HTMLVideoElement) => v.currentTime))
        .toBeGreaterThan(0.7);
      await mobile.screenshot({ path: '.local/video-preview/featured-mobile.png' });
      expect(await mobile.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        390,
      );
      await phone.close();
      // A failed decorative clip leaves a working static cover, without a dead replay control.
      await page.unroute(url);
      await page.route(playbackUrl, (route) => route.abort());
      await page.goto(origin);
      await page.locator('.featured-slider').scrollIntoViewIfNeeded();
      await browserExpect(page.locator('.featured-hero video')).toHaveCount(0);
      await browserExpect(
        page.getByRole('button', { name: 'Play featured clip', exact: true }),
      ).toHaveCount(0);
      await browserExpect(
        page.getByRole('link', { name: 'Explore featured napplet: Video demo', exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      child.kill();
      await child.exited;
      relay.stop(true);
      await rm(directory, { recursive: true, force: true });
    }
  }, 60000);
}
