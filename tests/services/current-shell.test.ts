import { expect, test } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { currentShell } from './current-shell-host';
const enabled = process.env.SOY_CURRENT_SHELL === '1' ? test : test.skip;
for (const mode of ['allowed', 'denied', 'absent'] as const)
  enabled(
    `current signed artifact in independent Paja: ${mode}`,
    async () => {
      const host = await currentShell(
        await Bun.file('tests/fixtures/current-shell/interaction.html').text(),
        { absent: mode === 'absent' },
      );
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(host.url);
        const frame = page.frameLocator('iframe').last();
        await browserExpect(frame.locator('h1')).toHaveText('Portable interaction', {
          timeout: 20000,
        });
        expect(host.requests.length).toBeGreaterThan(0);
        expect(await page.locator('iframe').last().getAttribute('sandbox')).toBe('allow-scripts');
        await frame.locator('#play').click();
        await browserExpect(frame.locator('#score')).toHaveText('1');
        if (mode === 'denied') {
          await page.getByRole('button', { name: 'state:write', exact: true }).click();
          await page.getByRole('button', { name: 'media:control', exact: true }).click();
        }
        await frame.locator('#save').click();
        await browserExpect(frame.locator('#saved')).toHaveText(
          mode === 'allowed'
            ? 'Saved 1'
            : mode === 'denied'
              ? 'Storage denied'
              : 'Storage unavailable',
        );
        await frame.locator('#sound').click();
        await browserExpect(frame.locator('#audio')).toHaveText(
          mode === 'allowed'
            ? 'Session granted'
            : mode === 'denied'
              ? 'Media denied'
              : 'Media unavailable',
        );
        await frame.locator('#network').click();
        await browserExpect(frame.locator('#network-result')).toHaveText('Blocked');
        await browserExpect(frame.locator('body')).toHaveAttribute('data-csp', 'connect-src');
        if (mode === 'allowed') {
          await page.reload();
          await frame.locator('#restore').click();
          await browserExpect(frame.locator('#saved')).toHaveText('Saved 1');
        }
      } finally {
        await browser.close();
        host.close();
      }
    },
    30000,
  );
enabled(
  'independent Paja rejects bytes differing from the signed current artifact hash',
  async () => {
    const host = await currentShell(
      await Bun.file('tests/fixtures/current-shell/interaction.html').text(),
      { corrupt: true },
    );
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(host.url);
      await browserExpect(page.locator('body')).toContainText(/no server served blob/i, {
        timeout: 15000,
      });
      expect(host.requests.length).toBeGreaterThan(0);
      expect(await page.locator('iframe').count()).toBe(0);
    } finally {
      await browser.close();
      host.close();
    }
  },
  30000,
);
