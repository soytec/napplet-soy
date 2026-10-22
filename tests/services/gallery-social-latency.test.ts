import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, matchFilters } from 'nostr-tools';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { likeTemplate, commentTemplate, socialScope } from '../../packages/protocol/src/social';
import fixtures from '../../packages/backend/data/catalog.json';

test('gallery rankings appear while a fallback relay is still stalled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gallery-latency-'));
  const index = new IndexStore(join(directory, 'index'), true);
  const key = new Uint8Array(32).fill(7); // Public fixture only.
  const now = Math.floor(Date.now() / 1000);
  const events = fixtures.flatMap((n) => [
    n.current,
    finalizeEvent(likeTemplate(socialScope(n.current), n.current, now), key),
    finalizeEvent(
      commentTemplate(socialScope(n.current), 'Hello from a fast relay', undefined, now),
      key,
    ),
  ]);
  for (const fixture of fixtures) {
    index.admit(fixture.current);
    const entry = await publicNapplet(fixture.current, []);
    index.project(
      entry.revisionId,
      { ...entry, availability: 'ready' },
      Date.now() + 60000,
      Date.now() + 60000,
    );
  }
  index.close();
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const guard = setTimeout(() => server.kill(), 20000);
  const browser = await chromium.launch();
  try {
    let output = '',
      origin = '';
    for await (const chunk of server.stdout) {
      output += new TextDecoder().decode(chunk);
      origin = /listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? '';
      if (origin) break;
    }
    expect(origin).not.toBe('');
    const context = await browser.newContext();
    await context.addInitScript(() =>
      localStorage.setItem(
        'napplet:network',
        JSON.stringify({
          relays: ['wss://fast.example', 'wss://stalled.example'],
          blossom: [],
        }),
      ),
    );
    // Only the fast relay advertises NIP-45; the stalled relay never answers NIP-11 either.
    await context.route('https://fast.example/', (route) =>
      route.fulfill({
        json: { supported_nips: [1, 11, 45] },
        headers: { 'access-control-allow-origin': '*' },
      }),
    );
    await context.route('https://stalled.example/', () => {});
    let firstSocialEvent = 0;
    let socialRequests = 0;
    await context.routeWebSocket(/wss?:\/\//, (route) => {
      route.onMessage((raw) => {
        const m = JSON.parse(String(raw));
        if (!route.url().includes('fast.example')) return;
        if (m[0] === 'COUNT') {
          socialRequests++;
          const count = events.filter((event) => matchFilters(m.slice(2), event)).length;
          if (count && !firstSocialEvent) firstSocialEvent = performance.now();
          route.send(JSON.stringify(['COUNT', m[1], { count }]));
          return;
        }
        if (m[0] !== 'REQ') return;
        for (const event of events)
          if (matchFilters(m.slice(2), event)) route.send(JSON.stringify(['EVENT', m[1], event]));
        route.send(JSON.stringify(['EOSE', m[1]]));
      });
    });
    const page = await context.newPage();
    await page.goto(new URL(origin).origin);
    await ui.poll(() => firstSocialEvent).toBeGreaterThan(0);
    await ui(page.locator('.social-rail-liked .napplet-card')).toHaveCount(fixtures.length, {
      timeout: 2000,
    });
    await ui(page.locator('.social-rail-commented .napplet-card')).toHaveCount(fixtures.length, {
      timeout: 2000,
    });
    const elapsed = performance.now() - firstSocialEvent;
    console.log(
      `Social rankings visible ${Math.round(elapsed)}ms after the fast relay answered counts (${socialRequests} COUNT queries).`,
    );
    expect(elapsed).toBeLessThan(2500);
  } finally {
    await browser.close();
    server.kill();
    await server.exited;
    clearTimeout(guard);
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
