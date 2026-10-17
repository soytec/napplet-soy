import type { SignedEvent } from './index';
import type { ManifestIcon } from './manifest';

/** Optional Soy convention while the NIP-5D amendment is under discussion. */
export const LEGACY_PRESENTATION_PROFILE = 'soy.presentation/1';
export const MANIFEST_PRESENTATION_PROFILE = 'soy.presentation/2';
export const MAX_DISPLAY_SCREENSHOTS = 8;
export function isDirectPresentationProfile(value: unknown) {
  return value === MANIFEST_PRESENTATION_PROFILE || value === LEGACY_PRESENTATION_PROFILE;
}
type TaggedEvent = Pick<SignedEvent, 'kind' | 'tags'>;
export type PresentationClaim = {
  hash: string;
  mime: string;
  width?: number;
  height?: number;
  bytes?: number;
  alt?: string;
  duration?: number;
};
const hashPattern = /^[a-f0-9]{64}$/;

/** Hints only: byte/hash/decoder checks remain authoritative. Unknown fields are extensible. */
function attributes(fields: string[]): Omit<PresentationClaim, 'hash' | 'mime'> {
  const values = new Map<string, string>();
  const duplicate = new Set<string>();
  for (const field of fields) {
    const separator = field.indexOf(' ');
    if (separator < 1) continue;
    const name = field.slice(0, separator);
    if (!['dim', 'size', 'alt', 'duration'].includes(name)) continue;
    if (values.has(name)) duplicate.add(name);
    values.set(name, field.slice(separator + 1));
  }
  const get = (name: string) => (duplicate.has(name) ? undefined : values.get(name));
  const result: Omit<PresentationClaim, 'hash' | 'mime'> = {};
  const dimensions = /^([1-9]\d*)x([1-9]\d*)$/.exec(get('dim') ?? '');
  if (dimensions && dimensions.slice(1).every((n) => Number.isSafeInteger(Number(n)))) {
    result.width = Number(dimensions[1]);
    result.height = Number(dimensions[2]);
  }
  const size = get('size');
  if (size && /^(0|[1-9]\d*)$/.test(size) && Number.isSafeInteger(Number(size)))
    result.bytes = Number(size);
  const alt = get('alt');
  if (alt && alt.length <= 2000) result.alt = alt;
  const duration = get('duration');
  if (duration && /^\d+(?:\.\d+)?$/.test(duration) && Number.isFinite(Number(duration)))
    result.duration = Number(duration);
  return result;
}

function claims(event: TaggedEvent, name: string, mimes: string[], limit: number) {
  const profiles = event.tags.filter((t) => t[0] === 'presentation');
  if (
    ![35129, 15129, 5129].includes(event.kind) ||
    profiles.length > 1 ||
    (profiles.length === 1 &&
      (profiles[0].length !== 2 || !isDirectPresentationProfile(profiles[0][1])))
  )
    return [];
  const legacy = profiles[0]?.[1] === LEGACY_PRESENTATION_PROFILE;
  // Marker-free tags implement the proposed wire format, not an adopted upstream standard.
  if (name === 'preview' && event.tags.filter((t) => t[0] === name).length > 1) return [];
  const result = new Map<string, PresentationClaim>();
  const ambiguous = new Set<string>();
  for (const tag of event.tags) {
    if (result.size >= limit) break; // Ignore extras; never invalidate a usable set.
    if (
      tag[0] !== name ||
      (legacy ? tag.length !== 3 : tag.length < 3) ||
      !hashPattern.test(tag[1]) ||
      !mimes.includes(tag[2]) ||
      ambiguous.has(tag[1])
    )
      continue;
    const previous = result.get(tag[1]);
    if (previous) {
      if (previous.mime !== tag[2]) {
        result.delete(tag[1]);
        ambiguous.add(tag[1]);
      }
      continue; // First occurrence determines ordering and optional hints.
    }
    result.set(tag[1], { hash: tag[1], mime: tag[2], ...attributes(tag.slice(3)) });
  }
  return [...result.values()];
}

/** Display policy only. A manifest may contain any number of screenshots. */
export function manifestScreenshots(event: TaggedEvent): (PresentationClaim & ManifestIcon)[] {
  return screenshotClaims(event, MAX_DISPLAY_SCREENSHOTS);
}
function screenshotClaims(event: TaggedEvent, limit: number) {
  return claims(
    event,
    'screenshot',
    ['image/png', 'image/jpeg', 'image/webp'],
    limit,
  ) as (PresentationClaim & ManifestIcon)[];
}
/** Cleanup/shared-blob protection must see attachments beyond the display limit. */
export function inventoryScreenshots(event: TaggedEvent) {
  return screenshotClaims(event, Infinity);
}
export function manifestPreviewVideo(event: TaggedEvent): PresentationClaim | null {
  return claims(event, 'preview', ['video/webm'], 1)[0] ?? null;
}

/** Hash-only destinations, with the same declared-origin shape as NIP-5D icons.
 * The consumer still applies public DNS/network policy (or explicit local mode). */
export function presentationSources(event: Pick<SignedEvent, 'tags'>, hash: string): string[] {
  if (!hashPattern.test(hash)) return [];
  return [
    ...new Set(
      event.tags
        .filter((t) => t[0] === 'server')
        .flatMap((t) => {
          try {
            const url = new URL(t[1]);
            if (
              t.length !== 2 ||
              !['https:', 'http:'].includes(url.protocol) ||
              url.username ||
              url.password ||
              url.pathname !== '/' ||
              url.search ||
              url.hash
            )
              return [];
            return [`${url.origin}/${hash}`];
          } catch {
            return [];
          }
        }),
    ),
  ].slice(0, 8);
}
export function manifestScreenshotSources(event: TaggedEvent) {
  return manifestScreenshots(event).flatMap((claim) =>
    presentationSources(event, claim.hash).map((url) => ({ ...claim, url })),
  );
}
export function manifestVideoSources(event: TaggedEvent) {
  const claim = manifestPreviewVideo(event);
  return claim ? presentationSources(event, claim.hash).map((url) => ({ ...claim, url })) : [];
}
