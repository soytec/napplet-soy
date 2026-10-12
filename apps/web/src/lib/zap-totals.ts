import { useSyncExternalStore } from 'react';
import { ZapTotalsStore } from '../../../../packages/client/src/zap-totals';

// Confirmed local totals survive reloads; no payment data is sent to our server.
export const zapTotalsStore = new ZapTotalsStore(
  typeof window === 'undefined' ? undefined : () => window.localStorage,
);
export function useZapTotals(scope: string) {
  return useSyncExternalStore(
    zapTotalsStore.subscribe,
    () => zapTotalsStore.get(scope),
    () => undefined,
  );
}
