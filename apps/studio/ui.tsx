import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Paperclip,
  Images,
  Check,
  ChevronDown,
  Code2,
  ExternalLink,
  GitBranch,
  History,
  LoaderCircle,
  MessageSquare,
  Monitor,
  Plus,
  RotateCcw,
  Smartphone,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import type { StudioState } from './types';
import { working } from './types';
import { ProposalDialog } from './proposal-ui';
import { PublicationDialog, usePublicationSigner } from './publication-ui';
import { ActivityPanel, ChatText } from './activity-ui';
import { BrowserGitPanel } from './browser-git-ui';
import { AssetsPanel } from './assets-ui';
import { Dashboard } from './dashboard';
import { QuickModelChoice } from './model-picker-ui';
import { validSource } from './navigation';
import type { BrowserBuildController } from './browser-build-client';

import type { StudioClient } from './local-client';
import type { PublicationAccount } from './publication-ui';
import type { StudioRoute } from './navigation';

const examples = [
  [
    'A tiny arcade',
    'Make a playful neon target-popping game. Tap the moving orb to score, with a reset button and a keyboard alternative. Keep it comfortable on phones.',
  ],
  [
    'Something calming',
    'Make an interactive constellation toy. Tap to place stars and connect nearby stars with soft glowing lines. Include clear and undo controls.',
  ],
  [
    'A useful little thing',
    'Build a colorful focus timer with work and break sessions, a start/pause button and reset. Make the remaining time the main visual feature.',
  ],
];
export function StudioApp({
  client,
  reconnect,
  account,
  route,
  navigate,
  openConnections,
  browserBuild,
  setBrowserBuildAvailable,
}: {
  client: StudioClient;
  reconnect?: () => void;
  account: PublicationAccount;
  route: StudioRoute;
  navigate: (path: string) => void;
  openConnections: () => void;
  browserBuild: BrowserBuildController;
  setBrowserBuildAvailable: (available: boolean) => void;
}) {
  const { api, media } = client;
  const storagePrefix = client.mode === 'hosted' ? 'studio:' + account.pubkey + ':' : 'quick-vibe-';
  const [state, setState] = useState<StudioState>({ projects: [], model: '' });
  const id = route.view === 'project' ? route.id : '';
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    // Route remounts start with empty state. Do not tear down an in-flight
    // creation compiler before the new page has read the service capabilities.
    if (loaded) setBrowserBuildAvailable(!!state.browserBuilds);
  }, [loaded, state.browserBuilds, setBrowserBuildAvailable]);
  const setId = (id: string) => navigate(id ? '/studio/' + id : '/studio');
  const [prompt, setPrompt] = useState('');
  const [publicationPrompt, setPublicationPrompt] = useState<string>();
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [remix, setRemix] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [proposalOpen, setProposalOpen] = useState(false);
  const [assetFile, setAssetFile] = useState<File>();
  const signer = usePublicationSigner(
    api,
    {
      ...account,
      connect: async () => {
        // A modal makes the shared header inert. Close it before opening its account menu.
        setPublishOpen(false);
        setProposalOpen(false);
        await account.connect();
      },
    },
    client.mode === 'hosted',
  );
  const [tab, setTab] = useState<'preview' | 'assets' | 'files' | 'changes' | 'history'>('preview');
  const [mobileTab, setMobileTab] = useState<'chat' | 'preview'>('chat');
  const [phone, setPhone] = useState(false);
  const [preview, setPreview] = useState('');
  const [frameKey, setFrameKey] = useState(0);
  const [paths, setPaths] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [code, setCode] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const p = state.projects.find((p) => p.id === id);
  const busy = !!state.busy || sending;
  const active = p && working(p.phase);
  const seenPublicationIntents = useRef(new Set<string>());
  useEffect(() => {
    if (route.view === 'create') {
      setSource(route.source);
      setTitle(route.title);
      setRemix(!!route.source);
    }
  }, [route]);
  useEffect(() => {
    if (
      p?.publicationIntent &&
      !active &&
      !seenPublicationIntents.current.has(p.publicationIntent)
    ) {
      seenPublicationIntents.current.add(p.publicationIntent);
      setPublishOpen(true);
    }
  }, [p?.publicationIntent, p?.id, active]);
  const refresh = async () => {
    setState(await api<StudioState>('state'));
    setLoaded(true);
    setOffline(false);
  };
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<StudioState>('state');
        if (live) {
          setState(next);
          setLoaded(true);
          setOffline(false);
        }
      } catch (e) {
        if (live) {
          setOffline(true);
          setError((e as Error).message);
        }
      } finally {
        if (live) timer = setTimeout(() => void poll(), client.mode === 'hosted' ? 3000 : 1000);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [client]);
  useEffect(() => {
    localStorage.setItem(storagePrefix + 'project', id);
    setPublishOpen(false);
    setProposalOpen(false);
    setTab('preview');
    setPreview('');
    setCode('');
    setPath('');
    setPrompt(localStorage.getItem(storagePrefix + 'draft:' + id) ?? '');
  }, [id]);
  useEffect(() => {
    localStorage.setItem(storagePrefix + 'draft:' + id, prompt);
  }, [prompt, id]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'nearest' });
  }, [p?.messages.length]);
  useEffect(() => {
    let live = true;
    if (p?.preview)
      void api<{ url: string }>(`projects/${p.id}/preview`)
        .then((r) => {
          if (live) setPreview(r.url);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [p?.id, p?.preview, p?.previewUrl]);
  useEffect(() => {
    let live = true;
    setCode('');
    if (p && tab === 'changes')
      void api<string>(`projects/${p.id}/diff`)
        .then((r) => {
          if (live) setCode(r || 'No source changes yet.');
        })
        .catch((e) => {
          if (live) setCode(e.message);
        });
    if (p && tab === 'files')
      void api<string[]>(`projects/${p.id}/files`)
        .then((r) => {
          if (live) {
            setPaths(r);
            if (!path || !r.includes(path))
              setPath(r.includes('src/main.ts') ? 'src/main.ts' : (r[0] ?? ''));
          }
        })
        .catch((e) => {
          if (live) setCode(e.message);
        });
    return () => {
      live = false;
    };
  }, [tab, p?.id, p?.updatedAt]);
  useEffect(() => {
    let live = true;
    if (p && tab === 'files' && path)
      void api<string>(`projects/${p.id}/file?path=${encodeURIComponent(path)}`)
        .then((r) => {
          if (live) setCode(r);
        })
        .catch((e) => {
          if (live) setCode(e.message);
        });
    return () => {
      live = false;
    };
  }, [path, tab, p?.id, p?.updatedAt]);
  async function action(fn: () => Promise<unknown>) {
    setError('');
    setSending(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function send() {
    if (!prompt.trim() || busy || offline) return;
    if (!p && route.view !== 'create') return;
    if (!p && remix && !validSource(source.trim())) {
      setError(
        'Enter a napplet HTTPS link, Nostr identifier or local preview link before remixing.',
      );
      return;
    }
    await action(async () => {
      if (p)
        await api(`projects/${p.id}/messages`, {
          prompt,
          browserSession: browserBuild.session,
          reviewPublication: publicationPrompt === p.id,
        });
      else {
        const result = await api<{ id: string }>('projects', {
          title: title.trim() || prompt.trim().split('\n')[0].slice(0, 60),
          prompt,
          browserSession: browserBuild.session,
          ...(remix && source.trim() ? { source: source.trim() } : {}),
        });
        setId(result.id);
        setMobileTab('chat');
      }
      localStorage.removeItem(storagePrefix + 'draft:' + id);
      setPrompt('');
      setPublicationPrompt(undefined);
    });
  }
  const browserBuildChoice = state.browserBuilds && (
    <label
      className="browser-build-choice"
      title="Experimental: standard TypeScript starter only. Keep this tab open. Publish still runs full soyLI checks."
    >
      <input
        type="checkbox"
        checked={browserBuild.enabled}
        disabled={busy}
        onChange={(event) => browserBuild.setEnabled(event.target.checked)}
      />
      Browser builds
    </label>
  );
  const composer = (initial = false) => (
    <form
      className={`composer ${initial ? 'initial' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      onDragOver={p ? (e) => e.preventDefault() : undefined}
      onDrop={
        p
          ? (e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) {
                setAssetFile(f);
                setTab('assets');
                setMobileTab('preview');
              }
            }
          : undefined
      }
      onPaste={
        p
          ? (e) => {
              const f = Array.from(e.clipboardData.items)
                .find((i) => i.kind === 'file')
                ?.getAsFile();
              if (f) {
                e.preventDefault();
                setAssetFile(f);
                setTab('assets');
                setMobileTab('preview');
              }
            }
          : undefined
      }
    >
      <label className="sr-only" htmlFor="prompt">
        {initial ? 'Describe your napplet' : 'Message your agent'}
      </label>
      {p && publicationPrompt === p.id && (
        <p className="composer-followup" role="status">
          Send this to prepare the gameplay recipe. Publish will reopen after the maker and checks
          finish; then you can capture and watch the clip.
          <button type="button" onClick={() => setPublicationPrompt(undefined)}>
            Cancel return to Publish
          </button>
        </p>
      )}
      <textarea
        id="prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={
          initial ? 'What would you like to make?' : 'Try it out. What should we change?'
        }
        rows={initial ? 4 : 3}
        maxLength={10000}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <div className="composer-foot">
        <QuickModelChoice
          state={state.connections}
          api={api}
          refresh={refresh}
          openConnections={openConnections}
          disabled={busy || offline}
        />
        {p && (
          <button
            type="button"
            aria-label="Add an asset"
            onClick={() => {
              setTab('assets');
              setMobileTab('preview');
            }}
          >
            <Paperclip size={17} />
          </button>
        )}
        <button
          className="primary send"
          type="submit"
          disabled={!prompt.trim() || busy || offline}
          aria-label={initial ? 'Create napplet' : 'Send message'}
        >
          {initial ? 'Let’s make it' : 'Send'}
          <ArrowUp size={17} />
        </button>
      </div>
    </form>
  );
  return (
    <div className={route.view === 'project' ? 'studio-surface workspace-open' : 'studio-surface'}>
      {offline && (
        <div role="status" className="connection">
          Connection interrupted. Reconnecting… Your conversation is saved on this computer.
        </div>
      )}
      {error && (
        <div role="alert" className="error-banner">
          <pre>{error}</pre>
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={18} />
          </button>
        </div>
      )}
      {offline && client.mode === 'hosted' && reconnect && (
        <button className="outline" onClick={reconnect}>
          Reconnect Studio
        </button>
      )}
      {route.view === 'dashboard' ? (
        <Dashboard
          projects={state.projects}
          loading={!loaded}
          busy={state.busy}
          navigate={navigate}
        />
      ) : route.view === 'missing' || (route.view === 'project' && !p) ? (
        <section className="creations-page creations-empty">
          <h1>{loaded ? 'This creation isn’t here.' : 'Opening your creation…'}</h1>
          <p>
            {loaded
              ? 'Your saved projects are in My creations. No new draft has been started.'
              : 'Connecting to Studio.'}
          </p>
          <button className="outline" onClick={() => navigate('/studio')}>
            My creations
          </button>
        </section>
      ) : !p ? (
        <section className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">A LITTLE IDEA GOES A LONG WAY</span>
            <h1>
              What’s your next
              <br />
              <em>little obsession?</em>
            </h1>
            <p>
              Describe a game, a tool, a wonderfully unnecessary thing.
              <br className="desktop-only" /> Make it real. Play it. Make it yours.
            </p>
          </div>
          <div className="start-card">
            <div className="start-options">
              <button className={!remix ? 'selected' : ''} onClick={() => setRemix(false)}>
                <Sparkles size={16} />
                Start fresh
              </button>
              <button className={remix ? 'selected' : ''} onClick={() => setRemix(true)}>
                <GitBranch size={16} />
                Remix a napplet
              </button>
            </div>
            {remix && (
              <label className="field">
                Original napplet
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="Paste a napplet link or Nostr identifier"
                />
              </label>
            )}
            {remix && source && (
              <p className="remix-context">
                You’re starting a separate creation from this source. The original keeps its credit.
                Nothing is created until you send your prompt.
              </p>
            )}
            <label className="field title-field">
              Draft name <span>optional</span>
              <input
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Something wonderfully unnecessary"
              />
            </label>
            {composer(true)}
            {state.browserBuilds && (
              <div className="creation-build-choice">
                {browserBuildChoice}
                <small>
                  Build previews in this browser. Keep this tab open while your maker works.
                </small>
              </div>
            )}
          </div>
          <div className="suggestions">
            {examples.map(([label, text]) => (
              <button
                key={label}
                onClick={() => {
                  setPrompt(text);
                  setTitle(label);
                }}
              >
                <Plus size={14} />
                {label}
              </button>
            ))}
          </div>
          {state.busy && (
            <p className="muted">
              A draft is still running. Open it below to follow along or stop it.
            </p>
          )}
          {state.projects.length > 0 && (
            <section className="recent">
              <div className="section-label">
                YOUR DRAFTS <span>{state.projects.length}</span>
              </div>
              <div className="draft-grid">
                {state.projects.map((draft) => (
                  <button key={draft.id} className="draft-card" onClick={() => setId(draft.id)}>
                    <span className={`draft-mark ${draft.phase}`}>
                      <Sparkles size={18} />
                    </span>
                    <span>
                      <strong>{draft.title}</strong>
                      <small>
                        {working(draft.phase)
                          ? draft.stage
                          : draft.preview
                            ? 'Playable preview saved'
                            : draft.stage}
                      </small>
                    </span>
                    <span className="draft-arrow">↗</span>
                  </button>
                ))}
              </div>
            </section>
          )}
          <p className="local-note">
            <a href={'/create#local-soyli'}>Prefer your own editor? Use soyLI locally ↗</a>
            <br />
            {client.mode === 'hosted'
              ? 'Private server workspace · Your API key · You choose when to publish'
              : 'On your computer · Real source code · You choose when to publish'}
            <br />
            {client.mode === 'hosted'
              ? 'Your maker runs in an isolated container. Browser builds run in this tab; server builds and publication checks run on the host.'
              : 'This local experiment runs agent tools as your OS user. Use trusted projects.'}
          </p>
        </section>
      ) : (
        <section className="workspace">
          <div className="workspace-heading">
            <div>
              <label className="sr-only" htmlFor="project">
                Current draft
              </label>
              <select id="project" value={p.id} onChange={(e) => setId(e.target.value)}>
                {state.projects.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <span className="draft-badge">
                {p.publication?.attempt?.status === 'published'
                  ? 'PUBLISHED PROJECT'
                  : 'PRIVATE DRAFT'}
              </span>
              <button
                className="primary publish-entry"
                disabled={busy || !p.preview}
                onClick={() => setPublishOpen(true)}
              >
                Publish
              </button>
              {p.source && (
                <button
                  className="outline"
                  disabled={busy || !p.preview}
                  onClick={() => setProposalOpen(true)}
                >
                  Propose changes
                </button>
              )}
            </div>
            <div className={`status ${p.phase}`} role="status">
              {active ? (
                <LoaderCircle className="spin" size={15} />
              ) : p.phase === 'ready' ? (
                <Check size={15} />
              ) : (
                <span className="dot" />
              )}
              {p.stage}
            </div>
          </div>
          <div className="mobile-tabs">
            <button
              className={mobileTab === 'chat' ? 'selected' : ''}
              onClick={() => setMobileTab('chat')}
            >
              <MessageSquare size={16} />
              Chat
            </button>
            <button
              className={mobileTab === 'preview' ? 'selected' : ''}
              onClick={() => setMobileTab('preview')}
            >
              <Monitor size={16} />
              Preview & code{p.preview && <span className="dot" />}
            </button>
          </div>
          <div className="panes">
            <section
              className={`chat-pane ${mobileTab === 'chat' ? 'mobile-visible' : ''}`}
              aria-label="Creator chat"
            >
              <div className="chat-heading">
                <span>
                  <Sparkles size={16} />
                  MAKE SOMETHING YOURS
                </span>
                {active && (
                  <button
                    className="stop"
                    disabled={sending}
                    onClick={() => void action(() => api(`projects/${p.id}/stop`, {}))}
                  >
                    <Square size={12} fill="currentColor" />
                    Stop
                  </button>
                )}
              </div>
              <div className="messages">
                {p.messages.map((m) => (
                  <article className={`message ${m.role}`} key={m.id}>
                    <div className="message-who">
                      {m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Your maker' : 'Studio'}
                    </div>
                    <div className="message-text">
                      {m.role === 'user' ? m.text : <ChatText text={m.text} />}
                    </div>
                  </article>
                ))}
                {active && (
                  <div className="working">
                    <span className="pulse" />
                    {p.stage}
                    <small>You can keep playing the last passing preview.</small>
                  </div>
                )}
                <ActivityPanel key={p.id} project={p} />
                {p.checks.length > 0 && (
                  <div className="checks">
                    {p.checks.map((c) => (
                      <details key={c.name}>
                        <summary>
                          <span className={c.state}>
                            {c.state === 'passed' ? '✓' : c.state === 'failed' ? '×' : '◌'}
                          </span>
                          {c.name}
                          <ChevronDown size={13} />
                        </summary>
                        <pre>{c.detail ?? 'Running…'}</pre>
                      </details>
                    ))}
                  </div>
                )}
                <div ref={bottom} />
              </div>
              <div className="chat-bottom">
                {composer()}
                <span className="composer-hint">
                  Enter to send · Shift + Enter for a new line ·{' '}
                  {client.mode === 'hosted' ? 'Private workspace' : 'Saved locally'}
                </span>
              </div>
            </section>
            <section
              className={`preview-pane ${mobileTab === 'preview' ? 'mobile-visible' : ''}`}
              aria-label="Preview and source"
            >
              <div className="preview-toolbar">
                <div className="view-tabs">
                  {(
                    [
                      ['preview', 'Preview', Monitor],
                      ['assets', 'Assets', Images],
                      ['files', 'Files', Code2],
                      ['changes', 'Changes', GitBranch],
                      ['history', 'History', History],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      key={value}
                      aria-label={label}
                      title={label}
                      className={tab === value ? 'selected' : ''}
                      onClick={() => setTab(value)}
                    >
                      <Icon size={15} />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                {tab === 'preview' && (
                  <div className="preview-actions">
                    <button
                      title={phone ? 'Desktop preview' : 'Phone preview'}
                      aria-label={phone ? 'Desktop preview' : 'Phone preview'}
                      onClick={() => setPhone(!phone)}
                    >
                      {phone ? <Monitor size={16} /> : <Smartphone size={16} />}
                    </button>
                    <button
                      title="Reload preview"
                      aria-label="Reload preview"
                      disabled={!preview}
                      onClick={() => setFrameKey(frameKey + 1)}
                    >
                      <RotateCcw size={16} />
                    </button>
                    {preview && (
                      <a
                        href={preview}
                        target="_blank"
                        rel="noreferrer"
                        title="Open preview"
                        aria-label="Open preview"
                      >
                        <ExternalLink size={16} />
                      </a>
                    )}
                  </div>
                )}
              </div>
              {tab === 'preview' ? (
                <div className={`preview-canvas ${phone ? 'phone' : ''}`}>
                  {preview ? (
                    <iframe
                      key={preview + frameKey}
                      src={preview + (preview.includes('?') ? '&' : '?') + 'studio=1'}
                      title="Playable napplet preview"
                      allow="fullscreen"
                    />
                  ) : (
                    <div className="empty-preview">
                      <span
                        className="mascot"
                        role="img"
                        aria-label="Soybert is getting things ready"
                      />
                      <h2>
                        {active ? 'A little idea is taking shape.' : 'Your playground starts here.'}
                      </h2>
                      <p>
                        {active
                          ? 'The preview appears after the build and sandbox checks pass.'
                          : 'Continue in chat or run checks to prepare your first preview.'}
                      </p>
                      <span className="preview-placeholder-tag">
                        <Square size={12} />
                        REAL SOYLI SANDBOX
                      </span>
                    </div>
                  )}
                </div>
              ) : tab === 'assets' ? (
                <AssetsPanel
                  key={p.id}
                  project={p}
                  busy={busy}
                  api={api}
                  client={client}
                  selectedFile={assetFile}
                  clearFile={() => setAssetFile(undefined)}
                  refresh={refresh}
                  chat={(text) => {
                    setPrompt(text);
                    setMobileTab('chat');
                  }}
                />
              ) : tab === 'history' ? (
                <div className="history-panel">
                  <h2>A place to come back to.</h2>
                  <p>
                    Each passing preview gets a Git checkpoint. Restoring saves your current work
                    first.
                  </p>
                  {state.browserGit && (
                    <BrowserGitPanel key={p.id} id={p.id} client={client} busy={busy} />
                  )}
                  {[...p.checkpoints].reverse().map((c) => (
                    <div className="checkpoint" key={c.commit}>
                      <span>
                        <strong>{c.label}</strong>
                        <small>
                          {new Date(c.at).toLocaleString()} · {c.commit.slice(0, 8)}
                        </small>
                      </span>
                      <button
                        className="outline"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              'Restore this preview’s source? Your current work will be backed up in local Git history.',
                            )
                          )
                            void action(() =>
                              api(`projects/${p.id}/restore`, { commit: c.commit }),
                            );
                        }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                  {!p.checkpoints.length && (
                    <p className="muted">Your first checkpoint will appear after verification.</p>
                  )}
                </div>
              ) : (
                <div className="source-panel">
                  {tab === 'files' && (
                    <>
                      <label className="sr-only" htmlFor="file">
                        Source file
                      </label>
                      <select id="file" value={path} onChange={(e) => setPath(e.target.value)}>
                        {paths.map((path) => (
                          <option key={path}>{path}</option>
                        ))}
                      </select>
                    </>
                  )}
                  <pre>{code || 'Loading source…'}</pre>
                </div>
              )}
              <div className="preview-footer">
                <span>
                  {p.previewValidation === 'browser'
                    ? 'Browser preview · full checks pending'
                    : p.preview
                      ? `${p.checkpoints.length} saved preview${p.checkpoints.length === 1 ? '' : 's'}${active || p.phase !== 'ready' ? ' · Showing last passing build' : ' · Try the controls'}`
                      : 'A preview you can actually play.'}
                </span>
                {browserBuildChoice}
                {browserBuild.enabled && (
                  <small role="status">{browserBuild.status || 'Keep this tab open'}</small>
                )}
                <button
                  disabled={busy || !p.initialized}
                  onClick={() =>
                    void action(() =>
                      api(`projects/${p.id}/check`, { browserSession: browserBuild.session }),
                    )
                  }
                >
                  <Check size={14} />
                  {browserBuild.enabled ? 'Build in browser' : 'Run checks'}
                </button>
              </div>
            </section>
          </div>
        </section>
      )}
      {p && proposalOpen && (
        <ProposalDialog
          project={p}
          busy={busy}
          api={api}
          signer={signer}
          close={() => setProposalOpen(false)}
        />
      )}
      {p && publishOpen && (
        <PublicationDialog
          project={p}
          busy={busy}
          api={api}
          action={action}
          signer={signer}
          close={() => setPublishOpen(false)}
          chat={(text) => {
            setPublishOpen(false);
            setProposalOpen(false);
            setMobileTab('chat');
            setPrompt(text);
            setPublicationPrompt(p.id);
          }}
          media={media}
        />
      )}
    </div>
  );
}
