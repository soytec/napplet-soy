import { expect, test } from 'bun:test';
import { expect as browserExpect, type Browser, type Page } from '@playwright/test';
import { browserEngine } from '../../apps/cli/src/browser';
import { PLAYER_ALLOW, PLAYER_SANDBOX } from '../../packages/runtime/src';
import { gamepadPrelude } from '../../packages/runtime/src/prelude';

/** Features Chromium still grants an opaque player frame. Review additions before allowing them. */
const REVIEWED_FEATURES = new Set([
  'aria-notify',
  'ch-save-data',
  'ch-ua',
  'ch-ua-high-entropy-values',
  'ch-ua-mobile',
  'ch-ua-platform',
  'fullscreen',
  'picture-in-picture',
  'sync-xhr',
  'unload',
]);

async function withFrame(run: (page: Page) => Promise<void>) {
  let browser: Browser | undefined;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      new Response('<!doctype html><body></body>', { headers: { 'Content-Type': 'text/html' } }),
  });
  try {
    browser = await (await browserEngine()).chromium.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(server.url.href);
    await run(page);
  } finally {
    await browser?.close();
    server.stop(true);
  }
}
async function mount(page: Page, body: string, allow = PLAYER_ALLOW) {
  await page.evaluate(
    ({ body, allow, sandbox }) => {
      const state = window as unknown as { received: unknown[] };
      state.received = [];
      addEventListener('message', (event) => state.received.push(event.data));
      const frame = document.createElement('iframe');
      frame.sandbox.value = sandbox;
      frame.allow = allow;
      frame.srcdoc = body;
      document.body.replaceChildren(frame);
    },
    { body, allow, sandbox: PLAYER_SANDBOX },
  );
  await browserExpect.poll(() => page.frames().length).toBe(2);
  const frame = page.frames()[1];
  await frame.waitForFunction(() => (window as unknown as { booted?: boolean }).booted === true);
  const post = (state: Record<string, unknown>) =>
    page.evaluate((state) => {
      document
        .querySelector('iframe')!
        .contentWindow!.postMessage(
          { type: 'gamepad.state', available: true, focused: true, ...state },
          '*',
        );
    }, state);
  const received = () =>
    page.evaluate(() => (window as unknown as { received: unknown[] }).received);
  return { frame, post, received };
}
const pad = (id: string, timestamp: number) => ({
  id,
  mapping: 'standard',
  timestamp,
  axes: [0.25, -1],
  buttons: [{ value: 1, pressed: true, touched: true }],
});

test('the prelude shim serves the standard Gamepad API from shell snapshots', async () => {
  await withFrame(async (page) => {
    const { frame, post, received } = await mount(
      page,
      `<script>window.napplet = {};</script><script>${gamepadPrelude(4)}</script><script>
        window.log = [];
        window.booted = true;
      </script>`,
    );
    await browserExpect.poll(received).toEqual([{ type: 'gamepad.subscribe' }]);
    // Only the denied operation is replaced, with the native property shape and receiver
    // check. Before the first snapshot it already has Chromium's empty-slot shape.
    expect(
      await frame.evaluate(() => {
        const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'getGamepads')!;
        const fn = navigator.getGamepads;
        let receiver = 'accepted';
        try {
          fn.call({});
        } catch (error) {
          receiver = (error as Error).name;
        }
        return {
          descriptor: [descriptor.writable, descriptor.enumerable, descriptor.configurable],
          ownOnNavigator: Object.hasOwn(navigator, 'getGamepads'),
          name: fn.name,
          length: fn.length,
          receiver,
          initial: navigator.getGamepads(),
          addEventListener: [
            Object.hasOwn(window, 'addEventListener'),
            window.addEventListener === EventTarget.prototype.addEventListener,
          ],
          handler: String(Object.getOwnPropertyDescriptor(window, 'ongamepadconnected')?.set),
        };
      }),
    ).toEqual({
      descriptor: [true, true, true],
      ownOnNavigator: false,
      name: 'getGamepads',
      length: 0,
      receiver: 'TypeError',
      initial: [null, null, null, null],
      addEventListener: [false, true],
      handler: expect.stringContaining('[native code]'),
    });
    await frame.evaluate(() => {
      const log = (window as unknown as { log: unknown[] }).log;
      addEventListener('gamepadconnected', (event) => {
        const pad = (event as GamepadEvent).gamepad;
        log.push([
          'connected',
          pad.index,
          pad instanceof Gamepad,
          event instanceof GamepadEvent,
          pad.connected,
        ]);
      });
      window.ongamepaddisconnected = (event) =>
        log.push([
          'disconnected',
          event.gamepad.index,
          event instanceof GamepadEvent,
          event.gamepad.connected,
        ]);
      const api = (window as unknown as { napplet: { gamepad: { onChange: Function } } }).napplet
        .gamepad;
      api.onChange((snapshot: { pads: unknown[] }) => log.push(['change', snapshot.pads.length]));
    });
    await browserExpect.poll(received).toEqual([{ type: 'gamepad.subscribe' }]);

    await post({ pads: [null, pad('Pad one', 42)] });
    await browserExpect.poll(() => frame.evaluate(() => navigator.getGamepads().length)).toBe(2);
    expect(
      await frame.evaluate(() => {
        const [empty, pad] = navigator.getGamepads();
        return {
          empty,
          gamepad: pad instanceof Gamepad,
          button: pad!.buttons[0] instanceof GamepadButton,
          fields: [pad!.id, pad!.index, pad!.mapping, pad!.connected, pad!.timestamp],
          axes: [...pad!.axes],
          frozen: Object.isFrozen(pad!.axes) && Object.isFrozen(pad!.buttons),
          button0: [pad!.buttons[0].value, pad!.buttons[0].pressed, pad!.buttons[0].touched],
          vibration: pad!.vibrationActuator as unknown,
        };
      }),
    ).toEqual({
      empty: null,
      gamepad: true,
      button: true,
      fields: ['Pad one', 1, 'standard', true, 42],
      axes: [0.25, -1],
      frozen: true,
      button0: [1, true, true],
      vibration: null,
    });
    // A message the frame posts to itself is not a shell snapshot.
    await frame.evaluate(
      (spoof) =>
        postMessage(
          { type: 'gamepad.state', available: true, focused: true, pads: [null, null, spoof] },
          '*',
        ),
      pad('Spoofed', 1),
    );
    await post({ pads: [] });
    await browserExpect
      .poll(() => frame.evaluate(() => (window as unknown as { log: unknown[] }).log))
      .toEqual([
        ['connected', 1, true, true, true],
        ['change', 2],
        ['disconnected', 1, true, false],
        ['change', 0],
      ]);

    await post({ available: false, reason: 'blocked', focused: false, pads: [] });
    await browserExpect
      .poll(() =>
        frame.evaluate(() => {
          try {
            navigator.getGamepads();
            return 'allowed';
          } catch (error) {
            return (error as Error).name;
          }
        }),
      )
      .toBe('SecurityError');
    expect(await received()).toEqual([{ type: 'gamepad.subscribe' }]);
  });
}, 20000);

