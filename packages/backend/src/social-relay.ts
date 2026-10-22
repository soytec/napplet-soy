import { RelayPool, type RelayOptions } from 'applesauce-relay';
import { take, takeUntil, takeWhile, timer } from 'rxjs';
import { matchFilters, type Filter } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { PreviewWebSocket, previewRelayUrl } from './preview-relay';
import { CommunityError } from '../../community/src/store';
export interface SocialRelay {
  query(relays: string[], filters: Filter[]): Promise<SignedEvent[]>;
  publish(relays: string[], event: SignedEvent): Promise<string[]>;
}
function safeRelays(values: string[]) {
  const local = new Set((process.env.SPACE_INDEX_RELAYS ?? '').split(','));
  return [...new Set(values)]
    .filter((value) => {
      try {
        const u = new URL(value);
        if (
          local.has(value) &&
          u.protocol === 'ws:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) &&
          !u.username &&
          !u.password
        )
          return true;
        previewRelayUrl(value);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 8);
}
function poolFor(relays: string[]) {
  // Local addresses come only from the operator's explicit configuration.
  const local = relays.every((r) => r.startsWith('ws:'));
  return new RelayPool(
    local ? {} : { WebSocket: PreviewWebSocket as unknown as RelayOptions['WebSocket'] },
  );
}
export const socialRelay: SocialRelay = {
  async query(urls, filters) {
    const found = new Map<string, SignedEvent>();
    let completed = 0;
    await Promise.all(
      safeRelays(urls).map(async (relay) => {
        const pool = poolFor([relay]);
        try {
          await new Promise<void>((done) => {
            pool
              .req([relay], filters)
              .pipe(
                takeWhile((m) => m.type !== 'EOSE' && m.type !== 'CLOSED', true),
                take(350),
                takeUntil(timer(2500)),
              )
              .subscribe({
                next: (m) => {
                  if (m.type === 'EOSE') completed++;
                  if (m.type === 'EVENT' && found.size < 600)
                    try {
                      const e = verifiedEvent(m.event);
                      if (
                        e.created_at <= Date.now() / 1000 + 60 &&
                        JSON.stringify(e).length <= 16000 &&
                        matchFilters(filters, e)
                      )
                        found.set(e.id, e);
                    } catch {}
                },
                error: () => done(),
                complete: done,
              });
          });
        } finally {
          pool.close();
        }
      }),
    );
    if (!completed && !found.size)
      throw new CommunityError('No relay could be reached. Please try refreshing shortly.', 502);
    return [...found.values()];
  },
  async publish(urls, event) {
    const accepted: string[] = [];
    await Promise.all(
      safeRelays(urls).map(async (relay) => {
        const pool = poolFor([relay]);
        try {
          const results = await pool.publish([relay], event, { timeout: 5000, retries: false });
          if (results.some((r) => r.ok)) accepted.push(relay);
        } catch {
        } finally {
          pool.close();
        }
      }),
    );
    if (!accepted.length)
      throw new CommunityError(
        'No relay acknowledged this event. It may have arrived; retrying will send the exact same event.',
        502,
      );
    return accepted;
  },
};
