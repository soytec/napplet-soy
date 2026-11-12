import {
  encryptBackup,
  decryptBackup,
  validateBackup,
} from '../../../../packages/wallet/src/backup';
import { WalletError } from '../../../../packages/wallet/src/errors';
import { EventStore } from 'applesauce-core';
import { getHiddenTags } from 'applesauce-core/helpers';
import { RelayPool } from 'applesauce-relay';
import { auditTime, BehaviorSubject, Subscription } from 'rxjs';
import type { ISigner } from 'applesauce-signers';
import type { Filter, NostrEvent } from 'nostr-tools';
import { ShellWallet } from '../../../../packages/wallet/src/wallet';
import { getWalletMints, getWalletRelays } from 'applesauce-wallet/helpers';
import { verifiedEvent, verifySignature } from '../../../../packages/protocol/src';
import { WalletVault } from './wallet-storage';
import { browserIdentity } from './browser-identity';
import { network } from './network';
import { walletBootstrapRelays } from '../../../../packages/wallet/src/network';
import { walletRelays } from '../../../../packages/wallet/src/policy';
import { readWalletEvents } from '../../../../packages/wallet/src/relay-read';
import {
  canonicalWalletRelays,
  discoverWalletRelays,
  walletDiscoveryFilters,
} from '../../../../packages/wallet/src/discovery';

export type WalletRuntime = Awaited<ReturnType<typeof openWallet>>;
export async function openWallet(pubkey: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const store = new EventStore({ verifyEvent: verifySignature }),
    pool = new RelayPool();
  const storage = new WalletVault(pubkey),
    subs = new Subscription();
  let closed = false;
  const assertAccount = () => {
    if (
      closed ||
      signal?.aborted ||
      browserIdentity().state.pubkey !== pubkey ||
      browserIdentity().state.reconnect
    )
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
        const event = await browserIdentity().sign(pubkey, template);
        assertAccount();
        return event;
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
          const result = await browserIdentity().walletCrypt(pubkey, 'encrypt', value);
          assertAccount();
          return result;
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
          const result = await browserIdentity().walletCrypt(pubkey, 'decrypt', value);
          assertAccount();
          return result;
        } catch {
          throw new WalletError(
            'Wallet decryption did not complete. Unlock a signer with NIP-44 support and retry.',
          );
        }
      },
    },
  };
  const fallback = canonicalWalletRelays(walletBootstrapRelays(network().relays));
  const relays$ = new BehaviorSubject(fallback);
  let started = false,
    relayGeneration = 0;
  const setRelays = (urls: string[]) => {
    const next = canonicalWalletRelays(urls);
    if (JSON.stringify(next) === JSON.stringify(relays$.value)) return;
    relayGeneration++;
    relays$.next(next);
  };
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
    await readWalletEvents({ pool, store, pubkey, signer, relays, filters, assertAccount });
  };
  let nutSub: Subscription | undefined;
  let nutQuery = '';
  const close = (settled?: Promise<void>) => {
    if (closed) return;
    closed = true;
    signal?.removeEventListener('abort', onAbort);
    nutSub?.unsubscribe();
    subs.unsubscribe();
    wallet.stop();
    pool.close();
    // Stop signer/network work now; let an already-dispatched mint response
    // reach its durable journal before disposing the encrypted storage.
    void Promise.allSettled([wallet.lock(), settled]).then(() => storage.close());
  };
  const onAbort = () => close();
  signal?.addEventListener('abort', onAbort, { once: true });
  const watchNutzaps = (retry = false) => {
    assertAccount();
    const info = store.getReplaceable(10019, pubkey);
    const mints = [
      ...new Set(info?.tags.filter((t) => t[0] === 'mint').map((t) => t[1]) ?? []),
    ].sort();
    const query = JSON.stringify([relays$.value, mints]);
    if (query === nutQuery && (!retry || (nutSub && !nutSub.closed))) return;
    nutQuery = query;
    nutSub?.unsubscribe();
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
      .pipe(auditTime(16))
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
    const generation = relayGeneration;
    const urls = await discoverWalletRelays({
      pubkey,
      store,
      fallback,
      current: relays$.value,
      unlock: () => wallet.unlock(),
      collect,
    });
    assertAccount();
    setRelays(urls);
    const knownWallet = store.getReplaceable(17375, pubkey);
    if (knownWallet) {
      await storage.setItem('wallet-reference', JSON.stringify(knownWallet));
      await wallet.unlock();
    }
    await wallet.refreshTransactions();
    assertAccount();
    wallet.setAutoUnlock(true);
    if (!started) {
      await wallet.start();
      assertAccount();
      started = true;
    } else if (generation === relayGeneration) {
      // Changing relays already restarts NutWallet's loader. Otherwise an explicit
      // refresh requests exactly one native sync, not another custom snapshot.
      wallet.resync();
    }
    watchNutzaps(true);
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
    assertAccount();
    subs.add(
      wallet.history$.pipe(auditTime(16)).subscribe((history) => {
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
        if (relays?.length) {
          setRelays(relays);
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
        const generation = relayGeneration;
        await collect(chosen, walletDiscoveryFilters(pubkey));
        const event = store.getReplaceable(17375, pubkey);
        if (!event)
          throw new WalletError(
            'No wallet found at those relays. Check the relay addresses or restore a backup.',
          );
        await storage.setItem('wallet-reference', JSON.stringify(event));
        await wallet.unlock();
        assertAccount();
        setRelays(chosen);
        if (generation === relayGeneration) wallet.resync();
        wallet.setAutoUnlock(true);
        await wallet.refreshTransactions();
        watchNutzaps(true);
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
      close,
    };
  } catch (error) {
    close();
    throw error;
  }
}
