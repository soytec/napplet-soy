import { expect, test } from 'bun:test';
import { expect as browserExpect, type Frame, type Browser } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserEngine } from '../../apps/cli/src/browser';
import { creatorSkills } from '../../apps/cli/src/creator-kit';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { startPreviewServer } from '../../apps/cli/src/preview/server';

// Pads are installed on the host page: player frames are denied the native API and
// receive the shell's focus-scoped NAP-GAMEPAD snapshots through the prelude shim.
async function installSyntheticPads(frame: Frame) {
  await frame.evaluate(() => {
    const state = window as unknown as { testPads: (Gamepad | null)[] };
    state.testPads = [];
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => state.testPads,
    });
  });
}
async function pads(
  frame: Frame,
  controllers: { index: number; mapping?: string; x?: number; jump?: number }[],
) {
  await frame.evaluate((controllers) => {
    const values: unknown[] = [];
    for (const { index, mapping = 'standard', x = 0, jump = 0 } of controllers) {
      values[index] = {
        id: `Synthetic pad ${index}`,
        index,
        mapping,
        connected: true,
        axes: [x, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, i) => ({
          value: i === 0 ? jump : 0,
          pressed: i === 0 && jump > 0.5,
          touched: false,
        })),
      };
    }
    (window as unknown as { testPads: unknown[] }).testPads = values;
  }, controllers);
}

