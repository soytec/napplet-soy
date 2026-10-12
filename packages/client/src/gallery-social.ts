import type { Filter } from 'nostr-tools';
import type { SignedEvent } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { socialScope, socialView, targetManifest } from '../../protocol/src/social';
import { latestProfile } from '../../protocol/src/profile';
import type { PublicNapplet } from '../../backend/src/public-model';
import type { GallerySocialData, SocialCounts } from '../../backend/src/gallery-social';
import type { ProtocolClient } from './nostr';
import { resolveZapEndpoint, zapTotals, type ZapEndpoint } from './zaps';
import type { ZapTotalsStore } from './zap-totals';

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
type Counts = Omit<SocialCounts, 'liked'> & { likes: string[] };

/** Gallery summaries share relay reads; full conversation/profile hydration belongs to details. */
export class GallerySocialReader {
  private counts = new Map<string, Counts>();
  private endpoints = new Map<string, { until: number; value: Promise<ZapEndpoint> }>();
  private cursor = 0;
  constructor(
    private client: ProtocolClient,
    private loadEndpoint = resolveZapEndpoint,
    private zapCounts?: ZapTotalsStore,
    private allowSocialAuthor: (pubkey: string) => boolean = () => true,
    private communityOnly = false,
  ) {}

  private endpoint(pubkey: string, events: SignedEvent[]) {
    const key = `${pubkey}:${latestProfile(events, pubkey)?.id ?? ''}`;
    const cached = this.endpoints.get(key);
    if (cached && cached.until > Date.now()) return cached.value;
    const value = this.loadEndpoint(pubkey, events);
    this.endpoints.set(key, { until: Date.now() + 60000, value });
    while (this.endpoints.size > 256) this.endpoints.delete(this.endpoints.keys().next().value!);
    return value;
  }

