import { linkedMedia } from '../../protocol/src/linked-media';
import {
  manifestScreenshots,
  manifestScreenshotSources,
  manifestVideoSources,
} from '../../protocol/src/presentation';
import type { SignedEvent } from '../../protocol/src';
import { descriptorImages, validatedPreview, type CachedPreview } from '../../protocol/src/preview';
import {
  descriptorVideos,
  validatedVideo,
  type CachedVideo,
} from '../../protocol/src/preview-video';

export type DetailAsset = {
  kind: 'image' | 'video' | 'source';
  title: string;
  href: string;
  detail: string;
  thumbnail?: string;
  screenshotHash?: string;
  alt?: string;
};

const size = (bytes: number) =>
  bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
function linkedUrl(value: string) {
  try {
    const url = new URL(value);
    const transport =
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    return value.length <= 4096 && transport && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

/** Presentation only: use existing signed associations; never fetch or infer attachments. */
export function detailAssets(
  manifest: SignedEvent,
  image?: CachedPreview | null,
  clip?: CachedVideo | null,
  metadata: SignedEvent[] = [],
): DetailAsset[] {
  const preview = validatedPreview(manifest, image);
  const video = validatedVideo(manifest, clip);
  const assets: DetailAsset[] = [];
  const screenshotSources = manifestScreenshotSources(manifest);
  const seen = new Set<string>();
  const imageUrl = preview && linkedUrl(preview.url);
  if (preview && imageUrl) {
    assets.push({
      kind: 'image',
      title: 'Preview image',
      href: preview.url,
      thumbnail:
        preview.descriptor.id === manifest.id ? `/api/previews/${manifest.id}` : preview.url,
      // Cached PNG dimensions/size describe a derivative, not the original image.
      detail: imageUrl.host,
    });
    seen.add(preview.url);
    const claim = screenshotSources.find((c) => c.url === preview.url);
    if (claim) {
      assets[assets.length - 1].screenshotHash = claim.hash;
      assets[assets.length - 1].alt = claim.alt;
      for (const source of screenshotSources.filter((c) => c.hash === claim.hash))
        seen.add(source.url);
    }
  }
  const videoUrl = video && linkedUrl(video.url);
  if (video && videoUrl) {
    assets.push({
      kind: 'video',
      title: 'Preview clip',
      href: video.url,
      detail: `${videoUrl.host} · ${(video.durationMs / 1000).toFixed(1)} sec · ${size(video.bytes)}`,
    });
    seen.add(video.url);
    if (manifestVideoSources(manifest).some((source) => source.url === video.url))
      for (const source of manifestVideoSources(manifest)) seen.add(source.url);
  }
  // The cache selects one cover/clip. Other declared files remain opt-in links
  // to the publisher's server, not unverified embeds or downloads at render time.
  const descriptors = new Map<string, { event: SignedEvent; profile?: SignedEvent }>();
  if (preview)
    descriptors.set(preview.descriptor.id, { event: preview.descriptor, profile: preview.profile });
  if (video && !descriptors.has(video.descriptor.id))
    descriptors.set(video.descriptor.id, { event: video.descriptor });
  let images = 0,
    videos = 0;
  for (const { event, profile } of descriptors.values()) {
    const links = [
      ...descriptorImages(event, profile).map((url) => ({ url, kind: 'image' as const })),
      ...descriptorVideos(event).map(({ url }) => ({ url, kind: 'video' as const })),
    ];
    for (const link of links) {
      const url = linkedUrl(link.url);
      if (!url || seen.has(url.href) || seen.has(link.url)) continue;
      seen.add(url.href);
      assets.push({
        kind: link.kind,
        href: link.url,
        title:
          link.kind === 'image' ? `Additional image ${++images}` : `Additional clip ${++videos}`,
        detail: url.host,
      });
    }
  }
  const links = linkedMedia(manifest, metadata);
  const directImages = new Set(screenshotSources.map((c) => c.url));
  for (const [kind, urls] of [
    ['image', links.images],
    ['video', links.videos.map((v) => v.url)],
  ] as const)
    for (const href of urls) {
      const url = linkedUrl(href);
      if (!url || seen.has(href)) continue;
      seen.add(href);
      const primary = !assets.some((asset) => asset.kind === kind);
      const screenshot =
        kind === 'image' ? screenshotSources.find((c) => c.url === href) : undefined;
      assets.push({
        kind,
        title:
          kind === 'image'
            ? primary
              ? 'Preview image'
              : `Additional image ${++images}`
            : primary
              ? 'Preview clip'
              : `Additional clip ${++videos}`,
        href,
        detail: url.host,
        ...(screenshot ? { screenshotHash: screenshot.hash, alt: screenshot.alt } : {}),
        ...(kind === 'image' && primary && !directImages.has(href) ? { thumbnail: href } : {}),
      });
    }
  const archives = manifest.tags.filter((tag) => tag[0] === 'source-archive');
  if (archives.length === 1 && archives[0][1]?.length <= 4096) {
    try {
      const url = linkedUrl(archives[0][1]);
      if (url && !url.hash && /\/[a-f0-9]{64}(?:\.tar)?$/.test(url.pathname))
        assets.push({
          kind: 'source',
          title: 'Source archive',
          href: archives[0][1],
          detail: url.host,
        });
    } catch {
      /* A malformed optional reference does not become a download. */
    }
  }
  const order = new Map(manifestScreenshots(manifest).map((claim, i) => [claim.hash, i]));
  for (const asset of assets) {
    const index = asset.screenshotHash ? order.get(asset.screenshotHash) : undefined;
    if (index !== undefined) asset.title = `Screenshot ${index + 1}`;
  }
  return assets.sort(
    (a, b) => (order.get(a.screenshotHash ?? '') ?? 8) - (order.get(b.screenshotHash ?? '') ?? 8),
  );
}
