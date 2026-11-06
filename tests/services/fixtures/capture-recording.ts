import { checkPublication } from '../../../apps/cli/src/publish-check';
import { recordingSchema } from '../../../packages/publish/src/config';
import { diagnose, formatDiagnostic } from '../../../packages/diagnostics/src';

// One capture per process, matching the isolated Studio capture worker.
const input = await Bun.stdin.json();
try {
  const result = await checkPublication(
    new Map([
      ['napplet.json', new TextEncoder().encode(input.config)],
      ['index.html', new TextEncoder().encode(input.html)],
    ]),
    true,
    recordingSchema.parse(input.recording),
    false,
    undefined,
    input.viewport,
  );
  console.log(
    JSON.stringify({
      preview: Buffer.from(result.preview).toString('base64'),
      videoBytes: result.video?.length ?? 0,
    }),
  );
} catch (error) {
  console.error(formatDiagnostic(diagnose(error, 'capture test recording')));
  process.exitCode = 1;
}
