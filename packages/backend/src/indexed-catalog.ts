import { blocked, manifestBlocked } from '../../moderation/src/policy';
import { join, resolve } from 'node:path';
import {
  decodeAddress,
  identityAddress,
  MAX_READ_ARTIFACT_BYTES,
  sha256,
} from '../../protocol/src';
import { IndexStore, indexedProjection } from './index-store';
import type { Lookup } from './catalog';

export type IndexHealth = {
  checkedAt: number;
  release: string;
  relays: string[];
  errors: string[];
};
let connection: IndexStore | undefined;
export function indexStore() {
  const directory = process.env.SPACE_INDEX_DIR ? resolve(process.env.SPACE_INDEX_DIR) : null;
  if (connection?.directory !== directory) {
    connection?.close();
    connection = undefined;
  }
  if (!directory) return null;
  try {
    return (connection ??= new IndexStore(directory));
  } catch {
    return null;
  } // Web can start before the independent worker creates its DB.
}
export function indexHealth() {
  const health = indexStore()?.state<IndexHealth>('health') ?? null;
  return {
    enabled: !!process.env.SPACE_INDEX_DIR,
    ...health,
    stale: !health || Date.now() - health.checkedAt > 300000,
  };
}
function relays() {
  return indexHealth().relays ?? (process.env.SPACE_INDEX_RELAYS ?? '').split(',').filter(Boolean);
}
export async function indexedEntries() {
  const store = indexStore();
  if (!store) return [];
  const hints = relays();
  const scope = `${store.directory}:${hints.join(',')}`;
  if (projectionScope !== scope) {
    projectionCache.clear();
    projectionScope = scope;
  }
  const retained = new Set<string>();
  const entries = await Promise.all(
    store.rows().map((row) => {
      retained.add(row.id);
      const event = JSON.parse(row.event);
      if (store.removed(event) || manifestBlocked(event)) return null;
      const old = projectionCache.get(row.id);
      if (old?.event === row.event && old.projection === row.projection && old.key === row.key)
        return old.entry.then((entry) =>
          entry ? { ...entry, firstPublishedAt: store.firstPublishedAt(event) } : null,
        );
      const entry = indexedProjection(row, hints, store.firstPublishedAt(event));
      projectionCache.set(row.id, {
        event: row.event,
        projection: row.projection,
        key: row.key,
        entry,
      });
      return entry;
    }),
  );
  for (const id of projectionCache.keys()) if (!retained.has(id)) projectionCache.delete(id);
  return entries.filter((entry) => entry !== null);
}
let projectionScope = '';
const projectionCache = new Map<
  string,
  {
    event: string;
    projection: string | null;
    key: string;
    entry: ReturnType<typeof indexedProjection>;
  }
>();
export function lookupKey(input: Lookup) {
  if (input.type === 'named') return null;
  if (input.type === 'snapshot') return /^[a-f0-9]{64}$/.test(input.id) ? input.id : null;
  try {
    return identityAddress(decodeAddress(input.naddr));
  } catch {
    return null;
  }
}
export async function indexedLookup(input: Lookup) {
  const key = lookupKey(input),
    store = indexStore(),
    // /r/<id> can pin either a snapshot or an archived signed replaceable manifest.
    // Replaceable rows are keyed by address, so an exact event lookup must use id.
    row = key ? (input.type === 'snapshot' ? store?.revision(key) : store?.row(key)) : null;
  return {
    known: !!row,
    entry:
      row &&
      !manifestBlocked(JSON.parse(row.event)) &&
      !indexStore()!.removed(JSON.parse(row.event))
        ? await indexedProjection(
            row,
            relays(),
            indexStore()!.firstPublishedAt(JSON.parse(row.event)),
          )
        : null,
  };
}
export async function indexedRevision(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  const row = indexStore()?.revision(id);
  return row &&
    !manifestBlocked(JSON.parse(row.event)) &&
    !indexStore()!.removed(JSON.parse(row.event))
    ? indexedProjection(row, relays(), indexStore()!.firstPublishedAt(JSON.parse(row.event)))
    : null;
}
export async function indexedArtifact(hash: string) {
  const store = indexStore();
  if (!store || !/^[a-f0-9]{64}$/.test(hash) || blocked('hash', hash)) return null;
  const entries = await Promise.all(
    store
      .artifactRows(hash)
      .map((row) =>
        store.removed(JSON.parse(row.event)) || manifestBlocked(JSON.parse(row.event))
          ? null
          : indexedProjection(row, relays(), indexStore()!.firstPublishedAt(JSON.parse(row.event))),
      ),
  );
  const entry = entries.find((n) => n?.artifactHash === hash && n.availability === 'ready');
  if (!entry) return null;
  const file = Bun.file(join(store.directory, 'artifacts', `${hash}.html`));
  if (!(await file.exists()) || file.size !== entry.bytes || file.size > MAX_READ_ARTIFACT_BYTES)
    return null;
  // Artifact URLs are immutable: never serve corrupted bytes under a valid digest.
  return (await sha256(new Uint8Array(await file.arrayBuffer()))) === hash ? file : null;
}
