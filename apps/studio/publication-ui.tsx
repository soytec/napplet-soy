import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ExternalLink, Send, X } from 'lucide-react';
import type { EventTemplate, NostrEvent } from 'nostr-tools';
import type { Listing, ListingDetails, Media, ReleaseReview } from './publication';
import type { Project } from './types';
import { bindPublicationAccount, type PublicationAccount } from './publication-account';
import { PublicationProgressPanel } from './publication-progress-ui';
export type { PublicationAccount } from './publication-account';

type Api = <T>(path: string, body?: unknown) => Promise<T>;
export function usePublicationSigner(api: Api, account: PublicationAccount, hosted = false) {
  const [session, setSession] = useState<{ id: string; pubkey: string }>();
  const [status, setStatus] = useState('');
  const pending = useRef(false);
  const shell = useRef<ReturnType<typeof bindPublicationAccount> | undefined>(undefined);
  const connected = useRef<{ id: string; pubkey: string } | undefined>(undefined);
  const connecting = useRef<Promise<{ id: string; pubkey: string } | undefined> | undefined>(
    undefined,
  );
  const latest = useRef(account);
  latest.current = account;
  // Reset before the dialog's passive effect binds the newly selected identity.
  useLayoutEffect(() => {
    shell.current?.close();
    shell.current = undefined;
    setSession(undefined);
    connected.current = undefined;
    connecting.current = undefined;
    setStatus('');
    return () => shell.current?.close();
  }, [account.pubkey]);
  async function connect() {
    const current = latest.current;
    if (!current.pubkey) {
      setStatus('Choose an account using the shared account menu, then continue.');
      await current.connect();
      return;
    }
    if (shell.current?.alive() && connected.current?.pubkey === current.pubkey)
      return connected.current;
    if (connecting.current) return connecting.current;
    shell.current?.close();
    setSession(undefined);
    const signer = bindPublicationAccount(current);
    shell.current = signer;
    setStatus('Using your signed-in shell account…');
    const operation = (async () => {
      try {
        const result = await api<{ id: string; pubkey: string }>('signers', {
          pubkey: signer.pubkey,
        });
        if (!signer.alive() || result.pubkey !== signer.pubkey)
          throw new Error('Shell account changed while connecting. Try again.');
        connected.current = result;
        setSession(result);
        setStatus('Using your signed-in shell account');
        return result;
      } catch (error) {
        signer.close();
        if (shell.current === signer) {
          shell.current = undefined;
          connected.current = undefined;
          setStatus('Could not connect to Studio. Retry to use your shell account.');
        }
        throw error;
      }
    })();
    connecting.current = operation;
    try {
      return await operation;
    } finally {
      if (connecting.current === operation) connecting.current = undefined;
    }
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
          connected.current = undefined;
        }
      } finally {
        pending.current = false;
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), hosted ? 1500 : 750);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session?.id]);
  return { session, status, connect, pubkey: account.pubkey };
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
  const [recordingPlanned, setRecordingPlanned] = useState(false);
  const [tagsText, setTagsText] = useState('');
  const [editing, setEditing] = useState(!p.publication?.review);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [resume, setResume] = useState(false);
  const [availabilityChecks, setAvailabilityChecks] = useState(0);
  const checkingAvailability = useRef(false);
  const review = resume ? p.publication?.attempt?.review : p.publication?.review;
  const attempt = p.publication?.attempt;
  const success =
    attempt?.status === 'published' &&
    (!p.publication?.review || p.publication.review.id === attempt.review.id) &&
    (!p.publication?.progress || p.publication.progress.step === 7)
      ? attempt.result
      : undefined;
  const automaticChecks =
    !!success &&
    !success.websiteReady &&
    success.websiteStatus !== 'superseded' &&
    availabilityChecks < 40;
  useEffect(() => {
    setAvailabilityChecks(0);
  }, [success?.jobId]);
  useEffect(() => {
    if (!automaticChecks || busy) return;
    // Only query saved publication status. No signing, uploads or republishing.
    const timer = setTimeout(() => {
      if (checkingAvailability.current) return;
      checkingAvailability.current = true;
      setAvailabilityChecks((value) => value + 1);
      void api(`projects/${p.id}/refresh-publication`, {})
        .catch((e) => setError(e.message))
        .finally(() => {
          checkingAvailability.current = false;
        });
    }, 15000);
    return () => clearTimeout(timer);
  }, [automaticChecks, busy, availabilityChecks, success?.jobId]);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const startingPublication =
    busy && (p.publication?.progress?.step === 0 || attempt?.status === 'running');
  useEffect(() => {
    if (startingPublication)
      dialog.current?.querySelector('.publication-timeline')?.scrollIntoView({ block: 'nearest' });
  }, [startingPublication]);
  useEffect(() => {
    let live = true;
    if (signer.pubkey)
      void signer.connect().catch((e) => {
        if (live) setError(e.message);
      });
    setConfirmed(false);
    return () => {
      live = false;
    };
  }, [signer.pubkey]);
  useEffect(() => {
    void api<ListingDetails>(`projects/${p.id}/listing`)
      .then(({ recordingPlanned, ...form }) => {
        setRecordingPlanned(recordingPlanned);
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
            <strong>Your shell account</strong>
            <small className="pubkey">
              {signer.pubkey ?? 'Sign in using the account menu to publish.'}
            </small>
            <small>{signer.status}</small>
          </div>
          {(!signer.pubkey || !signer.session) && (
            <button className="outline" disabled={busy} onClick={() => void call(signer.connect)}>
              {signer.pubkey ? 'Retry connection' : 'Sign in'}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="publication-error">
            {error}
          </p>
        )}
        <PublicationProgressPanel project={p} signing={signer.status} />
        {busy && (
          <div className="publication-actions">
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
                  : success.websiteStatus === 'superseded'
                    ? 'Published · a newer release is listed'
                    : 'Published to Nostr · checking website availability'}
              </strong>
              {!success.websiteReady && (
                <p className="muted">
                  {success.websiteStatus === 'superseded'
                    ? 'The website lists a newer version of this napplet.'
                    : automaticChecks
                      ? 'Uploads and relay publication succeeded. Checking automatically while this dialog is open; the link may already play. No need to publish again.'
                      : 'Automatic checking has paused. Your release is published; try the link or check availability again. No need to publish again.'}
                </p>
              )}
              <p>
                <a href={success.url} target="_blank" rel="noreferrer">
                  Open napplet <ExternalLink size={13} />
                </a>
              </p>
              {!success.websiteReady && (
                <button
                  className="outline"
                  disabled={busy}
                  onClick={() => {
                    setAvailabilityChecks(0);
                    void call(() => api(`projects/${p.id}/refresh-publication`, {}));
                  }}
                >
                  Check availability
                </button>
              )}
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
              void call(async () => {
                const session = await signer.connect();
                if (!session) return;
                await api(`projects/${p.id}/prepare-publication`, {
                  session: session.id,
                  listing: {
                    ...form,
                    topics: tagsText
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  },
                });
              });
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
              A fresh screenshot is included. For clips, the saved recipe must start the app and
              demonstrate its core interaction. Watch the result before publishing. Preparing a
              recipe in chat does not capture a clip. After the maker finishes, this dialog reopens
              so you can prepare the release and review the actual recording.
            </p>
            {form.video && !recordingPlanned && (
              <div className="capture-plan-note">
                <p>
                  No gameplay recording plan is saved yet. Prepare one in chat before capturing.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={!!form.autoplay}
                    disabled={busy}
                    onChange={(e) => setForm({ ...form, autoplay: e.target.checked })}
                  />{' '}
                  This app runs automatically and needs no input to demonstrate it
                </label>
              </div>
            )}
            <div className="publication-actions">
              <button
                className="outline"
                type="button"
                disabled={busy}
                onClick={() =>
                  chat(
                    'Prepare a gameplay recording plan for this app. Inspect its actual start screen and controls. Configure preview.recording in napplet.json with an early start action and timed inputs that demonstrate the core interaction, not just the menu. Coordinates use a 960 × 600 viewport; durationMs is 2000–8000 and actions use atMs, type click with x/y, or keyDown/keyUp with key. Keep the app working. Do not publish or claim a clip was captured. I will use Publish to capture and watch the result.',
                  )
                }
              >
                Prepare gameplay recording in chat
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !signer.session ||
                  !form.title.trim() ||
                  !form.description.trim() ||
                  (form.video && !recordingPlanned && !form.autoplay)
                }
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
              {review.previousCurrent && (
                <p>
                  Publishing shares this reviewed source and its captured media with the original
                  repository, then updates the original napplet listing.
                </p>
              )}
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
                I reviewed the listing and captures
                {review.media.some((m) => m.mime === 'video/webm')
                  ? ', and watched the clip demonstrate the app’s core interaction'
                  : ''}
                . Publish this version, including its source and Git history, under the account
                above.
              </span>
            </label>
            {signer.pubkey !== review.plan.pubkey && (
              <p role="alert">
                Your shell account changed. This review cannot be published as another author.
                Prepare a new release using the current account, or switch accounts in the shell
                menu.
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
                disabled={busy || !confirmed || signer.pubkey !== review.plan.pubkey}
                onClick={() =>
                  void call(async () => {
                    const session = await signer.connect();
                    if (!session) return;
                    await api(`projects/${p.id}/publish`, {
                      session: session.id,
                      review: review.id,
                      resume,
                      confirmed: true,
                    });
                  })
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
