import { test, expect } from 'bun:test';
import { browserEngine } from '../../apps/cli/src/browser';

// Exercise the production React/Radix dialogs, presentation hook and runtime service together.
test('shell dialogs, capability discovery and feedback survive native/expanded player transitions', async () => {
  const bundle = await Bun.build({
    entrypoints: ['tests/fixtures/shell-dialogs.tsx'],
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
  const css = `*{box-sizing:border-box;margin:0;padding:0}body{min-height:3000px;font-family:system-ui}#app{padding-top:500px}.player-expanded{position:fixed;inset:0;background:white;z-index:80}iframe{display:block}button{padding:8px}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0006}[data-slot=dialog-content]{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:24px}.connections-dialog{width:min(600px,94vw);padding:20px}label,input,select{display:block}`;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (r) =>
      new URL(r.url).pathname === '/app.js'
        ? new Response(bundle.outputs[0], { headers: { 'content-type': 'application/javascript' } })
        : new Response(
            `<style>${css}</style><div id="app"></div><script type="module" src="/app.js"></script>`,
            { headers: { 'content-type': 'text/html' } },
          ),
  });
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(String(server.url));
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '0', exact: true }).click();
    await page.getByText('Fullscreen', { exact: true }).click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await page.getByText('Choose model', { exact: true }).click();
    await page
      .getByText('Loading your AI connections… Approve the account request if asked.', {
        exact: true,
      })
      .waitFor();
    expect(
      await page.evaluate(() => document.querySelector('.shell-notices')?.matches(':popover-open')),
    ).toBe(true);
    // Progress is non-modal and does not take keyboard focus from the initiating control.
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe('Choose model');
    await page.evaluate(() => (window as any).releaseConnections());
    const select = page.getByLabel('Choose a model for this napplet');
    await select.click();
    await select.selectOption('test');
    await page.getByRole('button', { name: 'AI connections', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.waitForFunction(
      () => (document.querySelector('input[type=checkbox]') as HTMLInputElement)?.checked,
    );
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    expect(await page.evaluate(() => (window as any).savedConnection().images)).toBe(true);
    await page.getByRole('button', { name: 'Close connections', exact: true }).click();
    expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    // Saved image support is actually returned to the napplet by select, not only displayed in settings.
    await page.getByText('Choose model', { exact: true }).click();
    await page.evaluate(() => (window as any).releaseConnections());
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByText('Images available', { exact: true }).waitFor();
    await page.getByText('Generate', { exact: true }).click();
    await page.getByText('AI response received.', { exact: true }).waitFor();
    expect(await page.locator('.shell-notices').innerText()).not.toContain('private medical');
    expect(await page.locator('.shell-notices').innerText()).not.toContain('Private report');
    await page.getByText('Wallet', { exact: true }).click();
    await page.getByText('Cancel payment', { exact: true }).click();
    await page.getByText('Exit native fullscreen', { exact: true }).click();
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.getByText('Wallet', { exact: true }).click();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog:modal'));
    expect(await page.locator('.player-expanded').count()).toBe(1);
    await frame.getByRole('button', { name: '1', exact: true }).click();
    expect(await frame.getByRole('button', { name: '2', exact: true }).count()).toBe(1);
    // An existing prompt also remains above a subsequently entered fullscreen element.
    await page.getByText('Settings', { exact: true }).click();
    await page.evaluate(() => document.querySelector('.player-expanded')!.requestFullscreen());
    await page.getByRole('button', { name: 'Close connections', exact: true }).click();
    await page.getByText('Leave player', { exact: true }).click();
    await page.waitForFunction(
      () => !document.fullscreenElement && !document.querySelector('dialog:modal'),
    );
    expect(await page.locator('aside').evaluate((e) => (e as HTMLElement).inert)).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByText('Choose model', { exact: true }).click();
    await page.evaluate(() => (window as any).releaseConnections());
    const bounds = await page.locator('.capability-dialog').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.evaluate(() => (window as any).failGeneration());
    await page.getByText('Generate', { exact: true }).click();
    await page
      .getByText('The AI request could not complete. See the napplet for details.', { exact: true })
      .waitFor();
    expect(await page.locator('.shell-notices').innerText()).not.toContain('private-provider-key');
    await page.getByText('Choose model', { exact: true }).click();
    await page
      .getByText('Loading your AI connections… Approve the account request if asked.', {
        exact: true,
      })
      .waitFor();
    await page.evaluate(() => (window as any).cancelSelection());
    expect(await page.locator('.shell-notice[data-state=working]').count()).toBe(0);
    await page.evaluate(() => (window as any).releaseConnections());
    await page.getByText('Cancelled', { exact: true }).waitFor();
    expect(await page.locator('dialog:modal').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);
