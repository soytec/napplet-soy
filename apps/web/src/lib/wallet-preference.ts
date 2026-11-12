import { useSyncExternalStore } from 'react';

const prefix = 'napplet:wallet-enabled:';
const changed = 'napplet:wallet-preference';
const availability = 'napplet:wallet-availability';
export function notifyWalletAvailability() {
  window.dispatchEvent(new Event(availability));
}
export function watchWalletAvailability(listener: () => void) {
  window.addEventListener(availability, listener);
  return () => window.removeEventListener(availability, listener);
}
// Only the opt-in bit is stored here, never wallet data. Missing/invalid = off,
// including for accounts that used the old automatically opened wallet.
const volatile = new Map<string, boolean>();
export function walletEnabled(pubkey: string | null) {
  if (!pubkey || typeof window === 'undefined') return false;
  if (volatile.has(pubkey)) return volatile.get(pubkey)!;
  try {
    return localStorage.getItem(prefix + pubkey) === 'true';
  } catch {
    return false;
  }
}
export function setWalletEnabled(pubkey: string, enabled: boolean) {
  try {
    localStorage.setItem(prefix + pubkey, String(enabled));
    volatile.delete(pubkey);
  } catch {
    // A blocked storage API must not prevent switching off in this tab.
    volatile.set(pubkey, enabled);
  }
  window.dispatchEvent(new Event(changed));
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) {
      if (event.key === null) volatile.clear();
      else volatile.delete(event.key.slice(prefix.length));
      listener();
    }
  };
  window.addEventListener(changed, listener);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener('storage', storage);
  };
}
export function useWalletEnabled(pubkey: string | null) {
  return useSyncExternalStore(
    subscribe,
    () => walletEnabled(pubkey),
    () => false,
  );
}
