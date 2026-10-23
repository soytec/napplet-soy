import type { EventStore } from 'applesauce-core';
import { RelayGroup, type RelayPool } from 'applesauce-relay';
import type { ISigner } from 'applesauce-signers';
import type { Filter } from 'nostr-tools';
import { endWith, filter, firstValueFrom, ignoreElements, tap } from 'rxjs';
import { verifiedEvent } from '../../protocol/src';
import { WalletError } from './errors';

/** Share the relay group's progress-aware read policy. A missing wallet must
 * still wait for the full lookup, rather than offering creation after one empty relay. */
export async function readWalletEvents(options: {
  pool: RelayPool;
  store: EventStore;
  pubkey: string;
  signer: ISigner;
  relays: string[];
  filters: Filter[];
  assertAccount: () => void;
}) {
  const { pool, store, pubkey, signer, relays, filters, assertAccount } = options;
  try {
    await firstValueFrom(
      pool
        .group(relays)
        .request(filters, {
          timeout: 12000,
          reconnect: false,
          resubscribe: false,
          waitForAuth: pubkey,
          onAuthRequired: async ({ relay }) => {
            assertAccount();
            await relay.authenticate(signer);
          },
          complete: (messages) =>
            RelayGroup.completeAfterIdle()(messages).pipe(
              filter(() => !!store.getReplaceable(17375, pubkey)),
            ),
        })
        .pipe(
          tap((raw) => {
            assertAccount();
            try {
              store.add(verifiedEvent(raw));
            } catch {}
          }),
          ignoreElements(),
          endWith(undefined),
        ),
    );
    assertAccount();
  } catch {
    throw new WalletError(
      'No wallet relay completed the lookup. Retry before creating or spending from a wallet.',
    );
  }
}
