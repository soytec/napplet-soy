import { relayGo } from './relay-go';
import { mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { RelayPool } from 'applesauce-relay';
import { lastValueFrom, toArray } from 'rxjs';
import { verifiedEvent, type SignedEvent } from '../packages/protocol/src';

const root = resolve(import.meta.dir, '..');
export const relayBinary = resolve(root, '.local/bin/napplet-relay');
export const localRelayUrl = 'ws://127.0.0.1:19347/relay';
export const localRelayInstance = createHash('sha256').update(root).digest('hex').slice(0, 16);
export async function relayBuildID() {
  const hash = createHash('sha256')
    .update('go1.25.0')
    .update(process.platform)
    .update(process.arch);
  const files = [
    ...new Bun.Glob('*.go').scanSync(resolve(root, 'services/relay')),
    'go.mod',
    'go.sum',
  ].sort();
  for (const file of files)
    hash.update(file).update(await Bun.file(resolve(root, 'services/relay', file)).bytes());
  for (const file of ['scripts/relay-go.ts', 'scripts/relay-count-patches.ts'])
    hash.update(file).update(await Bun.file(resolve(root, file)).bytes());
  return hash.digest('hex').slice(0, 16);
}
export async function buildRelay(output = relayBinary) {
  const build = await relayBuildID();
  const marker = Bun.file(`${output}.build`);
  if (
    (await Bun.file(output).exists()) &&
    (await marker.exists()) &&
    (await marker.text()) === build
  )
    return build;
  await mkdir(resolve(output, '..'), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await relayGo([
    'build',
    '-trimpath',
    '-ldflags',
    `-X main.buildID=${build}`,
    '-o',
    temporary,
    '.',
  ]);
  await rename(temporary, output);
  await Bun.write(`${output}.build`, build);
  return build;
}
/** This fixture-writing entry point accepts only literal loopback URLs. It never uses publicdev targets. */
export function localFixtureTarget(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== 'ws:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['/', '/relay'].includes(url.pathname)
  )
    throw new Error(
      'Fixture relay must be ws:// with a literal loopback address and no credentials (only / or /relay paths).',
    );
  return url.href;
}
export async function readRelayEvents(pool: RelayPool, url: string, ids: string[]) {
  const result = await lastValueFrom(
    pool
      .relay(url)
      .request({ ids, limit: ids.length }, { timeout: 5000, reconnect: false, waitForAuth: false })
      .pipe(toArray()),
  );
  return result.map(verifiedEvent).filter((event) => ids.includes(event.id));
}
export async function seedLocalRelay(
  url = localRelayUrl,
  records?: Array<{ current: SignedEvent; snapshot: SignedEvent }>,
) {
  const started = performance.now();
  const target = localFixtureTarget(url);
  const catalog =
    records ?? (await Bun.file(resolve(root, 'packages/backend/data/catalog.json')).json());
  const events: SignedEvent[] = catalog.flatMap(
    (record: { current: unknown; snapshot: unknown }) => [
      verifiedEvent(record.current),
      verifiedEvent(record.snapshot),
    ],
  );
  if (events.length > 64)
    throw new Error('Local relay seeding supports at most 64 fixture events.');
  const pool = new RelayPool();
  try {
    const ids = events.map((event) => event.id);
    const existing = new Set((await readRelayEvents(pool, target, ids)).map((event) => event.id));
    let published = 0;
    for (const event of events) {
      if (existing.has(event.id)) continue;
      const result = await pool
        .relay(target)
        .publish(event, { timeout: 5000, retries: false, reconnect: false });
      if (!result.ok) throw new Error(`Local relay refused fixture ${event.id}: ${result.message}`);
      published++;
    }
    const returned = new Set((await readRelayEvents(pool, target, ids)).map((event) => event.id));
    if (ids.some((id) => !returned.has(id)))
      throw new Error('Local relay acknowledged fixtures but did not return all signed events.');
    return {
      events: events.length,
      published,
      milliseconds: Math.round(performance.now() - started),
    };
  } finally {
    pool.close();
  }
}
if (import.meta.main) {
  const command = process.argv[2];
  if (command === 'build') console.log('Relay build:', await buildRelay(process.argv[3]));
  else if (command === 'seed') console.log('Local relay:', await seedLocalRelay());
  else throw new Error('Expected build [output] or seed.');
}
