import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CachedVideo } from '../../../../packages/protocol/src/preview-video';
import { playback } from '@/lib/playback-coordinator';
import { manifestVideoBlob } from '../../../../packages/client/src/manifest-video';

/** Decorative media never intercepts the cover's play/navigation action. */
export function PreviewCover({
  children,
  video,
  revision,
  mode = 'hover',
  enabled = true,
  onPlaybackChange,
  onUnavailable,
}: {
  children: ReactNode;
  video?: (Pick<CachedVideo, 'url' | 'hash'> & { sources?: string[] }) | null;
  revision: string;
  title: string;
  mode?: 'hover' | 'auto' | 'play' | 'pause';
  enabled?: boolean;
  onPlaybackChange?: (playing: boolean) => void;
  onUnavailable?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null),
    player = useRef<HTMLVideoElement>(null);
  const owner = useRef({});
  const [active, setActive] = useState(false),
    [playing, setPlaying] = useState(false),
    [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [video?.hash, video?.url, revision]);
  useEffect(() => {
    if (failed) onUnavailable?.();
  }, [failed, onUnavailable]);
  useEffect(() => {
    onPlaybackChange?.(playing && active);
  }, [playing, active, onPlaybackChange]);
  useEffect(() => {
    const element = container.current;
    const stop = () => {
      setActive(false);
      setPlaying(false);
      playback.release(owner.current);
    };
    stop();
    if (!video || !element || !enabled || failed || mode === 'pause') return;
    let visible = false,
      hovered = false,
      focused = false;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      const automatic =
        !motion.matches &&
        !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
      if (
        !visible ||
        document.hidden ||
        (mode !== 'play' && !automatic) ||
        (mode === 'hover' && !hovered && !focused)
      ) {
        stop();
        return;
      }
      if (playback.claim(owner.current, mode === 'play' ? 'media' : 'preview', stop))
        setActive(true);
    };
    const enter = (event: PointerEvent) => {
      hovered = event.pointerType === 'mouse';
      sync();
    };
    const leave = () => {
      hovered = false;
      sync();
    };
    const focus = () => {
      focused = true;
      sync();
    };
    const blur = (event: FocusEvent) => {
      focused = element.contains(event.relatedTarget as Node);
      sync();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        sync();
      },
      { threshold: [0, 0.25] },
    );
    observer.observe(element);
    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    element.addEventListener('focusin', focus);
    element.addEventListener('focusout', blur);
    motion.addEventListener('change', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      observer.disconnect();
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
      element.removeEventListener('focusin', focus);
      element.removeEventListener('focusout', blur);
      motion.removeEventListener('change', sync);
      document.removeEventListener('visibilitychange', sync);
      stop();
    };
  }, [video?.hash, video?.url, revision, enabled, failed, mode]);
  useEffect(() => {
    const node = player.current;
    if (!node || !video || !active) return;
    node.muted = true;
    let alive = true;
    const controller = new AbortController();
    let blob: string | undefined;
    void (async () => {
      const source = video.sources
        ? await manifestVideoBlob(
            video.sources,
            video.hash,
            AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
          )
        : video.url;
      if (video.sources) blob = source;
      if (!alive) {
        if (blob) URL.revokeObjectURL(blob);
        return;
      }
      node.src = source;
      await node.play();
    })().catch(() => {
      if (alive) {
        setActive(false);
        setPlaying(false);
        setFailed(true);
      }
    });
    return () => {
      alive = false;
      controller.abort();
      playback.release(owner.current);
      node.pause();
      node.removeAttribute('src');
      node.load();
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [active, video?.hash, video?.url, revision]);
  return (
    <div ref={container} className="card-cover">
      {children}
      {video && !failed && (
        <video
          ref={player}
          className={`card-preview-clip${playing && active ? ' is-active' : ''}`}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => {
            setActive(false);
            setPlaying(false);
            setFailed(true);
          }}
        />
      )}
    </div>
  );
}
