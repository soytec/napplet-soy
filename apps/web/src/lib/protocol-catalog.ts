import type { Filter } from 'nostr-tools';
import {
  comparePublications,
  publicationKey,
} from '../../../../packages/protocol/src/publication-order';
import {
  decodeAddress,
  verifiedEvent,
  encodeAddress,
  MAX_READ_ARTIFACT_BYTES,
  type SignedEvent,
  type GallerySearch,
} from '../../../../packages/protocol/src';
import {
  legacySnapshotAddress,
  manifestFormat,
  validateManifest,
} from '../../../../packages/protocol/src/manifest';
import {
  discoveryTarget,
  targetedDiscoveryFilters,
} from '../../../../packages/protocol/src/discovery';
import {
  appReferences,
  latestMetadata,
  validatedPreview,
} from '../../../../packages/protocol/src/preview';
import { publicNapplet, type PublicNapplet } from '../../../../packages/backend/src/public-model';
import {
  discoveryFacets,
  matchesGallery,
  topicFacets,
  type DiscoverySearch,
} from '../../../../packages/protocol/src/topics';
import {
  resolveManifestIcon,
  resolveManifestScreenshots,
} from '../../../../packages/client/src/manifest-icon';
import { indexedPinnedManifest } from '../../../../packages/client/src/pinned-manifest';
import {
  snapshotPresentationAddress,
  standalonePresentationKey,
} from '../../../../packages/protocol/src/presentation-pairs';
import {
  latestProfile,
  profilePubkey,
  profileView,
} from '../../../../packages/protocol/src/profile';
import { createSourceBrowser } from '../../../../packages/client/src/source';
import { blossomBytes, downloadBytes, resourceUrl } from '../../../../packages/client/src/bytes';
import { protocolClient, network, manifestAllowed, blocked, featuredRules } from './network';

const entries = new Map<string, PublicNapplet>();
const firstPublications = new Map<string, number>();
// Retain bounded verified named presentation observations across replacements.
// Exact pairs and verified author references affect display only, never authority.
const presentationParents = new Map<string, SignedEvent>();
const localDeletions = new Map<string, number>();
function locallyRemoved(e: SignedEvent) {
  const expiration = e.tags.find((tag) => tag[0] === 'expiration')?.[1];
  if (expiration && /^\d+$/.test(expiration) && Number(expiration) <= Date.now() / 1000)
    return true;
  const address = `${e.kind}:${e.pubkey}:${e.kind === 15129 ? '' : (e.tags.find((t) => t[0] === 'd')?.[1] ?? '')}`;
  return (
    (localDeletions.get(`${e.pubkey}:e:${e.id}`) ?? -1) >= e.created_at ||
    (localDeletions.get(`${e.pubkey}:a:${address}`) ?? -1) >= e.created_at
  );
}

const metadataCache = new Map<string, { at: number; events: SignedEvent[] }>();
const availabilityCache = new Map<string, { at: number; ready: boolean; size: number | null }>();
const manifestCache = new Map<string, SignedEvent>();
const deletionReads = new Map<string, { at: number; events: SignedEvent[] }>();
const pendingDeletions = new Map<string, Promise<SignedEvent[]>>();
async function readDeletions(filters: Filter[], hints: string[]) {
  const client = protocolClient();
  const key = JSON.stringify([filters, [...hints, ...network().relays]]);
  const cached = deletionReads.get(key);
  let events = cached && cached.at > Date.now() - 15000 ? cached.events : undefined;
  if (!events) {
    let pending = pendingDeletions.get(key);
    if (!pending) {
      pending = client
        .query(filters, hints)
        .then((events) => {
          deletionReads.set(key, { at: Date.now(), events });
          while (deletionReads.size > 512) deletionReads.delete(deletionReads.keys().next().value!);
          return events;
        })
        .finally(() => pendingDeletions.delete(key));
      pendingDeletions.set(key, pending);
    }
    events = await pending;
  }
  // A recent negative read never hides a newly observed signed deletion.
  return [...new Map([...events, ...client.cached(filters)].map((e) => [e.id, e])).values()];
}
const newest = (a: SignedEvent, b: SignedEvent) =>
  b.created_at - a.created_at || a.id.localeCompare(b.id);
const catalogKey = (event: SignedEvent) =>
  event.kind === 5129
    ? event.id
    : `${event.kind}:${event.pubkey}:${event.kind === 15129 ? '' : event.tags.find((t) => t[0] === 'd')?.[1]}`;
