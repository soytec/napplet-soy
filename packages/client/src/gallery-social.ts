import type { Filter } from 'nostr-tools';
import type { SignedEvent } from '../../protocol/src';
import { validateManifest } from '../../protocol/src/manifest';
import { socialScope, socialView, targetManifest } from '../../protocol/src/social';
import { latestProfile } from '../../protocol/src/profile';
import type { PublicNapplet } from '../../backend/src/public-model';
import type { ProtocolClient } from './nostr';
import { resolveZapEndpoint, zapTotals, type ZapEndpoint } from './zaps';
import type { ZapTotalsStore } from './zap-totals';

const chunks = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
type Zaps = { zapCount: number | null; msats: number | null };
export type GalleryCardState = Zaps & { liked: boolean };
/** Like and comment totals come from NIP-45 COUNT; this covers what COUNT cannot answer. */
export type GalleryZapData = {
  counts: Record<string, GalleryCardState>;
  zapped: PublicNapplet[];
  refreshing: boolean;
};

/** Gallery summaries share relay reads for verified zap totals and the viewer's own likes. */
export class GallerySocialReader {
  private zaps = new Map<string, Zaps>();
  private endpoints = new Map<string, { until: number; value: Promise<ZapEndpoint> }>();
  private cursor = 0;
  constructor(
    private client: ProtocolClient,
    private loadEndpoint = resolveZapEndpoint,
    private zapCounts?: ZapTotalsStore,
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

  /** The viewer's likes and deletions are cached by the shared store, so this is synchronous. */
  private liked(n: PublicNapplet, viewer: string) {
    const scope = socialScope(n.manifest);
    const events = this.client
      .cached([
        { kinds: [7], authors: [viewer], '#e': [n.revisionId] },
        ...(scope.address ? [{ kinds: [7], authors: [viewer], '#a': [scope.address] }] : []),
        { kinds: [5], authors: [viewer] },
      ])
      .filter(this.client.allowed);
    return socialView(scope, events, new Map([[n.revisionId, n.manifest]])).likes.length > 0;
  }

  /** Reads up to 64 entries per call, visible cards first, rotating through the rest. */
  async read(
    entries: PublicNapplet[],
    viewer?: string,
    signal = AbortSignal.timeout(30000),
    onUpdate?: (data: GalleryZapData) => void,
    priority: ReadonlySet<string> = new Set(),
  ): Promise<GalleryZapData> {
    signal.throwIfAborted();
    entries = entries.filter((n) => this.client.allowed(n.manifest));
    let running = true;
    const snapshot = (): GalleryZapData => ({
      counts: Object.fromEntries(
        entries.flatMap((n) => {
          const zaps = this.zaps.get(socialScope(n.manifest).key);
          const liked = !!viewer && this.liked(n, viewer);
          if (!zaps && !liked) return [];
          return [[n.revisionId, { zapCount: null, msats: null, ...zaps, liked }]];
        }),
      ),
      zapped: entries
        .filter((n) => (this.zaps.get(socialScope(n.manifest).key)?.msats ?? 0) > 0)
        .sort(
          (a, b) =>
            (this.zaps.get(socialScope(b.manifest).key)?.msats ?? 0) -
              (this.zaps.get(socialScope(a.manifest).key)?.msats ?? 0) ||
            b.manifest.created_at - a.manifest.created_at ||
            a.revisionId.localeCompare(b.revisionId),
        )
        .slice(0, 12),
      refreshing: running || entries.some((n) => !this.zaps.has(socialScope(n.manifest).key)),
    });
    const emit = () => {
      if (!signal.aborted) onUpdate?.(snapshot());
    };
    // Immediately reuse known totals on navigation/filter/account changes.
    emit();
    const visible = entries.filter((n) => priority.has(n.revisionId));
    const rest = entries.filter((n) => !priority.has(n.revisionId));
    const batch = [
      ...visible.slice(0, 64),
      ...Array.from(
        { length: Math.min(64 - Math.min(64, visible.length), rest.length) },
        (_, i) => rest[(this.cursor + i) % rest.length],
      ),
    ];
    this.cursor += batch.length - Math.min(64, visible.length);
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
            await this.readGroup(group.entries, group.hints, viewer, signal, emit);
          }
        }),
      );
      const failed = results.find((r) => r.status === 'rejected');
      if (failed?.status === 'rejected' && results.every((r) => r.status === 'rejected'))
        throw failed.reason;
    } finally {
      running = false;
      while (this.zaps.size > 1000) this.zaps.delete(this.zaps.keys().next().value!);
    }
    signal.throwIfAborted();
    emit();
    return snapshot();
  }

  private async readGroup(
    group: PublicNapplet[],
    hints: string[],
    viewer: string | undefined,
    signal: AbortSignal,
    emit: () => void,
  ) {
    await Promise.all(group.map((n) => validateManifest(n.manifest)));
    const scopes = group.map((n) => socialScope(n.manifest));
    const ids = group.map((n) => n.revisionId);
    const addresses = [...new Set(scopes.flatMap((s) => (s.address ? [s.address] : [])))];
    const filters: Filter[] = [
      { kinds: [9735], '#e': ids, limit: 500 },
      ...(addresses.length ? [{ kinds: [9735], '#a': addresses, limit: 500 }] : []),
      ...(viewer
        ? [
            { kinds: [7], authors: [viewer], '#e': ids, limit: 200 },
            ...(addresses.length
              ? [{ kinds: [7], authors: [viewer], '#a': addresses, limit: 200 }]
              : []),
            { kinds: [5], authors: [viewer], limit: 200 },
          ]
        : []),
    ];
    const raw = new Map(
      this.client
        .cached(filters)
        .slice(0, 1000)
        .map((e) => [e.id, e]),
    );
    const manifests = new Map(group.map((n) => [n.revisionId, n.manifest]));
    const allowedEvents = () => [...raw.values()].filter(this.client.allowed);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const add = (event: SignedEvent) => {
      if (signal.aborted || raw.size >= 2000 || !this.client.allowed(event)) return;
      raw.set(event.id, event);
      // Coalesce a relay's event burst into one render, without waiting for EOSE.
      timer ??= setTimeout(() => {
        timer = undefined;
        emit();
      }, 40);
    };
    const dependencies = () => {
      const receipts = [...raw.values()].filter((e) => e.kind === 9735);
      const refs = [
        ...new Set(
          receipts.flatMap((e) =>
            e.tags.filter((t) => t[0] === 'e' && /^[a-f0-9]{64}$/.test(t[1])).map((t) => t[1]),
          ),
        ),
      ]
        .filter((id) => !manifests.has(id) && !raw.has(id))
        .slice(0, 128);
      const zapAuthors = group
        .filter((n, i) =>
          receipts.some(
            (e) =>
              e.tags.some((t) => t[0] === 'a' && t[1] === scopes[i].address) ||
              e.tags.some((t) => t[0] === 'e' && t[1] === n.revisionId),
          ),
        )
        .map((n) => n.pubkey);
      return [
        ...chunks(refs, 64).map((ids) => ({ ids, kinds: [35129, 15129, 5129], limit: 200 })),
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
      await this.client.query(filters, hints, signal, add);
      emit();
      const related = dependencies();
      if (related.length) {
        await this.client.query(related, hints, signal, add);
        await validateReferences();
      }
      // Receipt verification is per napplet; threads without receipts need no LNURL request.
      let next = 0;
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          while (next < group.length) {
            const i = next++,
              n = group[i],
              scope = scopes[i];
            signal.throwIfAborted();
            let totals: Zaps = { zapCount: null, msats: null };
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
                  totals = this.zapCounts?.observe(scope.key, verified.receipts) ?? verified;
                } catch {}
            }
            signal.throwIfAborted();
            this.zaps.set(scope.key, totals);
            emit();
          }
        }),
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
