import { useEffect, useState } from 'react';
import type { NostrEvent } from 'nostr-tools';
import { Button } from '../ui/button';
import { useNostr } from '../nostr-provider';
import { useWallet } from './wallet-provider';
import { TransactionReview } from './transaction-review';
import { protocolClient } from '@/lib/network';
import { nutzapRecipient } from '../../../../../packages/wallet/src/policy';
import { zapPayments } from '@/lib/zap-payments';
import type { ZapInvoice } from '../../../../../packages/client/src/zaps';

function MintChoice({
  mints,
  value,
  set,
  balances,
}: {
  mints: string[];
  value: string;
  set: (s: string) => void;
  balances: Record<string, number>;
}) {
  return (
    <label className="wallet-field">
      Pay from mint
      <select value={value} onChange={(e) => set(e.target.value)}>
        {mints.map((m) => (
          <option key={m} value={m}>
            {new URL(m).hostname} · {(balances[m] ?? 0).toLocaleString()} sats
          </option>
        ))}
      </select>
    </label>
  );
}
export function MintInvoicePayment({ invoice, scope }: { invoice: ZapInvoice; scope: string }) {
  const wallet = useWallet(),
    { pubkey } = useNostr(),
    [mint, setMint] = useState('');
  const mints = wallet.runtime?.mints() ?? [];
  const tx = wallet.transactions.find(
    (t) => t.paymentHash === invoice.paymentHash && t.status !== 'cancelled',
  );
  useEffect(() => {
    if (tx?.preimage) zapPayments.confirmPreimage(scope, invoice.paymentHash, tx.preimage);
  }, [tx?.preimage, scope, invoice.paymentHash, pubkey]);
  return (
    <section className="wallet-zap">
      <strong>Pay from your Cashu wallet</strong>
      {!wallet.runtime ? (
        <Button variant="outline" disabled={wallet.busy} onClick={() => void wallet.open()}>
          {pubkey ? 'Open wallet' : 'Sign in to use wallet'}
        </Button>
      ) : !mints.length ? (
        <p>Create a wallet using the wallet icon in the header.</p>
      ) : (
        <>
          {!tx && (
            <>
              <MintChoice
                mints={mints}
                balances={wallet.balances}
                value={mint || mints[0]}
                set={setMint}
              />
              <Button
                variant="outline"
                disabled={wallet.busy}
                onClick={() =>
                  void wallet.run((r) => r.wallet.preparePayment(mint || mints[0], invoice.invoice))
                }
              >
                Review mint payment
              </Button>
            </>
          )}
          {tx && (
            <>
              <TransactionReview transaction={tx} />
              {tx.status === 'pending' && (
                <Button
                  variant="outline"
                  disabled={wallet.busy}
                  onClick={() => void wallet.run((r) => r.wallet.resume(tx.id))}
                >
                  Check pending payment
                </Button>
              )}
            </>
          )}
        </>
      )}
      {wallet.busy && <p role="status">{wallet.progress || 'Opening wallet…'}</p>}
      {wallet.error && <p role="alert">{wallet.error}</p>}
    </section>
  );
}

export function NutzapOption({ target, relays }: { target: NostrEvent; relays: string[] }) {
  const { pubkey } = useNostr(),
    wallet = useWallet();
  const [info, setInfo] = useState<NostrEvent>(),
    [loading, setLoading] = useState(true),
    [mint, setMint] = useState(''),
    [amount, setAmount] = useState('21'),
    [comment, setComment] = useState(''),
    [id, setId] = useState<string>();
  useEffect(() => {
    setInfo(undefined);
    setLoading(true);
    setId(undefined);
    const abort = new AbortController(),
      client = protocolClient();
    void (async () => {
      // NIP-61 is independent of LNURL. Find the recipient's relay list first when necessary.
      await client.query(
        [{ kinds: [10019, 10002], authors: [target.pubkey] }],
        relays,
        abort.signal,
      );
      let event = client.store.getReplaceable(10019, target.pubkey);
      if (!event) {
        const mail = client.store.getReplaceable(10002, target.pubkey);
        await client.query(
          [{ kinds: [10019], authors: [target.pubkey] }],
          mail?.tags.filter((t) => t[0] === 'r').map((t) => t[1]) ?? relays,
          abort.signal,
        );
        event = client.store.getReplaceable(10019, target.pubkey);
      }
      if (event) {
        nutzapRecipient(event);
        if (!abort.signal.aborted) setInfo(event);
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [target.pubkey]);
  useEffect(() => {
    setId(undefined);
  }, [pubkey, target.id]);
  if (target.tags.some((t) => t[0] === 'zap')) return null;
  if (!info)
    return loading ? (
      <p className="muted" role="status">
        Checking whether the creator accepts nutzaps…
      </p>
    ) : null;
  const accepted = nutzapRecipient(info).mints.map((m) => m.url),
    mints = (wallet.runtime?.mints() ?? []).filter((m) => accepted.includes(m));
  const tx = wallet.transactions.find((t) => t.id === id);
  return (
    <section className="wallet-zap">
      <strong>Or send a nutzap</strong>
      <p>Cashu sats, locked to this creator’s wallet. No Lightning address needed.</p>
      {!wallet.runtime ? (
        <Button variant="outline" disabled={wallet.busy} onClick={() => void wallet.open()}>
          {pubkey ? 'Open wallet for nutzaps' : 'Sign in for nutzaps'}
        </Button>
      ) : !mints.length ? (
        <p>
          No shared mint. The creator accepts {accepted.join(', ')}. You can review and add one in
          your wallet settings.
        </p>
      ) : (
        <>
          {!tx && (
            <>
              <MintChoice
                mints={mints}
                balances={wallet.balances}
                value={mint || mints[0]}
                set={setMint}
              />
              <label className="wallet-field">
                Satoshis
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <label className="wallet-field">
                Note (optional)
                <input value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <Button
                disabled={wallet.busy}
                onClick={() =>
                  void wallet.run(async (r) => {
                    const prepared = await r.wallet.prepareSend(
                      mint || mints[0],
                      Number(amount),
                      info,
                      target,
                      comment,
                      protocolClient().store.getReplaceable(10002, info.pubkey),
                    );
                    setId(prepared.id);
                  })
                }
              >
                Review nutzap
              </Button>
            </>
          )}
          {tx && (
            <>
              <TransactionReview transaction={tx} />
              {tx.status === 'complete' ? (
                <p role="status">
                  Nutzap sent! {tx.amount} sats are locked to the creator’s wallet.
                </p>
              ) : tx.status === 'pending' ? (
                <Button
                  variant="outline"
                  disabled={wallet.busy}
                  onClick={() => void wallet.run((r) => r.wallet.resume(tx.id))}
                >
                  Resume saved nutzap
                </Button>
              ) : tx.status === 'cancelled' ? (
                <Button variant="outline" onClick={() => setId(undefined)}>
                  Start again
                </Button>
              ) : null}
            </>
          )}
        </>
      )}
      {wallet.busy && <p role="status">{wallet.progress || 'Opening wallet…'}</p>}
      {wallet.error && <p role="alert">{wallet.error}</p>}
    </section>
  );
}
