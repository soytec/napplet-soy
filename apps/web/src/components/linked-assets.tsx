import { ArrowUpRight, FileArchive, Film, Image } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveScreenshot } from '../../../../packages/client/src/manifest-icon';
import { detailAssets } from '../../../../packages/backend/src/detail-assets';
import type { SignedEvent } from '../../../../packages/protocol/src';
import type { CachedPreview } from '../../../../packages/protocol/src/preview';
import type { CachedVideo } from '../../../../packages/protocol/src/preview-video';

export function LinkedAssets({
  manifest,
  preview,
  video,
  metadata = [],
}: {
  manifest: SignedEvent;
  preview?: CachedPreview | null;
  video?: CachedVideo | null;
  metadata?: SignedEvent[];
}) {
  const assets = useMemo(
    () => detailAssets(manifest, preview, video, metadata),
    [manifest, preview, video, metadata],
  );
  if (!assets.length) return null;
  return (
    <section className="linked-assets" aria-label="Linked assets">
      <h2>
        Linked assets <span>{assets.length}</span>
      </h2>
      <ul>
        {assets.map((asset) => {
          const Icon =
            asset.kind === 'video' ? Film : asset.kind === 'source' ? FileArchive : Image;
          return (
            <li key={asset.href}>
              <a
                href={asset.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${asset.alt ? `${asset.alt}. ` : ''}Open ${asset.title.toLowerCase()} (new tab)`}
              >
                <span className="linked-asset-icon" aria-hidden="true">
                  <Icon size={22} />
                  {asset.screenshotHash && !asset.thumbnail ? (
                    <ScreenshotThumbnail
                      manifest={manifest}
                      hash={asset.screenshotHash}
                      alt={asset.alt ?? asset.title}
                    />
                  ) : (
                    asset.thumbnail && (
                      <img
                        src={asset.thumbnail}
                        alt={asset.alt ?? ''}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                        }}
                      />
                    )
                  )}
                </span>
                <span className="linked-asset-label">
                  <strong>{asset.title}</strong>
                  <small>{asset.detail}</small>
                </span>
                <ArrowUpRight size={17} aria-hidden="true" />
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A remote URL is never used as an image before hash and decoder verification. */
function ScreenshotThumbnail({
  manifest,
  hash,
  alt,
}: {
  manifest: SignedEvent;
  hash: string;
  alt: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    setUrl(null);
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void resolveScreenshot(manifest, hash).then((resolved) => {
        if (!disposed) setUrl(resolved);
      });
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [manifest, hash]);
  return (
    <span ref={ref} style={{ position: 'absolute', inset: 0 }}>
      {url && <img src={url} alt={alt} loading="lazy" />}
    </span>
  );
}
