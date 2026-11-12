import { expect, test } from 'bun:test';
import { browserEngine } from '../../apps/cli/src/browser';
import { testInvoice } from '../../packages/wallet/src/fixture';
test('shared CVM checkout: external QR, wallet approval, uncertainty and cancellation', async () => {
  const bundle = await Bun.build({
    entrypoints: ['tests/fixtures/cvm-checkout.ts'],
    target: 'browser',
    minify: true,
  });
  if (!bundle.success) throw new Error(String(bundle.logs));
  const js = await bundle.outputs[0].text();
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/fixture.js'
        ? new Response(js, { headers: { 'Content-Type': 'application/javascript' } })
        : new Response('<script type="module" src="/fixture.js"></script>', {
            headers: { 'Content-Type': 'text/html' },
          }),
  });
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForFunction(() => !!(window as any).openCheckout);
    const invoice = testInvoice(21);
    const open = async (wallet = true, pr = invoice) =>
      page.evaluate(({ wallet, pr }) => (window as any).openCheckout(pr, wallet), { wallet, pr });
    await open(false);
    await page.getByAltText('Lightning invoice QR').waitFor();
    expect(await page.getByRole('button', { name: 'Pay from wallet' }).count()).toBe(0);
    expect(await page.getByLabel('Lightning invoice', { exact: true }).inputValue()).toBe(invoice);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'I’ve paid — continue' }).click();
    await page.waitForFunction(() => (window as any).checkoutState.result === 'continued');
    await open();
    // Live opt-out hides wallet-only controls without removing external payment.
    await page.evaluate(() => (window as any).walletAvailable(false));
    expect(await page.getByRole('button', { name: 'Pay from wallet' }).count()).toBe(0);
    expect(await page.getByRole('spinbutton').count()).toBe(0);
    await page.getByAltText('Lightning invoice QR').waitFor();
    await page.evaluate(() => (window as any).walletAvailable(true));
    await page.getByRole('button', { name: 'Pay from wallet' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => (window as any).checkoutState.result === 'continued');
    expect(await page.getByAltText('Lightning invoice QR').count()).toBe(0);
    expect(await page.evaluate(() => (window as any).checkoutState.pays)).toBe(1);
    await open();
    await page.getByRole('button', { name: 'Pay from wallet' }).click();
    await page.waitForFunction(() => (window as any).checkoutState.result === 'continued');
    expect(await page.evaluate(() => (window as any).checkoutState.pays)).toBe(1);
    await page.evaluate(() => {
      (window as any).checkoutState.outcome = 'unknown';
    });
    await open(true, testInvoice(21, new Uint8Array(32).fill(8)));
    await page.getByRole('button', { name: 'Pay from wallet' }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page
      .locator('dialog > p')
      .filter({ hasText: /Payment is unconfirmed/ })
      .waitFor();
    expect(await page.getByAltText('Lightning invoice QR').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Pay from wallet' }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Copy invoice' }).isDisabled()).toBe(true);
    await page.evaluate(() => {
      (window as any).walletAvailable(false);
      (window as any).walletAvailable(true);
    });
    expect(await page.getByRole('button', { name: 'Pay from wallet' }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => (window as any).checkoutState.statuses)).toBe(0);
    await page.evaluate(() => (window as any).checkoutState.controller.abort());
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 60000);
