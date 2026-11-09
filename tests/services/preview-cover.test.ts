import { afterAll, beforeAll, expect, test } from 'bun:test';
import type { Browser, Page } from '@playwright/test';
import { browserEngine } from '../../apps/cli/src/browser';

let browser: Browser, server: ReturnType<typeof Bun.serve>;
beforeAll(async () => {
  const bundle = await Bun.build({
    entrypoints: ['tests/fixtures/preview-cover.tsx'],
    target: 'browser',
    plugins: [
      {
        name: 'web-workspace',
        setup(build) {
          build.onResolve({ filter: /^@\// }, (args) => ({
            path: Bun.resolveSync('./src/' + args.path.slice(2), process.cwd() + '/apps/web'),
          }));
        },
      },
    ],
  });
  if (!bundle.success) throw Error(String(bundle.logs));
  const clip = await Bun.file('tests/fixtures/preview.webm').bytes();
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/app.js')
        return new Response(bundle.outputs[0], {
          headers: { 'content-type': 'application/javascript' },
        });
      if (path === '/clip.webm')
        return new Response(clip, { headers: { 'content-type': 'video/webm' } });
      return new Response(
        `<style>
      body{margin:0}nav{height:50px}.first-row{display:flex}.card-cover{width:240px;height:140px;position:relative}
      video{position:absolute;inset:0;width:100%;height:100%}.spacer{height:650px}
    </style><div id="app"></div><script type="module" src="/app.js"></script>`,
        { headers: { 'content-type': 'text/html' } },
      );
    },
  });
  browser = await (await browserEngine()).chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

async function active(page: Page, covers: string[]) {
  await page.waitForFunction((expected) => {
    const playing = [...document.querySelectorAll<HTMLVideoElement>('video.is-active')]
      .filter((video) => !video.paused)
      .map((video) => video.closest<HTMLElement>('[data-cover]')!.dataset.cover!)
      .sort();
    return JSON.stringify(playing) === JSON.stringify([...expected].sort());
  }, covers);
}
async function clickControl(page: Page, name: string) {
  // Keep controls from scrolling the media wall back into view during a test.
  await page
    .getByRole('button', { name, exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
}

test('grouped previews play together, stop offscreen and yield to explicit playback', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  page.setDefaultTimeout(4000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(String(server.url));
    await active(page, ['one', 'two']);
    await page.waitForFunction(() =>
      [...document.querySelectorAll<HTMLVideoElement>('.first-row video')].every(
        (video) => video.currentTime > 0.05,
      ),
    );
    expect(
      await page
        .locator('video')
        .evaluateAll((videos) =>
          (videos as HTMLVideoElement[]).every(
            (video) => video.muted && video.loop && video.playsInline,
          ),
        ),
    ).toBe(true);
    expect(await page.locator('[data-cover="three"] video').getAttribute('src')).toBeNull();

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await active(page, ['three']);
    expect(
      await page
        .locator('.first-row video')
        .evaluateAll((videos) =>
          (videos as HTMLVideoElement[]).every(
            (video) => !video.hasAttribute('src') && video.paused,
          ),
        ),
    ).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await active(page, ['one', 'two']);

    for (const name of ['Start napplet', 'Start media']) {
      await clickControl(page, name);
      await active(page, []);
      // New visibility events must not let previews interrupt the active explicit owner.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(150);
      await active(page, []);
      await clickControl(page, 'Stop explicit playback');
      await page.evaluate(() => window.scrollTo(0, 0));
      await active(page, ['one', 'two']);
    }

    await clickControl(page, 'Toggle previews');
    await active(page, []);
    await clickControl(page, 'Toggle previews');
    await active(page, ['one', 'two']);
    // Exercise the document-visibility contract without relying on browser foreground heuristics.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await active(page, []);
    await page.evaluate(() => {
      delete (document as any).hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await active(page, ['one', 'two']);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30000);

test('group autoplay respects reduced motion and data saving', async () => {
  const motion = await browser.newPage({
    viewport: { width: 800, height: 400 },
    reducedMotion: 'reduce',
  });
  const saving = await browser.newPage({ viewport: { width: 800, height: 400 } });
  const requested: string[] = [];
  saving.on('request', (request) => {
    if (request.url().endsWith('/clip.webm')) requested.push(request.url());
  });
  try {
    await motion.goto(String(server.url));
    await motion.waitForTimeout(150);
    await active(motion, []);
    expect(await motion.locator('video[src]').count()).toBe(0);
    await motion.emulateMedia({ reducedMotion: 'no-preference' });
    await active(motion, ['one', 'two']);
    await motion.emulateMedia({ reducedMotion: 'reduce' });
    await active(motion, []);
    await saving.addInitScript(() =>
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: true },
        configurable: true,
      }),
    );
    await saving.goto(String(server.url));
    await saving.waitForTimeout(150);
    await active(saving, []);
    expect(await saving.locator('video[src]').count()).toBe(0);
    expect(requested).toEqual([]);
  } finally {
    await motion.close();
    await saving.close();
  }
}, 15000);

test('existing ungrouped covers keep a single active preview', async () => {
  const page = await browser.newPage({ viewport: { width: 800, height: 400 } });
  try {
    await page.goto(String(server.url) + '?exclusive');
    await page.waitForFunction(() => document.querySelectorAll('video.is-active').length === 1);
    expect(
      await page
        .locator('video')
        .evaluateAll(
          (videos) => (videos as HTMLVideoElement[]).filter((video) => !video.paused).length,
        ),
    ).toBe(1);
  } finally {
    await page.close();
  }
}, 10000);
