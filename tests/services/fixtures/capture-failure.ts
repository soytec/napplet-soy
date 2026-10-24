import { browserEngine } from '../../../apps/cli/src/browser';
import { capturePreview } from '../../../apps/cli/src/publish-check';
import { diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';

const browser = await (await browserEngine()).chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.close();
  await capturePreview(page, { width: 1200, height: 750 });
} catch (error) {
  console.error(formatDiagnostic(diagnose(error, 'capture isolated studio preview')));
  process.exitCode = 1;
} finally {
  await browser.close();
}
