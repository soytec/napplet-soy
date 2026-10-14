import { publicPreviewVideo } from '../../../../packages/backend/src/public-model';
import { PreviewCover } from './preview-cover';
import { Link } from '@tanstack/react-router';
import { Expand, Play, Info } from 'lucide-react';
import { TopicTags } from './topic-tags';
import { Player } from './player';
import { GalleryCardSocial } from './gallery-social';
import { CardShare } from './card-share';
import { shareMedia } from '../../../../packages/client/src/share-note';
import { CreatorLink } from './creator-link';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { NappletCard as Card } from '../../../../packages/backend/src/catalog';
import {
  hasPublicPreview,
  publicPoster,
  publicLink,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
export function NappletCard({
  napplet,
  index = 0,
  playing = false,
  onPlay,
  onStop,
}: {
  napplet: Card | PublicNapplet;
  index?: number;
  playing?: boolean;
  onPlay?: () => void;
  onStop?: () => void;
}) {
  const article = useRef<HTMLElement>(null);
  const stop = useRef(onStop);
  stop.current = onStop;
  useLayoutEffect(() => {
    if (playing)
      article.current
        ?.querySelector('.player-stage')
        ?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [playing]);
  useEffect(() => {
    if (!playing || !article.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting && !article.current?.querySelector(':fullscreen, .player-expanded'))
        stop.current?.();
    });
    observer.observe(article.current.querySelector('.player-stage') ?? article.current);
    return () => observer.disconnect();
  }, [playing]);
  const external = 'provenance' in napplet;
  const playable = !external || napplet.availability === 'ready';
  const share = (
    <CardShare
      title={napplet.title}
      note={() => ({
        title: napplet.title,
        description: napplet.description,
        topics: napplet.topics,
        media: external ? shareMedia(napplet) : undefined,
      })}
      path={
        napplet.naddr
          ? `/n/${napplet.naddr}`
          : `/r/${external ? napplet.revisionId : napplet.snapshotId}`
      }
    />
  );
  const link = external
    ? publicLink(napplet)
    : {
        to: '/$creator/$slug' as const,
        params: { creator: `@${napplet.handle}`, slug: napplet.slug },
      };
  return (
    <article
      ref={article}
      className={`napplet-card${playing ? ' is-playing' : ''}`}
      style={{ animationDelay: `${index * 25}ms` }}
    >
      {playing && external ? (
        <Player napplet={napplet} autoPlay compact onStop={onStop} />
      ) : (
        <PreviewCover
          video={external ? publicPreviewVideo(napplet) : null}
          revision={external ? napplet.revisionId : napplet.snapshotId}
          title={napplet.title}
        >
          <Link
            {...link}
            className="card-preview"
            aria-label={`${playable ? 'Play' : 'View'} ${napplet.title}`}
            onClick={(event) => {
              if (
                onPlay &&
                playable &&
                external &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                event.preventDefault();
                onPlay();
              }
            }}
          >
            <img
              className={external && !hasPublicPreview(napplet) ? 'generated-poster' : undefined}
              src={external ? publicPoster(napplet) : `/posters/${napplet.slug}.svg`}
              referrerPolicy="no-referrer"
              alt=""
              width="720"
              height="450"
              loading={index < 3 ? 'eager' : 'lazy'}
            />
            <span className="play-indicator">
              {playable ? <Play size={18} fill="currentColor" /> : <Info size={20} />}
            </span>
          </Link>
        </PreviewCover>
      )}
      <div className="card-heading">
        <Link {...link}>{napplet.title}</Link>
        <Link
          to={napplet.naddr ? '/n/$naddr/play' : '/r/$snapshot/play'}
          params={
            napplet.naddr
              ? { naddr: napplet.naddr }
              : { snapshot: external ? napplet.revisionId : napplet.snapshotId }
          }
          className="card-fullscreen"
          aria-label={`Open ${napplet.title} fullscreen`}
          title="Open fullscreen"
        >
          <Expand size={18} aria-hidden="true" />
        </Link>
      </div>
      <div className={`card-meta${external ? ' public-meta' : ''}`}>
        <CreatorLink pubkey={napplet.pubkey} />
        <span>
          {external ? (
            <span className={playable ? 'compatibility-ready' : 'compatibility-missing'}>
              {playable
                ? 'Ready to play'
                : napplet.availability === 'host-required'
                  ? 'Needs more capabilities'
                  : 'Download unavailable'}
            </span>
          ) : (
            <>
              {(napplet.bytes / 1024).toFixed(1)} KB <span className="meta-dot">·</span> open source
            </>
          )}
        </span>
      </div>
      {external ? (
        <GalleryCardSocial napplet={napplet}>{share}</GalleryCardSocial>
      ) : (
        <div
          className="card-social"
          role="group"
          aria-label={`Social actions for ${napplet.title}`}
        >
          {share}
        </div>
      )}
      <TopicTags topics={napplet.topics.slice(0, 3)}>
        {napplet.topics.length > 3 && (
          <Link {...link} aria-label={`View all tags for ${napplet.title}`}>
            +{napplet.topics.length - 3}
          </Link>
        )}
      </TopicTags>
    </article>
  );
}
