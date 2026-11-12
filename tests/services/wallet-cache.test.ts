import { expect, test } from 'bun:test';
import { chromium } from '@playwright/test';

test('encrypted browser wallet cache survives reload without signer prompts or key generation', async () => {
  const built = await Bun.build({
    entrypoints: ['tests/fixtures/wallet-cache.ts'],
    target: 'browser',
  });
  expect(built.success).toBe(true);
  const bundle = await built.outputs[0].text();
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request) {
      return new URL(request.url).pathname === '/fixture.js'
        ? new Response(bundle, { headers: { 'content-type': 'text/javascript' } })
        : new Response('<!doctype html><title>Wallet cache</title>', {
            headers: { 'content-type': 'text/html' },
          });
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url.href);
    const cold = await page.evaluate(
      async (path) => (await import(path)).probe(true),
      '/fixture.js',
    );
    expect(cold).toEqual({
      balance: 8,
      isolated: true,
      decryptions: 2,
      keyGenerations: 1,
      keyNonExportable: true,
      noPlaintext: true,
    });
    await page.reload();
    const warm = await page.evaluate(
      async (path) => (await import(path)).probe(false),
      '/fixture.js',
    );
    expect(warm).toEqual({ ...cold, decryptions: 0, keyGenerations: 0 });
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);
