import { useEffect, useState } from 'react';
import { ProtocolClient } from '../../../../packages/client/src/nostr';
import { walletBootstrapRelays } from '../../../../packages/wallet/src/network';
import { paymentRecipient, type PaymentRecipient } from '../../../../packages/wallet/src/recipient';
import { network, manifestAllowed, protocolClient } from './network';

// Only public payment discovery/receipts belong here. Private NIP-60 events use
// the account-scoped wallet runtime and never enter either public event cache.
let client: ProtocolClient | undefined;
export const paymentClient = () =>
  (client ??= new ProtocolClient(() => walletBootstrapRelays(network().relays), manifestAllowed));
const refreshed = new Map<string, number>();
const pending = new Map<string, Promise<void>>();
const filtersFor = (pubkey: string) => [{ kinds: [0, 10019, 10002], authors: [pubkey] }];
function refresh(pubkey: string, hints: string[]) {
  if (pending.has(pubkey)) return pending.get(pubkey)!;
  if ((refreshed.get(pubkey) ?? 0) > Date.now() - 60000) return Promise.resolve();
  const c = paymentClient();
  const job = (async () => {
    await c.query(filtersFor(pubkey), walletBootstrapRelays(network().relays, hints));
    const mail = c.store.getReplaceable(10002, pubkey);
    const authorRelays =
      mail?.tags.filter((t) => t[0] === 'r' && (!t[2] || t[2] === 'write')).map((t) => t[1]) ?? [];
    if (authorRelays.length)
      await c.query(filtersFor(pubkey), walletBootstrapRelays([], authorRelays));
    refreshed.set(pubkey, Date.now());
    while (refreshed.size > 1024) refreshed.delete(refreshed.keys().next().value!);
  })().finally(() => pending.delete(pubkey));
  pending.set(pubkey, job);
  return job;
}
export function useZapRecipient(pubkey: string, hints: string[]) {
  const [state, setState] = useState<{ pubkey: string; value: PaymentRecipient }>();
  const hintKey = hints.join('\n');
  useEffect(() => {
    const c = paymentClient(),
      filters = filtersFor(pubkey);
    // Reuse profiles already verified by the shell, but keep wallet relay
    // discovery from changing the shell's publication destinations.
    c.seed(protocolClient().cached(filters));
    const subscription = c.store.timeline(filters).subscribe(() => {
      const events = c.cached(filters);
      const value = paymentRecipient(events, pubkey);
      if (value.profile && !c.allowed(value.profile)) {
        value.profile = undefined;
        value.lightning = false;
      }
      if (value.nutzap && !c.allowed(value.nutzap)) value.nutzap = undefined;
      setState({ pubkey, value });
    });
    const update = () => {
      if (document.visibilityState !== 'hidden') void refresh(pubkey, hints).catch(() => {});
    };
    update();
    const timer = setInterval(update, 60000);
    window.addEventListener('focus', update);
    return () => {
      subscription.unsubscribe();
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [pubkey, hintKey]);
  return state?.pubkey === pubkey ? state.value : undefined;
}
