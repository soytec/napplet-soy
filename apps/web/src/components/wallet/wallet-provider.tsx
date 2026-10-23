import { walletErrorMessage, WalletError } from '../../../../../packages/wallet/src/errors';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Subscription } from 'rxjs';
import { useNostr } from '../nostr-provider';
import { browserIdentity } from '@/lib/browser-identity';
import type { WalletRuntime } from '@/lib/wallet-runtime';
import type { WalletTransaction } from '../../../../../packages/wallet/src/types';
import type { NostrEvent } from 'nostr-tools';
import {
  settlementCandidates,
  transactionFeedback,
} from '../../../../../packages/wallet/src/settlement';

type Snapshot = {
  runtime?: WalletRuntime;
  balance: number;
  balances: Record<string, number>;
  transactions: WalletTransaction[];
  nutzaps: NostrEvent[];
  progress: string;
  busy: boolean;
  error: string;
  opened: boolean;
  notice: string;
};
const initial: Snapshot = {
  balance: 0,
  balances: {},
  transactions: [],
  nutzaps: [],
  progress: '',
  busy: false,
  error: '',
  opened: false,
  notice: '',
};
const Context = createContext<
  | (Snapshot & {
      open: () => Promise<void>;
      lock: () => void;
      run: <T>(fn: (r: WalletRuntime) => Promise<T>) => Promise<T | undefined>;
      clearError: () => void;
    })
  | null
>(null);
export function WalletProvider({ children }: { children: ReactNode }) {
  const { pubkey, ready, needsReconnect, connect } = useNostr();
  const [state, setState] = useState(initial);
  const active = useRef<
    { runtime: WalletRuntime; subs: Subscription; release: () => void } | undefined
  >(undefined);
  const generation = useRef(0),
    working = useRef(false),
    autoOpened = useRef<string | null>(null);
  const lock = () => {
    generation.current++;
    active.current?.runtime.close();
    active.current?.subs.unsubscribe();
    active.current?.release();
    active.current = undefined;
    working.current = false;
    setState(initial);
  };
  useEffect(() => {
    autoOpened.current = null;
    lock();
    return lock;
  }, [pubkey]);
  useEffect(() => {
    if (!pubkey || !ready || needsReconnect || autoOpened.current === pubkey) return;
    // Wait for restored signers. Cancel the scheduled attempt during effect
    // cleanup; explicit locks and failed attempts must not cause reopen loops.
    const timer = setTimeout(() => {
      autoOpened.current = pubkey;
      void open();
    }, 0);
    return () => clearTimeout(timer);
  }, [pubkey, ready, needsReconnect]);
  const open = async () => {
    if (!pubkey) {
      await connect();
      return;
    }
    if (active.current || working.current) return;
    autoOpened.current = pubkey;
    working.current = true;
    const turn = generation.current;
    setState((s) => ({
      ...s,
      busy: true,
      error: '',
      progress: 'Finding your wallet on Nostr…',
      opened: true,
    }));
    let release = () => {};
    try {
      if (!navigator.locks)
        throw new WalletError(
          'Use a current browser with Web Locks over HTTPS to open this wallet safely.',
        );
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request(`napplet-wallet:${pubkey}`, { ifAvailable: true }, async (lease) => {
            if (!lease) {
              reject(
                new WalletError(
                  'This wallet is open in another tab. Lock it there, then reopen here.',
                ),
              );
              return;
            }
            await new Promise<void>((done) => {
              release = done;
              resolve();
            });
          })
          .catch(reject);
      });
      if (turn !== generation.current) {
        release();
        return;
      }
      if (browserIdentity().state.reconnect) await browserIdentity().reconnect();
      const { openWallet } = await import('@/lib/wallet-runtime');
      if (turn !== generation.current) {
        release();
        return;
      }
      const runtime = await openWallet(pubkey);
      if (turn !== generation.current) {
        runtime.close();
        release();
        return;
      }
      const subs = new Subscription();
      active.current = { runtime, subs, release };
      const update = (patch: Partial<Snapshot>) => {
        if (active.current?.runtime === runtime) setState((s) => ({ ...s, ...patch }));
      };
      subs.add(
        runtime.wallet.balance$.subscribe(() => {
          try {
            const balances = runtime.wallet.satBalances();
            update({ balances, balance: Object.values(balances).reduce((a, b) => a + b, 0) });
          } catch (error) {
            update({ error: walletErrorMessage(error) });
          }
        }),
      );
      subs.add(runtime.wallet.transactions$.subscribe((transactions) => update({ transactions })));
      subs.add(runtime.wallet.progress$.subscribe((progress) => update({ progress })));
      subs.add(runtime.nuts$.subscribe((nutzaps) => update({ nutzaps })));
      // Check each outstanding quote/token fairly, including invoices paid near
      // expiry. Outgoing checks cannot initiate or retry a payment.
      const checked = new Map<string, number>();
      const timer = setInterval(() => {
        if (working.current || active.current?.runtime !== runtime) return;
        const tx = settlementCandidates(runtime.wallet.transactions$.value).sort(
          (a, b) => (checked.get(a.id) ?? 0) - (checked.get(b.id) ?? 0),
        )[0];
        if (tx) {
          checked.set(tx.id, Date.now());
          void run((r) => r.wallet.checkSettlement(tx.id));
        }
      }, 10000);
      subs.add(() => clearInterval(timer));
      update({ runtime, busy: false, progress: '' });
    } catch (error) {
      release();
      if (turn === generation.current)
        setState((s) => ({ ...s, busy: false, error: walletErrorMessage(error), progress: '' }));
    } finally {
      if (turn === generation.current) working.current = false;
    }
  };
  const run = async <T,>(fn: (r: WalletRuntime) => Promise<T>): Promise<T | undefined> => {
    const current = active.current;
    if (!current || working.current) return;
    working.current = true;
    setState((s) => ({ ...s, busy: true, error: '' }));
    try {
      const before = new Map(
        current.runtime.wallet.transactions$.value.map((t) => [t.id, transactionFeedback(t)]),
      );
      const result = await fn(current.runtime);
      const changed = current.runtime.wallet.transactions$.value.find(
        (t) =>
          (t.status === 'complete' || t.quoteState === 'PAID' || t.quoteState === 'ISSUED') &&
          before.get(t.id) !== transactionFeedback(t),
      );
      if (changed && active.current === current)
        setState((s) => ({
          ...s,
          notice: `${transactionFeedback(changed)} · ${changed.amount.toLocaleString()} sats`,
        }));
      return result;
    } catch (error) {
      if (active.current === current) setState((s) => ({ ...s, error: walletErrorMessage(error) }));
      return undefined;
    } finally {
      if (active.current === current) {
        working.current = false;
        setState((s) => ({ ...s, busy: false }));
      }
    }
  };
  const visible = state.runtime && state.runtime.pubkey !== pubkey ? initial : state;
  return (
    <Context.Provider
      value={{
        ...visible,
        open,
        lock,
        run,
        clearError: () => setState((s) => ({ ...s, error: '' })),
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWallet() {
  const value = useContext(Context);
  if (!value) throw new WalletError('WalletProvider missing');
  return value;
}
