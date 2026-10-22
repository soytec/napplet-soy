import { RelayPool } from 'applesauce-relay';
import { take, takeUntil, takeWhile, timer } from 'rxjs';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';

/** Read-only, finite discovery: no signer, AUTH response, or EVENT publication. */
export async function discoverNapplets(relays: string[], timeoutMs = 5000) {
  const pool = new RelayPool();
  const events = new Map<string, SignedEvent>();
  let responded = 0;
  try {
    await Promise.all(
      relays.map(
        (relay) =>
          new Promise<void>((resolve) => {
            pool
              .req(
                [relay],
                [
                  { kinds: [35129], limit: 150 },
                  { kinds: [15129], limit: 25 },
                  { kinds: [5129], limit: 25 },
                ],
              )
              .pipe(
                takeWhile((message) => message.type !== 'EOSE' && message.type !== 'CLOSED', true),
                take(225),
                takeUntil(timer(timeoutMs)),
              )
              .subscribe({
                next: (message) => {
                  if (message.type === 'EOSE') responded++;
                  if (message.type !== 'EVENT' || events.size >= 600) return;
                  try {
                    const event = verifiedEvent(message.event);
                    if (
                      [35129, 15129, 5129].includes(event.kind) &&
                      event.created_at <= Date.now() / 1000 + 600
                    )
                      events.set(event.id, event);
                  } catch {
                    /* Unverified relay data never enters the catalog. */
                  }
                },
                error: () => resolve(),
                complete: () => resolve(),
              });
          }),
      ),
    );
  } finally {
    pool.close();
  }
  if (!responded && !events.size) throw new Error('Public relays did not respond');
  return [...events.values()];
}
