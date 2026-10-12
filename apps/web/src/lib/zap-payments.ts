import { ZapPayments, zapReceiptFilters } from '../../../../packages/client/src/zap-payments';
import { protocolClient } from './network';
import { zapTotalsStore } from './zap-totals';
export const zapPayments = new ZapPayments({
  totals: zapTotalsStore,
  storage: typeof window === 'undefined' ? undefined : () => window.localStorage,
  query: (record, signal, receive) =>
    protocolClient().query(zapReceiptFilters(record), record.relays, signal, receive),
});
