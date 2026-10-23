import { ZapPayments, zapReceiptFilters } from '../../../../packages/client/src/zap-payments';
import { paymentClient } from './zap-recipient';
import { zapTotalsStore } from './zap-totals';
export const zapPayments = new ZapPayments({
  totals: zapTotalsStore,
  storage: typeof window === 'undefined' ? undefined : () => window.localStorage,
  query: (record, signal, receive) =>
    paymentClient().query(zapReceiptFilters(record), record.relays, signal, receive),
});
