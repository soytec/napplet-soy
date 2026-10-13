import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { verifiedEvent } from '../../../../packages/protocol/src';
import { verifiedFollowEvent } from './community-follow-event';

test('accepts a signed contact list with hundreds of follows', () => {
  const event = finalizeEvent(
    {
      kind: 3,
      created_at: 1,
      content: '',
      tags: Array.from({ length: 423 }, (_, index) => ['p', index.toString(16).padStart(64, '0')]),
    },
    generateSecretKey(),
  );
  const wire = JSON.parse(JSON.stringify(event));
  expect(() => verifiedEvent(wire)).toThrow();
  expect(verifiedFollowEvent(wire).tags).toHaveLength(423);
  expect(() => verifiedFollowEvent({ ...JSON.parse(JSON.stringify(wire)), content: 'tampered' })).toThrow();
});
