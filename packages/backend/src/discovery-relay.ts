import { RelayPool, type RelayOptions } from 'applesauce-relay';
import { matchFilter, type Filter } from 'nostr-tools';
import { take, takeUntil, takeWhile, timer, fromEvent } from 'rxjs';
import { PreviewWebSocket, previewRelayUrl } from './preview-relay';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';

/** Runs in Node so ws enforces connection-time DNS checks for untrusted hints. */
export async function queryDiscoveryEvents(
  relays: string[],
  filters: Filter[],
  signal: AbortSignal,
) {
  const destinations = [...new Set(relays)]
    .filter((relay) => {
      try {
        previewRelayUrl(relay);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 4);
  const pool = new RelayPool({
    WebSocket: PreviewWebSocket as unknown as RelayOptions['WebSocket'],
  });
  const events = new Map<string, SignedEvent>();
  let complete = false;
  try {
    await Promise.all(
      destinations.map(
        (relay) =>
          new Promise<void>((resolve) => {
            pool
              .req([relay], filters)
              .pipe(
                takeWhile((m) => m.type !== 'EOSE' && m.type !== 'CLOSED', true),
                take(100),
                takeUntil(timer(4000)),
                takeUntil(fromEvent(signal, 'abort')),
              )
              .subscribe({
                next: (message) => {
                  if (message.type === 'EOSE') complete = true;
                  if (message.type !== 'EVENT' || events.size >= 128) return;
                  try {
                    const event = verifiedEvent(message.event);
                    if (
                      event.created_at <= Date.now() / 1000 + 600 &&
                      filters.some((f) => matchFilter(f, event))
                    )
                      events.set(event.id, event);
                  } catch {
                    /* Forged, oversized and unrelated events never enter the index. */
                  }
                },
                error: () => resolve(),
                complete: () => resolve(),
              });
          }),
      ),
    );
    return { events: [...events.values()], complete };
  } finally {
    pool.close();
  }
}
