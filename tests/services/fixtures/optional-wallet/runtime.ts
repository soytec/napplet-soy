import { BehaviorSubject } from 'rxjs';
import { state } from './environment';
import { WalletError } from '../../../../packages/wallet/src/errors';
state.runtimeLoads++;
export async function openWallet(pubkey: string, signal: AbortSignal) {
  state.opens++;
  if (state.delay) await new Promise<void>((done) => state.opening.push(done));
  // Intentionally finishes after cancellation to exercise the provider's stale-result guard.
  if (state.fail) throw new WalletError('Fixture unlock declined');
  let closed = false;
  const close = () => {
    if (!closed) {
      closed = true;
      state.closes++;
    }
  };
  signal.addEventListener('abort', close, { once: true });
  return {
    pubkey,
    close,
    mints: () => ['https://mint.example'],
    relays: () => ['wss://relay.example'],
    store: { getReplaceable: () => ({ id: 'wallet' }) },
    nuts$: new BehaviorSubject([]),
    history$: new BehaviorSubject([]),
    wallet: {
      loadingState$: new BehaviorSubject(false),
      busy$: new BehaviorSubject(false),
      errorState$: new BehaviorSubject(null),
      balance$: new BehaviorSubject(42),
      satBalances: () => ({ 'https://mint.example': 42 }),
      transactions$: new BehaviorSubject([]),
      progress$: new BehaviorSubject(''),
      checkSettlement: async () => {
        state.checks++;
      },
    },
  };
}
