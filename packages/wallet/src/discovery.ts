import type { EventStore } from 'applesauce-core';
import { getWalletRelays } from 'applesauce-wallet/helpers';
import type { Filter } from 'nostr-tools';
import { walletRelays } from './policy';

/** Bootstrap only configuration and relay hints. NutWallet owns token/history sync. */
export const walletDiscoveryFilters = (pubkey: string): Filter[] => [
  { kinds: [10019, 10002, 17375], authors: [pubkey] },
];

export function canonicalWalletRelays(urls: string[]) {
  return walletRelays(urls).sort();
}

export async function discoverWalletRelays(options: {
  pubkey: string;
  store: EventStore;
  fallback: string[];
  current: string[];
  unlock: () => Promise<void>;
  collect: (relays: string[], filters: Filter[]) => Promise<void>;
}) {
  const { pubkey, store, fallback, current, unlock, collect } = options;
  const filters = walletDiscoveryFilters(pubkey);
  let known = store.getReplaceable(17375, pubkey);
  if (known) await unlock();
  const saved = known && getWalletRelays(known);
  const initial = canonicalWalletRelays(saved?.length ? saved : [...fallback, ...current]);
  await collect(initial, filters);
  const discovered = store.getReplaceable(17375, pubkey);
  if (discovered && discovered !== known) await unlock();
  known = discovered;
  const owned = known && getWalletRelays(known);
  const info = store.getReplaceable(10019, pubkey);
  const mail = store.getReplaceable(10002, pubkey);
  const advertised = info?.tags.filter((tag) => tag[0] === 'relay').map((tag) => tag[1]);
  const mailboxes = mail?.tags.filter((tag) => tag[0] === 'r').map((tag) => tag[1]);
  const selected = canonicalWalletRelays(
    owned?.length
      ? owned
      : advertised?.length
        ? advertised
        : mailboxes?.length
          ? mailboxes
          : fallback,
  );
  const additional = selected.filter((url) => !initial.includes(url));
  if (additional.length) await collect(additional, filters);
  const latest = store.getReplaceable(17375, pubkey);
  if (latest && latest !== known) await unlock();
  const latestRelays = latest && getWalletRelays(latest);
  return latestRelays?.length ? canonicalWalletRelays(latestRelays) : selected;
}
