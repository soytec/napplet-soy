import { test, expect } from '@playwright/test';
import { nip19 } from 'nostr-tools';
import records from '../../packages/backend/data/catalog.json' with { type: 'json' };

// Discover a visible tag and creation instead of depending on bundled examples.
// Production and local discovery use the same ordinary gallery entries.
test('gallery SSR, filtering, navigation and browser history', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const response = await request.get('/');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Small code.');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'The playground' })).toBeVisible();
  await expect(page.locator('.napplet-card').first()).toBeVisible();
  await expect(page.getByLabel('Sort napplets')).toHaveValue('new');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Public napplets' })).toHaveCount(0);
  expect(await page.locator('.napplet-grid > .napplet-card').count()).toBeLessThanOrEqual(24);
  const nextPage = page.getByRole('link', { name: 'Next →', exact: true });
  if (await nextPage.isVisible()) {
    await nextPage.click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('.napplet-card').first()).toBeVisible();
    await page.getByRole('link', { name: '← Previous', exact: true }).click();
    await expect(page.locator('.napplet-card').first()).toBeVisible();
  }
  await page.screenshot({
    path: '.local/gallery-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  const filter = page.getByRole('button', { name: /^Filter by #/ }).first();
  const label = (await filter.getAttribute('aria-label'))!;
  const topic = label.replace('Filter by #', '');
  await filter.click();
  await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(new URL(page.url()).searchParams.get('tag')).toBe(topic);
  const card = page.locator('.napplet-card').first();
  await expect(card).toBeVisible();
  const title = (await card.locator('.card-heading a').textContent())!;
  await card.locator('.card-heading a').click();
  await expect(page.locator('h1')).toContainText(title);
  await page.goBack();
  await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const tagLink = page.locator('.napplet-card .topic-tags a').first();
  const linkedTopic = (await tagLink.textContent())!.slice(1);
  await tagLink.click();
  expect(new URL(page.url()).searchParams.get('tag')).toBe(linkedTopic);
  await page.reload();
  await expect(
    page.getByRole('button', { name: `Filter by #${linkedTopic}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Sort napplets').selectOption('featured');
  await expect(page.getByLabel('Sort napplets')).toHaveValue('featured');
  await page.getByLabel('Sort napplets').selectOption('new');
  expect(errors).toEqual([]);
});

test('plays only on request; opaque sandbox blocks host access and network', async ({ page }) => {
  await page.goto('/@space-lab/soft-orbit');
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start Soft orbit' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(page.frameLocator('iframe').locator('canvas')).toBeVisible();
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  const restrictions = await frame.evaluate(async () => {
    let parentBlocked = false,
      storageBlocked = false,
      networkBlocked = false;
    try {
      void parent.document;
    } catch {
      parentBlocked = true;
    }
    try {
      localStorage.setItem('probe', '1');
    } catch {
      storageBlocked = true;
    }
    try {
      await fetch('https://example.com');
    } catch {
      networkBlocked = true;
    }
    return { parentBlocked, storageBlocked, networkBlocked };
  });
  expect(restrictions).toEqual({ parentBlocked: true, storageBlocked: true, networkBlocked: true });
  await page.getByRole('button', { name: 'Stop napplet', exact: true }).click();
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('tampered artifact is never executed', async ({ page }) => {
  await page.route(
    (url) => /\/[a-f0-9]{64}$/.test(url.pathname),
    (route) =>
      route.fulfill({
        body: '<script>parent.hacked=true</script>',
        contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' },
      }),
  );
  await page.goto('/@space-lab/blob-friend');
  await page.getByRole('button', { name: 'Start Blob friend' }).click();
  await expect(page.getByRole('alert')).toContainText('verified file');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('portable and pinned source routes resolve; unknown addresses return 404', async ({
  page,
  request,
}) => {
  const n = records[0];
  for (const path of [`/n/${n.naddr}`, `/r/${n.snapshot.id}`]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(n.title);
  }
  await page.goto(`/r/${n.snapshot.id}/source`);
  await expect(page.getByRole('heading', { name: 'Made of little things.' })).toBeVisible();
  await page.getByRole('link', { name: 'Built HTML', exact: true }).click();
  await expect(page.locator('pre')).toContainText('<canvas');
  await expect(page.locator('iframe')).toHaveCount(0);
  const artifact = await request.get(
    `${n.current.tags.find((t) => t[0] === 'server')![1]}/${n.artifactHash}`,
  );
  expect(await artifact.text()).toContain('<canvas');
  expect((await request.get('/n/not-a-real-address')).status()).toBe(404);
  expect((await request.get('/@nobody/missing')).status()).toBe(404);
});

test('detail pages expose copyable naddr and release nevent', async ({ page, context }) => {
  const n = records[0];
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`/n/${n.naddr}`);
  await expect(page.getByTestId('napplet-naddr')).toHaveText(n.naddr);
  const nevent = page.getByTestId('napplet-nevent');
  await expect(nevent).toHaveText(/^nevent1/);
  const decoded = nip19.decode((await nevent.textContent())!);
  expect(decoded.type).toBe('nevent');
  expect(decoded.data).toMatchObject({ id: n.snapshot.id, author: n.pubkey });
  const copy = page.getByRole('button', { name: 'Copy naddr' });
  // Retry until hydration attaches the click handler.
  await expect(async () => {
    await copy.click();
    await expect(copy).toHaveAttribute('data-state', 'copied', { timeout: 1000 });
  }).toPass();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(n.naddr);
  // A pinned release has no moving address; only its own event is offered.
  await page.goto(`/r/${n.snapshot.id}`);
  await expect(page.getByTestId('napplet-naddr')).toHaveCount(0);
  await expect(page.getByTestId('napplet-nevent')).toHaveText(/^nevent1/);
});

test('server-rendered gallery loads responsive styles without JavaScript', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await context.newPage();
    await page.goto('/');
    const stylesheets = await page
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
    expect(stylesheets.length).toBeGreaterThan(0);
    for (const url of stylesheets) {
      const response = await request.get(url);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/css');
    }
    await expect(page.locator('.napplet-grid')).toHaveCSS('display', 'grid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await context.close();
  }
});

test('mobile gallery has no horizontal overflow and signer failure is actionable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.napplet-card').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: '.local/gallery-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  const moreTags = page.getByRole('button', { name: 'More tags', exact: true });
  if (await moreTags.isVisible()) await moreTags.click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole('button', { name: /^Filter by #/ })
    .first()
    .click();
  await expect(page.locator('.napplet-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('button', { name: 'Connect browser extension' }).click();
  await expect(page.getByRole('alert')).toContainText('Install or unlock a Nostr extension');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('share metadata is present without JavaScript on named, portable, and pinned pages', async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const n = records[0];
  let currentCanonical: string | undefined;
  try {
    for (const path of [`/@space-lab/${n.slug}`, `/n/${n.naddr}`, `/r/${n.snapshot.id}`]) {
      await page.goto(path);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', n.title);
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
        'content',
        'summary_large_image',
      );
      const image = await page.locator('meta[property="og:image"]').getAttribute('content');
      expect(image).toMatch(/^https?:\/\//);
      const response = await request.get(new URL(image!).pathname);
      expect(response.headers()['content-type']).toBe('image/png');
      const bytes = await response.body();
      expect(bytes.readUInt32BE(16)).toBe(1200);
      expect(bytes.readUInt32BE(20)).toBe(630);
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toBeTruthy();
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', canonical!);
      if (path.startsWith('/r/')) expect(new URL(canonical!).pathname).toBe(path);
      else {
        expect(new URL(canonical!).pathname).toMatch(
          /^\/(a\/[a-z0-9-]+-[a-f0-9]{12,64}|n\/naddr1[a-z0-9]+)$/,
        );
        currentCanonical ??= canonical!;
        expect(canonical).toBe(currentCanonical);
      }
    }
    await page.screenshot({ path: '.local/og-page-no-js.png', fullPage: true });
  } finally {
    await context.close();
  }
  const headers = { 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'http' };
  const html = await (await request.get(`/n/${n.naddr}`, { headers })).text();
  expect(html).not.toContain('attacker.invalid');
  expect((await request.get(`/api/og/${'0'.repeat(64)}`)).status()).toBe(404);
});
