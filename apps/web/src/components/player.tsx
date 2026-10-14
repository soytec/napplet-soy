import {
  installPlayerIntent,
  playerIntentCatalogId,
  webIntentWorkspace,
} from '@/lib/intent-workspace';
import { shellTheme } from '../../../../packages/runtime/src/appearance';
import { network, backendProvider } from '@/lib/network';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, Expand, Minimize, Play, RotateCcw, Square } from 'lucide-react';
import { playback } from '@/lib/playback-coordinator';
import { usePlayerPresentation } from '@/lib/use-player-presentation';
import { browserIdentity } from '@/lib/browser-identity';
import { FilePicker } from '../../../../packages/runtime/src/file-picker';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import { PlayerChrome } from './player-chrome';
import { SoybertWalk } from './soybert-walk';
import { loadArtifact, PLAYER_SANDBOX } from '../../../../packages/runtime/src';
import { preparePlayback } from '../../../../packages/runtime/src/playback';
import type { Napplet } from '../../../../packages/backend/src/catalog';
import {
  hasPublicPreview,
  publicPoster,
  type PublicNapplet,
} from '../../../../packages/backend/src/public-model';
import shim from '@napplet/shim/prelude.global?raw';
import { nappletPrelude } from '../../../../packages/runtime/src/prelude';
import { attachNappletHost, type HostPrompt } from '../../../../packages/runtime/src/host';
import type { ExportFile } from '../../../../packages/runtime/src/filesystem';
import { declaredConfig } from '../../../../packages/runtime/src/config-schema';
import type { NappletConfig } from '../../../../packages/runtime/src/config-session';
import { SettingsControl } from '../../../../packages/runtime/src/settings-panel';
import { MediaControls } from '../../../../packages/runtime/src/media-controls';
import type { NappletMedia } from '../../../../packages/runtime/src/media-session';

function FileExports({ files }: { files: ExportFile[] }) {
  const [downloads, setDownloads] = useState<{ name: string; url: string }[]>([]);
  useEffect(() => {
    const next = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file.blob) }));
    setDownloads(next);
    return () => next.forEach((file) => URL.revokeObjectURL(file.url));
  }, [files]);
  if (!downloads.length) return null;
  return (
    <div className="host-files">
      <span>Session files · download before closing</span>
      {downloads.map((file) => (
        <a key={file.name} href={file.url} download={file.name.split('/').pop()}>
          {file.name} ↓
        </a>
      ))}
    </div>
  );
}

