import {
  encryptBackup,
  decryptBackup,
  validateBackup,
} from '../../../../packages/wallet/src/backup';
import { WalletError } from '../../../../packages/wallet/src/errors';
import { EventStore } from 'applesauce-core';
import { getHiddenTags } from 'applesauce-core/helpers';
import { RelayPool } from 'applesauce-relay';
import { BehaviorSubject, Subscription, firstValueFrom, toArray } from 'rxjs';
import type { ISigner } from 'applesauce-signers';
import type { Filter, NostrEvent } from 'nostr-tools';
import { ShellWallet } from '../../../../packages/wallet/src/wallet';
import { getWalletMints, getWalletRelays } from 'applesauce-wallet/helpers';
import { verifiedEvent, verifySignature } from '../../../../packages/protocol/src';
import { WalletVault } from './wallet-storage';
import { browserIdentity } from './browser-identity';
import { network } from './network';
import { walletRelays } from '../../../../packages/wallet/src/policy';

export type WalletRuntime = Awaited<ReturnType<typeof openWallet>>;
export async function openWallet(pubkey: string) {
  const store = new EventStore({ verifyEvent: verifySignature }),
    pool = new RelayPool();
  const storage = new WalletVault(pubkey),
    subs = new Subscription();
  let closed = false;
  const assertAccount = () => {
    if (closed || browserIdentity().state.pubkey !== pubkey || browserIdentity().state.reconnect)
      throw new WalletError('Reconnect this wallet’s account before continuing.');
  };
  const signer: ISigner = {
    getPublicKey: async () => {
      assertAccount();
      return pubkey;
    },
    signEvent: async (template) => {
      assertAccount();
      try {
        return await browserIdentity().sign(pubkey, template);
      } catch {
        throw new WalletError(
          'Wallet signing did not complete. Unlock your selected signer and retry the saved transaction.',
        );
      }
    },
    nip44: {
      encrypt: async (peer, value) => {
        assertAccount();
        if (peer !== pubkey) throw new WalletError('Wallet encryption must be to self.');
        try {
          return await browserIdentity().walletCrypt(pubkey, 'encrypt', value);
        } catch {
          throw new WalletError(
            'Wallet encryption did not complete. Unlock a signer with NIP-44 support and retry.',
          );
        }
      },
      decrypt: async (peer, value) => {
        assertAccount();
        if (peer !== pubkey) throw new WalletError('Wallet decryption must be to self.');
        try {
          return await browserIdentity().walletCrypt(pubkey, 'decrypt', value);
        } catch {
          throw new WalletError(
            'Wallet decryption did not complete. Unlock a signer with NIP-44 support and retry.',
          );
        }
      },
    },
  };
  const fallback = walletRelays(network().relays.filter((r) => r.startsWith('wss:')));
  const relays$ = new BehaviorSubject(fallback);
  const wallet = new ShellWallet(
    {
      pubkey,
      signer,
      eventStore: store,
      pool,
      relays: relays$,
      decryptionCache: storage,
      couch: {
        getAll: () => [],
        store: () => {
          throw new WalletError('Use the durable wallet transaction flow.');
        },
        clear: () => {},
        remove: () => {},
      },
    },
    storage,
    assertAccount,
  );
  const nuts$ = new BehaviorSubject<NostrEvent[]>([]);
  const history$ = new BehaviorSubject<
    {
      id: string;
      date: number;
      direction: string;
      amount: number;
      type: string;
      fee: number;
      mint: string;
    }[]
  >([]);
  const collect = async (relays: string[], filters: Filter[]) => {
    let completed = 0;
    const results = await Promise.allSettled(
      relays.map(async (relay) => {
        const events = await firstValueFrom(
          pool
            .relay(relay)
            .request(filters, {
              timeout: 12000,
              reconnect: false,
              resubscribe: false,
              waitForAuth: pubkey,
              onAuthRequired: async ({ relay }) => {
                assertAccount();
                await relay.authenticate(signer);
              },
            })
            .pipe(toArray()),
        );
        completed++;
        for (const raw of events) {
          try {
            store.add(verifiedEvent(raw));
          } catch {}
        }
      }),
    );
    if (!completed)
      throw new WalletError(
        'No wallet relay completed the lookup. Retry before creating or spending from a wallet.',
      );
    return results;
  };
  let nutSub: Subscription | undefined;
  const watchNutzaps = () => {
    nutSub?.unsubscribe();
    const info = store.getReplaceable(10019, pubkey);
    const mints = info?.tags.filter((t) => t[0] === 'mint').map((t) => t[1]) ?? [];
    if (!mints.length) {
      nuts$.next([]);
      return;
    }
    nutSub = pool
      .subscription(relays$.value, [{ kinds: [9321], '#p': [pubkey], '#u': mints }], {
        eventStore: store,
        waitForAuth: pubkey,
        onAuthRequired: async ({ relay }) => {
          assertAccount();
          await relay.authenticate(signer);
        },
      })
      .subscribe({
        next: () => updateNuts(),
        error: () => wallet.progress$.next('Nutzap relay disconnected. Sync to retry receiving.'),
      });
  };
  const updateNuts = () => {
    const redeemed = new Set(
      store
        .getByFilters({ kinds: [7376], authors: [pubkey] })
        .flatMap((e) => e.tags.filter((t) => t[0] === 'e' && t[3] === 'redeemed').map((t) => t[1])),
    );
    nuts$.next(
      store.getByFilters({ kinds: [9321], '#p': [pubkey] }).filter((e) => !redeemed.has(e.id)),
    );
  };
  const refresh = async () => {
    assertAccount();
    await collect(
      [...new Set([...fallback, ...relays$.value])],
      [{ kinds: [10019, 10002], authors: [pubkey] }],
    );
    const info = store.getReplaceable(10019, pubkey),
      mail = store.getReplaceable(10002, pubkey);
    const advertised = info?.tags.filter((t) => t[0] === 'relay').map((t) => t[1]);
    const mailboxes = mail?.tags.filter((t) => t[0] === 'r').map((t) => t[1]);
    const urls = walletRelays(
      advertised?.length ? advertised : mailboxes?.length ? mailboxes : fallback,
    );
    relays$.next(urls);
    await collect(urls, [
      { kinds: [17375, 7375, 7376], authors: [pubkey] },
      { kinds: [5], authors: [pubkey], '#k': ['7375'] },
    ]);
    const knownWallet = store.getReplaceable(17375, pubkey);
    if (knownWallet) {
      await storage.setItem('wallet-reference', JSON.stringify(knownWallet));
      await wallet.unlock();
    }
    await wallet.refreshTransactions();
    watchNutzaps();
    updateNuts();
  };
  try {
    // Opening storage must succeed even for an empty wallet; no volatile-money fallback.
    await storage.setItem('probe', 'ok');
    await storage.removeItem('probe');
    const restoring = await storage.getItem('restoring');
    if (restoring) {
      const data = validateBackup(JSON.parse(restoring), pubkey);
      await storage.setItem('transactions', JSON.stringify(data.transactions));
      if (data.outbox) await storage.setItem('outbox', data.outbox);
      await storage.setItem('recovery-events', JSON.stringify(data.events));
      await storage.removeItem('restoring');
    }
    const recovered = JSON.parse((await storage.getItem('recovery-events')) ?? '[]');
    const reference = await storage.getItem('wallet-reference');
    if (reference) recovered.push(JSON.parse(reference));
    const queued = await storage.getItem('outbox');
    if (queued)
      recovered.push(
        ...JSON.parse(queued)
          .items.map((item: { event: NostrEvent }) => item.event)
          .filter((e: NostrEvent) => e.kind === 17375 || e.kind === 10019),
      );
    for (const event of recovered) if (event.pubkey === pubkey) store.add(verifiedEvent(event));
    await refresh();
    await wallet.start();
    wallet.setAutoUnlock(true);
    subs.add(
      wallet.history$.subscribe((history) => {
        history$.next(
          (history ?? []).flatMap((h) => {
            const tags = getHiddenTags(h.event);
            if (!tags) return [];
            const get = (name: string) => tags.find((t) => t[0] === name)?.[1];
            return [
              {
                id: h.event.id,
                date: h.event.created_at,
                direction: h.direction ?? 'in',
                amount: h.amount ?? 0,
                type: get('type') ?? (h.redeemed.length ? 'redeem' : 'transfer'),
                fee: Number(get('fee') ?? 0),
                mint: get('mint') ?? '',
              },
            ];
          }),
        );
        updateNuts();
      }),
    );
    subs.add(
      wallet.walletRelays$.subscribe((relays) => {
        if (relays?.length && JSON.stringify(relays) !== JSON.stringify(relays$.value)) {
          relays$.next(walletRelays(relays));
          watchNutzaps();
        }
      }),
    );
    return {
      pubkey,
      wallet,
      storage,
      store,
      pool,
      nuts$,
      history$,
      refresh,
      async receiveNutzap(event: NostrEvent) {
        const token = await wallet.validateNutzap(event);
        // Redemption itself must not depend on the sender's relay discovery service.
        try {
          await collect(
            [...new Set([...fallback, ...relays$.value])],
            [{ kinds: [10002], authors: [event.pubkey] }],
          );
        } catch {}
        return wallet.prepareReceive(token, event, store.getReplaceable(10002, event.pubkey));
      },
      async discoverAt(urls: string[]) {
        assertAccount();
        const chosen = walletRelays(urls);
        await collect(chosen, [
          { kinds: [10019, 17375, 7375, 7376], authors: [pubkey] },
          { kinds: [5], authors: [pubkey], '#k': ['7375'] },
        ]);
        relays$.next(chosen);
        const event = store.getReplaceable(17375, pubkey);
        if (!event)
          throw new WalletError(
            'No wallet found at those relays. Check the relay addresses or restore a backup.',
          );
        await storage.setItem('wallet-reference', JSON.stringify(event));
        await wallet.unlock();
        await wallet.refreshTransactions();
        watchNutzaps();
      },
      async exportBackup() {
        assertAccount();
        const data = {
          version: 1 as const,
          pubkey,
          transactions: await wallet.journal.list(),
          outbox: await storage.getItem('outbox'),
          events: store.getByFilters({ authors: [pubkey], kinds: [5, 17375, 7375, 7376, 10019] }),
        };
        return encryptBackup(data, signer);
      },
      async importBackup(value: string) {
        assertAccount();
        const data = await decryptBackup(value, pubkey, signer);
        if ((await wallet.journal.list()).length || (await storage.getItem('outbox')))
          throw new WalletError(
            'Restore into a device without local wallet transactions to avoid overwriting recovery data.',
          );
        // The durable marker makes an interrupted import finish on the next open.
        await storage.setItem('restoring', JSON.stringify(data));
        await storage.setItem('transactions', JSON.stringify(data.transactions));
        if (data.outbox) await storage.setItem('outbox', data.outbox);
        await storage.setItem('recovery-events', JSON.stringify(data.events));
        await storage.removeItem('restoring');
        data.events.forEach((event) => store.add(verifiedEvent(event)));
        await wallet.unlock();
        await wallet.refreshTransactions();
      },
      mints: () => {
        const event = store.getReplaceable(17375, pubkey);
        return event ? (getWalletMints(event) ?? []) : [];
      },
      relays: () => {
        const event = store.getReplaceable(17375, pubkey);
        return event ? (getWalletRelays(event) ?? relays$.value) : relays$.value;
      },
      close: () => {
        closed = true;
        nutSub?.unsubscribe();
        subs.unsubscribe();
        wallet.stop();
        pool.close();
        void wallet.lock().catch(() => {});
      },
    };
  } catch (error) {
    closed = true;
    nutSub?.unsubscribe();
    subs.unsubscribe();
    wallet.stop();
    pool.close();
    throw error;
  }
}
