import type { SignedEvent } from './index';
import { appReferences, latestMetadata, descriptorImages } from './preview';
import { descriptorVideos } from './preview-video';
import { manifestScreenshotSources, manifestVideoSources } from './presentation';
/** Signed metadata associations, independent of this client's optional media cache. */
export function linkedMedia(manifest: SignedEvent, events: SignedEvent[]) {
  const images: string[] = [],
    videos: { url: string; hash: string }[] = [];
  const safe = (value: string) => {
    try {
      const u = new URL(value);
      return u.protocol === 'https:' && !u.username && !u.password && value.length <= 4096;
    } catch {
      return false;
    }
  };
  images.push(
    ...manifestScreenshotSources(manifest)
      .map((c) => c.url)
      .filter(safe),
  );
  videos.push(...manifestVideoSources(manifest).filter((v) => safe(v.url)));
  for (const ref of appReferences(manifest)) {
    const descriptor = latestMetadata(ref, events);
    if (!descriptor) continue;
    const profile = latestMetadata({ kind: 0, pubkey: descriptor.pubkey, identifier: '' }, events);
    images.push(...descriptorImages(descriptor, profile).filter(safe));
    videos.push(...descriptorVideos(descriptor).filter((v) => safe(v.url)));
  }
  return {
    images: [...new Set(images)],
    videos: [...new Map(videos.map((v) => [v.url, v])).values()],
  };
}