test('player frames are denied native Gamepad access and other unreviewed default features', async () => {
  await withFrame(async (page) => {
    const { frame } = await mount(page, '<script>window.booted = true;</script>');
    const { allowed, native } = await frame.evaluate(() => {
      const policy = (document as unknown as { featurePolicy: { allowedFeatures(): string[] } })
        .featurePolicy;
      try {
        navigator.getGamepads();
        return { allowed: policy.allowedFeatures(), native: 'allowed' };
      } catch (error) {
        return { allowed: policy.allowedFeatures(), native: (error as Error).name };
      }
    });
    expect(native).toBe('SecurityError');
    const unreviewed = allowed.filter((feature) => !REVIEWED_FEATURES.has(feature));
    expect(unreviewed).toEqual([]);
    expect(allowed).toContain('fullscreen');
  });
}, 20000);

test('the shim leaves the native API untouched when the host does not deny it', async () => {
  await withFrame(async (page) => {
    const { frame, received } = await mount(
      page,
      `<script>window.napplet = {};</script><script>${gamepadPrelude(4)}</script><script>
        window.booted = true;
      </script>`,
      'fullscreen',
    );
    expect(
      await frame.evaluate(() => ({
        native: String(navigator.getGamepads).includes('[native code]'),
        api: 'gamepad' in (window as unknown as { napplet: object }).napplet,
      })),
    ).toEqual({ native: true, api: true });
    await Bun.sleep(100);
    expect(await received()).toEqual([{ type: 'gamepad.subscribe' }]);
  });
}, 20000);

test('the standard binding works without a native Gamepad API', async () => {
  await withFrame(async (page) => {
    const { frame, post, received } = await mount(
      page,
      `<script>
        delete Navigator.prototype.getGamepads;
        delete window.Gamepad;
        delete window.GamepadButton;
        window.napplet = {};
      </script><script>${gamepadPrelude(0)}</script><script>window.booted = true;</script>`,
    );
    await browserExpect.poll(received).toEqual([{ type: 'gamepad.subscribe' }]);
    await post({ pads: [pad('Controller', 9)] });
    await browserExpect
      .poll(() => frame.evaluate(() => (window as any).napplet.gamepad.getGamepads()[0]?.id))
      .toBe('Controller');
    await post({ available: false, reason: 'unavailable', focused: false, pads: [] });
    await browserExpect
      .poll(() =>
        frame.evaluate(() => ({
          available: (window as any).napplet.gamepad.available,
          focused: (window as any).napplet.gamepad.focused,
          pads: (window as any).napplet.gamepad.getGamepads(),
          native: typeof navigator.getGamepads,
        })),
      )
      .toEqual({ available: false, focused: false, pads: [], native: 'undefined' });
  });
}, 20000);
