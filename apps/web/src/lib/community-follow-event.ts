import { verifySignature } from '../../../../packages/protocol/src/verify';
import type { NostrEvent } from 'nostr-tools';

// Contact lists can legitimately have far more tags than a napplet event. Keep
// their own bounds so the graph can read large lists without relaxing admission
// limits used by the rest of the site.
export function verifiedFollowEvent(input: unknown): NostrEvent {
  if (!input || typeof input !== 'object') throw new Error('Invalid contact list');
  const event = input as NostrEvent;
  if (
    event.kind !== 3 ||
    !Array.isArray(event.tags) ||
    event.tags.length > 20_000 ||
    typeof event.content !== 'string' ||
    event.content.length > 65_536 ||
    !event.tags.every(
      (tag) =>
        Array.isArray(tag) &&
        tag.length <= 16 &&
        tag.every((value) => typeof value === 'string' && value.length <= 4_096),
    ) ||
    JSON.stringify(event).length > 1_048_576 ||
    !verifySignature(event)
  )
    throw new Error('Invalid contact list');
  return event;
}
