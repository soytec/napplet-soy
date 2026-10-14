import { z } from 'zod';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { readRelayUrl } from './relay-policy';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const authorsSchema = z.array(hex).max(64);
export const outboxPublishOptions = z
  .object({
    toOutbox: z.boolean().default(true),
    toInboxes: authorsSchema.default([]),
    relays: z.array(z.string().max(256)).max(8).default([]),
  })
  .strict();
export type RelayPurpose = 'author-read' | 'own-write' | 'recipient-inbox';
export type RelayPlan = {
  relays: string[];
  source: 'nip65' | 'cache' | 'fallback';
  missingAuthors: string[];
  /** Host-only coverage information; not a new OUTBOX wire field. */
  incomplete: boolean;
  limited: boolean;
};
type Discovery = (
  authors: string[],
  timeoutMs: number,
) => Promise<{
  events: SignedEvent[];
  incomplete: boolean;
}>;

/** NIP-65 policy shared by event reads and publication planning. No signing here. */
export class OutboxRelayPlanner {
  private closed = false;
  private cache = new Map<string, { event: SignedEvent; expires: number }>();
  constructor(
    private configured: string[],
    private discover: Discovery,
    private now: () => number = Date.now,
  ) {}
  close() {
    this.closed = true;
    this.cache.clear();
  }

  async resolve(input: string[], purpose: RelayPurpose, timeoutMs = 2000): Promise<RelayPlan> {
    if (this.closed) throw new Error('Outbox relay planner closed.');
    const authors = [...new Set(authorsSchema.parse(input))];
    const bounded = authors.slice(0, 16);
    const records = new Map<string, SignedEvent>();
    const uncached: string[] = [];
    for (const author of bounded) {
      const cached = this.cache.get(author);
      if (cached && cached.expires > this.now()) records.set(author, cached.event);
      else uncached.push(author);
    }
    let discoveryIncomplete = false;
    if (uncached.length) {
      const discovered = await this.discover(uncached, timeoutMs);
      if (this.closed) throw new Error('Outbox relay planner closed.');
      discoveryIncomplete = discovered.incomplete;
      for (const input of discovered.events) {
        let event: SignedEvent;
        try {
          event = verifiedEvent(input);
        } catch {
          continue;
        }
        if (
          event.kind !== 10002 ||
          !uncached.includes(event.pubkey) ||
          event.created_at > Math.floor(this.now() / 1000) + 600
        )
          continue;
        const previous = records.get(event.pubkey);
        if (
          !previous ||
          event.created_at > previous.created_at ||
          (event.created_at === previous.created_at && event.id < previous.id)
        )
          records.set(event.pubkey, event);
      }
      for (const author of uncached) {
        const event = records.get(author);
        if (!event) continue;
        // A timed-out discovery's observed record is usable, but must be refreshed
        // next time: cache reuse must not turn partial discovery into completeness.
        if (!discoveryIncomplete) {
          this.cache.delete(author);
          this.cache.set(author, { event, expires: this.now() + 60000 });
          while (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
        }
      }
    }
    const relays = new Set<string>();
    const missingAuthors = authors.slice(16);
    const marker = purpose === 'recipient-inbox' ? 'read' : 'write';
    for (const author of bounded) {
      let found = false;
      for (const tag of records.get(author)?.tags ?? []) {
        if (tag[0] !== 'r' || !tag[1] || (tag[2] && tag[2] !== marker)) continue;
        try {
          relays.add(readRelayUrl(tag[1], this.configured, true));
          found = true;
        } catch {
          /* Rejected metadata is never a connection grant. */
        }
      }
      if (!found) missingAuthors.push(author);
    }
    const hasNip65 = relays.size > 0;
    // Missing authors need fallback even if another author's list resolved.
    // Recipient inboxes never substitute unrelated discovery relays.
    if (!authors.length || (purpose !== 'recipient-inbox' && missingAuthors.length))
      for (const relay of this.configured) relays.add(readRelayUrl(relay, this.configured, true));
    const all = [...relays];
    return {
      relays: all.slice(0, 8),
      source: hasNip65 ? (uncached.length ? 'nip65' : 'cache') : 'fallback',
      missingAuthors,
      incomplete: discoveryIncomplete || missingAuthors.length > 0 || all.length > 8,
      limited: authors.length > 16 || all.length > 8,
    };
  }

  /** Preflight every required target before a caller signs an event. */
  async publication(pubkey: string, input: unknown, timeoutMs = 2000) {
    if (this.closed) throw new Error('Outbox relay planner closed.');
    hex.parse(pubkey);
    const options = outboxPublishOptions.parse(input ?? {});
    const selected = new Set(options.relays.map((r) => readRelayUrl(r, this.configured, true)));
    if (options.toOutbox) {
      const own = await this.resolve([pubkey], 'own-write', timeoutMs);
      // Missing own metadata may use fallback, but truncated/discovery-failed
      // known plans cannot silently omit requested destinations.
      if (own.limited || (own.incomplete && !own.missingAuthors.length))
        throw new Error('Own outbox relay discovery is incomplete. Retry before publishing.');
      own.relays.forEach((relay) => selected.add(relay));
    }
    if (options.toInboxes.length) {
      const inbox = await this.resolve(options.toInboxes, 'recipient-inbox', timeoutMs);
      if (inbox.missingAuthors.length)
        throw new Error(
          `Required recipient inbox relay lists unavailable for ${inbox.missingAuthors.length} author(s). Retry relay discovery.`,
        );
      if (inbox.incomplete)
        throw new Error(
          'Required recipient inbox relay discovery is incomplete or exceeds the relay limit. Reduce recipients or retry.',
        );
      inbox.relays.forEach((relay) => selected.add(relay));
    }
    if (!selected.size)
      throw new Error(
        'No publish destinations. Select an outbox, recipient inbox or explicit relay.',
      );
    if (selected.size > 8)
      throw new Error(
        'Publish fanout exceeds eight relays. Reduce destinations; no targets were dropped.',
      );
    return [...selected];
  }
}