  async read(
    entries: PublicNapplet[],
    viewer?: string,
    signal = AbortSignal.timeout(30000),
    onUpdate?: (data: GallerySocialData) => void,
  ): Promise<GallerySocialData> {
    signal.throwIfAborted();
    entries = entries.filter((n) => this.client.allowed(n.manifest));
    let running = true;
    const snapshot = (): GallerySocialData => {
      const rank = (field: 'likeCount' | 'commentCount' | 'msats') =>
        entries
          .filter((n) => (this.counts.get(socialScope(n.manifest).key)?.[field] ?? 0) > 0)
          .sort(
            (a, b) =>
              (this.counts.get(socialScope(b.manifest).key)?.[field] ?? 0) -
                (this.counts.get(socialScope(a.manifest).key)?.[field] ?? 0) ||
              b.manifest.created_at - a.manifest.created_at ||
              a.revisionId.localeCompare(b.revisionId),
          )
          .slice(0, 12);
      return {
        counts: Object.fromEntries(
          entries.flatMap((n) => {
            const count = this.counts.get(socialScope(n.manifest).key);
            if (!count) return [];
            const { likes, ...totals } = count;
            return [[n.revisionId, { ...totals, liked: !!viewer && likes.includes(viewer) }]];
          }),
        ),
        rankings: {
          liked: rank('likeCount'),
          commented: rank('commentCount'),
          zapped: rank('msats'),
        },
        refreshing: running || entries.some((n) => !this.counts.has(socialScope(n.manifest).key)),
      };
    };
    const emit = () => {
      if (!signal.aborted) onUpdate?.(snapshot());
    };
    // Immediately reuse known counts on navigation/filter/account changes.
    emit();
    const batch = Array.from(
      { length: Math.min(64, entries.length) },
      (_, i) => entries[(this.cursor + i) % entries.length],
    );
    this.cursor += batch.length;
    // Share compatible relay sets without dropping a publication's own hints to fit a batch.
    const groups: { entries: PublicNapplet[]; hints: string[] }[] = [];
    for (const n of batch) {
      const hints = [...new Set([...n.relays, ...this.client.relays()])].slice(0, 8);
      const last = groups.at(-1);
      const combined = [...new Set([...(last?.hints ?? []), ...hints])];
      if (last && last.entries.length < 32 && combined.length <= 8) {
        last.entries.push(n);
        last.hints = combined;
      } else groups.push({ entries: [n], hints });
    }
    let next = 0;
    try {
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(3, groups.length) }, async () => {
          while (next < groups.length) {
            signal.throwIfAborted();
            const group = groups[next++];
            await this.readGroup(group.entries, group.hints, signal, emit);
          }
        }),
      );
      const failed = results.find((r) => r.status === 'rejected');
      if (failed?.status === 'rejected' && results.every((r) => r.status === 'rejected'))
        throw failed.reason;
    } finally {
      running = false;
      while (this.counts.size > 1000) this.counts.delete(this.counts.keys().next().value!);
    }
    signal.throwIfAborted();
    emit();
    return snapshot();
  }

  private async readGroup(
    group: PublicNapplet[],
    hints: string[],
    signal: AbortSignal,
    emit: () => void,
  ) {
    await Promise.all(group.map((n) => validateManifest(n.manifest)));
    const scopes = group.map((n) => socialScope(n.manifest));
    const ids = group.map((n) => n.revisionId);
    const addresses = [...new Set(scopes.flatMap((s) => (s.address ? [s.address] : [])))];
    const pinned = scopes.filter((s) => !s.address).map((s) => s.eventId);
    const filters: Filter[] = [
      { kinds: [7, 9735], '#e': ids, limit: 500 },
      ...(addresses.length
        ? [
            { kinds: [1111], '#A': addresses, limit: 500 },
            { kinds: [7, 9735], '#a': addresses, limit: 500 },
          ]
        : []),
      ...(pinned.length ? [{ kinds: [1111], '#E': pinned, limit: 500 }] : []),
    ];
    const raw = new Map(
      this.client.store
        .getByFilters(filters)
        .slice(0, 1000)
        .map((e) => [e.id, e]),
    );
    const manifests = new Map(group.map((n) => [n.revisionId, n.manifest]));
    const allowedEvents = () =>
      [...raw.values()].filter(
        (event) =>
          this.client.allowed(event) && (event.kind === 0 || this.allowSocialAuthor(event.pubkey)),
      );
    let complete = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = undefined;
      if (signal.aborted) return;
      const events = allowedEvents();
      for (const [i, n] of group.entries()) {
        const view = socialView(scopes[i], events, manifests);
        const previous = this.counts.get(socialScope(n.manifest).key);
        // Until a relay has answered, absent data remains unknown, not a fabricated zero.
        if (!complete && !previous && !view.likes.length && !view.comments.length) continue;
        this.counts.set(socialScope(n.manifest).key, {
          likeCount: view.likeCount,
          likes: view.likes.map((e) => e.pubkey),
          commentCount: view.comments.filter((e) => !e.deleted).length,
          zapCount: previous?.zapCount ?? null,
          msats: previous?.msats ?? null,
        });
      }
      emit();
    };
    const cachedAuthors = new Set<string>();
    const add = (event: SignedEvent) => {
      if (signal.aborted || raw.size >= 2000 || !this.client.allowed(event)) return;
      raw.set(event.id, event);
      if ([7, 1111].includes(event.kind) && !cachedAuthors.has(event.pubkey)) {
        cachedAuthors.add(event.pubkey);
        for (const deletion of this.client
          .cached([{ kinds: [5], authors: [event.pubkey] }])
          .slice(0, 200)) {
          if (raw.size < 2000 && this.client.allowed(deletion)) raw.set(deletion.id, deletion);
        }
      }
      // Coalesce a relay's event burst into one render, without waiting for EOSE.
      timer ??= setTimeout(update, 40);
    };
    const dependencies = () => {
      const refs = [
        ...new Set(
          [...raw.values()].flatMap((e) =>
            e.tags
              .filter((t) => ['e', 'E'].includes(t[0]) && /^[a-f0-9]{64}$/.test(t[1]))
              .map((t) => t[1]),
          ),
        ),
      ]
        .filter((id) => !manifests.has(id) && !raw.has(id))
        .slice(0, 128);
      const authors = [
        ...new Set(
          [...raw.values()].filter((e) => [7, 1111].includes(e.kind)).map((e) => e.pubkey),
        ),
      ].slice(0, 256);
      const zapAuthors = group
        .filter((n, i) =>
          [...raw.values()].some(
            (e) =>
              e.kind === 9735 &&
              (e.tags.some((t) => t[0] === 'a' && t[1] === scopes[i].address) ||
                e.tags.some((t) => t[0] === 'e' && t[1] === n.revisionId)),
          ),
        )
        .map((n) => n.pubkey);
      return [
        ...chunks(refs, 64).map((ids) => ({ ids, kinds: [35129, 15129, 5129, 1111], limit: 200 })),
        ...chunks(authors, 64).map((authors) => ({ kinds: [5], authors, limit: 200 })),
        ...(zapAuthors.length
          ? [{ kinds: [0], authors: [...new Set(zapAuthors)], limit: 64 }]
          : []),
      ];
    };
    const validateReferences = async () => {
      for (const e of raw.values())
        if ([35129, 15129, 5129].includes(e.kind) && !manifests.has(e.id)) {
          try {
            await validateManifest(e);
            manifests.set(e.id, e);
          } catch {}
        }
    };
    try {
      // Cached deletions/revisions must apply before rendering cached reactions.
      const cached = dependencies();
      if (cached.length) this.client.cached(cached).forEach(add);
      await validateReferences();
      update();
      await this.client.query(filters, hints, signal, add);
      complete = true;
      update();
      const related = dependencies();
      if (related.length) {
        await this.client.query(related, hints, signal, add);
        await validateReferences();
      }
      update();
      // Receipt verification never gates likes/comments, and empty threads need no LNURL request.
      let next = 0;
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < group.length) {
            const i = next++,
              n = group[i],
              scope = scopes[i];
            signal.throwIfAborted();
            let totals: { zapCount: number; msats: number } | null = null;
            if (!n.manifest.tags.some((t) => t[0] === 'zap')) {
              const events = allowedEvents().filter(
                (e) => e.kind !== 9735 || targetManifest(e, scope, manifests),
              );
              if (!events.some((e) => e.kind === 9735))
                totals = this.zapCounts?.observe(scope.key, []) ?? { zapCount: 0, msats: 0 };
              else
                try {
                  const verified = await zapTotals(
                    { scope, manifest: n.manifest, relays: hints },
                    { events, manifests },
                    await this.endpoint(n.pubkey, events),
                  );
                  const receipts = this.communityOnly
                    ? verified.receipts.filter((receipt) => this.allowSocialAuthor(receipt.pubkey))
                    : verified.receipts;
                  totals = this.zapCounts?.observe(scope.key, receipts) ?? {
                    zapCount: receipts.length,
                    msats: receipts.reduce((sum, receipt) => sum + receipt.msats, 0),
                  };
                } catch {}
            }
            signal.throwIfAborted();
            const value = this.counts.get(socialScope(n.manifest).key)!;
            this.counts.set(socialScope(n.manifest).key, {
              ...value,
              zapCount: totals?.zapCount ?? null,
              msats: totals?.msats ?? null,
            });
            emit();
          }
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
