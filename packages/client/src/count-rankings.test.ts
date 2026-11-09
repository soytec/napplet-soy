import { expect, test } from 'bun:test';
import { BehaviorSubject } from 'rxjs';
import type { CountService, CountState } from 'applesauce-loaders/loaders';
import type { PublicNapplet } from '../../backend/src/public-model';
import fixtures from '../../backend/data/catalog.json';
import {
  observeCountRankings,
  rankingNotice,
  type CountRankings,
  type RankingValues,
} from '../../../apps/web/src/lib/count-rankings';
import type { CountAvailability } from '../../../apps/web/src/lib/social-counts';

const entries = fixtures.slice(0, 2).map((entry) => ({
  manifest: entry.current,
  revisionId: entry.current.id,
})) as PublicNapplet[];
const sample = (value?: number, failure?: boolean): CountState => ({
  value,
  refreshing: value === undefined && !failure,
  failure,
  fresh: value !== undefined,
  observedAt: value !== undefined ? Date.now() : undefined,
  origin: undefined,
  approximate: false,
});
function fixture(phase: CountAvailability = 'available') {
  const availability = new BehaviorSubject(phase);
  const likes = entries.map(() => new BehaviorSubject(sample()));
  const comments = entries.map(() => new BehaviorSubject(sample()));
  const counts = {
    event: (target: { id: string }) => {
      const index = entries.findIndex((entry) => entry.manifest.id === target.id);
      return { metric: () => likes[index], comments: comments[index] };
    },
  } as unknown as CountService;
  let state: CountRankings;
  const retained: RankingValues = new Map();
  const observe = () =>
    observeCountRankings(entries, counts, availability, retained, 20).subscribe((value) => {
      state = value;
    });
  return { availability, likes, comments, retained, observe, state: () => state };
}
const settle = () => Bun.sleep(130);

test('unsupported relays are unavailable instead of an endless loading or a zero count', async () => {
  const f = fixture('unavailable'),
    sub = f.observe();
  try {
    expect(f.state().loading).toBe(false);
    expect(f.state().status).toEqual({ liked: 'unavailable', commented: 'unavailable' });
    expect(rankingNotice(f.state().status.liked)).toContain('unavailable');
    expect(f.retained.get(entries[0].revisionId)?.liked?.value).toBeUndefined();
  } finally {
    sub.unsubscribe();
  }
});

test('slow COUNT requests stop showing loading but stay subscribed for late replies', async () => {
  const f = fixture(),
    sub = f.observe();
  try {
    expect(f.state().loading).toBe(true);
    await settle();
    expect(f.state().status.liked).toBe('unavailable');
    expect(f.likes[0].observed).toBe(true);
    f.likes[0].next(sample(7));
    f.likes[1].next(sample(0));
    await settle();
    expect(f.state().status.liked).toBe('ready');
    expect(f.state().liked).toEqual([entries[0]]);
    expect(f.state().status.commented).toBe('unavailable');
  } finally {
    sub.unsubscribe();
  }
  expect(f.likes[0].observed).toBe(false);
});

test('partial answers retain real ranks and counted zeroes remain different from unknown', async () => {
  const f = fixture();
  f.likes[0].next(sample(3));
  f.likes[1].next(sample(undefined, true));
  f.comments[0].next(sample(0));
  f.comments[1].next(sample(0));
  const sub = f.observe();
  try {
    expect(f.state().status).toEqual({ liked: 'partial', commented: 'ready' });
    expect(f.state().liked).toEqual([entries[0]]);
    expect(f.state().commented).toEqual([]);
    expect(rankingNotice(f.state().status.liked)).toContain('already received');
    expect(rankingNotice(f.state().status.commented)).toBe('');
  } finally {
    sub.unsubscribe();
  }
});

test('retry retains known ranks while loading and replaces them when new answers arrive', async () => {
  const f = fixture();
  f.likes[0].next(sample(6));
  f.likes[1].next(sample(1));
  let sub = f.observe();
  expect(f.state().liked).toEqual(entries);
  sub.unsubscribe();
  f.availability.next('discovering');
  f.likes.forEach((subject) => subject.next(sample()));
  sub = f.observe();
  try {
    expect(f.state().status.liked).toBe('loading');
    expect(f.state().liked).toEqual(entries);
    f.availability.next('unavailable');
    await settle();
    expect(f.state().status.liked).toBe('partial');
    expect(f.state().liked).toEqual(entries);
    f.availability.next('available');
    f.likes[0].next(sample(0));
    f.likes[1].next(sample(10));
    await settle();
    expect(f.state().status.liked).toBe('ready');
    expect(f.state().liked).toEqual([entries[1]]);
  } finally {
    sub.unsubscribe();
  }
});
