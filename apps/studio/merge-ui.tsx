import React, { useEffect, useState } from 'react';
import type { Project } from './types';
import type { usePublicationSigner } from './publication-ui';

export function MergePanel({
  project: p,
  busy,
  signer,
  api,
}: {
  project: Project;
  busy: boolean;
  signer: ReturnType<typeof usePublicationSigner>;
  api: <T>(path: string, body?: unknown) => Promise<T>;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState('');
  const merge = p.merge,
    review = merge?.review;
  useEffect(() => {
    setConfirmed(false);
    setError('');
  }, [review?.id, signer.pubkey]);
  if (!merge) return null;
  return (
    <section className="merge-review-panel" aria-label="Author management">
      <span className="eyebrow">AUTHOR MANAGEMENT</span>
      <h3>{merge.status === 'merged' ? 'Changes merged' : 'Review the merged build'}</h3>
      <p role="status">{busy ? p.stage : merge.detail}</p>
      {review && (
        <details>
          <summary>Source revision</summary>
          <p className="pubkey">
            Branch: {review.branch}
            <br />
            Base: {review.target}
            <br />
            Proposed: {review.head}
            <br />
            Merged: {review.commit ?? 'Checking…'}
          </p>
          <a href={`/proposals/${review.proposal}`}>Open proposal</a>
        </details>
      )}
      {review?.commit && merge.status !== 'merged' && (
        <>
          <p>
            Review Changes and play the preview. Confirming updates the original Git branch and
            marks this proposal merged. Publish the napplet release separately.
          </p>
          <label className="publication-consent">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            I reviewed the diff and played the merged build.
          </label>
          <button
            className="primary"
            disabled={busy || !confirmed || signer.pubkey !== review.pubkey}
            onClick={() => {
              setError('');
              void (async () => {
                const session = await signer.connect();
                if (!session || session.pubkey !== review.pubkey)
                  throw new Error('Connect the original author account.');
                await api(`projects/${p.id}/merge-proposal`, {
                  session: session.id,
                  review: review.id,
                  confirmed: true,
                });
              })().catch((e) => setError(e.message));
            }}
          >
            {merge.status === 'failed' ? 'Retry reviewed merge' : 'Merge and update source'}
          </button>
          {busy && <p role="status">{signer.status}</p>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
