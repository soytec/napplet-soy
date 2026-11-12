import { walletErrorMessage } from '../../../../packages/wallet/src/errors';
import type { InvoicePaymentBackend } from '../../../../packages/runtime/src/invoice-payment-session';
import { chooseCapability } from '../../../../packages/runtime/src/capability-dialog';
import type { WalletRuntime } from './wallet-runtime';
import type { WalletTransaction } from '../../../../packages/wallet/src/types';
import { watchWalletAvailability } from './wallet-preference';
const state = (t: WalletTransaction) =>
  t.quoteState === 'PAID' || t.status === 'complete'
    ? 'settled'
    : t.status === 'cancelled'
      ? 'cancelled'
      : t.status === 'review'
        ? 'failed'
        : 'unknown';
/** Reuse the wallet journal and settlement reconciler; never expose proofs/preimages. */
export function cvmWalletPayments(
  current: () => WalletRuntime | undefined,
  run: <T>(fn: (r: WalletRuntime) => Promise<T>) => Promise<T | undefined>,
): InvoicePaymentBackend {
  const execute = async <T>(r: WalletRuntime, fn: () => Promise<T>): Promise<T> => {
    const outcome = await run(async (active) => {
      if (active !== r) return { error: 'Account changed' };
      try {
        return { result: await fn() };
      } catch (error) {
        return { error: walletErrorMessage(error) };
      }
    });
    if (!outcome)
      throw new Error('Wallet busy: Wait for the current operation, then check status.');
    if ('error' in outcome) throw new Error(outcome.error);
    return outcome.result;
  };
  const runtime = () => {
    const r = current();
    if (!r)
      throw new Error('wallet unavailable: Open your wallet in the shell, or use the invoice QR.');
    return r;
  };
  // IDs are bound to this backend's account, not whichever wallet is active later.
  const owners = new Map<string, WalletRuntime>();
  const owned = (id: string) => {
    const r = runtime(),
      owner = owners.get(id);
    if (owner && owner.pubkey !== r.pubkey) throw new Error('Account changed');
    return r;
  };
  return {
    available: () => !!current(),
    subscribeAvailability: watchWalletAvailability,
    async prepare(invoice, signal) {
      const r = runtime(),
        mints = r.mints();
      const mint = await chooseCapability(
        'Pay from your Cashu wallet',
        mints.map((m) => ({
          id: m,
          label: `${new URL(m).hostname} · ${r.wallet.satBalances()[m] ?? 0} sats`,
        })),
        signal,
        undefined,
        'Your shell wallet has no mints. Add one in wallet settings, or pay using the invoice QR.',
      );
      signal.throwIfAborted();
      if (runtime() !== r) throw new Error('Account changed');
      const previous = r.wallet.transactions$.value.find(
        (t) => t.invoice === invoice && t.status === 'review',
      );
      if (previous && previous.mint !== mint)
        throw new Error(
          'This invoice already has a prepared transaction at another mint. Resolve it in wallet Activity first.',
        );
      const tx = previous ?? (await execute(r, () => r.wallet.preparePayment(mint, invoice)));
      owners.set(tx.id, r);
      return { id: tx.id, feesMsat: Math.ceil(tx.fee * 1000), label: new URL(tx.mint).hostname };
    },
    async pay(id) {
      const r = owned(id);
      return state(await execute(r, () => r.wallet.resume(id, true)));
    },
    async status(id) {
      const r = owned(id);
      await execute(r, async () => {
        await r.wallet.checkSettlement(id);
        return true;
      });
      const tx = r.wallet.transactions$.value.find((t) => t.id === id);
      if (!tx) throw new Error('Unknown wallet transfer');
      return state(tx);
    },
  };
}
