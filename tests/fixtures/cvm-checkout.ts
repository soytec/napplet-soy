import { cvmCheckout } from '../../packages/runtime/src/cvm-payment-dialog';
const state = {
  available: true,
  pays: 0,
  statuses: 0,
  outcome: 'settled',
  result: '',
  controller: new AbortController(),
};
Object.assign(window, {
  checkoutState: state,
  walletAvailable: (enabled: boolean) => {
    state.available = enabled;
    window.dispatchEvent(new Event('wallet-fixture'));
  },
  openCheckout: (invoice: string, wallet = true) => {
    state.controller = new AbortController();
    state.result = '';
    void cvmCheckout(
      'fixture:alice',
      'Test napplet',
      wallet
        ? {
            available: () => state.available,
            subscribeAvailability: (listener) => {
              window.addEventListener('wallet-fixture', listener);
              return () => window.removeEventListener('wallet-fixture', listener);
            },
            prepare: async () => ({
              id: 'fixture-transaction',
              feesMsat: 1000,
              label: 'Fixture mint',
            }),
            pay: async () => {
              state.pays++;
              return state.outcome as 'settled' | 'unknown';
            },
            status: async () => {
              state.statuses++;
              return 'unknown';
            },
          }
        : undefined,
    )({
      server: 'a'.repeat(64),
      operation: 'paid_report',
      invoice,
      amountMsat: 21000,
      signal: state.controller.signal,
    }).then(
      () => {
        state.result = 'continued';
      },
      (error) => {
        state.result = error.message;
      },
    );
  },
});
