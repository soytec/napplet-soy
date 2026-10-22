import { diagnose } from '../../diagnostics/src';
import { discoverRemix } from './discovery';

try {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 16384) throw new Error('Invalid remix discovery input');
    chunks.push(chunk);
  }
  const { filter, relays } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const event = await discoverRemix(filter, relays, AbortSignal.timeout(8000));
  process.stdout.write(JSON.stringify({ event }));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: diagnose(error, 'discover remix') }));
}
