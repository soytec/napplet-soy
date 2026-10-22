import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import type { Project } from './types';
import type { usePublicationSigner } from './publication-ui';
import { ProposalProgressPanel } from './proposal-progress-ui';

export function ProposalDialog({
  project: p,
  busy,
  api,
  signer,
  close,
}: {
  project: Project;
  busy: boolean;
  api: <T>(path: string, body?: unknown) => Promise<T>;
  signer: ReturnType<typeof usePublicationSigner>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [description, setDescription] = useState(p.proposal?.review?.description ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(false);
  const review = retry ? p.proposal?.attempt?.review : p.proposal?.review;
  const result =
    p.proposal?.attempt?.status === 'proposed' &&
    (p.proposal.progress?.complete ||
      (!p.proposal.progress && p.proposal.review?.id === p.proposal.attempt.review.id))
      ? p.proposal.attempt.result
      : undefined;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    setConfirmed(false);
  }, [review?.id, retry, signer.pubkey]);
  useEffect(() => {
    let live = true;
    if (signer.pubkey)
      void signer.connect().catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [signer.pubkey]);
  const call = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (error) {
      setError((error as Error).message);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="publication-dialog"
      aria-labelledby="proposal-title"
      onClose={close}
      onCancel={close}
    >
      <div className="publication-header">
        <div>
          <span className="eyebrow">BUILD ON EACH OTHER</span>
          <h2 id="proposal-title">Propose changes</h2>
        </div>
        <button aria-label="Close proposal" onClick={close}>
          <X size={20} />
        </button>
      </div>
      <div className="publication-body">
        <p>
          Share this revision with the original project’s maintainers, including a playable build.
          They decide whether to merge it. This does not create another napplet listing.
        </p>
        <div className="signer-card">
          <div>
            <strong>Contributing account</strong>
            <small className="pubkey">
              {signer.pubkey ?? 'Sign in using the shared account menu'}
            </small>
            <small>{signer.status}</small>
          </div>
          {!signer.pubkey || !signer.session ? (
            <button className="outline" disabled={busy} onClick={() => void call(signer.connect)}>
              {signer.pubkey ? 'Retry connection' : 'Sign in'}
            </button>
          ) : null}
        </div>
        {(error || p.error) && (
          <p className="publication-error" role="alert">
            {error || p.error?.message}
            <br />
            {p.error?.recovery}
          </p>
        )}
        <ProposalProgressPanel project={p} signing={signer.status} />
        {busy && (
          <p role="status">
            <button onClick={() => void call(() => api(`projects/${p.id}/stop`, {}))}>Stop</button>
          </p>
        )}
        {result && (
          <div className="publication-success">
            <p>
              Proposal submitted. <a href={`/proposals/${result.proposal}`}>Open proposal review</a>
              {' · '}
              <a
                href={`nostr:${nip19.neventEncode({ id: result.proposal, relays: p.proposal!.attempt!.review.relays })}`}
              >
                Open proposal in a Nostr client
              </a>
            </p>
            <p className="pubkey">Source: {result.head}</p>
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void call(async () => {
              const session = await signer.connect();
              if (!session) return;
              setRetry(false);
              await api(`projects/${p.id}/prepare-proposal`, {
                session: session.id,
                proposal: { description },
              });
            });
          }}
        >
          <label className="field">
            Describe your changes
            <textarea
              required
              value={description}
              rows={4}
              maxLength={8000}
              disabled={busy}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button className="outline" disabled={busy || !signer.session}>
            Prepare proposal
          </button>
        </form>
        {p.proposal?.attempt?.status === 'failed' && (
          <button className="outline" disabled={busy} onClick={() => setRetry(true)}>
            Review saved attempt
          </button>
        )}
        {review && (
          <section className="release-review">
            <h3>Review your contribution</h3>
            <p>
              <strong>{review.name}</strong>
            </p>
            <p className="pubkey">{review.repository}</p>
            <p className="pubkey">
              Revision: {review.commit}
              <br />
              Base: {review.base}
            </p>
            <p className="pubkey">Playable build: {review.artifactHash}</p>
            <p className="whitespace-pre-wrap">{review.description}</p>
            <p>Source destinations: {review.clones.join(', ')}</p>
            <label className="publication-consent">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              <span>
                I have played this build and reviewed the changes. Share this source and description
                publicly with this repository.
              </span>
            </label>
            <button
              className="primary"
              disabled={
                busy ||
                !confirmed ||
                signer.pubkey !== review.pubkey ||
                signer.session?.pubkey !== review.pubkey ||
                (!retry && description.trim() !== review.description)
              }
              onClick={() =>
                void call(async () => {
                  const session = await signer.connect();
                  if (!session || session.pubkey !== review.pubkey)
                    throw new Error('Your account changed. Prepare a new proposal review.');
                  await api(`projects/${p.id}/propose`, {
                    session: session.id,
                    review: review.id,
                    resume: retry,
                    confirmed: true,
                  });
                })
              }
            >
              {retry ? 'Retry reviewed proposal' : 'Submit reviewed proposal'}
            </button>
          </section>
        )}
      </div>
    </dialog>
  );
}
