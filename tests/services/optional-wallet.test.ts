import { test, expect } from 'bun:test';
import { expect as browserExpect } from '@playwright/test';
import { browserEngine } from '../../apps/cli/src/browser';
import { testInvoice } from '../../packages/wallet/src/fixture';
import { inspectInvoice } from '../../packages/protocol/src/invoice';

test('wallet opt-in, cancellation, account isolation and Cashu UI availability', async () => {
  // Keep browser bundling independent of bun:test's loaded module cache.
  const build = Bun.spawn([process.execPath, 'tests/services/fixtures/optional-wallet/build.ts'], {
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const bundle = await new Response(build.stdout).text();
  expect(await build.exited).toBe(0);
  const css = await Bun.file('apps/web/src/wallet.css').text();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/app.js'
        ? new Response(bundle, { headers: { 'content-type': 'application/javascript' } })
        : new Response(
            `<style>:root{--foreground:#173e37;--background:white;--primary:#006d68;--primary-foreground:white;--muted:#ddd;--ring:teal;--border:#456}*{box-sizing:border-box}body{font:16px system-ui;margin:20px;max-width:360px}button{padding:10px;margin:4px}input{max-width:100%}[data-slot=dialog-overlay]{position:fixed;inset:0;background:#0006}[data-slot=dialog-content]{position:fixed;inset:15px;background:white;padding:20px;overflow:auto}${css}</style><div id="app"></div><script type="module" src="/app.js"></script>`,
            { headers: { 'content-type': 'text/html' } },
          ),
  });
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await context.route('https://**', (route) => route.abort());
    await page.goto(String(server.url));
    const toggle = page.getByRole('switch', { name: 'NIP-60 wallet' }),
      snapshot = page.locator('[data-wallet-state]');
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(snapshot).toContainText('"enabled":false');
    expect(await page.evaluate(() => (window as any).walletFixture.state.runtimeLoads)).toBe(0);
    await page.evaluate(() => (window as any).walletFixture.open());
    expect(await page.evaluate(() => (window as any).walletFixture.state.opens)).toBe(0);
    // Keyboard opt-in and automatic load only after that deliberate action.
    await toggle.focus();
    await page.keyboard.press('Space');
    await browserExpect(snapshot).toContainText('"balance":42');
    expect(await page.evaluate(() => (window as any).walletFixture.state.opens)).toBe(1);
    await page.getByRole('button', { name: 'Lock wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Navigate', exact: true }).click();
    await page.getByRole('button', { name: 'Navigate', exact: true }).click();
    await browserExpect(snapshot).toContainText('"balance":0');
    expect(await page.evaluate(() => (window as any).walletFixture.state.opens)).toBe(1);
    await page.reload();
    await browserExpect(snapshot).toContainText('"balance":42');
    // Other accounts do not inherit permission, while the first account remembers it.
    await page.getByRole('button', { name: 'Switch account' }).click();
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(snapshot).toContainText('"balance":0');
    await page.getByRole('button', { name: 'Switch account' }).click();
    await browserExpect(snapshot).toContainText('"balance":42');
    // Other tabs cannot reopen the spend lease; their off preference closes this tab too.
    const second = await context.newPage();
    await second.goto(String(server.url));
    await browserExpect(second.locator('[data-wallet-state]')).toContainText('another tab');
    await second.getByRole('switch', { name: 'NIP-60 wallet' }).uncheck();
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(snapshot).toContainText('"balance":0');
    await second.close();
    await page.reload();
    expect(await page.evaluate(() => (window as any).walletFixture.state.opens)).toBe(0);
    // A late unlock result cannot restore a wallet after switching off.
    await page.evaluate(() => {
      (window as any).walletFixture.state.delay = true;
    });
    await toggle.check();
    await page.waitForFunction(() => (window as any).walletFixture.state.opens === 1);
    await toggle.uncheck();
    await page.evaluate(() => {
      const s = (window as any).walletFixture.state;
      s.delay = false;
      s.opening.splice(0).forEach((done: any) => done());
    });
    await browserExpect(snapshot).toContainText('"balance":0');
    await page.waitForFunction(() => (window as any).walletFixture.state.closes === 1);
    // A dispatched operation retains the Web Lock until its recovery is finished.
    await toggle.check();
    await browserExpect(snapshot).toContainText('"balance":42');
    await page.evaluate(() => {
      void (window as any).walletFixture.spend();
    });
    await toggle.uncheck();
    expect(
      await page.evaluate(async () =>
        (await navigator.locks.query()).held?.some((l) => l.name?.startsWith('napplet-wallet:')),
      ),
    ).toBe(true);
    await page.evaluate(() => (window as any).walletFixture.state.finishSpend());
    await page.waitForFunction(
      async () =>
        !(await navigator.locks.query()).held?.some((l) => l.name?.startsWith('napplet-wallet:')),
    );
    // An existing LNURL invoice remains usable, without Cashu controls, while off.
    const pr = testInvoice(21),
      parsed = inspectInvoice(pr);
    await page.evaluate((invoice) => (window as any).walletFixture.invoice(invoice), {
      invoice: pr,
      msats: 21000,
      paymentHash: parsed.paymentHash,
      expiresAt: parsed.expiresAt,
    });
    await page.getByRole('button', { name: 'Zap', exact: true }).click();
    await page.getByRole('link', { name: 'Open Lightning wallet', exact: true }).waitFor();
    expect(await page.getByText('Pay from your Cashu wallet', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await toggle.check();
    await browserExpect(snapshot).toContainText('"balance":42');
    await page.getByRole('button', { name: 'Zap', exact: true }).click();
    await page.getByText('Pay from your Cashu wallet', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await toggle.uncheck();
    await page.getByRole('button', { name: 'Zap', exact: true }).click();
    expect(await page.getByText('Pay from your Cashu wallet', { exact: true }).count()).toBe(0);
    await page.getByRole('link', { name: 'Open Lightning wallet', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // Nutzap-only recipients have no unusable zap button while the wallet is off.
    await page.evaluate(() => (window as any).walletFixture.update({ lightning: false }));
    await browserExpect(page.getByRole('button', { name: 'Zap', exact: true })).toHaveCount(0);
    await toggle.check();
    await browserExpect(page.getByRole('button', { name: 'Zap', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await browserExpect(toggle).not.toBeChecked();
    await browserExpect(toggle).toBeDisabled();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 60000);