export function Player({
  napplet,
  reviewScope,
  pinned = false,
  autoPlay = false,
  compact = false,
  onStop,
  immersive = false,
  onEnter,
  onExit,
  detailPath,
  returnLabel = 'Back to gallery',
  onLoadError,
}: {
  napplet: Napplet | PublicNapplet;
  reviewScope?: string;
  pinned?: boolean;
  autoPlay?: boolean;
  compact?: boolean;
  onStop?: () => void;
  immersive?: boolean;
  onEnter?: () => void;
  onExit?: () => void;
  detailPath?: string;
  returnLabel?: string;
  onLoadError?: (error: Error) => void;
}) {
  const external = 'provenance' in napplet;
  const manifest = external ? napplet.manifest : pinned ? napplet.snapshot : napplet.current;
  const releaseId = manifest.id;
  const { ready, pubkey } = useNostr();
  const [prompt, setPrompt] = useState<HostPrompt | null>(null);
  const [exports, setExports] = useState<ExportFile[]>([]);
  const [configuration, setConfiguration] = useState<NappletConfig | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [media, setMedia] = useState<NappletMedia | null>(null);
  const declaration = useRef<ReturnType<typeof declaredConfig>>({});
  const host = useRef<ReturnType<typeof attachNappletHost> | undefined>(undefined);
  const currentPubkey = useRef(pubkey);
  const focusPrompt = useCallback((node: HTMLDivElement | null) => {
    node?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);
  useLayoutEffect(() => {
    currentPubkey.current = pubkey;
    host.current?.updateIdentity(reviewScope ? null : pubkey);
  }, [pubkey]);
  const [playing, setPlaying] = useState(autoPlay || immersive),
    [doc, setDoc] = useState(''),
    [release, setRelease] = useState<
      (Awaited<ReturnType<typeof preparePlayback>> & { relays: string[] }) | null
    >(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const [restingHeight, setRestingHeight] = useState<number>();
  useLayoutEffect(() => {
    const node = wrapper.current!;
    const measure = () => {
      if (!node.matches(':fullscreen, .player-expanded'))
        setRestingHeight(node.getBoundingClientRect().height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const { expanded, fullscreen, enterNative, exitNative, leave, escape } = usePlayerPresentation(
    wrapper,
    immersive,
    settingsOpen || prompt !== null,
    onEnter,
    onExit,
  );
  const escapeCurrent = useRef(escape);
  escapeCurrent.current = escape;
  const owner = useRef({});
  const stopCurrent = useRef<() => void>(() => {});
  stopCurrent.current = () => {
    host.current?.close();
    setPlaying(false);
    if (expanded) leave();
    onStop?.();
  };
  useEffect(() => {
    if (!playing) return;
    const token = owner.current;
    playback.claim(token, 'napplet', () => stopCurrent.current());
    const hide = () => {
      if (document.hidden) stopCurrent.current();
    };
    document.addEventListener('visibilitychange', hide);
    const observer = compact
      ? new IntersectionObserver(([entry]) => {
          if (!entry.isIntersecting && !wrapper.current?.matches(':fullscreen, .player-expanded'))
            stopCurrent.current();
        })
      : null;
    if (wrapper.current) observer?.observe(wrapper.current);
    return () => {
      playback.release(token);
      observer?.disconnect();
      document.removeEventListener('visibilitychange', hide);
    };
  }, [playing, compact]);
  useEffect(() => {
    if (immersive) setPlaying(true);
  }, [immersive]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  // Parent route revalidation can recreate the model without changing the session.
  // A callback-ref rebind would destroy instance storage, files and subscriptions.
  const bindFrame = useCallback(
    (node: HTMLIFrameElement | null) => {
      host.current?.close();
      host.current = undefined;
      if (!node || !release) return;
      host.current = attachNappletHost({
        intent: reviewScope
          ? undefined
          : { workspace: webIntentWorkspace(), catalogId: playerIntentCatalogId(release.manifest) },
        escape: () => escapeCurrent.current(),
        theme: shellTheme,
        backend: reviewScope ? undefined : backendProvider(),
        frame: node,
        identity: reviewScope
          ? `proposal:${reviewScope}:${release.manifest.id}`
          : release.hostIdentity,
        manifestId: release.manifest.id,
        servers: [...release.servers, ...network().blossom],
        localServers: network().blossom,
        relays: release.relays,
        actionRelays: network().relays,
        uploadServers: network().blossom,
        title: napplet.title,
        sign: reviewScope ? undefined : (key, event) => browserIdentity().sign(key, event),
        pubkey: reviewScope ? null : currentPubkey.current,
        prompt: setPrompt,
        files: setExports,
        declaration: declaration.current,
        configuration: setConfiguration,
        media: setMedia,
      });
    },
    [release, reviewScope, napplet.title],
  );
  useEffect(() => {
    setExports([]);
    if (!playing) {
      setDoc('');
      return;
    }
    const controller = new AbortController();
    setError('');
    setDoc('');
    setRelease(null);
    void preparePlayback(manifest, napplet.artifactHash)
      .then(async (release) => {
        if (!reviewScope) await installPlayerIntent(release.manifest, napplet.title);
        let config: ReturnType<typeof declaredConfig> = {};
        const html = await loadArtifact(
          release.artifactHash,
          controller.signal,
          (verifiedHtml) => {
            config = declaredConfig(verifiedHtml);
            return nappletPrelude(shim, config);
          },
          [...release.servers, ...network().blossom],
          network().blossom,
        );
        if (!controller.signal.aborted) {
          declaration.current = config;
          setRelease({
            ...release,
            relays: [...new Set([...network().relays, ...(napplet.relays ?? [])])].slice(0, 8),
          });
          setDoc(html);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          const error =
            reason instanceof Error ? reason : new Error('Could not load this creation.');
          setError(error.message);
          onLoadError?.(error);
        }
      });
    return () => controller.abort();
  }, [playing, releaseId, revision, reviewScope]);
  return (
    <div className="player-slot" style={expanded ? { height: restingHeight } : undefined}>
      <div
        ref={wrapper}
        tabIndex={-1}
        aria-label={`${napplet.title} player`}
        className={`player-wrap${compact ? ' player-compact' : ''}${expanded ? ' player-expanded' : ''}`}
      >
        <div className="player-stage">
          {!playing ? (
            <button
              disabled={!ready}
              className="player-cover"
              onClick={() => {
                if (expanded) enterNative();
                setPlaying(true);
              }}
              aria-label={`Start ${napplet.title}`}
            >
              <img
                className={external && !hasPublicPreview(napplet) ? 'generated-poster' : undefined}
                src={external ? publicPoster(napplet) : `/posters/${napplet.slug}.svg`}
                alt=""
                referrerPolicy="no-referrer"
              />
              <span>
                <Play size={22} fill="currentColor" />{' '}
                {expanded ? 'Play in fullscreen' : 'Play napplet'}
              </span>
            </button>
          ) : error ? (
            <div className="player-message" role="alert">
              <p>{error}</p>
              <Button variant="outline" onClick={() => setRevision((r) => r + 1)}>
                Try again
              </Button>
            </div>
          ) : doc ? (
            <iframe
              key={revision}
              ref={bindFrame}
              title={napplet.title}
              srcDoc={doc}
              sandbox={PLAYER_SANDBOX}
              inert={prompt !== null || settingsOpen}
              allow="fullscreen"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="player-message player-loading" role="status">
              <SoybertWalk />
              <span>Verifying creation…</span>
            </div>
          )}
          {prompt && (
            <div
              className="host-prompt"
              role="dialog"
              aria-modal="true"
              aria-label={
                prompt.kind === 'files'
                  ? 'Choose files'
                  : prompt.kind === 'action'
                    ? 'Approve public action'
                    : prompt.kind === 'upload'
                      ? 'Approve public upload'
                      : prompt.kind === 'media'
                        ? 'Allow audio playback'
                        : prompt.kind === 'save'
                          ? 'Save napplet file'
                          : prompt.kind === 'multiplayer'
                            ? 'Allow multiplayer connections'
                            : prompt.kind === 'network'
                              ? 'Allow network connection'
                              : 'Open external link'
              }
              ref={focusPrompt}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  prompt.dismiss();
                }
                if (event.key === 'Tab') {
                  const controls = [
                    ...event.currentTarget.querySelectorAll<HTMLElement>('button, a[href], input'),
                  ];
                  const index = controls.indexOf(document.activeElement as HTMLElement);
                  event.preventDefault();
                  controls[
                    (index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length
                  ]?.focus();
                }
              }}
            >
              <strong>
                {prompt.kind === 'files'
                  ? 'Choose files'
                  : prompt.kind === 'action'
                    ? 'Approve public action'
                    : prompt.kind === 'upload'
                      ? 'Approve public upload'
                      : prompt.kind === 'media'
                        ? 'Ready to listen?'
                        : prompt.kind === 'save'
                          ? 'Save a file from this napplet?'
                          : prompt.kind === 'multiplayer'
                            ? 'Allow multiplayer connections?'
                            : prompt.kind === 'network'
                              ? 'Connect this napplet?'
                              : 'Open this link?'}
              </strong>
              <p
                style={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  maxHeight: '35vh',
                  overflowY: 'auto',
                }}
              >
                {prompt.value}
              </p>
              <FilePicker prompt={prompt} />
              {prompt.kind === 'save' && (
                <p>The file will appear below the player for you to download.</p>
              )}
              <div>
                <Button variant="outline" onClick={() => prompt.answer(false)}>
                  {prompt.kind === 'multiplayer' ? 'Block' : 'Cancel'}
                </Button>
                {prompt.kind === 'multiplayer' && (
                  <Button variant="ghost" onClick={() => prompt.dismiss()}>
                    Not now
                  </Button>
                )}
                {prompt.kind === 'files' ? null : prompt.kind !== 'link' ? (
                  <Button onClick={() => prompt.answer(true)}>
                    {prompt.kind === 'action'
                      ? 'Approve & publish'
                      : prompt.kind === 'upload'
                        ? 'Approve upload'
                        : prompt.kind === 'media'
                          ? 'Play audio'
                          : prompt.kind === 'multiplayer'
                            ? 'Allow'
                            : prompt.kind === 'network'
                              ? 'Connect'
                              : 'Save file'}
                  </Button>
                ) : (
                  <Button asChild>
                    <a
                      href={prompt.value}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => prompt.answer(true)}
                    >
                      Open link
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
        <PlayerChrome
          expanded={expanded}
          blocked={prompt !== null || settingsOpen}
          title={napplet.title}
          description={napplet.description}
          detailPath={detailPath}
          returnLabel={returnLabel}
          onExit={leave}
        >
          <FileExports files={exports} />
          {media && <MediaControls media={media} />}
          <div className="player-controls">
            <span>
              {playing && doc ? (
                <>
                  <span className="status-dot" />
                  Playing · verified artifact
                </>
              ) : (
                'A small world, ready when you are.'
              )}
            </span>
            <div>
              {expanded && immersive && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={
                    copied
                      ? 'Play link copied'
                      : copyError
                        ? 'Retry copying play link'
                        : 'Copy play link'
                  }
                  title={copyError || (copied ? 'Play link copied' : 'Copy play link')}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(location.origin + location.pathname);
                      setCopied(true);
                      setCopyError('');
                    } catch {
                      setCopyError('Copy failed. Retry or copy this page’s address.');
                    }
                  }}
                >
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                </Button>
              )}
              {expanded && !fullscreen && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Enter browser fullscreen"
                  title="Enter browser fullscreen"
                  onClick={enterNative}
                >
                  <Expand size={17} />
                </Button>
              )}
              {configuration && (
                <SettingsControl
                  session={configuration}
                  container={wrapper.current}
                  title={napplet.title}
                  iconOnly
                  onOpenChange={setSettingsOpen}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                disabled={!playing}
                aria-label="Restart napplet"
                title="Restart napplet"
                onClick={() => setRevision((r) => r + 1)}
              >
                <RotateCcw size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!playing}
                aria-label="Stop napplet"
                title="Stop napplet"
                onClick={() => stopCurrent.current()}
              >
                <Square size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={fullscreen || expanded ? 'Exit fullscreen' : 'Fullscreen'}
                onClick={() => {
                  if (document.fullscreenElement === wrapper.current) {
                    exitNative();
                    return;
                  }
                  if (expanded) {
                    leave();
                    return;
                  }
                  enterNative();
                }}
              >
                {fullscreen || expanded ? <Minimize size={17} /> : <Expand size={17} />}
              </Button>
            </div>
          </div>
        </PlayerChrome>
      </div>
    </div>
  );
}
