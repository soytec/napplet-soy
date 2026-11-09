import type { SignedEvent } from '../../protocol/src';
import { manifestIcon } from '../../protocol/src/manifest';
import {
  iconSources,
  verifyIconBytes,
  MAX_ICON_BYTES,
  MAX_ICON_PIXELS,
} from '../../protocol/src/icon';
import { downloadBytes } from './bytes';
import { manifestScreenshotSources } from '../../protocol/src/presentation';
import type { PresentationClaim } from '../../protocol/src/presentation';

const cache = new Map<string, { url: string | null; at: number; bytes: number }>();
const pending = new Map<string, Promise<void>>();
export const resolvedIconUrl = (id: string) => cache.get(id)?.url ?? null;
export const resolvedScreenshotUrl = (id: string) => cache.get(`screenshot:${id}`)?.url ?? null;

/** Render verified bytes, never the remote icon URL. Failures are presentation-only. */
export async function resolveManifestIcon(event: SignedEvent, local: string[] = []) {
  const claim = manifestIcon(event);
  return resolveRaster(
    event.id,
    claim ? iconSources(event).map((url) => ({ ...claim, url })) : [],
    local,
  );
}
export async function resolveManifestScreenshots(event: SignedEvent, local: string[] = []) {
  return resolveRaster(`screenshot:${event.id}`, manifestScreenshotSources(event), local);
}
async function resolveRaster(
  id: string,
  candidates: Array<PresentationClaim & { url: string }>,
  local: string[],
) {
  if (typeof createImageBitmap === 'undefined') return;
  if (!candidates.length) return;
  const previous = cache.get(id);
  if (previous && (previous.url || Date.now() - previous.at < 60000)) return;
  if (pending.has(id)) return pending.get(id);
  const task = (async () => {
    const deadline = AbortSignal.timeout(4000);
    let url: string | null = null,
      size = 0;
    // Preserve screenshot order, but race two mirrors of the same signed bytes.
    // A slow/dead first origin must not consume the whole presentation deadline
    // before another declared origin gets a chance to supply the image.
    const groups = new Map<string, typeof candidates>();
    for (const claim of candidates) {
      const key = `${claim.hash}:${claim.mime}`;
      groups.set(key, [...(groups.get(key) ?? []), claim]);
    }
    for (const mirrors of groups.values()) {
      if (deadline.aborted) break;
      const finished = new AbortController();
      const signal = AbortSignal.any([deadline, finished.signal]);
      let next = 0;
      try {
        const resolved = await Promise.any(
          Array.from({ length: Math.min(2, mirrors.length) }, async () => {
            while (next < mirrors.length && !signal.aborted) {
              const claim = mirrors[next++];
              try {
                return await decodeRaster(claim, signal, local);
              } catch {
                // Try the next declared mirror while this group's budget remains.
              }
            }
            throw new Error('No declared origin returned a usable image');
          }),
        );
        deadline.throwIfAborted();
        url = URL.createObjectURL(resolved.blob);
        size = resolved.bytes;
        break;
      } catch {
        /* Optional presentation: try the next declared screenshot. */
      } finally {
        // Abort remaining downloads and release any decoder that finishes late.
        finished.abort();
      }
    }
    cache.set(id, { url, at: Date.now(), bytes: size });
    let total = [...cache.values()].reduce((n, v) => n + v.bytes, 0);
    while (cache.size > 128 || total > 32 * 1024 * 1024) {
      const [id, value] = cache.entries().next().value!;
      if (value.url) URL.revokeObjectURL(value.url);
      total -= value.bytes;
      cache.delete(id);
    }
  })().finally(() => pending.delete(id));
  pending.set(id, task);
  return task;
}

async function decodeRaster(
  claim: PresentationClaim & { url: string },
  signal: AbortSignal,
  local: string[],
) {
  const bytes = await downloadBytes(claim.url, signal, MAX_ICON_BYTES, local);
  const header = await verifyIconBytes(bytes, claim);
  signal.throwIfAborted();
  const blob = new Blob([bytes as BlobPart], { type: header.mime });
  // Decoding cannot be cancelled. Stop waiting at the shared deadline,
  // and close a bitmap that finishes after its manifest has timed out.
  const decoding = createImageBitmap(blob).then((bitmap) => {
    if (signal.aborted) {
      bitmap.close();
      signal.throwIfAborted();
    }
    return bitmap;
  });
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  const decoded = await Promise.race([decoding, aborted]).finally(() =>
    signal.removeEventListener('abort', onAbort),
  );
  try {
    if (!decoded.width || !decoded.height || decoded.width * decoded.height > MAX_ICON_PIXELS)
      throw new Error('Icon dimensions exceed the presentation budget');
    // JPEG EXIF orientation may transpose dimensions without changing the pixel budget.
    if (!(
      (decoded.width === header.width && decoded.height === header.height) ||
      (decoded.width === header.height && decoded.height === header.width)
    ))
      throw new Error('Decoded icon dimensions disagree with the verified header');
  } finally {
    decoded.close();
  }
  signal.throwIfAborted();
  return { blob, bytes: bytes.length };
}
