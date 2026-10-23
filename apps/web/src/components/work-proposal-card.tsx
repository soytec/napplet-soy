import { workProposalHref, type WorkProposal } from '../../../../packages/client/src/work';
import { CreatorLink } from './creator-link';

export function WorkProposalCard({
  row: { proposal: p, publication, repository },
  incoming,
  unread,
}: {
  row: WorkProposal;
  incoming: boolean;
  unread: boolean;
}) {
  return (
    <article className="work-card">
      <div className="work-section-heading">
        <strong>{p.title}</strong>
        <span className="work-status">{p.status}</span>
      </div>
      <span>{publication?.title ?? repository.identifier}</span>
      <div className="proposal-byline">
        <span>Proposed by</span> <CreatorLink pubkey={p.root.pubkey} />
      </div>
      {unread && <small className="work-unread-label">New proposal activity</small>}
      <small>
        {p.comments.length} comments · Updated{' '}
        {new Date(p.revision.created_at * 1000).toLocaleString()}
      </small>
      <a href={workProposalHref(p.root.id, publication)}>
        {incoming ? 'Review & manage' : 'Open proposal'} ↗
      </a>
    </article>
  );
}
