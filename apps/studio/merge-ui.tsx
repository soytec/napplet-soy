import React, { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Project } from './types';
import type { usePublicationSigner } from './publication-ui';
import { shortPubkey } from '../../packages/protocol/src/profile';

export function MergePanel({
  project: p,
  busy,
  signer,
  api,
  refresh,
}: {
  project: Project;
  busy: boolean;
  signer: ReturnType<typeof usePublicationSigner>;
  api: <T>(path: string, body?: unknown) => Promise<T>;
  refresh: () => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [starting, setStarting] = useState(false);
  const merge = p.merge,
    review = merge?.review,
    merging = starting || merge?.status === 'publishing',
    disabled = busy || merging;
  useEffect(() => {
    setConfirmed(false);
    setError('');
  }, [review?.id, signer.pubkey]);
  if (!merge) return null;
  return (
    <section className="merge-review-panel" aria-label="Author management">
      <span className="eyebrow">AUTHOR MANAGEMENT</span>
      <h3 className="merge-review-heading">
        {merging && <LoaderCircle className="spin" size={18} aria-hidden="true" />}
        {merging
          ? 'Merging…'
          : merge.status === 'merged'
            ? 'Changes merged'
            : 'Private merge review'}
      </h3>
      {review && (
        <p>
          <a href={`/proposals/${review.proposal}`}>{review.title ?? 'Open published proposal'}</a>
          {review.author && (
            <>
              {' '}
              · Proposed by <span title={review.author}>{shortPubkey(review.author)}</span>
            </>
          )}
          {merge.status !== 'merged' && (
            <>
              <br />
              This workspace tests the proposal against the original project. The original stays
              unchanged until you confirm the merge.
            </>
          )}
        </p>
      )}
      {review && merge.status === 'failed' && !review.commit && (
        <p>
          After resolving the reported problem,{' '}
          <a href={`/proposals/${review.proposal}`}>return to the proposal</a> to prepare a fresh
          review.
        </p>
      )}
      <div role="status" aria-live="polite">
        <p>
          {starting && merge.status !== 'publishing'
            ? 'Connecting your account and starting the reviewed merge…'
            : busy
              ? p.stage
              : merge.detail}
        </p>
        {merging && signer.status && <p>{signer.status}</p>}
      </div>
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
              disabled={disabled}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{' '}
            I reviewed the diff and played the merged build.
          </label>
          <button
            className="primary"
            disabled={disabled || !confirmed || signer.pubkey !== review.pubkey}
            onClick={() => {
              setError('');
              setStarting(true);
              void (async () => {
                const session = await signer.connect();
                if (!session || session.pubkey !== review.pubkey)
                  throw new Error('Connect the original author account.');
                await api(`projects/${p.id}/merge-proposal`, {
                  session: session.id,
                  review: review.id,
                  confirmed: true,
                });
                await refresh();
              })()
                .catch((e) => setError(e.message))
                .finally(() => setStarting(false));
            }}
          >
            {merging && <LoaderCircle className="spin" size={16} aria-hidden="true" />}
            {merging
              ? 'Merging…'
              : merge.status === 'failed'
                ? 'Retry reviewed merge'
                : 'Merge and update source'}
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
