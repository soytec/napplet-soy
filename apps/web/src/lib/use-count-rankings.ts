import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicNapplet } from '../../../../packages/backend/src/public-model';
import { observeCountRankings, type CountRankings, type RankingValues } from './count-rankings';
import { retrySocialCounts, socialCountAvailability, socialCounts } from './social-counts';

export type Rankings = CountRankings & { retry: () => void; retryError: string };

/** Share COUNT requests with cards and retain received ranks during an explicit retry. */
export function useCountRankings(entries: PublicNapplet[] | null): Rankings {
  const [rankings, setRankings] = useState<CountRankings>({
    liked: [],
    commented: [],
    loading: true,
    status: { liked: 'loading', commented: 'loading' },
  });
  const [attempt, setAttempt] = useState(0),
    [retryError, setRetryError] = useState('');
  const retained = useRef<{ key?: string; values: RankingValues }>({ values: new Map() });
  const key = entries?.map((entry) => entry.revisionId).join(',');
  useEffect(() => {
    const counts = socialCounts();
    if (!counts || !entries) return;
    if (retained.current.key !== key) retained.current = { key, values: new Map() };
    const subscription = observeCountRankings(
      entries,
      counts,
      socialCountAvailability,
      retained.current.values,
    ).subscribe(setRankings);
    return () => subscription.unsubscribe();
  }, [key, attempt]);
  const retry = useCallback(() => {
    setRetryError('');
    setAttempt((value) => value + 1);
    void retrySocialCounts().catch(() => setRetryError('Couldn’t refresh counts. Try again.'));
  }, []);
  return { ...rankings, retry, retryError };
}
