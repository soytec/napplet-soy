import type { CountService, CountState } from 'applesauce-loaders/loaders';
import { Observable, Subscription } from 'rxjs';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';
import { countTarget, likesMetric } from '../../../../packages/client/src/social-counts';
import type { CountAvailability } from './social-counts';

export type RankingKind = 'liked' | 'commented';
export type RankingStatus = 'loading' | 'ready' | 'partial' | 'unavailable';
export type CountRankings = Record<RankingKind, PublicNapplet[]> & {
  status: Record<RankingKind, RankingStatus>;
  loading: boolean;
};
type MetricState = Pick<CountState, 'value' | 'refreshing' | 'failure'>;
export type RankingValues = Map<string, Partial<Record<RankingKind, MetricState>>>;

/** The wait only changes feedback. Late relay replies still update the same live ranking. */
export function observeCountRankings(
  entries: PublicNapplet[],
  counts: CountService,
  availability: Observable<CountAvailability>,
  retained: RankingValues = new Map(),
  feedbackAfterMs = 8000,
): Observable<CountRankings> {
  return new Observable((subscriber) => {
    let phase: CountAvailability = 'discovering',
      waiting = true;
    const values: RankingValues = new Map(
      entries.map((entry) => [
        entry.revisionId,
        Object.fromEntries(
          Object.entries(retained.get(entry.revisionId) ?? {}).map(([field, state]) => [
            field,
            { ...state, refreshing: true },
          ]),
        ),
      ]),
    );
    const subscriptions = new Subscription();
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const publish = () => {
      clearTimeout(publishTimer);
      publishTimer = undefined;
      const status = {} as CountRankings['status'];
      const ranks = {} as Record<RankingKind, PublicNapplet[]>;
      for (const field of ['liked', 'commented'] as const) {
        const metrics = entries.map((entry) => values.get(entry.revisionId)?.[field]);
        const known = metrics.filter((state) => state?.value !== undefined).length;
        const pending = metrics.some((state) => !state || state.refreshing);
        const failed = metrics.some((state) => state?.failure !== undefined);
        status[field] = !entries.length
          ? 'ready'
          : phase !== 'unavailable' && waiting && (phase === 'discovering' || pending)
            ? 'loading'
            : phase === 'available' && known === entries.length && !pending && !failed
              ? 'ready'
              : known
                ? 'partial'
                : 'unavailable';
        ranks[field] = entries
          .filter((entry) => (values.get(entry.revisionId)?.[field]?.value ?? 0) > 0)
          .sort(
            (a, b) =>
              values.get(b.revisionId)![field]!.value! - values.get(a.revisionId)![field]!.value! ||
              b.manifest.created_at - a.manifest.created_at ||
              a.revisionId.localeCompare(b.revisionId),
          )
          .slice(0, 12);
      }
      subscriber.next({ ...ranks, status, loading: Object.values(status).includes('loading') });
    };
    const schedule = () => {
      publishTimer ??= setTimeout(publish, 100);
    };
    const feedback = setTimeout(() => {
      waiting = false;
      publish();
    }, feedbackAfterMs);
    subscriptions.add(
      availability.subscribe((next) => {
        phase = next;
        schedule();
      }),
    );
    for (const entry of entries) {
      const handle = counts.event(countTarget(entry.manifest));
      for (const [field, metric] of [
        ['liked', handle.metric(likesMetric)],
        ['commented', handle.comments],
      ] as const) {
        const save = (state: MetricState) => {
          const previous = retained.get(entry.revisionId)?.[field];
          const value = { ...state, value: state.value ?? previous?.value };
          values.set(entry.revisionId, { ...values.get(entry.revisionId), [field]: value });
          retained.set(entry.revisionId, { ...retained.get(entry.revisionId), [field]: value });
          schedule();
        };
        subscriptions.add(
          metric.subscribe({
            next: save,
            error: () => save({ value: undefined, refreshing: false, failure: true }),
          }),
        );
      }
    }
    publish();
    return () => {
      clearTimeout(feedback);
      clearTimeout(publishTimer);
      subscriptions.unsubscribe();
    };
  });
}

export const rankingNotice = (status: RankingStatus) =>
  status === 'partial'
    ? 'Some counts are unavailable. Showing the counts already received.'
    : status === 'unavailable'
      ? 'Counts are unavailable from your relays right now.'
      : '';
