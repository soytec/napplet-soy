import type { SignedEvent } from '../../protocol/src';
import { socialScope, socialView } from '../../protocol/src/social';
import { validateManifest } from '../../protocol/src/manifest';
import {
  proposalsFromEvents,
  readRepository,
  repositoryRef,
  tag,
  type Proposal,
  type Repository,
} from '../../collaboration/src/protocol';
import { resolveZapEndpoint, zapTotals } from './zaps';
import type { ProtocolClient } from './nostr';
import { nip19, type Filter } from 'nostr-tools';

export type WorkPublication = {
  manifest: SignedEvent;
  title: string;
  href: string;
  relays: string[];
};
export type WorkActivity = {
  id: string;
  kind: 'proposal' | 'revision' | 'comment' | 'like' | 'zap' | 'merged' | 'status';
  at: number;
  actor: string;
  title: string;
  detail: string;
  href: string;
};
export type WorkProposal = {
  proposal: Proposal;
  repository: Repository;
  publication?: WorkPublication;
  incoming: boolean;
};
export type WorkData = { proposals: WorkProposal[]; activity: WorkActivity[]; warnings: string[] };
export const emptyWork = (): WorkData => ({ proposals: [], activity: [], warnings: [] });
export const workProposalHref = (id: string, publication?: WorkPublication) =>
  publication ? `${publication.href}?proposal=${id}#proposals` : `/proposals/${id}`;

export function proposalActivity(row: WorkProposal, account: string): WorkActivity[] {
  const { proposal: p, repository, publication } = row;
  const href = workProposalHref(p.root.id, publication);
  const items: WorkActivity[] = [];
  const add = (event: SignedEvent, kind: WorkActivity['kind'], detail: string) => {
    if (event.pubkey !== account)
      items.push({
        id: event.id,
        kind,
        at: event.created_at,
        actor: event.pubkey,
        title: publication?.title ?? p.title,
        detail,
        href,
      });
  };
  if (row.incoming) {
    add(p.root, 'proposal', p.title);
    if (p.revision.id !== p.root.id) add(p.revision, 'revision', `Updated proposal: ${p.title}`);
  }
  if (
    p.statusEvent &&
    (p.status !== 'merged' || repository.maintainers.includes(p.statusEvent.pubkey))
  )
    add(
      p.statusEvent,
      p.status === 'merged' ? 'merged' : 'status',
      `Proposal ${p.status}: ${p.title}`,
    );
  for (const comment of p.comments) add(comment, 'comment', comment.content);
  return items;
}

export function socialActivity(
  publication: WorkPublication,
  events: SignedEvent[],
  manifests: Map<string, SignedEvent>,
  account: string,
): WorkActivity[] {
  const view = socialView(
    socialScope(publication.manifest),
    events.filter((e) => e.created_at <= Date.now() / 1000 + 60),
    manifests,
  );
  return [
    ...view.likes.map((event) => ({ event, kind: 'like' as const, detail: 'Liked your napplet' })),
    ...view.comments
      .filter((c) => !c.deleted)
      .map((event) => ({ event, kind: 'comment' as const, detail: event.content })),
  ]
    .filter(({ event }) => event.pubkey !== account)
    .map(({ event, kind, detail }) => ({
      id: event.id,
      kind,
      at: event.created_at,
      actor: event.pubkey,
      title: publication.title,
      detail,
      href: publication.href,
    }));
}

/** Read public activity from the same verified relay client as the rest of the shell.
 * Finite snapshots are intentionally labelled recent: relays are not a complete inbox. */
