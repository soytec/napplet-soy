import { Link } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  publicLink,
  publicPoster,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
import { getFeaturedGallery } from '@/lib/catalog.functions';
import { Button } from './ui/button';
import { PreviewCover } from './preview-cover';
import { linkedMedia } from '../../../../packages/protocol/src/linked-media';
import { useNostr } from './nostr-provider';
import { communityMode } from '@/lib/community-mode';

const previewClip = (entry: PublicNapplet) =>
  entry.video ?? linkedMedia(entry.manifest, entry.metadata ?? []).videos[0];

export function FeaturedHero({
  initial,
  empty,
}: {
  initial: PublicNapplet[];
  empty: React.ReactNode;
}) {
  const { community } = useNostr();
  const [rawEntries, setEntries] = useState(initial);
  const entries = community.enabled
    ? rawEntries.filter((entry) => communityMode.allows(entry.pubkey))
    : rawEntries;
  const [selection, setSelection] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [clipMode, setClipMode] = useState<'auto' | 'play' | 'pause'>('auto');
  const [clipPlaying, setClipPlaying] = useState(false);
  const [clipFailed, setClipFailed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLElement>(null);
  const slider = useRef<HTMLDivElement>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const destination = useRef<number | null>(null);
  const index = Math.max(
    0,
    entries.findIndex((n) => n.revisionId === selection),
  );
  const current = entries[index];
  const slideOrder = entries.map((n) => n.revisionId).join(',');
  useEffect(() => {
    setClipMode('auto');
    setClipPlaying(false);
    setClipFailed(false);
  }, [current?.revisionId]);
  const selectedIndex = useRef(index);
  selectedIndex.current = index;
  function select(next: number) {
    clearTimeout(settle.current);
    destination.current = next;
    setSelection(entries[next].revisionId);
    slider.current?.scrollTo({
      left: next * slider.current.clientWidth,
      behavior: reduced ? 'instant' : 'smooth',
    });
  }
  // Keep the selected item aligned after a resize or refreshed editorial order.
  useEffect(() => {
    const element = slider.current;
    if (!element) return;
    const align = () => {
      clearTimeout(settle.current);
      destination.current = null;
      element.scrollTo({ left: selectedIndex.current * element.clientWidth, behavior: 'instant' });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(element);
    return () => {
      observer.disconnect();
      clearTimeout(settle.current);
    };
  }, [slideOrder]);
  useEffect(() => setEntries(initial), [initial]);
  useEffect(() => {
    let alive = true,
      pending = false;
    async function refresh() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const result = await getFeaturedGallery();
        if (alive) setEntries(result);
      } catch {
        /* Keep the last view during a transient outage; playback rechecks policy. */
      } finally {
        pending = false;
      }
    }
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!root.current) return;
    let inView = false;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(root.current);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [!!current]);
  useEffect(() => {
    if (entries.length < 2 || paused || hovered || focused || reduced || !visible) return;
    const timer = setInterval(() => select((index + 1) % entries.length), 7000);
    return () => clearInterval(timer);
  }, [slideOrder, index, paused, hovered, focused, reduced, visible]);
  function move(offset: number) {
    setPaused(true);
    select((index + offset + entries.length) % entries.length);
  }
  function interact() {
    destination.current = null;
    clearTimeout(settle.current);
    setPaused(true);
  }
  if (!current) return empty;
  return (
    <section
      ref={root}
      className="featured-hero"
      aria-label="Featured napplets"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        setFocused(true);
        if (!(event.target as HTMLElement).closest('[data-rotation-control]')) setPaused(true);
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <div className="featured-heading">
        <span className="eyebrow">
          <Sparkles size={14} /> PICKED FOR THE PLAYGROUND
        </span>
        <span>
          {String(index + 1).padStart(2, '0')} / {String(entries.length).padStart(2, '0')}
        </span>
      </div>
      <div
        ref={slider}
        className="featured-slider"
        tabIndex={entries.length > 1 ? 0 : undefined}
        role="group"
        aria-label="Featured slides"
        onPointerDown={interact}
        onWheel={interact}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || entries.length < 2) return;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }}
        onScroll={() => {
          clearTimeout(settle.current);
          settle.current = setTimeout(() => {
            const element = slider.current;
            if (!element?.clientWidth) return;
            // A previous scroll's debounce can fire during a new smooth movement.
            // Only gestures may change selection before the requested slide arrives.
            if (destination.current !== null) {
              if (Math.abs(element.scrollLeft - destination.current * element.clientWidth) > 2)
                return;
              destination.current = null;
            }
            const next = Math.max(
              0,
              Math.min(entries.length - 1, Math.round(element.scrollLeft / element.clientWidth)),
            );
            setSelection(entries[next].revisionId);
          }, 150);
        }}
      >
        {entries.map((entry, slide) => (
          <div
            key={entry.revisionId}
            className="featured-slide"
            role="group"
            aria-roledescription="slide"
            aria-label={`${slide + 1} of ${entries.length}: ${entry.title}`}
            inert={slide !== index}
          >
            <PreviewCover
              video={previewClip(entry)}
              revision={entry.revisionId}
              title={entry.title}
              mode={clipMode}
              enabled={slide === index && visible}
              onPlaybackChange={slide === index ? setClipPlaying : undefined}
              onUnavailable={slide === index ? () => setClipFailed(true) : undefined}
            >
              <Link
                {...publicLink(entry)}
                className="featured-art"
                aria-label={`Explore featured napplet: ${entry.title}`}
                draggable={false}
              >
                <img
                  src={publicPoster(entry)}
                  className={!entry.preview ? 'generated-poster' : undefined}
                  width={720}
                  height={450}
                  alt=""
                  draggable={false}
                  loading={slide === 0 ? 'eager' : 'lazy'}
                  referrerPolicy="no-referrer"
                />
                <span className="featured-open">
                  <ArrowUpRight size={22} />
                </span>
              </Link>
            </PreviewCover>
            <div className="featured-caption">
              <Link {...publicLink(entry)}>{entry.title}</Link>
              <p>{entry.description || 'A little world worth a look.'}</p>
              <CreatorLink pubkey={entry.pubkey} />
            </div>
          </div>
        ))}
      </div>
      <span
        className="sr-only"
        aria-live={paused || reduced || focused ? 'polite' : 'off'}
        aria-atomic="true"
      >
        {index + 1} of {entries.length}: {current.title}
      </span>
      <div className="featured-controls">
        {entries.length > 1 && (
          <>
            <Button
              variant="outline"
              size="icon"
              data-tone="mint"
              aria-label="Previous featured napplet"
              onClick={() => move(-1)}
            >
              <ArrowLeft size={16} />
            </Button>
            <Button
              variant="outline"
              size="icon"
              data-tone="mint"
              aria-label="Next featured napplet"
              onClick={() => move(1)}
            >
              <ArrowRight size={16} />
            </Button>
            {!reduced && (
              <Button
                variant="ghost"
                size="sm"
                data-rotation-control
                aria-label={paused ? 'Resume featured rotation' : 'Pause featured rotation'}
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? <Play size={13} /> : <Pause size={13} />}
                {paused ? 'Resume' : 'Pause'}
              </Button>
            )}
          </>
        )}
        {previewClip(current) && !clipFailed && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={clipPlaying ? 'Pause featured clip' : 'Play featured clip'}
            onClick={() => setClipMode(clipPlaying ? 'pause' : 'play')}
          >
            {clipPlaying ? <Pause size={13} /> : <Play size={13} />}
            {clipPlaying ? 'Pause clip' : 'Play clip'}
          </Button>
        )}
        <Link to="/" search={{ sort: 'featured' }} hash="napplets" className="featured-all">
          All featured <ArrowUpRight size={13} />
        </Link>
      </div>
    </section>
  );
}
import { CreatorLink } from './creator-link';
