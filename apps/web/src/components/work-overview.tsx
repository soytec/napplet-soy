import { useEffect, useState } from 'react';
import { useWork } from './work-provider';
import { useStudio } from './studio-provider';
import { useNostr } from './nostr-provider';
import { Button } from './ui/button';
import { Link } from '@tanstack/react-router';
import type { StudioState, Project } from '../../../studio/types';
import { WorkProposalCard } from './work-proposal-card';

export function WorkOverview({ view }: { view: 'creations' | 'proposals' | 'activity' }) {
  const work = useWork(),
    { client } = useStudio(),
    { pubkey } = useNostr();
  const [drafts, setDrafts] = useState<{ account: string; items: Project[] }>();
  const [draftError, setDraftError] = useState(''),
    [loading, setLoading] = useState(false);
  const [generation, refresh] = useState(0);
  const [onlyUnread, setOnlyUnread] = useState(false);
  useEffect(() => {
    if (!client || !pubkey || view !== 'creations') return;
    let active = true;
    setLoading(true);
    setDraftError('');
    void client
      .api<StudioState>('state')
      .then((state) => {
        if (active) setDrafts({ account: pubkey, items: state.projects });
      })
      .catch((e) => {
        if (active) setDraftError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, pubkey, view, generation]);
  if (view === 'creations')
    return (
      <section className="work-section" aria-label="Studio drafts">
        <div className="work-section-heading">
          <h2>Studio drafts & reviews</h2>
          <Link to="/studio/create">Create something new ↗</Link>
        </div>
        <p className="muted">
          {client?.mode === 'local'
            ? 'Drafts on this computer, including your existing local projects.'
            : 'Your private Studio projects. Publishing or merging always needs your confirmation.'}
        </p>
        {loading && <p role="status">Opening your private workspace…</p>}
        {draftError && (
          <p role="alert">
            {draftError} <button onClick={() => refresh((n) => n + 1)}>Retry</button>
          </p>
        )}
        <div className="work-grid">
          {(drafts?.account === pubkey ? drafts.items : []).map((d) => (
            <Link to="/studio/$id" params={{ id: d.id }} className="work-card" key={d.id}>
              <strong>{d.title}</strong>
              <span>
                {d.merge
                  ? d.merge.status === 'merged'
                    ? 'Source merged'
                    : 'Merge review'
                  : d.source
                    ? 'Remix draft'
                    : 'Draft'}
              </span>
              <small>{d.stage}</small>
              <small>Updated {new Date(d.updatedAt).toLocaleString()}</small>
            </Link>
          ))}
        </div>
        {!loading && !draftError && drafts?.account === pubkey && !drafts.items.length && (
          <p>No drafts yet. Create a napplet or remix one to begin.</p>
        )}
      </section>
    );
  if (view === 'proposals')
    return (
      <section className="work-section" aria-label="Your proposals">
        {[true, false].map((incoming) => {
          const rows = work.proposals.filter((r) =>
            incoming ? r.incoming : r.proposal.root.pubkey === pubkey,
          );
          return (
            <section key={String(incoming)} className="work-section">
              <h2>{incoming ? 'Incoming proposals' : 'Your contributions'}</h2>
              <p className="muted">
                {incoming
                  ? 'Review the proposed changes, play a rebuilt merge candidate, then decide whether to merge.'
                  : 'Proposals you submitted and their latest status.'}
              </p>
              {!rows.length && (
                <p>{work.loading ? 'Finding proposals…' : 'No proposals found on your relays.'}</p>
              )}
              <div className="work-grid">
                {rows.map((row) => (
                  <WorkProposalCard
                    key={row.proposal.root.id}
                    row={row}
                    incoming={incoming}
                    unread={
                      work.unread(row.proposal.revision.id) && row.proposal.root.pubkey !== pubkey
                    }
                  />
                ))}
              </div>
            </section>
          );
        })}
      </section>
    );
  const activity = work.activity.filter((a) => !onlyUnread || work.unread(a.id));
  return (
    <section className="work-section" aria-label="Recent activity">
      <div className="work-section-heading">
        <h2>Recent activity</h2>
        <Button
          variant="outline"
          disabled={!work.count}
          onClick={() => work.mark(work.activity.map((a) => a.id))}
        >
          Mark all loaded items read
        </Button>
      </div>
      <p className="muted">
        {work.count} unread · Updates from your configured relays. Read markers stay on this
        browser, separately for each account.
      </p>
      <label className="work-unread-filter">
        <input
          type="checkbox"
          checked={onlyUnread}
          onChange={(e) => setOnlyUnread(e.target.checked)}
        />{' '}
        Only unread
      </label>
      {!activity.length && (
        <p>
          {work.loading
            ? 'Checking your relays…'
            : onlyUnread
              ? 'You’re caught up.'
              : 'No activity found yet.'}
        </p>
      )}
      <ol className="work-activity">
        {activity.map((a) => (
          <li key={a.id} data-unread={work.unread(a.id)}>
            <div>
              <span className="eyebrow">{a.kind}</span>
              <h3>
                <a href={a.href}>{a.title}</a>
              </h3>
              <p>{a.detail}</p>
              <small>
                {a.actor.slice(0, 10)}… · {new Date(a.at * 1000).toLocaleString()}
              </small>
            </div>
            {work.unread(a.id) ? (
              <Button variant="outline" onClick={() => work.mark([a.id])}>
                Mark read
              </Button>
            ) : (
              <small>Read</small>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