export function seedCatalog(values: PublicNapplet[]) {
  for (const n of values) {
    if (!manifestAllowed(n.manifest) || locallyRemoved(n.manifest)) continue;
    const key = publicationKey(n.manifest);
    firstPublications.set(
      key,
      Math.min(firstPublications.get(key) ?? Infinity, n.firstPublishedAt ?? n.manifest.created_at),
    );
    n.firstPublishedAt = firstPublications.get(key);
    let list = true;
    if (n.manifest.kind !== 5129) {
      for (const [id, known] of entries) {
        if (catalogKey(known.manifest) !== catalogKey(n.manifest)) continue;
        if (newest(known.manifest, n.manifest) < 0) list = false;
        else if (id !== n.revisionId) entries.delete(id);
      }
    }
    if (list) entries.set(n.revisionId, n);
    const presentation = n.manifest.kind !== 5129 && standalonePresentationKey(n.manifest);
    if (presentation) presentationParents.set(presentation, n.manifest);
    if (!availabilityCache.has(n.revisionId))
      availabilityCache.set(n.revisionId, {
        at: Date.now(),
        ready: n.availability === 'ready',
        size: n.bytes,
      });
    manifestCache.set(n.revisionId, n.manifest);
    protocolClient().seed([
      n.manifest,
      ...(n.preview ? [n.preview.descriptor] : []),
      ...(n.video ? [n.video.descriptor] : []),
    ]);
  }
  while (firstPublications.size > 2000)
    firstPublications.delete(firstPublications.keys().next().value!);
  while (entries.size > 1000) entries.delete(entries.keys().next().value!);
  while (presentationParents.size > 1000)
    presentationParents.delete(presentationParents.keys().next().value!);
  while (metadataCache.size > 1000) metadataCache.delete(metadataCache.keys().next().value!);
  while (availabilityCache.size > 1000)
    availabilityCache.delete(availabilityCache.keys().next().value!);
  while (manifestCache.size > 1500) manifestCache.delete(manifestCache.keys().next().value!);
}
export async function findManifest(reference: string, hints: string[] = []) {
  const address = /^(35129|15129):([a-f0-9]{64}):(.*)$/.exec(reference);
  if (address)
    reference = encodeAddress({
      kind: Number(address[1]) as 35129 | 15129,
      pubkey: address[2],
      identifier: address[3],
    });
  const target = discoveryTarget(reference);
  const identity = target.type === 'address' ? decodeAddress(target.naddr) : null;
  const filter: Filter = identity
    ? {
        kinds: [identity.kind],
        authors: [identity.pubkey],
        ...(identity.kind === 35129 ? { '#d': [identity.identifier] } : {}),
        limit: 5,
      }
    : { ids: [target.type === 'snapshot' ? target.id : ''], kinds: [35129, 15129, 5129], limit: 1 };
  let result = target.type === 'snapshot' ? manifestCache.get(target.id) : undefined;
  if (!result) {
    try {
      result =
        target.type === 'snapshot'
          ? await protocolClient().queryEvent(
              target.id,
              [35129, 15129, 5129],
              [...hints, ...target.hints],
            )
          : (await protocolClient().query([filter], [...hints, ...target.hints])).sort(newest)[0];
    } catch (error) {
      if (target.type !== 'snapshot') throw error;
      // A replaceable event may have been pruned by every relay. The index can
      // return its original signature; validation and exact-ID checks still apply.
    }
    if (!result && target.type === 'snapshot')
      result = (await indexedPinnedManifest(target.id)) ?? undefined;
  }
  if (!result) return null;
  await validateManifest(result);
  if (target.type === 'snapshot' && result.id !== target.id)
    throw new Error('A different manifest cannot replace a pinned revision.');
  const expiration = result.tags.find((tag) => tag[0] === 'expiration')?.[1];
  if (expiration && /^\d+$/.test(expiration) && Number(expiration) <= Date.now() / 1000)
    return null;
  if (!manifestAllowed(result) || locallyRemoved(result)) return null;
  // NIP-09 deletion requests are authored by the event owner; a later valid release survives.
  const ownerAddress =
    result.kind === 5129
      ? legacySnapshotAddress(result)
      : `${result.kind}:${result.pubkey}:${result.kind === 15129 ? '' : (result.tags.find((t) => t[0] === 'd')?.[1] ?? '')}`;
  const deletes = await readDeletions(
    [
      { kinds: [5], authors: [result.pubkey], '#e': [result.id], limit: 20 },
      ...(ownerAddress
        ? [{ kinds: [5], authors: [result.pubkey], '#a': [ownerAddress], limit: 20 }]
        : []),
    ],
    [...hints, ...target.hints],
  );
  if (
    deletes.some(
      (d) =>
        d.created_at >= result.created_at &&
        d.tags.some(
          (t) =>
            (t[0] === 'e' && t[1] === result.id) ||
            (ownerAddress && t[0] === 'a' && t[1] === ownerAddress),
        ),
    )
  )
    return null;
  manifestCache.set(result.id, result);
  return result;
}
export async function hydrateNapplet(event: SignedEvent, hints: string[] = []) {
  if (!manifestAllowed(event) || locallyRemoved(event))
    throw new Error('This napplet is unavailable here.');
  const n = await publicNapplet(event, [...new Set([...network().relays, ...hints])].slice(0, 8));
  const previous = entries.get(event.id);
  if (previous) {
    n.bytes = previous.bytes;
    n.availability = previous.availability;
    n.preview = previous.preview;
    n.video = previous.video;
  }
  const iconTask = Promise.all([
    resolveManifestIcon(event, network().blossom),
    // Indexed direct covers already use the server's verified raster cache.
    n.preview?.descriptor.id === event.id && validatedPreview(event, n.preview)
      ? Promise.resolve(null)
      : resolveManifestScreenshots(event, network().blossom),
  ]);
  const metadata: SignedEvent[] = [];
  let metadataResolved = false;
  await Promise.all(
    appReferences(event).map(async (ref) => {
      try {
        const key = `${ref.kind}:${ref.pubkey}:${ref.identifier}`;
        const cached = metadataCache.get(key);
        const candidates =
          cached && cached.at > Date.now() - 60000
            ? cached.events
            : await protocolClient().query(
                [
                  { kinds: [ref.kind], authors: [ref.pubkey], '#d': [ref.identifier], limit: 3 },
                  { kinds: [0], authors: [ref.pubkey], limit: 3 },
                ],
                ref.relay ? [ref.relay] : hints,
              );
        metadataCache.set(key, { at: Date.now(), events: candidates });
        metadataResolved = true;
        const descriptor = latestMetadata(ref, candidates);
        if (descriptor && manifestAllowed(descriptor)) {
          metadata.push(descriptor);
          if (descriptor.kind === 31990 && descriptor.content === '') {
            const profile = latestProfile(candidates, descriptor.pubkey);
            if (profile && manifestAllowed(profile)) metadata.push(profile);
          }
        }
      } catch {
        /* Missing metadata must not prevent playback. */
      }
    }),
  );
  if (metadataResolved) {
    if (n.preview?.descriptor.id !== event.id) n.preview = null;
    if (n.video?.descriptor.id !== event.id) n.video = null;
  }
  n.metadata = metadata;
  await iconTask;
  // Availability is a lightweight direct storage probe; executable bytes are hash-checked on play.
  if (n.availability !== 'host-required') {
    const servers = (await validateManifest(event)).servers;
    const cachedAvailability = availabilityCache.get(event.id);
    if (cachedAvailability && cachedAvailability.at > Date.now() - 60000) {
      n.availability = cachedAvailability.ready ? 'ready' : 'unavailable';
      n.bytes = cachedAvailability.size;
      seedCatalog([n]);
      return n;
    }
    n.availability = 'unavailable';
    for (const server of [...new Set([...servers, ...network().blossom])].slice(0, 8)) {
      try {
        const response = await fetch(
          resourceUrl(`${server.replace(/\/$/, '')}/${n.artifactHash}`, network().blossom),
          {
            method: 'HEAD',
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            redirect: 'error',
            signal: AbortSignal.timeout(2500),
          },
        );
        const size = Number(response.headers.get('content-length'));
        if (response.ok && (!size || size <= MAX_READ_ARTIFACT_BYTES)) {
          n.availability = 'ready';
          n.bytes = size || previous?.bytes || null;
          break;
        }
      } catch {}
    }
  }
  availabilityCache.set(event.id, {
    at: Date.now(),
    ready: n.availability === 'ready',
    size: n.bytes,
  });
  seedCatalog([n]);
  return n;
}
export async function lookupProtocol(
  data: { type: 'address'; naddr: string } | { type: 'snapshot'; id: string },
) {
  const event = await findManifest(data.type === 'address' ? data.naddr : data.id);
  return event ? { ...(await hydrateNapplet(event)), siteOrigin: location.origin } : null;
}
let catalogFresh = 0;
let catalogPending: Promise<PublicNapplet[]> | undefined;
const targetedPending = new Map<string, Promise<PublicNapplet[]>>();
const targetedFresh = new Map<string, number>();
/** Four batches at a time, avoiding a deadline per author/descriptor group. */
async function forGroups<T>(items: T[], size: number, read: (group: T[]) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, Math.ceil(items.length / size)) }, async () => {
      while (next < items.length) {
        const start = next;
        next += size;
        await read(items.slice(start, start + size));
      }
    }),
  );
}
export function queryCatalog(author?: string, search?: DiscoverySearch): Promise<PublicNapplet[]> {
  if (
    search &&
    (search.archetype || search.intent || search.requiredDomain || search.optionalDomain)
  ) {
    const key = JSON.stringify([
      author,
      search.archetype,
      search.intent,
      search.requiredDomain,
      search.optionalDomain,
    ]);
    if ((targetedFresh.get(key) ?? 0) > Date.now() - 30000)
      return Promise.resolve([...entries.values()].filter(manifestEntry));
    const pending = targetedPending.get(key);
    if (pending) return pending;
    const query = refreshCatalog(author, search)
      .then((result) => {
        targetedFresh.set(key, Date.now());
        if (targetedFresh.size > 128) targetedFresh.delete(targetedFresh.keys().next().value!);
        return result;
      })
      .finally(() => targetedPending.delete(key));
    targetedPending.set(key, query);
    return query;
  }
  if (author) return refreshCatalog(author);
  return (catalogPending ??= refreshCatalog().finally(() => {
    catalogPending = undefined;
  }));
}
async function refreshCatalog(author?: string, search?: DiscoverySearch) {
  if (!author && !search && catalogFresh > Date.now() - 30000)
    return [...entries.values()].filter(manifestEntry);
  const filters = search
    ? targetedDiscoveryFilters(
        {
          archetypes: search.archetype ? [search.archetype] : [],
          intents: search.intent ? [search.intent] : [],
          requiredDomains: search.requiredDomain ? [search.requiredDomain] : [],
          optionalDomains: search.optionalDomain ? [search.optionalDomain] : [],
        },
        { limit: 300, legacyRequirements: true },
      ).fallback
    : [{ kinds: [35129, 15129, 5129], limit: 300 }];
  const events = await protocolClient().query(
    filters.map((filter) => ({
      ...filter,
      ...(author ? { authors: [author] } : {}),
    })),
  );
  const winners = new Map<string, SignedEvent>();
  for (const e of events.sort(newest)) {
    const key = catalogKey(e);
    if (!winners.has(key)) winners.set(key, e);
  }
  // Targeted reads must not replace a known newer publication with an older match.
  if (search)
    for (const entry of entries.values()) {
      const e = entry.manifest;
      const key = catalogKey(e);
      const candidate = winners.get(key);
      if (candidate && newest(e, candidate) < 0) winners.set(key, e);
    }
  const authors = [...new Set(events.map((e) => e.pubkey))];
  const deletions: SignedEvent[] = [];
  await forGroups(authors, 64, async (group) => {
    deletions.push(...(await protocolClient().query([{ kinds: [5], authors: group, limit: 300 }])));
  });
  for (const [key, e] of winners) {
    const removed = deletions.some(
      (d) =>
        d.pubkey === e.pubkey &&
        d.created_at >= e.created_at &&
        d.tags.some((t) => (t[0] === 'e' && t[1] === e.id) || (t[0] === 'a' && t[1] === key)),
    );
    if (!manifestAllowed(e) || removed || locallyRemoved(e)) {
      entries.delete(e.id);
      for (const [id, n] of entries)
        if (
          n.pubkey === e.pubkey &&
          n.manifest.kind === e.kind &&
          n.slug === (e.tags.find((t) => t[0] === 'd')?.[1] ?? '')
        )
          entries.delete(id);
      winners.delete(key);
    }
  }
  const values = [...winners.values()];
  const refs = [
    ...new Map(
      values
        .flatMap((e) => appReferences(e))
        .map((r) => [`${r.kind}:${r.pubkey}:${r.identifier}`, r]),
    ).values(),
  ];
  await forGroups(refs, 32, async (group) => {
    try {
      const found = await protocolClient().query(
        [
          ...group.map((r) => ({
            kinds: [r.kind],
            authors: [r.pubkey],
            '#d': [r.identifier],
            limit: 3,
          })),
          {
            kinds: [0],
            authors: [...new Set(group.map((r) => r.pubkey))],
            limit: group.length * 3,
          },
        ],
        group.flatMap((r) => (r.relay ? [r.relay] : [])),
      );
      for (const ref of group)
        metadataCache.set(`${ref.kind}:${ref.pubkey}:${ref.identifier}`, {
          at: Date.now(),
          events: found,
        });
    } catch {}
  });
  let index = 0;
  // Four concurrent manifest/metadata/storage resolutions per browser.
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (index < values.length) {
        const e = values[index++];
        try {
          await hydrateNapplet(e);
        } catch {}
      }
    }),
  );
  // Replaceable events supersede old revisions in the browser's listing.
  for (const [id, entry] of entries) {
    const e = entry.manifest,
      key = catalogKey(e);
    if (
      e.kind !== 5129 &&
      (!author || e.pubkey === author) &&
      (!search || winners.has(key)) &&
      winners.get(key)?.id !== id
    )
      entries.delete(id);
  }
  if (!author && !search) catalogFresh = Date.now();
  return [...entries.values()].filter((n) => manifestEntry(n) && (!author || n.pubkey === author));
}
export const availableCatalog = () => [...entries.values()].filter(manifestEntry);
const manifestEntry = (n: PublicNapplet) => {
  if (!manifestAllowed(n.manifest) || locallyRemoved(n.manifest)) return false;
  if (n.manifest.kind !== 5129 || featured(n)) return true;
  const presentation = standalonePresentationKey(n.manifest);
  const parent = presentation && presentationParents.get(presentation);
  if (parent && manifestAllowed(parent) && !locallyRemoved(parent)) return false;
  const presentationAddress = snapshotPresentationAddress(n.manifest, n.metadata);
  if (
    presentationAddress &&
    [...entries.values()].some(
      (entry) =>
        entry.manifest.kind !== 5129 &&
        catalogKey(entry.manifest) === presentationAddress &&
        entry.manifest.created_at >= n.manifest.created_at &&
        manifestAllowed(entry.manifest) &&
        !locallyRemoved(entry.manifest),
    )
  )
    return false;
  const address = legacySnapshotAddress(n.manifest);
  return (
    !address ||
    ![...entries.values()].some(
      (entry) =>
        entry.manifest.kind !== 5129 &&
        `${entry.manifest.kind}:${entry.pubkey}:${entry.manifest.kind === 15129 ? '' : entry.slug}` ===
          address &&
        manifestAllowed(entry.manifest) &&
        !locallyRemoved(entry.manifest),
    )
  );
};
export function featured(n: PublicNapplet) {
  const e = n.manifest,
    address = `${e.kind}:${e.pubkey}:${e.kind === 15129 ? '' : e.tags.find((t) => t[0] === 'd')?.[1]}`;
  return featuredRules().some((r) =>
    r.type === 'event' ? r.target === e.id : r.target === address,
  );
}
// Navigation reads the local projection. Relay/Blossom enrichment runs after render.
export function browseProtocol(search: GallerySearch) {
  const known = [...entries.values()].filter(
    (n) => manifestAllowed(n.manifest) && !locallyRemoved(n.manifest),
  );
  const all = known.filter((n) => (search.sort === 'featured' ? featured(n) : manifestEntry(n)));
  const selected = featuredRules().flatMap((rule) => {
    const n = known.find(
      (n) =>
        n.availability === 'ready' &&
        (rule.type === 'event'
          ? rule.target === n.revisionId
          : rule.target ===
            `${n.manifest.kind}:${n.pubkey}:${n.manifest.kind === 15129 ? '' : n.slug}`),
    );
    return n ? [rule.type === 'event' ? { ...n, naddr: null } : n] : [];
  });
  const visible = all.filter((n) => search.unavailable || n.availability === 'ready');
  const matches = visible
    .filter((n) => matchesGallery(n, search))
    .sort((a, b) =>
      comparePublications(
        { ...a, firstPublishedAt: firstPublications.get(publicationKey(a.manifest)) },
        { ...b, firstPublishedAt: firstPublications.get(publicationKey(b.manifest)) },
        search.sort,
      ),
    );
  const pages = Math.max(1, Math.ceil(matches.length / 24)),
    page = Math.min(search.page ?? 1, pages);
  return {
    napplets: matches.slice((page - 1) * 24, page * 24),
    topics: topicFacets(visible),
    discovery: discoveryFacets(visible),
    total: visible.length,
    unavailableCount: all.filter((n) => n.availability !== 'ready' && matchesGallery(n, search))
      .length,
    matches: matches.length,
    page,
    pages,
    featured: [...new Map(selected.map((n) => [n.revisionId, n])).values()].slice(0, 12),
    status: {
      index: null,
      publicdev: false,
      publicCount: all.length,
      fetchedAt: catalogFresh || null,
      stale: catalogFresh < Date.now() - 30000,
      relays: network().relays,
      rejected: 0,
    },
  };
}
export async function readProfile(pubkey: string) {
  const events = await protocolClient().query([{ kinds: [0], authors: [pubkey], limit: 3 }]);
  const event = latestProfile(events, pubkey);
  if (event && !manifestAllowed(event)) throw new Error('This profile is unavailable here.');
  return { event, profile: profileView(pubkey, event), relays: network().relays };
}
export async function profileProtocol(input: { pubkey: string; page: number; all: boolean }) {
  const pubkey = profilePubkey(input.pubkey);
  if (blocked('pubkey', pubkey)) return null;
  const [{ profile }, all] = await Promise.all([readProfile(pubkey), queryCatalog(pubkey)]);
  const shown = all
    .filter((n) => input.all || n.availability === 'ready')
    .sort((a, b) => newest(a.manifest, b.manifest));
  const pages = Math.max(1, Math.ceil(shown.length / 24)),
    page = Math.min(input.page, pages);
  return {
    profile,
    warning: null,
    relays: network().relays,
    entries: shown.slice((page - 1) * 24, page * 24),
    total: shown.length,
    hidden: all.length - shown.length,
    pages,
    page,
    all: input.all,
    siteOrigin: location.origin,
  };
}
export const directSource = createSourceBrowser({
  manifest: (id) => findManifest(id),
  artifact: async (hash) => {
    const n = [...manifestCache.values()].find((e) =>
      manifestFormat(e) === 'standalone'
        ? e.tags.some((t) => t[0] === 'x' && t.length === 2 && t[1] === hash)
        : e.tags.some((t) => t[0] === 'path' && t[2] === hash),
    );
    return blossomBytes(
      hash,
      [...(n ? (await validateManifest(n)).servers : []), ...network().blossom],
      AbortSignal.timeout(60000),
      MAX_READ_ARTIFACT_BYTES,
      network().blossom,
      30000,
    );
  },
  download: (url, signal) => downloadBytes(url.href, signal, 50 * 1024 ** 2, network().blossom),
  blocked,
  manifestBlocked: (e) => !manifestAllowed(e),
});

