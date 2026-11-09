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
  const css = `*{box-sizing:border-box}body{font:16px system-ui;margin:30px}button,input{padding:12px}header,.tiles{display:flex;gap:24px;margin:24px}.catalog-scroll{height:160px;overflow-y:auto}.tiles{display:grid;grid-template-columns:repeat(3,160px)}.tiles button{width:160px;height:100px}.player-stage iframe{width:600px;height:300px}output{display:block}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0006}[data-slot=dialog-content]{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px;display:flex;flex-direction:column;gap:12px;max-height:90vh;overflow:auto}.gg-keyboard{width:740px}.gg-keyboard-keys{display:grid;grid-template-columns:repeat(10,1fr);gap:4px}.gg-keyboard-actions{display:flex;gap:8px}dialog:not([data-shell-layer]){padding:24px}button:focus,input:focus{outline:3px solid purple}`;
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
      const state = {
        connected: true,
        active: true,
        buttons: [] as number[],
        axes: [0, 0, 0, 0],
        mapping: 'standard',
      };
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
                  axes: state.axes,
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
    const rightStick = async (value: number, frames = 4) => {
      await page.evaluate((axis) => {
        (window as any).controllerFixture.axes[3] = axis;
      }, value);
      await settle(frames);
    };
    const counts = async () => JSON.parse(await page.locator('[data-counts]').innerText());
    const menu = page.getByRole('dialog', { name: 'Game menu', exact: true });
    const openMenu = async () => {
      await buttons([]);
      await buttons([9]);
      await menu.waitFor();
    };
    // Navigation crosses grid/toolbar/footer boundaries only in their intended directions.
    await page.getByRole('button', { name: 'Game one', exact: true }).focus();
    await settle();
    await tap(12);
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest<HTMLElement>('[data-gamegrid-nav]')?.dataset.gamegridNav,
      ),
    ).toBe('toolbar');
    await page.getByRole('combobox', { name: 'Game collection' }).focus();
    await tap(15);
    expect(
      await page
        .getByLabel('Search games', { exact: true })
        .evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await tap(13);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('tile-one');

    // A glass toolbar can overlap tiles. A nearer overlaid control must not steal Right.
    await page.getByRole('combobox', { name: 'Game collection' }).evaluate((node) => {
      const tile = document.getElementById('tile-one')!.getBoundingClientRect();
      Object.assign(node.style, {
        position: 'fixed',
        left: `${tile.left + tile.width / 2 + 20}px`,
        top: `${tile.top + tile.height / 2 - 10}px`,
        width: '40px',
        height: '20px',
        padding: '0px',
      });
    });
    await tap(15);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('tile-two');
    await page
      .getByRole('combobox', { name: 'Game collection' })
      .evaluate((node) => node.removeAttribute('style'));
    await tap(13);
    expect(
      await page.evaluate(
        () =>
          document.activeElement?.closest<HTMLElement>('[data-gamegrid-nav]')?.dataset.gamegridNav,
      ),
    ).toBe('footer');
    await tap(12);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('tile-two');
    // Merely focusing a select must not capture horizontal navigation forever.
    const collection = page.getByRole('combobox', { name: 'Game collection' });
    await collection.focus();
    await settle();
    await tap(15);
    expect(await collection.inputValue()).toBe('new');
    expect(
      await page
        .getByLabel('Search games', { exact: true })
        .evaluate((node) => node === document.activeElement),
    ).toBe(true);
    await tap(14);
    expect(await collection.evaluate((node) => node === document.activeElement)).toBe(true);
    await tap(0);
    const choices = page.locator('.gg-select-dialog');
    await choices.waitFor();
    await choices.getByRole('button', { name: 'Most zapped', exact: true }).focus();
    await tap(1);
    await choices.waitFor({ state: 'detached' });
    expect(await collection.inputValue()).toBe('new');
    expect(await collection.evaluate((node) => node === document.activeElement)).toBe(true);
    await tap(0);
    await choices.waitFor();
    await choices.getByRole('button', { name: 'Most zapped', exact: true }).focus();
    await tap(0);
    await choices.waitFor({ state: 'detached' });
    expect(await collection.inputValue()).toBe('zapped');
    expect(await collection.evaluate((node) => node === document.activeElement)).toBe(true);
    await tap(15);
    expect(
      await page
        .getByLabel('Search games', { exact: true })
        .evaluate((node) => node === document.activeElement),
    ).toBe(true);

    // Menu entry works before launching a game, and B closes one scope at a time.
    await tap(8);
    await menu.waitFor();
    await menu.getByRole('button', { name: 'Wallet', exact: true }).focus();
    await tap(0);
    const wallet = page.getByRole('dialog', { name: 'Wallet', exact: true });
    await wallet.waitFor();
    await wallet.getByRole('button', { name: 'Send payment', exact: true }).focus();
    await tap(0);
    await wallet.getByText('Payment form', { exact: true }).waitFor();
    await tap(1);
    expect(await wallet.getByRole('button', { name: 'Send payment', exact: true }).count()).toBe(1);
    expect(await wallet.count()).toBe(1);
    await tap(1);
    await wallet.waitFor({ state: 'detached' });
    expect(await menu.count()).toBe(1);
    await tap(1);
    await menu.waitFor({ state: 'detached' });
    expect((await counts()).backs).toBe(0);
    await tap(1);
    expect((await counts()).backs).toBe(1);
    await tap(4);
    expect((await counts()).sections).toBe(-1);
    await tap(5);
    expect((await counts()).sections).toBe(0);
    await tap(3);
    expect((await counts()).searches).toBe(1);
    // The right stick scrolls a long catalog continuously without moving focus offscreen.
    await page.getByRole('button', { name: 'Long catalog', exact: true }).click();
    const catalog = page.locator('[data-gamegrid-scroll]');
    await page.getByRole('button', { name: 'Game one', exact: true }).focus();
    await rightStick(1, 18);
    expect(await catalog.evaluate((node) => node.scrollTop)).toBeGreaterThan(80);
    expect(
      await catalog.evaluate((node) => {
        const view = node.getBoundingClientRect();
        const focused = document.activeElement?.getBoundingClientRect();
        return !!focused && focused.bottom > view.top && focused.top < view.bottom;
      }),
    ).toBe(true);
    const scrolled = await catalog.evaluate((node) => node.scrollTop);
    await rightStick(0);
    await settle(8);
    expect(await catalog.evaluate((node) => node.scrollTop)).toBe(scrolled);

    // A held scrolling stick cannot carry into a newly opened modal scope.
    await rightStick(1, 4);
    await buttons([9]);
    await menu.waitFor();
    const backgroundAtMenu = await catalog.evaluate((node) => node.scrollTop);
    await menu.getByRole('button', { name: 'Account settings', exact: true }).click();
    const scrollSettings = page.getByRole('dialog', { name: 'Account settings', exact: true });
    await scrollSettings.getByRole('button', { name: 'Show all settings', exact: true }).click();
    await settle(8);
    expect(await scrollSettings.evaluate((node) => node.scrollTop)).toBe(0);
    expect(await catalog.evaluate((node) => node.scrollTop)).toBe(backgroundAtMenu);
    await rightStick(0);
    await buttons([]);
    await scrollSettings.getByLabel('Connection password', { exact: true }).focus();
    await rightStick(1, 18);
    expect(await scrollSettings.evaluate((node) => node.scrollTop)).toBeGreaterThan(80);
    expect(await catalog.evaluate((node) => node.scrollTop)).toBe(backgroundAtMenu);
    await rightStick(0);
    await tap(1);
    await scrollSettings.waitFor({ state: 'detached' });
    await tap(1);
    await menu.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Long catalog', exact: true }).click();
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
    await tap(4);
    await tap(5);
    await tap(3);
    const gameScroll = await page.evaluate(() => scrollY);
    await rightStick(1, 12);
    expect(await page.evaluate(() => scrollY)).toBe(gameScroll);
    await rightStick(0);
    expect(await counts()).toEqual(afterLaunch);
    expect(await page.locator('dialog:modal').count()).toBe(0);
    expect(await sameFrame()).toBe(true);

    // A single Start opens the menu, and the held input cannot activate its contents.
    await buttons([9]);
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
    // A slight deflection can still scroll after axis dead-zone normalization.
    // It must not qualify as neutral and leak held input into the resumed game.
    await rightStick(0.39);
    await buttons([]);
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME');
    await rightStick(0);
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
