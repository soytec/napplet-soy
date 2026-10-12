import { linkedMedia } from '../../protocol/src/linked-media';
import { cachedVideoSchema } from '../../protocol/src/preview-video';
import { z } from 'zod';
import { nip19 } from 'nostr-tools';
import { eventSchema, encodeAddress, MAX_READ_ARTIFACT_BYTES } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { missingDomains } from '../../runtime/src/capabilities';
import { cachedPreviewSchema } from '../../protocol/src/preview';
import { manifestTopics } from '../../protocol/src/topics';
import { resolvedIconUrl, resolvedScreenshotUrl } from '../../client/src/manifest-icon';
import { manifestScreenshotSources, manifestVideoSources } from '../../protocol/src/presentation';
export { default as DEFAULT_PUBLIC_RELAYS } from '../../nostr/discovery-relays.json';

export const PUBLIC_CACHE_TTL = 15 * 60 * 1000;
// Shared by gallery URLs, SSR share metadata, and the renderer's cache validators.
export const OG_VERSION = '4';
const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const publicNappletSchema = z.object({
  provenance: z.literal('nostr'),
  manifest: eventSchema,
  slug: z.string().max(256),
  title: z.string().max(160),
  description: z.string().max(1000),
  creator: z.string().max(160),
  pubkey: hex,
  topics: z.array(z.string().max(256)).max(32).catch([]).default([]),
  revisionId: hex,
  // Earliest signed publication observed for this identity; presentation only.
  firstPublishedAt: z.number().int().nonnegative().optional(),
  artifactHash: hex,
  aggregateHash: hex,
  format: z.enum(['legacy', 'standalone']).optional(),
  identityHash: hex.optional(),
  optionalDomains: z.array(z.string()).max(256).optional(),
  archetypes: z.array(z.string()).max(256).optional(),
  intents: z
    .array(z.object({ intent: z.string(), parameters: z.array(z.string()) }))
    .max(256)
    .optional(),
  icon: z
    .object({ hash: hex, mime: z.enum(['image/png', 'image/jpeg', 'image/webp']) })
    .nullable()
    .optional(),
  naddr: z.string().max(4096).nullable(),
  bytes: z.number().int().min(0).max(MAX_READ_ARTIFACT_BYTES).nullable(),
  domains: z.array(z.string()).max(256),
  relays: z.array(z.string().max(256)).max(8).default([]),
  sourceUrl: z.string().max(4096).nullable(),
  availability: z.enum(['ready', 'host-required', 'unavailable']),
  metadata: z.array(eventSchema).max(8).optional(),
  video: cachedVideoSchema.nullable().catch(null).default(null),
  preview: cachedPreviewSchema.nullable().catch(null).default(null),
});
export type PublicNapplet = z.infer<typeof publicNappletSchema>;
export const publicCacheSchema = z.object({
  version: z.literal(2),
  runtime: z.string().default('legacy'),
  previews: z.string().default('legacy'),
  fetchedAt: z.number().int().nonnegative(),
  relays: z.array(z.string().max(256)).max(8),
  rejected: z.number().int().nonnegative(),
  entries: z.array(publicNappletSchema).max(100),
});
export type PublicCache = z.infer<typeof publicCacheSchema>;
export async function publicNapplet(
  input: unknown,
  relayHints: string[] = [],
): Promise<PublicNapplet> {
  const release = await validateManifest(input);
  const event = release.manifest;
  const tag = (name: string) => event.tags.find((t) => t[0] === name)?.[1];
  let sourceUrl: string | null = null;
  try {
    const url = new URL(tag('source') ?? '');
    if (url.protocol === 'https:' && !url.username && !url.password) sourceUrl = url.href;
  } catch {}
  const pub = nip19.npubEncode(event.pubkey);
  return {
    provenance: 'nostr',
    manifest: event,
    slug: release.identity?.identifier ?? event.id,
    title: (tag('title') || release.identity?.identifier || 'Untitled napplet').slice(0, 160),
    description: release.description.slice(0, 1000),
    creator: `${pub.slice(0, 16)}…${pub.slice(-6)}`,
    pubkey: event.pubkey,
    topics: manifestTopics(event),
    revisionId: event.id,
    artifactHash: release.artifactHash,
    aggregateHash: release.aggregateHash,
    format: release.format,
    identityHash: release.identityHash,
    optionalDomains: release.optionalDomains,
    archetypes: release.archetypes,
    intents: release.intents,
    icon: release.icon,
    naddr: release.identity ? encodeAddress(release.identity, relayHints.slice(0, 8)) : null,
    bytes: null,
    domains: release.domains,
    relays: relayHints.slice(0, 8),
    sourceUrl,
    availability: missingDomains(release.domains).length ? 'host-required' : 'unavailable',
    preview: null,
    video: null,
  };
}
export const hasPublicPreview = (entry: PublicNapplet) =>
  !!entry.preview ||
  !!resolvedScreenshotUrl(entry.revisionId) ||
  !!resolvedIconUrl(entry.revisionId) ||
  linkedMedia(entry.manifest, entry.metadata ?? []).images.length > 0;
export const publicPoster = (entry: PublicNapplet) =>
  entry.preview
    ? entry.preview.descriptor.id === entry.manifest.id
      ? `/api/previews/${entry.revisionId}`
      : entry.preview.url
    : (resolvedScreenshotUrl(entry.revisionId) ??
      linkedMedia(entry.manifest, entry.metadata ?? []).images.find(
        (url) => !manifestScreenshotSources(entry.manifest).some((c) => c.url === url),
      ) ??
      resolvedIconUrl(entry.revisionId) ??
      `/api/og/${entry.revisionId}?v=${OG_VERSION}`);
/** Indexed direct previews use verified cache bytes; browser-only discoveries verify before playing. */
export function publicPreviewVideo(entry: PublicNapplet) {
  if (entry.video)
    return entry.video.descriptor.id === entry.manifest.id
      ? { url: `/api/previews/${entry.revisionId}/video`, hash: entry.video.hash }
      : entry.video;
  const candidates = manifestVideoSources(entry.manifest).filter((c) =>
    c.url.startsWith('https://'),
  );
  if (candidates.length)
    return {
      url: candidates[0].url,
      hash: candidates[0].hash,
      sources: candidates.map((c) => c.url),
    };
  return linkedMedia(entry.manifest, entry.metadata ?? []).videos[0];
}
export const publicLink = (entry: PublicNapplet) =>
  entry.naddr
    ? { to: '/n/$naddr' as const, params: { naddr: entry.naddr } }
    : { to: '/r/$snapshot' as const, params: { snapshot: entry.revisionId } };