export async function featuredProtocol() {
  const rules = featuredRules().slice(0, 12),
    selected: (PublicNapplet | undefined)[] = [];
  let index = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (index < rules.length) {
        const slot = index++,
          rule = rules[slot];
        try {
          const event = await findManifest(rule.target);
          if (!event) continue;
          const n = await hydrateNapplet(event);
          if (n.availability === 'ready')
            selected[slot] = rule.type === 'event' ? { ...n, naddr: null } : n;
        } catch {}
      }
    }),
  );
  return selected.filter((n): n is PublicNapplet => !!n);
}

/** Apply author actions immediately; relay/index refresh continues independently. */
export function applyLifecycleEvent(event: SignedEvent) {
  event = verifiedEvent(event);
  protocolClient().seed([event]);
  if (event.kind === 5) {
    for (const t of event.tags)
      if (t[0] === 'e' || t[0] === 'a') {
        const key = `${event.pubkey}:${t[0]}:${t[1]}`;
        localDeletions.set(key, Math.max(localDeletions.get(key) ?? 0, event.created_at));
      }
    while (localDeletions.size > 2000) localDeletions.delete(localDeletions.keys().next().value!);
    for (const [id, n] of entries) {
      const e = n.manifest,
        address = `${e.kind}:${e.pubkey}:${e.kind === 15129 ? '' : (e.tags.find((t) => t[0] === 'd')?.[1] ?? '')}`;
      if (
        e.pubkey === event.pubkey &&
        e.created_at <= event.created_at &&
        event.tags.some((t) => (t[0] === 'e' && t[1] === id) || (t[0] === 'a' && t[1] === address))
      ) {
        entries.delete(id);
        manifestCache.delete(id);
        availabilityCache.delete(id);
      }
    }
  } else if ([35129, 15129].includes(event.kind)) {
    manifestCache.set(event.id, event);
    void hydrateNapplet(event).catch(() => {});
  }
  catalogFresh = 0;
}
