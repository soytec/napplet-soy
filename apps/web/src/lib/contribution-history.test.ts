import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { contributionHistory } from './contribution-history';
import {
  proposalsFromEvents,
  repositoryFromEvent,
  repositoryRef,
} from '../../../../packages/collaboration/src/protocol';
import type { SignedEvent } from '../../../../packages/protocol/src';
const owner = new Uint8Array(32).fill(1),
  author = new Uint8Array(32).fill(2);
const event = (kind: number, time: number, tags: string[][], key = owner) =>
  finalizeEvent({ kind, created_at: time, tags, content: '' }, key);
const release = (time: number, commit: string, identifier = 'game') =>
  event(35129, time, [
    ['d', identifier],
    ['source-commit', commit],
  ]);
const a = 'a'.repeat(40),
  b = 'b'.repeat(40),
  c = 'c'.repeat(40);
const announcement = event(30617, 1, [['d', 'game']]);
const repo = repositoryFromEvent(repositoryRef(`30617:${announcement.pubkey}:game`), announcement);
const root = event(
  1618,
  20,
  [
    ['a', repo.address],
    ['c', b],
    ['merge-base', a],
    ['subject', 'Make it better'],
  ],
  author,
);
const status = event(1631, 30, [
  ['e', root.id, '', 'root'],
  ['e', root.id, '', 'reply'],
  ['a', repo.address],
  ['merge-commit', c],
]);
const proposal = (extra: SignedEvent[] = []) => proposalsFromEvents(repo, [root, ...extra]);

test('verified releases, contributor and signed merge stay separate and in chronological columns', () => {
  const first = release(10, a),
    current = release(40, 'd'.repeat(40));
  const result = contributionHistory(
    current,
    [first, current, release(5, a, 'another-game')],
    proposal([status]),
  );
  expect(result.nodes.map((n) => n.kind)).toEqual(['release', 'proposal', 'merge', 'release']);
  expect(result.edges).toContainEqual({ from: first.id, to: root.id, kind: 'branch' });
  expect(result.edges).toContainEqual({ from: root.id, to: `merge:${status.id}`, kind: 'merge' });
  expect(result.nodes.find((n) => n.id === root.id)?.event?.pubkey).toBe(root.pubkey);
  expect(result.nodes.find((n) => n.kind === 'merge')?.event?.pubkey).toBe(current.pubkey);
  expect(result.nodes[0].title).toBe('First known release'); // never invent "initial commit"
  expect(result.nodes.at(-1)?.current).toBe(true);
  expect(result.edges.find((e) => e.to === current.id)?.kind).toBe('timeline'); // different source commit, not a claimed merge parent
});

test('unavailable bases are explicit gaps, not attributed or payable initial commits', () => {
  const current = release(40, c),
    result = contributionHistory(current, [], proposal());
  const missing = result.nodes.find((n) => n.kind === 'source')!;
  expect(missing.commit).toBe(a);
  expect(missing.event).toBeUndefined();
  expect(result.edges).toContainEqual({
    from: missing.id,
    to: root.id,
    kind: 'branch',
    uncertain: true,
  });
  expect(result.nodes.some((n) => n.kind === 'merge')).toBe(false);
});

test('unauthorized merge claims never make a merge edge; closed and patch proposals remain visible', () => {
  const outsider = event(1631, 30, [['e', root.id, '', 'root']], new Uint8Array(32).fill(3));
  const closed = event(1632, 31, [['e', root.id, '', 'root']]);
  const patch = event(
    1617,
    22,
    [
      ['a', repo.address],
      ['t', 'root'],
      ['subject', 'A patch'],
    ],
    author,
  );
  const rows = proposalsFromEvents(repo, [root, outsider, patch, closed]);
  const result = contributionHistory(release(40, c), [], rows);
  expect(result.nodes.filter((n) => n.kind === 'proposal')).toHaveLength(2);
  expect(result.nodes.some((n) => n.kind === 'merge')).toBe(false);
  expect(result.nodes.find((n) => n.id === root.id)?.proposal?.status).toBe('closed');
});

test('equal timestamps, input order and overlapping branches produce stable forward paths and separate lanes', () => {
  const sameTime = release(20, a);
  const root2 = event(
    1618,
    20,
    [
      ['a', repo.address],
      ['c', 'd'.repeat(40)],
      ['merge-base', a],
    ],
    author,
  );
  const rows = proposalsFromEvents(repo, [root, root2]);
  const result = contributionHistory(sameTime, [], rows);
  const reversed = contributionHistory(sameTime, [], [...rows].reverse());
  expect(result).toEqual(reversed);
  expect(new Set(result.nodes.filter((n) => n.kind === 'proposal').map((n) => n.lane)).size).toBe(
    2,
  );
  for (const e of result.edges)
    expect(result.nodes.find((n) => n.id === e.from)!.column).toBeLessThan(
      result.nodes.find((n) => n.id === e.to)!.column,
    );
});
