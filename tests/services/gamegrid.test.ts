import { test, expect } from 'bun:test';
import { browserEngine } from '../../apps/cli/src/browser';

test('Gamegrid controller scopes preserve the game, guard dialogs and edit ordinary fields', async () => {
  const bundle = await Bun.build({
    entrypoints: ['tests/fixtures/gamegrid.tsx'],
    target: 'browser',
    plugins: [
      {
        name: 'web-workspace',
        setup(build) {
          build.onResolve({ filter: /^(@\/|radix-ui$)/ }, (args) => ({
            path: Bun.resolveSync(
              args.path.startsWith('@/') ? './src/' + args.path.slice(2) : args.path,
              process.cwd() + '/apps/web',
            ),
          }));
        },
      },
    ],
  });
  if (!bundle.success) throw Error(String(bundle.logs));
  const css = `*{box-sizing:border-box}body{font:16px system-ui;margin:30px}button,input{padding:12px}header,.tiles{display:flex;gap:24px;margin:24px}.tiles button{width:160px;height:100px}.player-stage iframe{width:600px;height:300px}output{display:block}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0006}[data-slot=dialog-content]{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px;display:flex;flex-direction:column;gap:12px;max-height:90vh;overflow:auto}.gg-keyboard{width:740px}.gg-keyboard-keys{display:grid;grid-template-columns:repeat(10,1fr);gap:4px}.gg-keyboard-actions{display:flex;gap:8px}dialog:not([data-shell-layer]){padding:24px}button:focus,input:focus{outline:3px solid purple}`;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/app.js'
        ? new Response(bundle.outputs[0], { headers: { 'content-type': 'application/javascript' } })
        : new Response(
            `<style>${css}</style><div id="app"></div><script type="module" src="/app.js"></script>`,
            { headers: { 'content-type': 'text/html' } },
          ),
  });
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
    page.setDefaultTimeout(3000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      const state = { connected: true, active: true, buttons: [] as number[], mapping: 'standard' };
      Object.assign(window, { controllerFixture: state });
      const hasFocus = document.hasFocus.bind(document);
      Object.defineProperty(document, 'hasFocus', {
        configurable: true,
        value: () => state.active && hasFocus(),
      });
      Object.defineProperty(navigator, 'getGamepads', {
        configurable: true,
        value: () =>
          state.connected
            ? [
                {
                  index: 0,
                  id: 'Synthetic standard-layout controller',
                  mapping: state.mapping,
                  connected: true,
                  axes: [0, 0, 0, 0],
                  buttons: Array.from({ length: 17 }, (_, index) => ({
                    value: state.buttons.includes(index) ? 1 : 0,
                    pressed: state.buttons.includes(index),
                    touched: state.buttons.includes(index),
                  })),
                },
              ]
            : [],
      });
    });
    await page.goto(String(server.url));
    const settle = async (frames = 4) =>
      page.evaluate(
        (count) =>
          new Promise<void>((resolve) => {
            const tick = () => (--count <= 0 ? resolve() : requestAnimationFrame(tick));
            requestAnimationFrame(tick);
          }),
        frames,
      );
    const buttons = async (pressed: number[]) => {
      await page.evaluate((value) => {
        (window as any).controllerFixture.buttons = value;
      }, pressed);
      await settle();
    };
    const tap = async (button: number) => {
      await buttons([]);
      await buttons([button]);
      await buttons([]);
    };
    const counts = async () => JSON.parse(await page.locator('[data-counts]').innerText());
    const menu = page.getByRole('dialog', { name: 'Game menu', exact: true });
    const openMenu = async () => {
      await buttons([]);
      await buttons([8, 9]);
      await menu.waitFor();
    };
    await page.getByRole('button', { name: 'Game one', exact: true }).focus();
    await settle();
    await tap(15);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('tile-two');
    await tap(0);
    await page.locator('[data-mode=game]').waitFor();
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '0', exact: true }).click();
    await page.evaluate(() => {
      (window as any).originalGameFrame = document.querySelector('iframe');
    });
    const sameFrame = async () =>
      page.evaluate(() => document.querySelector('iframe') === (window as any).originalGameFrame);
    const afterLaunch = await counts();
    await tap(0);
    await tap(1);
    await tap(15);
    expect(await counts()).toEqual(afterLaunch);
    expect(await page.locator('dialog:modal').count()).toBe(0);
    expect(await sameFrame()).toBe(true);

    // View+Menu must be held, and the same held input cannot act inside the new menu.
    await buttons([8, 9]);
    expect(await menu.count()).toBe(0);
    await menu.waitFor();
    expect(await sameFrame()).toBe(true);
    await buttons([]);
    await menu.getByRole('button', { name: 'Review action', exact: true }).focus();
    await buttons([0]);
    const review = page.getByRole('dialog', { name: 'Native action review', exact: true });
    await review.waitFor();
    await settle(12);
    expect((await counts()).approvals).toBe(0);
    await buttons([]);
    await buttons([1]);
    await review.waitFor({ state: 'detached' });
    await settle();
    expect(await menu.count()).toBe(1);
    await buttons([]);
    await menu.getByRole('button', { name: 'Resume game', exact: true }).focus();
    await buttons([0]);
    await menu.waitFor({ state: 'detached' });
    const focusedGameBeforeNeutral = await page.evaluate(
      () => document.activeElement?.tagName === 'IFRAME',
    );
    // An inactive browser sample zeros exposed buttons; those zeros are not a release.
    await page.evaluate(() => {
      (window as any).controllerFixture.active = false;
      window.dispatchEvent(new Event('blur'));
    });
    await settle(8);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
    await page.evaluate(() => {
      (window as any).controllerFixture.active = true;
    });
    await settle();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
    await buttons([]);
    await page.waitForFunction(() => document.activeElement?.tagName === 'IFRAME');
    expect(await sameFrame()).toBe(true);
    expect(await frame.getByRole('button', { name: '1', exact: true }).count()).toBe(1);

    // A game can request a native host prompt without going through the GG menu.
    // Both approval and cancellation must gate restored iframe focus on release.
    for (const closeButton of [0, 1]) {
      await frame.getByRole('button', { name: 'Request host review', exact: true }).click();
      await review.waitFor();
      expect(await menu.count()).toBe(0);
      await buttons([]);
      await buttons([closeButton]);
      await review.waitFor({ state: 'detached' });
      await settle();
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
      expect((await counts()).approvals).toBe(1);
      await buttons([]);
      await page.waitForFunction(() => document.activeElement?.tagName === 'IFRAME');
      expect(await sameFrame()).toBe(true);
      expect(await frame.getByRole('button', { name: '1', exact: true }).count()).toBe(1);
    }

    await openMenu();
    await buttons([]);
    await menu.getByRole('button', { name: 'Back to grid', exact: true }).focus();
    await tap(0);
    await page.locator('[data-mode=browse]').waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'tile-two');
    expect((await counts()).approvals).toBe(1);

    // Reconnection starts disarmed, even if A was already down on the new sample.
    await page.evaluate(() => {
      (window as any).controllerFixture.connected = false;
    });
    await settle();
    await page.evaluate(() =>
      Object.assign((window as any).controllerFixture, { connected: true, buttons: [0] }),
    );
    await settle(12);
    expect((await counts()).launches).toBe(1);
    expect(await page.locator('[data-mode=browse]').count()).toBe(1);
    await buttons([]);

    // The actual generic keyboard edits a controlled search field and enforces its maxLength.
    await page.getByLabel('Search games', { exact: true }).focus();
    await tap(0);
    const keyboard = page.locator('.gg-keyboard');
    await keyboard.waitFor();
    await keyboard.getByRole('button', { name: 'q', exact: true }).focus();
    await tap(0);
    await tap(15);
    await tap(0);
    expect(await keyboard.getByLabel('Entered text').innerText()).toBe('qw');
    await keyboard.getByRole('button', { name: 'Space', exact: true }).focus();
    await tap(0);
    await keyboard.getByRole('button', { name: '1', exact: true }).focus();
    await tap(0);
    await tap(0);
    expect(await keyboard.getByLabel('Entered text').innerText()).toBe('qw 1');
    await keyboard.getByRole('button', { name: 'Done', exact: true }).focus();
    await tap(0);
    expect(await page.getByLabel('Search games').inputValue()).toBe('qw 1');
    expect(await page.locator('[data-search]').innerText()).toBe('qw 1');
    await tap(0);
    await keyboard.waitFor();
    await tap(1);
    await keyboard.waitFor({ state: 'detached' });
    expect(await page.getByLabel('Search games').inputValue()).toBe('qw 1');

    await page.getByRole('button', { name: 'Account settings', exact: true }).focus();
    await tap(0);
    await page.getByLabel('Connection password', { exact: true }).focus();
    await tap(0);
    await keyboard.waitFor();
    await keyboard.getByRole('button', { name: 'q', exact: true }).focus();
    await tap(0);
    expect(await keyboard.getByLabel('Entered text').innerText()).toBe('•');
    await keyboard.getByRole('button', { name: 'Symbols', exact: true }).focus();
    await tap(0);
    for (const symbol of ["'", '\\']) {
      await keyboard.getByRole('button', { name: symbol, exact: true }).focus();
      await tap(0);
    }
    expect(await keyboard.getByLabel('Entered text').innerText()).toBe('•••');
    await keyboard.getByRole('button', { name: 'Letters', exact: true }).focus();
    await tap(0);
    expect(await keyboard.getByRole('button', { name: 'q', exact: true }).count()).toBe(1);
    await keyboard.getByRole('button', { name: 'Done', exact: true }).focus();
    await tap(0);
    expect(await page.getByLabel('Connection password', { exact: true }).inputValue()).toBe("q'\\");
    expect(await page.locator('[data-secret-length]').innerText()).toBe('3');
    const range = page.getByLabel('Controller volume', { exact: true });
    await range.focus();
    await tap(15);
    expect(await range.inputValue()).toBe('4');
    expect(await page.locator('[data-volume]').innerText()).toBe('4');
    await tap(14);
    expect(await range.inputValue()).toBe('2');
    expect(await page.locator('[data-volume]').innerText()).toBe('2');
    await tap(1);
    expect(await page.locator('dialog:modal').count()).toBe(0);
    expect(focusedGameBeforeNeutral).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);
