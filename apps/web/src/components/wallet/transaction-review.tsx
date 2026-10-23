import { Button } from '../ui/button';
import { useWallet } from './wallet-provider';
import type { WalletTransaction } from '../../../../../packages/wallet/src/types';
import { transactionNames } from '../../../../../packages/wallet/src/policy';

export function TransactionReview({
  transaction,
  onDone,
}: {
  transaction: WalletTransaction;
  onDone?: (tx: WalletTransaction) => void;
}) {
  const { run, busy, transactions } = useWallet();
  const tx = transactions.find((t) => t.id === transaction.id) ?? transaction;
  if (tx.status !== 'review') return null;
  const incoming = tx.type === 'receive' || tx.type === 'redeem';
  return (
    <section className="wallet-review" aria-label="Review transaction">
      <h3>{transactionNames[tx.type]}</h3>
      <dl>
        <div>
          <dt>{incoming ? 'You receive' : 'Amount'}</dt>
          <dd>{tx.amount.toLocaleString()} sats</dd>
        </div>
        <div>
          <dt>{tx.type === 'melt' ? 'Maximum fee' : 'Mint fee'}</dt>
          <dd>{tx.fee.toLocaleString()} sats</dd>
        </div>
        {!incoming && (
          <div>
            <dt>Maximum debit</dt>
            <dd>{(tx.amount + tx.fee).toLocaleString()} sats</dd>
          </div>
        )}
        <div>
          <dt>Mint</dt>
          <dd>{tx.mint}</dd>
        </div>
        {tx.recipient && (
          <div>
            <dt>Recipient</dt>
            <dd>
              {tx.recipient.pubkey.slice(0, 12)}…{tx.recipient.pubkey.slice(-8)}
            </dd>
          </div>
        )}
      </dl>
      {tx.type === 'send' && (
        <p>Anyone with the token can spend it. Share it privately with your recipient.</p>
      )}
      {tx.type === 'nutzap' && (
        <p>
          This public nutzap is signed by your current account and locked to the recipient’s wallet.
        </p>
      )}
      <div className="wallet-actions">
        <Button
          disabled={busy}
          onClick={() =>
            void run(async (r) => {
              const result = await r.wallet.resume(tx.id, true);
              onDone?.(result);
            })
          }
        >
          {busy ? 'Working…' : incoming ? 'Confirm receive' : 'Confirm send'}
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run((r) => r.wallet.cancel(tx.id))}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}
