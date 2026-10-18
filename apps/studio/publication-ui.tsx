import React, { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, LoaderCircle, Send, X } from 'lucide-react';
import type { EventTemplate, NostrEvent } from 'nostr-tools';
import type { Listing, Media, ReleaseReview } from './publication';
import type { Project } from './types';
import { bindPublicationAccount, type PublicationAccount } from './publication-account';
export type { PublicationAccount } from './publication-account';

type Api = <T>(path: string, body?: unknown) => Promise<T>;
export function usePublicationSigner(api: Api, account: PublicationAccount) {
  const [session, setSession] = useState<{ id: string; pubkey: string }>();
  const [status, setStatus] = useState('');
  const pending = useRef(false);
  const shell = useRef<ReturnType<typeof bindPublicationAccount> | undefined>(undefined);
  useEffect(() => {
    shell.current?.close();
    shell.current = undefined;
    setSession(undefined);
    setStatus('');
    return () => shell.current?.close();
  }, [account.pubkey]);
  async function connect() {
    shell.current?.close();
    setSession(undefined);
    if (!account.pubkey) {
      setStatus('Choose an account using the shared account menu, then continue.');
      await account.connect();
      return;
    }
    const signer = bindPublicationAccount(account);
    setStatus('Connecting the selected account…');
    shell.current = signer;
    try {
      const connected = await api<{ id: string; pubkey: string }>('signers', {
        pubkey: signer.pubkey,
      });
      if (!signer.alive()) throw new Error('Account changed while connecting. Try again.');
      setSession(connected);
    } catch (error) {
      signer.close();
      shell.current = undefined;
      setStatus('Account connection did not complete. Connect again to retry.');
      throw error;
    }
    setStatus('Connected through napplet.soy');
  }
  useEffect(() => {
    if (!session) return;
    let live = true;
    const poll = async () => {
      if (pending.current) return;
      pending.current = true;
      try {
        const signer = shell.current;
        if (!signer?.alive() || signer.pubkey !== session.pubkey)
          throw new Error('Your selected account changed. Reconnect before continuing.');
        const request = await api<{ id: string; pubkey: string; template: EventTemplate } | null>(
          `signers/${session.id}`,
        );
        if (request && live) {
          setStatus('Approve the publication request with your selected signer');
          let event: NostrEvent | undefined;
          try {
            if (request.pubkey !== session.pubkey) throw new Error('Unexpected signing account.');
            event = await signer.signEvent(request.template);
          } catch {
            /* Only send a safe rejection; provider exceptions may contain credentials. */
          }
          await api(`signers/${session.id}`, {
            requestId: request.id,
            ...(event ? { event } : {}),
          });
          if (live)
            setStatus(
              event ? 'Signature received' : 'Signing declined. You can reconnect and resume.',
            );
        }
      } catch (error) {
        if (live) {
          setStatus((error as Error).message);
          setSession(undefined);
        }
      } finally {
        pending.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 750);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session?.id]);
  return { session, status, connect };
}

function Capture({
  item,
  review,
  project,
  media,
}: {
  item: Media;
  review: ReleaseReview;
  project: string;
  media: (path: string) => Promise<Blob>;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true,
      objectUrl = '';
    void media(
      `projects/${project}/media?review=${review.id}&name=${encodeURIComponent(item.name)}`,
    )
      .then((blob) => {
        if (live) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [review.id, item.name]);
  return (
    <figure className={item.promotional ? 'portrait-capture' : ''}>
      {url ? (
        item.mime === 'video/webm' ? (
          <video src={url} controls muted playsInline preload="metadata" />
        ) : (
          <img src={url} alt={item.label} />
        )
      ) : (
        <p>{error || 'Loading capture…'}</p>
      )}
      <figcaption>
        {item.label}
        {item.promotional && ' · promotional download'}
        {url && (
          <a href={url} download={item.name}>
            Download
          </a>
        )}
      </figcaption>
    </figure>
  );
}

export function PublicationDialog({
  project: p,
  busy,
  api,
  media,
  action,
  signer,
  close,
  chat,
}: {
  project: Project;
  busy: boolean;
  api: Api;
  media: (path: string) => Promise<Blob>;
  action: (fn: () => Promise<unknown>) => Promise<void>;
  signer: ReturnType<typeof usePublicationSigner>;
  close: () => void;
  chat: (text: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<Listing>();
  const [tagsText, setTagsText] = useState('');
  const [editing, setEditing] = useState(!p.publication?.review);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [resume, setResume] = useState(false);
  const review = resume ? p.publication?.attempt?.review : p.publication?.review;
  const attempt = p.publication?.attempt;
  const success = attempt?.status === 'published' ? attempt.result : undefined;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    void api<Listing>(`projects/${p.id}/listing`)
      .then((form) => {
        setForm(form);
        setTagsText(form.topics.join(', '));
      })
      .catch((e) => setError(e.message));
  }, [p.id]);
  useEffect(() => {
    if (p.publication?.review) {
      setEditing(false);
      setConfirmed(false);
    }
  }, [p.publication?.review?.id]);
  const call = async (fn: () => Promise<unknown>) => {
    setError('');
    await action(async () => {
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };
  return (
    <dialog
      ref={dialog}
      aria-labelledby="publication-title"
      className="publication-dialog"
      onCancel={close}
      onClose={close}
    >
      <div className="publication-header">
        <div>
          <span className="eyebrow">FROM YOUR WORKSHOP TO THE WORLD</span>
          <h2 id="publication-title">Publish your napplet</h2>
        </div>
        <button aria-label="Close publication" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="publication-body">
        <div className="signer-card">
          <div>
            <strong>Publishing account</strong>
            <small className="pubkey">
              {signer.session?.pubkey ?? 'Use your existing napplet.soy account.'}
            </small>
            <small>{signer.status}</small>
          </div>
          <button className="outline" disabled={busy} onClick={() => void call(signer.connect)}>
            {signer.session ? 'Use current account' : 'Use shell account'}
          </button>
        </div>
        {error && (
          <p role="alert" className="publication-error">
            {error}
          </p>
        )}
        {busy && (
          <div role="status" className="publication-progress">
            <LoaderCircle className="spin" size={20} />
            <div>
              <strong>{p.stage}</strong>
              <small>
                {p.phase === 'publishing'
                  ? 'Keep this tab open for signing. Uploaded steps are saved for retry.'
                  : 'Checking the project and capturing its actual running build.'}
              </small>
            </div>
            <button
              className="outline"
              onClick={() => void call(() => api(`projects/${p.id}/stop`, {}))}
            >
              Stop
            </button>
          </div>
        )}
        {p.error && (
          <div className="publication-error" role="alert">
            <strong>{p.error.message}</strong>
            <p>{p.error.details?.join('\n')}</p>
            {!busy && (p.publication?.preparationFailed || attempt?.status === 'failed') && (
              <button
                className="outline"
                onClick={() => {
                  if (!p.publication?.preparationFailed) {
                    setResume(true);
                    setEditing(false);
                    setConfirmed(false);
                  } else
                    void call(async () => {
                      await api(`projects/${p.id}/fix-publication`, {});
                      close();
                    });
                }}
              >
                {p.publication?.preparationFailed
                  ? 'Ask the agent to fix this'
                  : 'Review saved release to retry'}
              </button>
            )}
          </div>
        )}
        {success && (
          <div className="publication-success">
            <Check size={20} />
            <div>
              <strong>
                {success.websiteReady
                  ? 'Your napplet is live'
                  : 'Published · website indexing pending'}
              </strong>
              <p>
                <a href={success.url} target="_blank" rel="noreferrer">
                  Open napplet <ExternalLink size={13} />
                </a>
              </p>
              <button
                className="outline"
                disabled={busy}
                onClick={() => void call(() => api(`projects/${p.id}/refresh-publication`, {}))}
              >
                Check availability
              </button>
            </div>
          </div>
        )}
        {attempt?.status === 'failed' &&
          !resume &&
          !busy &&
          (!p.error || p.publication?.preparationFailed) && (
            <button
              className="outline"
              onClick={() => {
                setResume(true);
                setEditing(false);
                setConfirmed(false);
              }}
            >
              Resume the saved release
            </button>
          )}
        {editing && form && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (signer.session)
                void call(() =>
                  api(`projects/${p.id}/prepare-publication`, {
                    session: signer.session!.id,
                    listing: {
                      ...form,
                      topics: tagsText
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    },
                  }),
                );
            }}
          >
            <label className="field">
              Title
              <input
                value={form.title}
                maxLength={160}
                disabled={busy}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label className="field">
              Description
              <textarea
                value={form.description}
                maxLength={1000}
                required
                rows={3}
                disabled={busy}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </label>
            <label className="field">
              Tags · comma separated
              <input
                value={tagsText}
                disabled={busy}
                onChange={(e) => setTagsText(e.target.value)}
              />
            </label>
            <div className="capture-options">
              <label>
                <input
                  type="checkbox"
                  checked={form.video}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, video: e.target.checked })}
                />{' '}
                Record a short preview clip
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={form.portrait}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, portrait: e.target.checked })}
                />{' '}
                Also create portrait promotional media
              </label>
            </div>
            <p className="muted">
              A fresh screenshot is included. Captures use the project’s saved timing and input
              recipe. Watch them before publishing.
            </p>
            <div className="publication-actions">
              <button
                className="outline"
                type="button"
                disabled={busy}
                onClick={() =>
                  chat(
                    'Improve the publication description and tags, and configure preview.recording with timed inputs that show the core interaction. Keep the current app working. Do not publish. I will use Publish to capture and review the result.',
                  )
                }
              >
                Improve listing & capture plan in chat
              </button>
              <button
                className="primary"
                disabled={busy || !signer.session || !form.title.trim() || !form.description.trim()}
              >
                Prepare release
              </button>
            </div>
          </form>
        )}
        {!editing && review && (
          <>
            <div className="release-summary">
              <span className="eyebrow">
                {resume ? 'RESUME THIS SAVED RELEASE' : 'REVIEW YOUR LISTING'}
              </span>
              <h3>{review.plan.title}</h3>
              <p>{review.plan.description}</p>
              <p className="release-tags">
                {review.plan.topics.map((t) => '#' + t.replace(/^#/, '')).join(' ')}
              </p>
              <small>
                Author <span className="pubkey">{review.plan.pubkey}</span>
              </small>
              <small>
                Source revision <code>{review.plan.sourceCommit.slice(0, 12)}</code> ·{' '}
                {review.plan.files.length} files ·{' '}
                {(review.plan.sourceBytes / 1024 / 1024).toFixed(1)} MiB
              </small>
            </div>
            <div className="capture-grid">
              {review.media.map((item) => (
                <Capture key={item.name} item={item} project={p.id} review={review} media={media} />
              ))}
            </div>
            <details className="publication-destinations">
              <summary>Source, storage and publication destinations</summary>
              <p>
                Source:{' '}
                {review.repository.hosted ? review.repository.origin : review.repository.address}
                {review.repository.hosted
                  ? ' · soyLI will host this repository'
                  : ' · your existing repository'}
              </p>
              <p>Blossom: {review.plan.targets.blossom}</p>
              <p>Relay: {review.plan.targets.relay}</p>
              <p>Mirrors: {review.plan.targets.mirrors.join(', ') || 'None'}</p>
              <p>Author outbox relays are also discovered at publication time.</p>
              <p>License: {review.plan.license}</p>
              {review.plan.remix && <p>Original remix attribution is retained.</p>}
              <p>
                The cover and landscape clip appear on the listing. Portrait files are included in
                the public source and available to download for promotion.
              </p>
            </details>
            <label className="publication-consent">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                I reviewed the captures and listing. Publish this version, including its source and
                Git history, under the account above.
              </span>
            </label>
            {signer.session && signer.session.pubkey !== review.plan.pubkey && (
              <p role="alert">
                The connected account differs from this review. Reconnect the displayed author to
                resume, or prepare a new release for the new account.
              </p>
            )}
            <div className="publication-actions">
              <button
                className="outline"
                disabled={busy}
                onClick={() => {
                  setResume(false);
                  setEditing(true);
                  setConfirmed(false);
                }}
              >
                Edit listing / recapture
              </button>
              <button
                className="primary"
                disabled={busy || !confirmed || signer.session?.pubkey !== review.plan.pubkey}
                onClick={() =>
                  void call(() =>
                    api(`projects/${p.id}/publish`, {
                      session: signer.session!.id,
                      review: review.id,
                      resume,
                      confirmed: true,
                    }),
                  )
                }
              >
                <Send size={15} />
                {resume ? 'Resume publication' : 'Publish this version'}
              </button>
            </div>
          </>
        )}
        {!busy && !editing && !review && (
          <button className="primary" onClick={() => setEditing(true)}>
            Prepare a release
          </button>
        )}
      </div>
    </dialog>
  );
}
