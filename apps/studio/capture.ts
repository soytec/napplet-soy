// Executed in a clean child environment. No inference or signing credentials.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inspectProject } from '../../packages/publish/src/project';
import { checkPublication } from '../cli/src/publish-check';
import { recordingSchema } from '../../packages/publish/src/config';
import { diagnose, formatDiagnostic } from '../../packages/diagnostics/src';

try {
  const [root, pubkey, destination, video, portrait] = process.argv.slice(2);
  const { contents, plan } = await inspectProject(root, 'public', pubkey);
  const config = JSON.parse(new TextDecoder().decode(contents.get('napplet.json')));
  const settings =
    video === 'true' ? recordingSchema.parse(config.preview?.recording ?? {}) : undefined;
  const checked = await checkPublication(
    contents,
    true,
    settings,
    false,
    undefined,
    portrait === 'true' ? { width: 360, height: 640 } : undefined,
  );
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await writeFile(join(destination, 'cover.png'), checked.preview, { flag: 'wx' });
  if (checked.video) await writeFile(join(destination, 'clip.webm'), checked.video, { flag: 'wx' });
  console.log(
    JSON.stringify({
      artifactHash: plan.artifactHash,
      profile: checked.profile,
      browser: checked.browser,
      coverage: checked.coverage,
      warnings: checked.warnings,
    }),
  );
} catch (error) {
  console.error(formatDiagnostic(diagnose(error, 'capture studio publication media')));
  process.exitCode = 1;
}
