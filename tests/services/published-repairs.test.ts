import { afterAll, beforeAll, expect, test } from 'bun:test';
import { chromium, expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { finalizeEvent, generateSecretKey, matchFilters } from 'nostr-tools';
import { currentShell } from './current-shell-host';

const enabled = process.env.SOY_REPAIRS_ROOT ? test : test.skip;
let browser: Browser;
if (process.env.SOY_REPAIRS_ROOT) {
  // One browser process, isolated context per case. Repeated Chromium launches
  // hit intermittent stdio/socket failures in Bun's child_process compatibility.
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });
}
async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const state = window as any;
    state.audioContexts = [];
    state.mediaActions = {};
    const Original = window.AudioContext;
    window.AudioContext = class extends Original {
      constructor(options?: AudioContextOptions) {
        super(options);
        state.audioContexts.push(this);
      }
    };
    if (navigator.mediaSession) {
      const set = navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
      navigator.mediaSession.setActionHandler = (action, handler) => {
        state.mediaActions[action] = handler;
        set(action, handler);
      };
    }
  });
}
// Explicitly limited to the operator's published projects. This suite never
// modifies, signs for, or republishes a third-party author's application.
for (const name of [
  'obsidian-breaker',
  'truffle-rush',
  'funclet',
  'napplet-machines-v8',
  'physics-type',
  'rail-game',
  'soybert-3d',
  'soyindent-evil',
])
  for (const mode of ['allowed', 'absent', 'denied'])
    enabled(
      `${name} repair in independent Paja (${mode})`,
      async () => {
        const html = await Bun.file(
          resolve(process.env.SOY_REPAIRS_ROOT!, name, 'dist/index.html'),
        ).text();
        const host = await currentShell(html, { absent: mode === 'absent' });
        const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(6000);
          await observeAudio(page);
          const errors: string[] = [];
          page.on('pageerror', (error) => errors.push(error.message));
          // Signed station through the real OUTBOX path. No public relay or stream.
          const station = finalizeEvent(
            {
              kind: 31237,
              created_at: Math.floor(Date.now() / 1000),
              tags: [
                ['d', 'radio:fixture'],
                ['name', 'Acceptance Radio'],
              ],
              content: JSON.stringify({
                streams: [{ url: 'https://radio.example/live.mp3', format: 'mp3', primary: true }],
              }),
            },
            generateSecretKey(),
          );
          await page.routeWebSocket(/^wss:/, (socket) => {
            socket.onMessage((raw) => {
              const [type, id, ...filters] = JSON.parse(String(raw));
              if (type !== 'REQ') return;
              if (matchFilters(filters, station))
                socket.send(JSON.stringify(['EVENT', id, station]));
              socket.send(JSON.stringify(['EOSE', id]));
            });
          });
          await page.goto(host.url, { waitUntil: 'domcontentloaded' });
          const app = page.frameLocator('iframe').last();
          await app.locator('body').waitFor();
          if (mode === 'denied')
            await page.getByRole('button', { name: 'media:control', exact: true }).click();
          // Use real pointer input with coordinates measured in the owning
          // documents. Playwright's cross-frame scroll/layout action can stall
          // on continuously animated WebGL scenes even when controls are visible.
          const click = async (selector: string) => {
            const frame = page.frames().find((f) => f.parentFrame())!;
            const origin = await page.evaluate(() => {
              const r = document.querySelector('iframe')!.getBoundingClientRect();
              return { x: r.x, y: r.y };
            });
            const point = await frame.evaluate((selector) => {
              const r = document.querySelector(selector)!.getBoundingClientRect();
              if (r.width <= 0 || r.height <= 0)
                throw new Error(`Control is not visible: ${selector}`);
              return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            }, selector);
            await page.mouse.click(origin.x + point.x, origin.y + point.y);
          };
          if (name === 'obsidian-breaker') await click('canvas');
          if (name === 'truffle-rush') {
            await click('canvas');
            await page.keyboard.press('Enter');
          }
          if (name === 'napplet-machines-v8' || name === 'rail-game') await click('#soundButton');
          if (name === 'physics-type') await click('#sound');
          if (name === 'soybert-3d') await click('#enter');
          if (name === 'soyindent-evil') await click('#startButton');
          if (name === 'funclet') {
            await app.getByRole('button', { name: /Acceptance Radio/ }).click();
            if (mode === 'allowed')
              await browserExpect(app.locator('#player-error')).toContainText(
                'This shell cannot play radio streams',
              );
            if (mode === 'absent') await browserExpect(app.locator('#play-toggle')).toBeDisabled();
            else await app.locator('#play-toggle').click();
          }
          const frame = page.frames().find((f) => f.parentFrame())!;
          // Poll independently of rendering: a background/throttled rAF must not
          // make an already-delivered MEDIA command look like a protocol timeout.
          const wait = { polling: 100 };
          if (mode === 'allowed' && name !== 'funclet') {
            await page.waitForFunction(
              () => typeof (window as any).mediaActions.pause === 'function',
              undefined,
              wait,
            );
            await frame.waitForFunction(
              () => (window as any).audioContexts.some((c: AudioContext) => c.state === 'running'),
              undefined,
              wait,
            );
            await page.evaluate(() => (window as any).mediaActions.pause({ action: 'pause' }));
            await frame.waitForFunction(
              () =>
                (window as any).audioContexts.every((c: AudioContext) => c.state === 'suspended'),
              undefined,
              wait,
            );
            // Genuine keyboard input, including an unlock gesture, cannot undo the host pause.
            await page.keyboard.press('Space');
            expect(
              await frame.evaluate(() =>
                (window as any).audioContexts.every((c: AudioContext) => c.state === 'suspended'),
              ),
            ).toBe(true);
            await page.evaluate(() => (window as any).mediaActions.play({ action: 'play' }));
            await frame.waitForFunction(
              () => (window as any).audioContexts.some((c: AudioContext) => c.state === 'running'),
              undefined,
              wait,
            );
            await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
            await frame.waitForFunction(
              () => (window as any).audioContexts.every((c: AudioContext) => c.state === 'closed'),
              undefined,
              wait,
            );
          } else {
            await frame.waitForFunction(
              () => (window as any).audioContexts.every((c: AudioContext) => c.state === 'closed'),
              undefined,
              wait,
            );
            if (mode === 'absent')
              expect(await frame.evaluate(() => (window as any).audioContexts.length)).toBe(0);
          }
          expect(errors).toEqual([]);
          console.log(
            JSON.stringify({
              repair: name,
              mode,
              htmlSha256: host.hash,
              host: '@kehto/paja@0.24.4',
              result: 'passed',
            }),
          );
        } finally {
          await context.close();
          host.close();
        }
      },
      30000,
    );
