import type { SignedEvent } from '../../../../packages/protocol/src';
import { socialScope } from '../../../../packages/protocol/src/social';
import { commitPattern, tag, type Proposal } from '../../../../packages/collaboration/src/protocol';

export type ContributionNode = {
  id: string;
  kind: 'release' | 'proposal' | 'merge' | 'source';
  title: string;
  time: number;
  event?: SignedEvent;
  commit?: string;
  proposal?: Proposal;
  current?: boolean;
  column: number;
  lane: number;
};
export type ContributionEdge = {
  from: string;
  to: string;
  kind: 'timeline' | 'branch' | 'merge';
  uncertain?: boolean;
};
const commit = (value?: string) => (value && commitPattern.test(value) ? value : undefined);
const chronological = (a: ContributionNode, b: ContributionNode) =>
  a.time - b.time || a.id.localeCompare(b.id);

/** A presentation of verified release/proposal events, not a reconstructed Git DAG.
 * Only exact commit matches create branch origins. Merge edges represent signed
 * status reports, never a claim that a later publication contains that merge. */
export function contributionHistory(
  manifest: SignedEvent,
  history: SignedEvent[],
  proposals: Proposal[],
) {
  const scope = socialScope(manifest);
  const releases = [
    ...new Map(
      [...history, manifest]
        .filter(
          (e) =>
            e.kind === manifest.kind &&
            e.pubkey === manifest.pubkey &&
            socialScope(e).key === scope.key,
        )
        .map((e) => [e.id, e]),
    ).values(),
  ];
  const nodes: ContributionNode[] = releases.map((event) => ({
    id: event.id,
    kind: 'release',
    event,
    title: event.id === manifest.id ? 'This release' : 'Earlier release',
    time: event.created_at,
    commit: commit(tag(event, 'source-commit')),
    current: event.id === manifest.id,
    column: 0,
    lane: 0,
  }));
  const earliest = [...nodes].sort(chronological)[0];
  if (earliest && !earliest.current) earliest.title = 'First known release';
  const edges: ContributionEdge[] = [];
  const branchNodes = [...proposals]
    .sort((a, b) => a.root.created_at - b.root.created_at || a.root.id.localeCompare(b.root.id))
    .map((proposal) => ({
      id: proposal.root.id,
      kind: 'proposal' as const,
      event: proposal.root,
      title: proposal.title,
      time: proposal.root.created_at,
      commit: commit(proposal.head),
      proposal,
      column: 0,
      lane: 1,
    }));
  nodes.push(...branchNodes);
  for (const node of branchNodes) {
    const p = node.proposal!;
    // A revised proposal may have a newer base; keep its card after that base.
    const base = commit(p.base);
    const origin =
      base &&
      nodes
        .filter((n) => n.id !== node.id && n.commit === base && n.time <= p.revision.created_at)
        .sort(chronological)
        .at(-1);
    if (origin) {
      edges.push({ from: origin.id, to: node.id, kind: 'branch' });
      node.time = Math.max(node.time, origin.time);
    } else {
      const id = `source:${base ?? node.id}`;
      if (!nodes.some((n) => n.id === id))
        nodes.push({
          id,
          kind: 'source',
          title: base ? 'Earlier source' : 'Unspecified base',
          commit: base,
          time: node.time - 1,
          column: 0,
          lane: 0,
        });
      edges.push({ from: id, to: node.id, kind: 'branch', uncertain: true });
    }
    if (p.status === 'merged' && p.statusEvent) {
      const event = p.statusEvent;
      // Several proposals may have been accepted by one status event.
      const id = `merge:${event.id}`;
      if (!nodes.some((n) => n.id === id))
        nodes.push({
          id,
          kind: 'merge',
          title: 'Merge reported',
          event,
          time: Math.max(node.time, event.created_at),
          commit: commit(tag(event, 'merge-commit')),
          column: 0,
          lane: 0,
        });
      edges.push({ from: node.id, to: id, kind: 'merge' });
    }
  }
  // Stable topological order handles equal timestamps without backward edges.
  const pending = [...nodes].sort(chronological),
    ordered: ContributionNode[] = [];
  while (pending.length) {
    const index = pending.findIndex(
      (n) => !edges.some((e) => e.to === n.id && pending.some((p) => p.id === e.from)),
    );
    // Malformed cyclic claims cannot strand the page; omit their claimed edges.
    if (index < 0) {
      const ids = new Set(pending.map((n) => n.id));
      for (let i = edges.length - 1; i >= 0; i--)
        if (ids.has(edges[i].from) && ids.has(edges[i].to)) edges.splice(i, 1);
      continue;
    }
    const [node] = pending.splice(index, 1);
    node.column = ordered.length;
    ordered.push(node);
  }
  const laneEnds: number[] = [];
  for (const node of ordered.filter((n) => n.kind === 'proposal')) {
    const destination = edges.find((e) => e.from === node.id && e.kind === 'merge');
    const end = destination ? ordered.find((n) => n.id === destination.to)!.column : ordered.length;
    let lane = laneEnds.findIndex((column) => column < node.column);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end;
    node.lane = lane + 1;
  }
  // The main line means chronological activity, not proven Git parentage.
  const main = ordered.filter((n) => n.lane === 0);
  for (let i = 1; i < main.length; i++)
    edges.push({ from: main[i - 1].id, to: main[i].id, kind: 'timeline', uncertain: true });
  return { nodes: ordered, edges, lanes: Math.max(0, ...ordered.map((n) => n.lane)) + 1 };
}
