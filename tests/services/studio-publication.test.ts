import { expect, test } from 'bun:test';
import { browserEngine } from '../../apps/cli/src/browser';
import { publicationFixture } from './fixtures/publication-server';

test('post-merge updates default to retained media, optional metadata and a separate confirmation; first releases still require capture planning', async () => {
  const { server, requests } = await publicationFixture();
  const browser = await (await browserEngine()).chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.url.href);
    await page.getByRole('button', { name: 'Prepare update', exact: true }).waitFor();
    expect(await page.getByLabel('Keep existing cover and clip').isChecked()).toBe(true);
    expect(await page.getByRole('textbox', { name: 'Description', exact: true }).isVisible()).toBe(
      false,
    );
    expect(await page.getByText('No gameplay recording plan is saved yet.').count()).toBe(0);
    await page.getByLabel('Capture new media', { exact: true }).check();
    expect(await page.getByLabel('Re-record the preview clip', { exact: true }).isChecked()).toBe(
      true,
    );
    expect(
      await page.getByRole('button', { name: 'Prepare update', exact: true }).isDisabled(),
    ).toBe(true);
    await page.getByLabel('Keep existing cover and clip').check();
    await page.getByText('Change title, description or tags', { exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Description', exact: true })
      .fill('The radio, with volume controls.');
    await page.getByRole('button', { name: 'Prepare update', exact: true }).click();
    await page
      .getByText('Existing media retained from the previous release.', { exact: false })
      .waitFor();
    const prepared = requests.find((r) => r.path.endsWith('/prepare-publication'))!;
    expect(prepared.body.listing).toMatchObject({
      keepMedia: true,
      description: 'The radio, with volume controls.',
      topics: ['radio', 'music'],
    });
    expect(
      await page.getByRole('button', { name: 'Publish update', exact: true }).isDisabled(),
    ).toBe(true);
    await page.getByRole('checkbox').check();
    expect(
      await page.getByRole('button', { name: 'Publish update', exact: true }).isEnabled(),
    ).toBe(true);
    expect(requests.filter((r) => r.path.endsWith('/publish'))).toHaveLength(0);
    await page.getByRole('button', { name: 'Publish update', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button.primary:disabled'));
    expect(requests.find((r) => r.path.endsWith('/publish'))?.body).toMatchObject({
      confirmed: true,
      review: 'fixture-review',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(server.url.href);
    await page.getByRole('button', { name: 'Prepare update', exact: true }).waitFor();
    expect(await page.locator('dialog').evaluate((d) => d.scrollWidth <= d.clientWidth)).toBe(true);
    await page.goto(server.url.href + '?first');
    await page.getByRole('button', { name: 'Prepare release', exact: true }).waitFor();
    expect(await page.getByRole('textbox', { name: 'Description', exact: true }).isVisible()).toBe(
      true,
    );
    expect(await page.getByLabel('Record a short preview clip', { exact: true }).isChecked()).toBe(
      true,
    );
    expect(
      await page.getByRole('button', { name: 'Prepare release', exact: true }).isDisabled(),
    ).toBe(true);
  } finally {
    await browser.close();
    server.stop(true);
  }
}, 30000);
