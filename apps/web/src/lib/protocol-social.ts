import type { Filter } from 'nostr-tools';
import type { SignedEvent, GallerySearch } from '../../../../packages/protocol/src';
import { validateManifest } from '../../../../packages/protocol/src/manifest';
import { socialScope, socialView, rootComment } from '../../../../packages/protocol/src/social';
import { latestProfile, profileView } from '../../../../packages/protocol/src/profile';
import { GallerySocialReader } from '../../../../packages/client/src/gallery-social';
import { protocolClient, network, manifestAllowed, publicEventCacheReady } from './network';
import { queryCatalog, availableCatalog, featured } from './protocol-catalog';
import { matchesGallery } from '../../../../packages/protocol/src/topics';
import { zapTotalsStore } from './zap-totals';
import type { GallerySocialData } from '../../../../packages/backend/src/gallery-social';

const history = new Map<string, SignedEvent[]>();
const chunks = <T>(items: T[], size = 64) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
export async function readSocial(
  manifest: SignedEvent,
  hints: string[] = [],
  signal = AbortSignal.timeout(30000),
  onUpdate?: (data: Awaited<ReturnType<typeof socialSnapshot>>) => void,
) {
  await validateManifest(manifest);
  const scope = socialScope(manifest),
    client = protocolClient();
  await publicEventCacheReady();
  const filters = socialFilters(manifest);
  const raw = new Map((history.get(scope.key) ?? []).filter(manifestAllowed).map((e) => [e.id, e]));
  client.cached(filters).forEach((e) => raw.set(e.id, e));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const emit = async () => {
    const value = await socialSnapshot(manifest, hints, [...raw.values()]);
    if (!signal.aborted) onUpdate?.(value);
    return value;
  };
  const schedule = () => {
    if (!timer)
      timer = setTimeout(() => {
        timer = undefined;
        void emit().catch(() => {});
      }, 40);
  };
  const add = (e: SignedEvent) => {
    raw.set(e.id, e);
    schedule();
  };
  try {
    if (raw.size) await emit();
    await client.query(filters, hints, signal, add, false, schedule);
    // References, reactions and author metadata share one parallel relay phase.
    const refs = [
      ...new Set(
        [...raw.values()].flatMap((e) =>
          e.tags
            .filter((t) => ['e', 'E'].includes(t[0]) && /^[a-f0-9]{64}$/.test(t[1]))
            .map((t) => t[1]),
        ),
      ),
    ]
      .filter((id) => id !== manifest.id && !raw.has(id))
      .slice(0, 128);
    const comments = [...raw.values()]
      .filter((e) => rootComment(e, scope))
      .map((e) => e.id)
      .slice(0, 200);
    const authors = [
      ...new Set([manifest.pubkey, ...[...raw.values()].map((e) => e.pubkey)]),
    ].slice(0, 256);
    const related: Filter[] = [
      ...chunks(refs).map((ids) => ({ ids, kinds: [35129, 15129, 5129, 1111], limit: 200 })),
      ...chunks(comments).map((ids) => ({ kinds: [7, 9735], '#e': ids, limit: 200 })),
      ...chunks(authors).map((authors) => ({ kinds: [0, 5], authors, limit: 200 })),
    ];
    if (related.length) await client.query(related, hints, signal, add);
    signal.throwIfAborted();
    return await emit();
  } finally {
    clearTimeout(timer);
  }
}
function socialFilters(manifest: SignedEvent): Filter[] {
  const scope = socialScope(manifest);
  return [
    {
      kinds: [1111],
      ...(scope.address ? { '#A': [scope.address] } : { '#E': [manifest.id] }),
      limit: 200,
    },
    { kinds: [7, 9735], '#e': [manifest.id], limit: 200 },
    ...(scope.address ? [{ kinds: [7, 9735], '#a': [scope.address], limit: 200 }] : []),
  ];
}
/** Re-reduce the verified store after an acknowledgement, including cached deletions. */
export async function socialSnapshot(
  manifest: SignedEvent,
  hints: string[],
  inputs: SignedEvent[] = [],
) {
  const scope = socialScope(manifest),
    client = protocolClient();
  const raw = new Map(
    [...(history.get(scope.key) ?? []), ...inputs, ...client.cached(socialFilters(manifest))].map(
      (e) => [e.id, e],
    ),
  );
  const refs = [
    ...new Set(
      [...raw.values()].flatMap((e) =>
        e.tags
          .filter((t) => ['e', 'E'].includes(t[0]) && /^[a-f0-9]{64}$/.test(t[1]))
          .map((t) => t[1]),
      ),
    ),
  ].slice(0, 128);
  if (refs.length)
    client.store
      .getByFilters([{ ids: refs, kinds: [35129, 15129, 5129, 1111] }])
      .forEach((e) => raw.set(e.id, e));
  const comments = [...raw.values()]
    .filter((e) => rootComment(e, scope))
    .map((e) => e.id)
    .slice(0, 200);
  if (comments.length)
    client.store
      .getByFilters([{ kinds: [7, 9735], '#e': comments }])
      .forEach((e) => raw.set(e.id, e));
  const authors = [...new Set([manifest.pubkey, ...[...raw.values()].map((e) => e.pubkey)])].slice(
    0,
    256,
  );
  client.cached([{ kinds: [0, 5], authors }]).forEach((e) => raw.set(e.id, e));
  const manifests = new Map([[manifest.id, manifest]]);
  for (const e of raw.values())
    if ([35129, 15129, 5129].includes(e.kind) && manifestAllowed(e))
      try {
        await validateManifest(e);
        manifests.set(e.id, e);
      } catch {}
  const events = [...raw.values()]
    .filter(manifestAllowed)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 2000);
  history.set(scope.key, events);
  let bytes = [...history.values()].reduce((n, values) => n + JSON.stringify(values).length * 2, 0);
  while (history.size > 1 && (history.size > 32 || bytes > 24 * 1024 ** 2)) {
    const key = history.keys().next().value!;
    bytes -= JSON.stringify(history.get(key)).length * 2;
    history.delete(key);
  }
  const profiles = Object.fromEntries(
    authors.map((key) => [key, profileView(key, latestProfile(events, key))]),
  );
  const lastActions: Record<string, number> = {};
  events
    .filter((e) => [7, 5, 1111].includes(e.kind))
    .forEach((e) => (lastActions[e.pubkey] = Math.max(lastActions[e.pubkey] ?? 0, e.created_at)));
  return {
    scope,
    manifest,
    relays: [...new Set([...network().relays, ...hints])].slice(0, 8),
    ...socialView(scope, events, manifests),
    profiles,
    lastActions,
    events,
    manifests,
  };
}
export async function publishSocial(event: SignedEvent, relays: string[]) {
  const accepted = await protocolClient().publish(event, relays);
  // Acknowledged events survive relays' eventual read visibility.
  for (const [key, events] of history) {
    const ids = new Set(events.map((e) => e.id));
    if (
      event.tags.some(
        (t) =>
          (['a', 'A'].includes(t[0]) && t[1] === key) ||
          (['e', 'E'].includes(t[0]) && (t[1] === key || ids.has(t[1]))),
      )
    )
      history.set(key, [...events.filter((e) => e.id !== event.id), event].slice(-2000));
  }
  return accepted;
}
let galleryReader: GallerySocialReader | undefined;
export async function gallerySocial(
  search: GallerySearch,
  viewer?: string,
  signal?: AbortSignal,
  onUpdate?: (data: GallerySocialData) => void,
): Promise<GallerySocialData> {
  protocolClient();
  await publicEventCacheReady();
  const entries = (availableCatalog().length ? availableCatalog() : await queryCatalog()).filter(
    (n) =>
      matchesGallery(n, search) &&
      (search.sort !== 'featured' || featured(n)) &&
      (search.unavailable || n.availability === 'ready'),
  );
  galleryReader ??= new GallerySocialReader(protocolClient(), undefined, zapTotalsStore);
  return galleryReader.read(entries, viewer, signal, onUpdate);
}
