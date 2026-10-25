import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, GitMerge, GitPullRequest, Circle, Code2 } from 'lucide-react';
import { contributionHistory, type ContributionNode } from '../lib/contribution-history';
import type { SignedEvent } from '../../../../packages/protocol/src';
import type { Proposal } from '../../../../packages/collaboration/src/protocol';
import { CreatorLink } from './creator-link';
import { Button } from './ui/button';
import './contribution-graph.css';

const COLUMN = 250,
  ROW = 260,
  LEFT = 125,
  TOP = 48;
const x = (n: ContributionNode) => LEFT + n.column * COLUMN;
const y = (n: ContributionNode) => TOP + n.lane * ROW;
const color = (n: ContributionNode) =>
  n.kind === 'proposal'
    ? ['var(--lilac)', 'var(--blue)', 'var(--gold)'][(n.lane - 1) % 3]
    : 'var(--mint)';
const date = (time: number) =>
  new Date(time * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function ContributionGraph({
  manifest,
  history,
  proposals,
  selected,
  onSelect,
  renderZap,
}: {
  manifest: SignedEvent;
  history: SignedEvent[];
  proposals: Proposal[];
  selected?: string;
  onSelect: (proposal: Proposal) => void;
  renderZap?: (node: ContributionNode) => ReactNode;
}) {
  const [allReleases, setAllReleases] = useState(false);
  const full = contributionHistory(manifest, history, proposals);
  const releases = full.nodes.filter((n) => n.kind === 'release');
  const bases = new Set(proposals.map((p) => p.base).filter(Boolean));
  const milestones = releases.filter(
    (n, i) => i === 0 || n.current || (n.commit && bases.has(n.commit)),
  );
  const graph = allReleases
    ? full
    : contributionHistory(
        manifest,
        milestones.flatMap((n) => (n.event ? [n.event] : [])),
        proposals,
      );
  const viewport = useRef<HTMLDivElement>(null);
  const width = Math.max(540, graph.nodes.length * COLUMN + 10);
  const height = graph.lanes * ROW + 70;
  const authors = new Set(
    graph.nodes
      .filter((n) => n.kind === 'release' || n.kind === 'proposal')
      .map((n) => n.event!.pubkey),
  );
  return (
    <div className="contributions">
      <div className="contribution-caption">
        <span>
          <strong>{authors.size}</strong> {authors.size === 1 ? 'creator' : 'creators'} ·{' '}
          <strong>{proposals.length}</strong> {proposals.length === 1 ? 'proposal' : 'proposals'}
        </span>
        {milestones.length < releases.length && (
          <button
            type="button"
            className="contribution-density"
            aria-pressed={allReleases}
            onClick={() => setAllReleases((v) => !v)}
          >
            {allReleases ? 'Show milestones' : `All ${releases.length} releases`}
          </button>
        )}
        <div className="contribution-key">
          <span>
            <i /> Releases
          </span>
          <span>
            <i /> Proposals
          </span>
        </div>
        <div className="contribution-navigation">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Earlier contributions"
            onClick={() => viewport.current?.scrollBy({ left: -540 })}
          >
            <ArrowLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Later contributions"
            onClick={() => viewport.current?.scrollBy({ left: 540 })}
          >
            <ArrowRight size={16} />
          </Button>
        </div>
      </div>
      <div
        className="contribution-viewport"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Contribution history, scroll horizontally for more"
      >
        <div className="contribution-canvas" style={{ width, height }}>
          <svg className="contribution-lines" width={width} height={height} aria-hidden="true">
            {graph.edges.map((edge) => {
              const from = graph.nodes.find((n) => n.id === edge.from)!;
              const to = graph.nodes.find((n) => n.id === edge.to)!;
              const a = x(from),
                b = x(to),
                ay = y(from),
                by = y(to);
              // Turn in the proposal's empty main-line column, never behind a release card.
              const curve = Math.min(60, (b - a) / 3);
              const d =
                ay === by
                  ? `M ${a} ${ay} H ${b}`
                  : edge.kind === 'merge'
                    ? `M ${a} ${ay} C ${a + curve} ${ay}, ${a + curve} ${by}, ${a + 2 * curve} ${by} H ${b}`
                    : `M ${a} ${ay} H ${b - 2 * curve} C ${b - curve} ${ay}, ${b - curve} ${by}, ${b} ${by}`;
              return (
                <path
                  key={`${edge.kind}:${edge.from}:${edge.to}`}
                  d={d}
                  fill="none"
                  stroke={
                    edge.kind === 'timeline'
                      ? 'var(--subtle-border)'
                      : color(edge.kind === 'merge' ? from : to)
                  }
                  strokeWidth={edge.kind === 'timeline' ? 2 : 3}
                  strokeDasharray={edge.uncertain ? '5 6' : undefined}
                />
              );
            })}
          </svg>
          <ol className="contribution-nodes">
            {graph.nodes.map((node) => {
              const p = node.proposal;
              const selectedNode = p && selected === p.root.id;
              const Icon =
                node.kind === 'merge'
                  ? GitMerge
                  : p
                    ? GitPullRequest
                    : node.kind === 'source'
                      ? Code2
                      : Circle;
              return (
                <li
                  key={node.id}
                  className={`contribution-node contribution-${node.kind}${selectedNode ? ' is-selected' : ''}`}
                  style={
                    {
                      left: x(node) - 110,
                      top: y(node) - 16,
                      '--contribution-color': color(node),
                    } as CSSProperties
                  }
                >
                  <div className="contribution-point" aria-hidden="true">
                    <Icon size={15} />
                  </div>
                  <article className="contribution-card">
                    <div className="contribution-card-heading">
                      <span>
                        {p
                          ? 'Proposal'
                          : node.kind === 'release'
                            ? 'Published'
                            : node.kind === 'merge'
                              ? 'Merged'
                              : 'Source'}
                      </span>
                      {p ? (
                        <span className={`contribution-status status-${p.status}`}>{p.status}</span>
                      ) : node.current ? (
                        <span className="contribution-status">Viewing</span>
                      ) : null}
                    </div>
                    {p ? (
                      <button
                        className="contribution-title"
                        type="button"
                        aria-expanded={!!selectedNode}
                        aria-controls="proposal-review"
                        onClick={() => onSelect(p)}
                        title={node.title}
                      >
                        <span>{node.title}</span>
                        <ArrowRight size={14} />
                      </button>
                    ) : (
                      <h3>{node.title}</h3>
                    )}
                    {node.event && <CreatorLink pubkey={node.event.pubkey} />}
                    <div className="contribution-meta">
                      {node.event && (
                        <time dateTime={new Date(node.event.created_at * 1000).toISOString()}>
                          {date(node.event.created_at)}
                        </time>
                      )}
                      {node.commit && <code title={node.commit}>{node.commit.slice(0, 7)}</code>}
                    </div>
                    {p && (
                      <p className="contribution-detail">
                        {p.revisions.length} {p.revisions.length === 1 ? 'revision' : 'revisions'} ·{' '}
                        {p.comments.length} {p.comments.length === 1 ? 'comment' : 'comments'}
                      </p>
                    )}
                    {node.kind === 'source' && (
                      <p className="contribution-detail">
                        {node.commit
                          ? 'Referenced by the proposal. No matching release found.'
                          : 'This proposal does not name its source base.'}
                      </p>
                    )}
                    {node.kind === 'merge' && (
                      <p className="contribution-detail">
                        Signed merge status. Publishing the updated napplet is a separate step.
                      </p>
                    )}
                    {(p || node.kind === 'release') && (
                      <div className="contribution-actions">
                        {p ? (
                          <button
                            type="button"
                            onClick={() => onSelect(p)}
                            aria-expanded={!!selectedNode}
                            aria-controls="proposal-review"
                          >
                            {selectedNode ? 'Selected' : 'View proposal'}
                          </button>
                        ) : (
                          <a href={`/r/${node.id}/source`}>View source ↗</a>
                        )}
                        {renderZap?.(node)}
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <p className="contribution-footnote">
        A history of shared work. Dotted lines show timing or missing source history; merge links
        reflect signed reports, not verified Git ancestry. Earlier releases may be unavailable.
      </p>
    </div>
  );
}