test('shipped controller helper and workshop tester operate inside the real opaque preview sandbox', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soyli-controllers-'));
  let server: ReturnType<typeof startPreviewServer> | undefined, browser: Browser | undefined;
  try {
    // Bundle exactly the source shipped by new/skills update, not a test-only adapter.
    await Bun.write(join(root, 'gamepad.ts'), creatorSkills()['docs/examples/gamepad.ts']);
    await Bun.write(
      join(root, 'fixture.ts'),
      `
      import { createGamepadInput } from './gamepad';
      const input = createGamepadInput();
      let jumps = 0;
      function tick() {
        const frame = input.poll();
        if (frame.players[0]?.actions.jump.pressed) jumps++;
        document.querySelector('#readings').textContent = JSON.stringify({ ...frame, jumps });
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
      addEventListener('pagehide', () => input.dispose());
    `,
    );
    const bundle = await Bun.build({
      entrypoints: [join(root, 'fixture.ts')],
      target: 'browser',
      format: 'iife',
    });
    expect(bundle.success).toBe(true);
    await Bun.write(
      join(root, 'index.html'),
      `<button>Focus game</button><pre id="readings"></pre><script>${await bundle.outputs[0].text()}</script>`,
    );
    await Bun.write(
      join(root, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Controller fixture',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        license: 'MIT',
      }),
    );
    server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets());
    browser = await (await browserEngine()).chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.url.href);
    const gameLocator = page.frameLocator('#stage iframe');
    await gameLocator.getByRole('button', { name: 'Focus game' }).click();
    const game = page.frames().find((f) => f.parentFrame() && f !== page.mainFrame())!;
    expect(
      await game.evaluate(() => ({
        secure: isSecureContext,
        callable: typeof navigator.getGamepads,
        slots: navigator.getGamepads().length,
      })),
    ).toMatchObject({ secure: true, callable: 'function' });
    expect(
      await game.evaluate(() => ({
        policy: (
          document as unknown as { featurePolicy: { allowsFeature(name: string): boolean } }
        ).featurePolicy.allowsFeature('gamepad'),
        shimmed: !Object.getOwnPropertyDescriptor(Navigator.prototype, 'getGamepads')!
          .value.toString()
          .includes('[native code]'),
        api: typeof (window as unknown as { napplet: { gamepad?: unknown } }).napplet.gamepad,
      })),
    ).toEqual({ policy: false, shimmed: true, api: 'object' });
    await browserExpect(page.locator('#stage iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    expect(
      await game.evaluate(() =>
        document
          .querySelector('meta[http-equiv="Content-Security-Policy"]')
          ?.getAttribute('content'),
      ),
    ).toContain("connect-src 'none'");
    expect(
      await game.evaluate(() => {
        try {
          void parent.document;
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    const host = page.mainFrame();
    await installSyntheticPads(host);
    await pads(host, [{ index: 0 }, { index: 2 }]);
    const read = async () => JSON.parse(await gameLocator.locator('#readings').innerText());
    await browserExpect.poll(async () => (await read()).players.length).toBe(2);
    await pads(host, [
      { index: 0, x: 0.1 },
      { index: 2, x: -1 },
    ]);
    await browserExpect
      .poll(async () => (await read()).players.map((p: any) => p.actions.moveX.value))
      .toEqual([0, -1]);
    await pads(host, [{ index: 0, jump: 1 }, { index: 2 }]);
    await browserExpect.poll(async () => (await read()).jumps).toBe(1);
    await page.getByText('Controller tester', { exact: true }).click();
    const testerLocator = page.frameLocator('#controller-stage iframe');
    await testerLocator.getByRole('heading', { name: 'Controller bench.' }).click();
    await browserExpect.poll(async () => (await read()).status).toBe('inactive');
    expect((await read()).players[0].actions.jump.down).toBe(false);
    // Isolation is enforced by the shell, not by the helper's own focus check.
    const tester = page.frames().find((f) => f !== game && f.parentFrame())!;
    expect(
      await tester.evaluate(() => ({
        policy: (document as any).featurePolicy.allowsFeature('gamepad'),
        binding: typeof (window as any).napplet?.gamepad?.getGamepads,
      })),
    ).toEqual({ policy: false, binding: 'function' });
    const raw = (frame: Frame) =>
      frame.evaluate(() => navigator.getGamepads()[0]?.buttons[0]?.value ?? null);
    await browserExpect.poll(() => raw(tester)).toBe(1);
    expect(await raw(game)).toBe(0);
    await gameLocator.getByRole('button', { name: 'Focus game' }).click();
    await browserExpect.poll(async () => (await read()).status).toBe('ready');
    expect((await read()).jumps).toBe(1); // held on resume is not a fresh jump
    await pads(host, [{ index: 2 }]);
    await browserExpect
      .poll(async () => (await read()).players.map((p: any) => p.index))
      .toEqual([2]);

    await testerLocator.getByRole('heading', { name: 'Controller bench.' }).click();
    expect(await tester.evaluate(() => typeof navigator.getGamepads())).toBe('object');
    await pads(host, [
      { index: 0, x: 0.6 },
      { index: 2, mapping: '' },
    ]);
    await browserExpect(testerLocator.locator('#pads')).toContainText('Synthetic pad 2');
    await browserExpect(testerLocator.locator('#pads')).toContainText('Map this controller');
    await testerLocator.getByLabel('Test controller', { exact: true }).selectOption('2');
    await testerLocator.getByText('Map buttons & axes', { exact: true }).click();
    await testerLocator.getByRole('button', { name: 'Apply test mapping' }).click();
    await browserExpect(testerLocator.locator('#mapping-result')).toContainText('Mapping applied');
    await pads(host, [
      { index: 0, x: 0.6 },
      { index: 2, mapping: '', jump: 1 },
    ]);
    await browserExpect(testerLocator.locator('#pads')).toContainText('jump: 1.00');
    const images = resolve('.local/controllers');
    await mkdir(images, { recursive: true });
    await tester.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(images, 'desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await tester.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await tester.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(images, 'mobile.png') });
    await pads(host, []);
    await browserExpect(testerLocator.locator('#empty')).toBeVisible();
    await page.getByText('Controller tester', { exact: true }).click();
    await browserExpect(page.locator('#controller-stage iframe')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test('a browser Permissions-Policy denial is visible in the tester without relaxing the sandbox', async () => {
  let browser: Browser | undefined;
  const assets = await previewAssets();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new Response(
        new URL(request.url).pathname === '/runtime.js'
          ? assets.client
          : assets.html.replace('<title>', '<meta name="soyli-token" content="test-only"><title>'),
        {
          headers: {
            'Content-Type':
              new URL(request.url).pathname === '/runtime.js' ? 'text/javascript' : 'text/html',
            'Permissions-Policy': 'gamepad=()',
          },
        },
      ),
  });
  try {
    browser = await (await browserEngine()).chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(server.url.href);
    await page.getByText('Controller tester', { exact: true }).click();
    await page
      .frameLocator('#controller-stage iframe')
      .getByRole('heading', { name: 'Controller bench.' })
      .click();
    await browserExpect(
      page.frameLocator('#controller-stage iframe').locator('#state'),
    ).toContainText('policy blocks Gamepad');
    await browserExpect(page.locator('#controller-stage iframe')).toHaveAttribute(
      'sandbox',
      'allow-scripts',
    );
  } finally {
    await browser?.close();
    server.stop(true);
  }
}, 15000);
