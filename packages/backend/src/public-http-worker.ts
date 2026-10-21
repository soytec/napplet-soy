import { fetchPublicBytesNative } from './blossom';
import { diagnose, formatDiagnostic } from '../../diagnostics/src';

try {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error('Invalid download input');
    chunks.push(chunk);
  }
  const { url, maxBytes } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (
    typeof url !== 'string' ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 128 * 1024 ** 2
  )
    throw new Error('Invalid download input');
  const bytes = await fetchPublicBytesNative(new URL(url), AbortSignal.timeout(28000), maxBytes);
  process.stdout.write(bytes);
} catch (error) {
  console.error(formatDiagnostic(diagnose(error, 'download public HTTPS bytes')));
  process.exitCode = 1;
}
