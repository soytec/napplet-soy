import sharp from 'sharp';
import { mkdir, rename, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256, type SignedEvent } from '../../protocol/src';
import {
  appReferences,
  latestMetadata,
  descriptorImages,
  validatedPreview,
  MAX_PREVIEW_BYTES,
  MAX_CACHED_PREVIEW_BYTES,
  type CachedPreview,
} from '../../protocol/src/preview';
import { fetchPublicBytes, publicResourceUrl } from './blossom';
import { manifestIcon } from '../../protocol/src/manifest';
import { iconSources, verifyIconBytes } from '../../protocol/src/icon';
import { manifestScreenshotSources } from '../../protocol/src/presentation';

export function previewImageUrl(input: string) {
  if (input.length > 4096) throw new Error('Preview URL is too long');
  return publicResourceUrl(input);
}
function rasterFormat(bytes: Uint8Array) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'png';
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpeg';
  if (/^GIF8[79]a/.test(b.subarray(0, 6).toString())) return 'gif';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP')
    return 'webp';
  throw new Error('Unsupported preview image');
}
export async function normalizePreview(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > MAX_PREVIEW_BYTES)
    throw new Error('Preview exceeds byte limit');
  const format = rasterFormat(bytes); // Reject SVG/HTML before invoking any image parser.
  const image = sharp(bytes, {
    limitInputPixels: 16_000_000,
    animated: false,
    failOn: 'warning',
  }).timeout({ seconds: 3 });
  const metadata = await image.metadata();
  if (metadata.format !== format) throw new Error('Preview format mismatch');
  const { data, info } = await image
    .rotate()
    .resize({ width: 1200, height: 750, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  if (data.length > MAX_CACHED_PREVIEW_BYTES)
    throw new Error('Normalized preview exceeds byte limit');
  return { data, width: info.width, height: info.height };
}

export async function cachedPreviewBytes(directory: string, preview: CachedPreview) {
  const file = Bun.file(resolve(directory, 'previews', `${preview.hash}.png`));
  if (!(await file.exists()) || file.size !== preview.bytes || file.size > MAX_CACHED_PREVIEW_BYTES)
    return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (
    (await sha256(bytes)) !== preview.hash ||
    bytes.length < 24 ||
    bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
    bytes.readUInt32BE(16) !== preview.width ||
    bytes.readUInt32BE(20) !== preview.height
  )
    return null;
  return bytes;
}

export async function indexPreviewImages(
  directory: string,
  entries: Array<{
    manifest: SignedEvent;
    preview?: CachedPreview | null;
    metadata?: SignedEvent[];
  }>,
  metadata: SignedEvent[],
  signal: AbortSignal,
  options: {
    download?: (url: URL, signal: AbortSignal, maxBytes: number) => Promise<Uint8Array>;
    previous?: Array<{ manifest: SignedEvent; preview?: CachedPreview | null }>;
  } = {},
) {
  const path = resolve(directory, 'previews');
  await mkdir(path, { recursive: true });
  const queue = [...entries];
  // Reserve the maximum before each request so concurrent downloads cannot exceed this budget.
  let remaining = 50 * 1024 * 1024;
  const downloaded = new Map<
    string,
    Promise<{ hash: string; width: number; height: number; bytes: number }>
  >();
  const previous = options.previous ?? [];
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let entry = queue.shift(); entry && !signal.aborted; entry = queue.shift()) {
        entry.preview = null;
        entry.metadata = appReferences(entry.manifest).flatMap((ref) => {
          const descriptor = latestMetadata(ref, metadata);
          if (!descriptor) return [];
          const profile =
            descriptor.kind === 31990 && descriptor.content === ''
              ? latestMetadata({ kind: 0, pubkey: descriptor.pubkey, identifier: '' }, metadata)
              : undefined;
          return profile ? [descriptor, profile] : [descriptor];
        });
        const candidates = appReferences(entry.manifest)
          .flatMap((ref) => {
            const descriptor = latestMetadata(ref, metadata);
            if (!descriptor) return [];
            const profile =
              descriptor.kind === 31990 && descriptor.content === ''
                ? latestMetadata({ kind: 0, pubkey: descriptor.pubkey, identifier: '' }, metadata)
                : undefined;
            return descriptorImages(descriptor, profile).map((url) => ({
              descriptor,
              profile,
              url,
              priority:
                descriptor.kind === 32267 &&
                descriptor.tags.some((t) => t[0] === 'image' && t[1] === url)
                  ? 0
                  : descriptor.kind === 31990
                    ? 1
                    : 2,
            }));
          })
          .sort((a, b) => a.priority - b.priority);
        candidates.unshift(
          ...manifestScreenshotSources(entry.manifest).map(({ url }) => ({
            descriptor: entry.manifest,
            profile: undefined,
            url,
            priority: -1,
          })),
        );
        // Keep screenshots as covers; a standalone manifest can supply its own verified icon.
        candidates.push(
          ...iconSources(entry.manifest).map((url) => ({
            descriptor: entry.manifest,
            profile: undefined,
            url,
            priority: 3,
          })),
        );
        for (const { descriptor, profile, url } of candidates) {
          if (signal.aborted) break;
          try {
            const target = previewImageUrl(url);
            // Immutable content-addressed URLs bind the retrieved bytes. Other HTTPS URLs bind only the signed URL.
            const digest = /\/([a-f0-9]{64})(?:\.[a-z0-9]{1,8})?$/.exec(target.pathname)?.[1];
            const old = previous
              .map((n) => n.preview)
              .find(
                (p) =>
                  p?.descriptor.id === descriptor.id &&
                  p.profile?.id === profile?.id &&
                  p.url === url,
              );
            if (
              digest &&
              old &&
              validatedPreview(entry.manifest, old) &&
              (await cachedPreviewBytes(directory, old))
            ) {
              entry.preview = old;
              break;
            }
            const icon =
              descriptor.id === entry.manifest.id
                ? (manifestScreenshotSources(entry.manifest).find((c) => c.url === url) ??
                  manifestIcon(entry.manifest))
                : null;
            const downloadKey = `${url}:${icon?.mime ?? 'preview'}`;
            let task = downloaded.get(downloadKey);
            if (!task) {
              if (remaining < MAX_PREVIEW_BYTES)
                throw new Error('Preview refresh budget exhausted');
              remaining -= MAX_PREVIEW_BYTES;
              task = (async () => {
                const bytes = await (options.download ?? fetchPublicBytes)(
                  target,
                  AbortSignal.any([signal, AbortSignal.timeout(4000)]),
                  MAX_PREVIEW_BYTES,
                );
                if (bytes.length > MAX_PREVIEW_BYTES) throw new Error('Preview exceeds byte limit');
                remaining += MAX_PREVIEW_BYTES - bytes.length;
                if (signal.aborted) throw new Error('Preview refresh cancelled');
                if (digest && (await sha256(bytes)) !== digest)
                  throw new Error('Preview hash mismatch');
                if (icon) await verifyIconBytes(bytes, icon);
                const normalized = await normalizePreview(bytes);
                const hash = await sha256(normalized.data);
                const temporary = resolve(path, `${hash}.${crypto.randomUUID()}.tmp`);
                await Bun.write(temporary, normalized.data);
                await rename(temporary, resolve(path, `${hash}.png`));
                return {
                  hash,
                  width: normalized.width,
                  height: normalized.height,
                  bytes: normalized.data.length,
                };
              })();
              downloaded.set(downloadKey, task);
            }
            entry.preview = { descriptor, profile, url, ...(await task) };
            break;
          } catch {
            /* Optional metadata never changes executable availability. Try the next image. */
          }
        }
      }
    }),
  );
}

/** Retain current and previous refresh images, keeping the on-disk cache bounded over time. */
export async function prunePreviewImages(
  directory: string,
  retained: Array<{ preview?: CachedPreview | null }>,
) {
  const hashes = new Set(retained.map((entry) => entry.preview?.hash).filter(Boolean));
  const path = resolve(directory, 'previews');
  for (const file of await readdir(path, { withFileTypes: true })) {
    if (
      file.isFile() &&
      /^[a-f0-9]{64}\.png$/.test(file.name) &&
      !hashes.has(file.name.slice(0, -4))
    )
      await rm(resolve(path, file.name));
  }
}
