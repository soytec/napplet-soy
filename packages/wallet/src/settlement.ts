import type { WalletTransaction } from './types';

export function settlementCandidates(transactions: WalletTransaction[]) {
  const reserved = transactions.filter((t) => t.status === 'pending' || t.status === 'review');
  return transactions.filter(
    (t) =>
      (t.type === 'send' && t.status === 'complete' && t.token && t.tokenState !== 'spent') ||
      (reserved.every((r) => r.id === t.id) &&
        ((t.type === 'deposit' && ['invoice', 'pending'].includes(t.status)) ||
          (t.type === 'melt' &&
            t.status === 'pending' &&
            t.confirmed &&
            t.meltOutputs &&
            !t.recoverySwap))),
  );
}

/** A paid quote must disappear even when minting or relay synchronization is pending. */
export function showDepositCode(tx: WalletTransaction, now = Date.now() / 1000) {
  return (
    tx.type === 'deposit' &&
    tx.status === 'invoice' &&
    (!tx.quoteState || tx.quoteState === 'UNPAID') &&
    (tx.quoteExpires ?? Infinity) > now &&
    !!tx.invoice
  );
}
export function transactionFeedback(tx: WalletTransaction) {
  if (tx.status === 'cancelled') return 'Cancelled';
  if (tx.type === 'send' && tx.status === 'complete') {
    if (tx.tokenState === 'spent') return 'Cashu token redeemed';
    if (tx.tokenState === 'partial') return 'Token partly redeemed — do not share it again';
    if (tx.tokenState === 'pending') return 'Token redemption in progress';
    return 'Cashu token ready to share';
  }
  if (tx.status === 'complete') {
    if (tx.recovered) return 'Unpaid Lightning funds recovered';
    return (
      {
        send: 'Cashu token ready to share',
        deposit: 'Lightning received',
        melt: 'Lightning paid',
        receive: 'Cashu received',
        redeem: 'Nutzap received',
        nutzap: 'Nutzap sent',
      }[tx.type] ?? 'Completed'
    );
  }
  if (tx.type === 'deposit' && ['PAID', 'ISSUED'].includes(tx.quoteState ?? ''))
    return 'Invoice paid — finishing wallet recovery and sync';
  if (tx.message === 'Lightning paid') return 'Lightning paid — finishing wallet sync';
  if (tx.status === 'invoice') return 'Waiting for Lightning payment';
  return 'Pending — check before sending again';
}