export async function readWork(
  client: ProtocolClient,
  account: string,
  publications: WorkPublication[],
  signal: AbortSignal,
  onUpdate?: (data: WorkData) => void,
): Promise<WorkData> {
  const result = emptyWork();
  const snapshot = (): WorkData => ({
    proposals: [...result.proposals].sort(
      (a, b) => b.proposal.revision.created_at - a.proposal.revision.created_at,
    ),
    activity: [...new Map(result.activity.map((a) => [a.id, a])).values()].sort(
      (a, b) => b.at - a.at || a.id.localeCompare(b.id),
    ),
    warnings: [...new Set(result.warnings)],
  });
  const update = () => {
    if (!signal.aborted) onUpdate?.(snapshot());
  };
  const relevant = publications.filter((p) => p.manifest.pubkey === account);
  const read = (filters: Filter[], hints: string[] = []) =>
    filters.length ? client.query(filters, hints, signal) : Promise.resolve([]);
  const incomingSources = new Map<string, WorkPublication>();
  for (const publication of relevant) {
    try {
      const source = tag(publication.manifest, 'source');
      if (source?.startsWith('nostr://'))
        incomingSources.set(repositoryRef(source).address, publication);
    } catch {
      /* A publication without Git still has social activity. */
    }
  }
  const proposals = async () => {
    const ownRoots = await read([{ kinds: [1617, 1618], authors: [account], limit: 100 }]).catch(
      () => {
        result.warnings.push('Your submitted proposals could not be refreshed.');
        return [];
      },
    );
    signal.throwIfAborted();
    const sourceRefs = new Set(incomingSources.keys());
    for (const root of ownRoots) {
      try {
        sourceRefs.add(repositoryRef(tag(root, 'a') ?? '').address);
      } catch {
        /* Invalid root. */
      }
    }
    // Limit concurrent relay subscriptions, not the number of repositories shown.
    const pending = [...sourceRefs];
    await Promise.all(
      Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (pending.length && !signal.aborted) {
          const address = pending.shift()!;
          try {
            const publication = incomingSources.get(address);
            // The coordinate groups proposals, but the original source carries
            // the Git relay hint needed to find its repository announcement.
            const ref = repositoryRef(publication ? tag(publication.manifest, 'source')! : address);
            const repo = await readRepository(
              client,
              nip19.naddrEncode({
                kind: 30617,
                pubkey: ref.pubkey,
                identifier: ref.identifier,
                relays: [...new Set([...ref.relays, ...(publication?.relays ?? [])])],
              }),
            );
            const roots = await read(
              [{ kinds: [1617, 1618], '#a': [address], limit: 100 }],
              repo.relays,
            );
            const ids = [
              ...new Set(
                [...roots, ...ownRoots.filter((e) => tag(e, 'a') === address)].map((e) => e.id),
              ),
            ];
            const related = ids.length
              ? await read(
                  [
                    { kinds: [1619, 1111], '#E': ids, limit: 500 },
                    { kinds: [1630, 1631, 1632, 1633], '#e': ids, limit: 500 },
                  ],
                  repo.relays,
                )
              : [];
            for (const proposal of proposalsFromEvents(repo, [
              ...new Map([...roots, ...ownRoots, ...related].map((e) => [e.id, e])).values(),
            ])) {
              const incoming = incomingSources.has(address) && repo.maintainers.includes(account);
              if (!incoming && proposal.root.pubkey !== account) continue;
              const row = {
                proposal,
                repository: repo,
                publication: incomingSources.get(address),
                incoming,
              };
              result.proposals.push(row);
              result.activity.push(...proposalActivity(row, account));
            }
          } catch {
            result.warnings.push('Some proposal repositories could not be read. Refresh to retry.');
          }
          update();
        }
      }),
    );
  };
  const socialActivityRead = async () => {
    if (relevant.length) {
      const social = await read(
        [
          { kinds: [7, 9735], '#p': [account], limit: 500 },
          { kinds: [1111], '#P': [account], limit: 500 },
          { kinds: [0], authors: [account], limit: 1 },
        ],
        relevant.flatMap((p) => p.relays),
      );
      const refs = [
        ...new Set(
          social.flatMap((e) =>
            e.tags
              .filter((t) => ['e', 'E'].includes(t[0]) && /^[a-f0-9]{64}$/.test(t[1]))
              .map((t) => t[1]),
          ),
        ),
      ];
      const related = await read(
        [
          ...(refs.length ? [{ ids: refs, kinds: [35129, 15129, 5129, 1111], limit: 500 }] : []),
          { kinds: [5], authors: [...new Set(social.map((e) => e.pubkey))], limit: 500 },
        ].filter((f) => !('authors' in f) || f.authors?.length),
      );
      const events = [...new Map([...social, ...related].map((e) => [e.id, e])).values()];
      const manifests = new Map(relevant.map((p) => [p.manifest.id, p.manifest]));
      for (const event of related.filter((e) => [35129, 15129, 5129].includes(e.kind))) {
        try {
          await validateManifest(event);
          manifests.set(event.id, event);
        } catch {
          /* Invalid manifest. */
        }
      }
      for (const publication of relevant)
        result.activity.push(...socialActivity(publication, events, manifests, account));
      update();
      let endpoint: Awaited<ReturnType<typeof resolveZapEndpoint>> | undefined;
      if (events.some((e) => e.kind === 9735)) {
        try {
          endpoint = await resolveZapEndpoint(account, events, undefined, signal);
        } catch {
          result.warnings.push(
            'Zap receipts could not be verified against your Lightning provider. Other activity is available.',
          );
        }
      }
      for (const publication of relevant) {
        if (endpoint) {
          const totals = await zapTotals(
            {
              scope: socialScope(publication.manifest),
              manifest: publication.manifest,
              relays: publication.relays,
            },
            { events, manifests },
            endpoint,
          );
          for (const receipt of totals.receipts.filter((r) => r.pubkey !== account)) {
            const event = events.find((e) => e.id === receipt.id)!;
            result.activity.push({
              id: receipt.id,
              kind: 'zap',
              at: event.created_at,
              actor: receipt.pubkey,
              title: publication.title,
              detail: `Zapped ${receipt.msats / 1000} sats`,
              href: publication.href,
            });
          }
        }
      }
    }
    update();
  };
  const outcomes = await Promise.allSettled([proposals(), socialActivityRead()]);
  if (outcomes[0].status === 'rejected')
    result.warnings.push('Proposal refresh did not finish. Refresh to retry.');
  if (outcomes[1].status === 'rejected')
    result.warnings.push('Social activity could not be fully refreshed. Refresh to retry.');
  if (signal.aborted)
    result.warnings.push(
      'Refresh timed out. Completed results are shown; refresh to retry the remaining reads.',
    );
  return snapshot();
}

/** Read markers are local, account-qualified, and keyed by event ID (not timestamps). */
export class WorkReadState {
  private read = new Set<string>();
  readonly key: string;
  constructor(
    account: string,
    private storage?: Pick<Storage, 'getItem' | 'setItem'>,
  ) {
    this.key = `napplet:work-read:v1:${account}`;
    try {
      const value = JSON.parse(storage?.getItem(this.key) ?? '[]');
      if (Array.isArray(value))
        this.read = new Set(
          value.filter((id) => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)),
        );
    } catch {
      /* Private browsing still supports read state for this visit. */
    }
  }
  unread(id: string) {
    return !this.read.has(id);
  }
  mark(ids: string[]) {
    ids.filter((id) => /^[a-f0-9]{64}$/.test(id)).forEach((id) => this.read.add(id));
    try {
      this.storage?.setItem(this.key, JSON.stringify([...this.read]));
    } catch {
      /* A full or disabled store must not break the activity view. */
    }
  }
}
