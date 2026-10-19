// Compiled with the same embedded sandbox assets and browser driver as soyLI.
import { mkdir, writeFile } from 'node:fs/promises';
import { checkPublication } from '../../cli/src/publish-check';
import { recordingSchema } from '../../../packages/publish/src/config';
import { diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';

try {
  const { files, context } = await Bun.file('/input/input.json').json();
  const contents = new Map<string, Uint8Array>(
    Object.entries(files).map(([p, data]) => [p, Buffer.from(data as string, 'base64')]),
  );
  const config = JSON.parse(new TextDecoder().decode(contents.get('napplet.json')));
  const result = await checkPublication(
    contents,
    context.cover === true,
    context.video ? recordingSchema.parse(config.preview?.recording ?? {}) : undefined,
    false,
    AbortSignal.timeout(550000),
    context.portrait ? { width: 360, height: 640 } : undefined,
  );
  await mkdir('/workspace/.studio-result');
  if (result.preview) await writeFile('/workspace/.studio-result/cover.png', result.preview);
  if (result.video) await writeFile('/workspace/.studio-result/clip.webm', result.video);
  await writeFile(
    '/workspace/.studio-result/result.json',
    JSON.stringify({ profile: result.profile, browser: result.browser }),
  );
} catch (error) {
  console.error(formatDiagnostic(diagnose(error, 'capture isolated studio preview')));
  process.exitCode = 1;
}
