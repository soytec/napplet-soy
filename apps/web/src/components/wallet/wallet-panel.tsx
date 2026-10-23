import { useEffect, useState } from 'react';
import {
  ArrowUpRight,
  Coins,
  Zap,
  QrCode,
  CheckCircle2,
  History,
  LockKeyhole,
  RefreshCw,
  Settings2,
  LoaderCircle,
} from 'lucide-react';
import { Button } from '../ui/button';
import { useWallet } from './wallet-provider';
import { useNostr } from '../nostr-provider';
import { PaymentCode } from './payment-code';
import { QrReader } from './qr-reader';
import { TransactionReview } from './transaction-review';
import {
  showDepositCode,
  transactionFeedback,
} from '../../../../../packages/wallet/src/settlement';
import { transactionNames } from '../../../../../packages/wallet/src/policy';
import type { WalletTransaction } from '../../../../../packages/wallet/src/types';
import type { WalletRuntime } from '@/lib/wallet-runtime';

const suggestions = [
  { name: 'Minibits', url: 'https://mint.minibits.cash/Bitcoin' },
  { name: 'Coinos', url: 'https://mint.coinos.io' },
  { name: '21Mint', url: 'https://21mint.me' },
];
type View = 'home' | 'deposit' | 'pay' | 'receive' | 'send' | 'activity' | 'settings';
const actions = [
  ['deposit', 'Receive Lightning', Zap],
  ['pay', 'Pay Lightning', ArrowUpRight],
  ['receive', 'Receive Cashu', QrCode],
  ['send', 'Send Cashu', Coins],
] as const;

export function WalletPanel({ full = false }: { full?: boolean }) {
  const wallet = useWallet(),
    { pubkey } = useNostr();
  const [view, setView] = useState<View>('home'),
    [mint, setMint] = useState(''),
    [amount, setAmount] = useState('21'),
    [input, setInput] = useState('');
  const [selected, setSelected] = useState<string>(),
    [showToken, setShowToken] = useState(false);
  const runtime = wallet.runtime,
    mints = runtime?.mints() ?? [],
    exists = !!runtime?.store.getReplaceable(17375, runtime.pubkey);
  useEffect(() => {
    setMint(mints[0] ?? '');
    setSelected(undefined);
    setInput('');
    setShowToken(false);
    setView('home');
  }, [pubkey, runtime]);
  const tx = wallet.transactions.find((t) => t.id === selected);
  const choose = (t: WalletTransaction) => {
    setSelected(t.id);
    setShowToken(false);
    setInput('');
  };
  // Camera, image and pasted strings all enter the same review flow.
  const acceptInput = (value: string) => {
    setInput(value);
    const text = value.trim();
    if (/^cashu:/i.test(text) || /^cashu[AB]/.test(text)) setView('receive');
    else if (/^(lightning:|lnbc)/i.test(text)) setView('pay');
    setSelected(undefined);
  };
  const changeView = (next: View) => {
    setView(next);
    setSelected(undefined);
    setInput('');
    setShowToken(false);
    wallet.clearError();
  };
  return (
    <div className={`wallet-panel${full ? ' wallet-full' : ''}`}>
      <div className="wallet-heading">
        <div>
          <span className="eyebrow">YOUR WALLET</span>
          <h2>
            {runtime && exists ? (
              <>
                {wallet.balance.toLocaleString()} <small>sats</small>
              </>
            ) : (
              'Sats, at hand.'
            )}
          </h2>
        </div>
        {runtime && (
          <div className="wallet-actions">
            <Button
              size="icon"
              variant="ghost"
              title="Sync wallet"
              aria-label="Sync wallet"
              disabled={wallet.busy}
              onClick={() =>
                void wallet.run(async (r) => {
                  await r.wallet.flush();
                  await r.refresh();
                })
              }
            >
              <RefreshCw size={17} className={wallet.busy ? 'animate-spin' : ''} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              title="Lock wallet"
              aria-label="Lock wallet"
              onClick={wallet.lock}
            >
              <LockKeyhole size={17} />
            </Button>
          </div>
        )}
      </div>
      {!runtime && (
        <>
          <p>Lightning and Cashu, using your Nostr account.</p>
          <Button disabled={wallet.busy} onClick={() => void wallet.open()}>
            {wallet.busy ? (
              <>
                <LoaderCircle className="animate-spin" /> Opening…
              </>
            ) : pubkey ? (
              'Open wallet'
            ) : (
              'Sign in to open wallet'
            )}
          </Button>
        </>
      )}
      {wallet.error && (
        <p className="wallet-error" role="alert">
          {wallet.error}
        </p>
      )}
      {wallet.busy && (
        <p className="wallet-progress" role="status">
          <LoaderCircle size={16} className="animate-spin" />
          {wallet.progress || 'Checking your wallet…'}
        </p>
      )}
      {!tx && wallet.notice && (
        <p className="wallet-success" role="status">
          <CheckCircle2 size={18} />
          {wallet.notice}
        </p>
      )}
      {runtime && !exists && <MintSettings creating onSaved={() => setView('home')} />}
      {runtime && exists && (
        <>
          {(view !== 'home' || tx) && (
            <Button variant="ghost" className="wallet-back" onClick={() => changeView('home')}>
              ← Wallet actions
            </Button>
          )}
          {!tx && view === 'home' && (
            <>
              <div className="wallet-action-grid" aria-label="Wallet actions">
                {actions.map(([id, label, Icon]) => (
                  <Button key={id} variant="outline" onClick={() => changeView(id)}>
                    <Icon size={18} />
                    {label}
                  </Button>
                ))}
              </div>
              <div className="wallet-tools">
                <Button variant="ghost" onClick={() => changeView('activity')}>
                  <History size={16} />
                  Transactions
                </Button>
                <Button variant="ghost" onClick={() => changeView('settings')}>
                  <Settings2 size={16} />
                  Mints & settings
                </Button>
              </div>
              {wallet.transactions.some((t) => t.status === 'pending' || t.status === 'review') && (
                <p className="wallet-notice">
                  A transaction needs attention.{' '}
                  <button type="button" onClick={() => changeView('activity')}>
                    Review transactions →
                  </button>
                </p>
              )}
            </>
          )}
          {!tx && ['home', 'deposit', 'pay', 'send'].includes(view) && (
            <label className="wallet-field">
              Mint
              <select
                value={mints.includes(mint) ? mint : (mints[0] ?? '')}
                disabled={wallet.busy}
                onChange={(e) => setMint(e.target.value)}
              >
                {mints.map((m) => (
                  <option key={m} value={m}>
                    {new URL(m).hostname} · {(wallet.balances[m] ?? 0).toLocaleString()} sats
                  </option>
                ))}
              </select>
            </label>
          )}
          {!tx && view === 'deposit' && (
            <section className="wallet-form">
              <h3>Receive Lightning</h3>
              <form
                className="wallet-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void wallet.run(async (r) => {
                    await r.wallet.deposit(mint || mints[0], Number(amount));
                    choose(r.wallet.transactions$.value[0]);
                  });
                }}
              >
                <Amount value={amount} set={setAmount} />
                <Button disabled={wallet.busy}>Create invoice</Button>
              </form>
            </section>
          )}
          {!tx && (view === 'receive' || view === 'pay') && (
            <section className="wallet-form">
              <h3>{view === 'receive' ? 'Receive Cashu' : 'Pay Lightning'}</h3>
              <PaymentInput value={input} set={acceptInput} />
              <QrReader onRead={acceptInput} />
              <Button
                disabled={wallet.busy || !input.trim()}
                onClick={() =>
                  void wallet.run(async (r) =>
                    choose(
                      view === 'receive'
                        ? await r.wallet.prepareReceive(input)
                        : await r.wallet.preparePayment(mint || mints[0], input),
                    ),
                  )
                }
              >
                {view === 'receive' ? 'Review token' : 'Review payment & fee'}
              </Button>
            </section>
          )}
          {!tx && view === 'send' && (
            <section className="wallet-form">
              <h3>Send Cashu</h3>
              <p>Share a token as a QR code or text.</p>
              <form
                className="wallet-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void wallet.run(async (r) =>
                    choose(await r.wallet.prepareSend(mint || mints[0], Number(amount))),
                  );
                }}
              >
                <Amount value={amount} set={setAmount} />
                <Button disabled={wallet.busy}>Review token & fee</Button>
              </form>
            </section>
          )}
          {tx && (
            <TransactionDetails
              tx={tx}
              reveal={showToken}
              onReveal={() => setShowToken(true)}
              choose={choose}
            />
          )}
          {!tx && (view === 'activity' || (full && view === 'home')) && (
            <WalletActivity choose={choose} />
          )}
          {!tx && view === 'settings' && <MintSettings onSaved={() => setView('home')} />}
          {!tx && (view === 'home' || view === 'receive') && wallet.nutzaps.length > 0 && (
            <details className="wallet-nutzaps">
              <summary>Incoming nutzaps · {wallet.nutzaps.length}</summary>
              <p>Each token’s mint signature and recipient lock are checked before redemption.</p>
              {wallet.nutzaps.map((event) => (
                <div className="wallet-activity-row" key={event.id}>
                  <div>
                    <strong>{event.pubkey.slice(0, 12)}…</strong>
                    <small>
                      {event.content || 'Nutzap'} ·{' '}
                      {new Date(event.created_at * 1000).toLocaleDateString()}
                    </small>
                  </div>
                  <Button
                    disabled={wallet.busy}
                    variant="outline"
                    onClick={() =>
                      void wallet.run(async (r) => choose(await r.receiveNutzap(event)))
                    }
                  >
                    Review
                  </Button>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </div>
  );
}
function Amount({ value, set }: { value: string; set: (v: string) => void }) {
  return (
    <label className="wallet-field">
      Amount (sats)
      <input
        type="number"
        min="1"
        step="1"
        required
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}
function PaymentInput({ value, set }: { value: string; set: (v: string) => void }) {
  return (
    <label className="wallet-field">
      Invoice or token
      <textarea
        spellCheck={false}
        autoComplete="off"
        rows={3}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder="Paste here, or scan a QR code"
      />
    </label>
  );
}

function TransactionDetails({
  tx,
  reveal,
  onReveal,
  choose,
}: {
  tx: WalletTransaction;
  reveal: boolean;
  onReveal: () => void;
  choose: (tx: WalletTransaction) => void;
}) {
  const { run, busy } = useWallet();
  const [now, setNow] = useState(Date.now() / 1000);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="wallet-transaction">
      <TransactionReview transaction={tx} />
      {tx.status !== 'review' && (
        <>
          <h3>
            {tx.type === 'deposit'
              ? 'Receive Lightning'
              : tx.type === 'send'
                ? 'Send Cashu'
                : transactionNames[tx.type]}
          </h3>
          <p className={tx.status === 'complete' ? 'wallet-success' : ''} role="status">
            {tx.status === 'complete' && <CheckCircle2 size={18} />}
            {transactionFeedback(tx)} · {tx.amount.toLocaleString()} sats
          </p>
          <small>{tx.mint}</small>
        </>
      )}
      {tx.lastError && <p role="status">{tx.lastError}</p>}
      {tx.type === 'deposit' && ['invoice', 'pending'].includes(tx.status) && (
        <>
          {showDepositCode(tx, now) && (
            <PaymentCode value={tx.invoice!} label="Lightning deposit invoice" />
          )}
          {tx.status === 'invoice' &&
            !showDepositCode(tx, now) &&
            !['PAID', 'ISSUED'].includes(tx.quoteState ?? '') && (
              <p role="status">
                This invoice expired. Checking whether it was paid; do not pay it again.
              </p>
            )}
          {tx.quoteExpires && (
            <small className="muted">
              Expires {new Date(tx.quoteExpires * 1000).toLocaleString()}.
            </small>
          )}
          {tx.status === 'invoice' && !!tx.quoteExpires && tx.quoteExpires < now && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run((r) => r.wallet.archiveExpiredInvoice(tx.id))}
            >
              Check & archive expired invoice
            </Button>
          )}
        </>
      )}
      {['invoice', 'pending'].includes(tx.status) && (
        <div className="wallet-actions">
          <Button disabled={busy} onClick={() => void run((r) => r.wallet.resume(tx.id))}>
            Check / recover transaction
          </Button>
          {tx.type === 'melt' && tx.status === 'pending' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run((r) => r.wallet.reclaimPayment(tx.id))}
            >
              Recover unpaid funds
            </Button>
          )}
        </div>
      )}
      {tx.type === 'send' && tx.status === 'complete' && tx.token && tx.tokenState !== 'spent' && (
        <>
          {reveal && (!tx.tokenState || tx.tokenState === 'unspent') ? (
            <PaymentCode
              value={tx.token}
              label="Cashu token — anyone with this code can spend it"
            />
          ) : (
            (!tx.tokenState || tx.tokenState === 'unspent') && (
              <Button variant="outline" onClick={onReveal}>
                Reveal token / QR
              </Button>
            )
          )}
          <p>Checking for redemption while your wallet is open. Share this token only once.</p>
          <details>
            <summary>Token status & recovery</summary>
            <div className="wallet-form">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run((r) => r.wallet.checkSettlement(tx.id))}
              >
                Check token status
              </Button>
              <Button
                variant="outline"
                disabled={busy || tx.tokenState === 'pending' || tx.tokenState === 'partial'}
                onClick={() =>
                  void run(async (r) => choose(await r.wallet.prepareReceive(tx.token!)))
                }
              >
                Review reclaim of unspent token
              </Button>
            </div>
          </details>
        </>
      )}
      {tx.preimage && (
        <details>
          <summary>Payment receipt</summary>
          <p>Payment hash: {tx.paymentHash}</p>
          <p>Preimage: {tx.preimage}</p>
        </details>
      )}
    </section>
  );
}

function WalletActivity({ choose }: { choose: (t: WalletTransaction) => void }) {
  const { runtime, transactions } = useWallet();
  const [remote, setRemote] = useState<WalletRuntime['history$']['value']>([]);
  useEffect(() => {
    if (!runtime) return;
    const sub = runtime.history$.subscribe(setRemote);
    return () => sub.unsubscribe();
  }, [runtime]);
  const localEvents = new Set(
    transactions.flatMap((t) => t.events?.filter((e) => e.kind === 7376).map((e) => e.id) ?? []),
  );
  return (
    <section>
      <h3>Transactions</h3>
      {!transactions.length && !remote.length && <p>No transactions yet.</p>}
      {transactions.map((tx) => (
        <button
          type="button"
          className="wallet-activity-row"
          key={tx.id}
          onClick={() => choose(tx)}
        >
          <span>
            <strong>{transactionNames[tx.type]}</strong>
            <small>
              {new Date(tx.createdAt * 1000).toLocaleString()} · {transactionFeedback(tx)}
            </small>
            <small>{new URL(tx.mint).hostname}</small>
          </span>
          <span>
            {tx.amount.toLocaleString()} sats<small>{tx.fee ? `${tx.fee} sats fee` : ''}</small>
          </span>
        </button>
      ))}
      {remote
        .filter((h) => !localEvents.has(h.id))
        .map((h) => (
          <div className="wallet-activity-row" key={h.id}>
            <span>
              <strong>
                {transactionNames[h.type as keyof typeof transactionNames] ??
                  (h.direction === 'in' ? 'Received' : 'Sent')}
              </strong>
              <small>{new Date(h.date * 1000).toLocaleString()} · From Nostr</small>
              <small>{h.mint}</small>
            </span>
            <span>
              {h.direction === 'in' ? '+' : '−'}
              {h.amount.toLocaleString()} sats<small>{h.fee ? `${h.fee} sats fee` : ''}</small>
            </span>
          </div>
        ))}
    </section>
  );
}

function MintSettings({ creating = false, onSaved }: { creating?: boolean; onSaved: () => void }) {
  const { runtime, run, busy, balances } = useWallet();
  const [mints, setMints] = useState(() => runtime?.mints() ?? []),
    [extra, setExtra] = useState('');
  const [relays, setRelays] = useState(() => runtime?.relays().join('\n') ?? ''),
    [nutzaps, setNutzaps] = useState(
      () =>
        !!runtime?.store.getReplaceable(10019, runtime.pubkey)?.tags.some((t) => t[0] === 'mint'),
    );
  const [consent, setConsent] = useState(!creating),
    [message, setMessage] = useState('');
  if (!runtime) return null;
  return (
    <section className="wallet-settings">
      <h3>{creating ? 'Create your wallet' : 'Mints & recovery'}</h3>
      {creating && (
        <p>
          No wallet was found. If you already use a NIP-60 wallet, enter its relays below or restore
          its backup before creating another.
        </p>
      )}
      <p>
        A mint holds the bitcoin backing your tokens. Choose operators you trust; balances at
        different mints are separate. Start with small amounts.
      </p>
      <fieldset disabled={busy}>
        <legend>Your mints</legend>
        {mints.map((m, i) => (
          <div className="wallet-mint-row" key={i}>
            <label className="wallet-field">
              Mint {i + 1} · {(balances[m] ?? 0).toLocaleString()} sats
              <input
                type="url"
                aria-label={`Mint ${i + 1} URL`}
                value={m}
                onChange={(e) =>
                  setMints((v) => v.map((item, j) => (i === j ? e.target.value : item)))
                }
              />
            </label>
            <Button
              variant="ghost"
              type="button"
              onClick={() => setMints((v) => v.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <label className="wallet-field">
          Add a mint URL
          <input
            type="url"
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            placeholder="https://mint.example"
          />
        </label>
        <Button
          variant="outline"
          type="button"
          disabled={!extra.trim()}
          onClick={() => {
            setMints((v) => [...v, extra.trim()]);
            setExtra('');
          }}
        >
          Add mint
        </Button>
        <details open={creating}>
          <summary>Suggested mints</summary>
          <p className="muted">Independent services, not guarantees or automatic trust.</p>
          <div className="wallet-actions">
            {suggestions.map((m) => (
              <Button
                type="button"
                variant="outline"
                key={m.url}
                title={m.url}
                disabled={mints.includes(m.url)}
                onClick={() => setMints((v) => [...v, m.url])}
              >
                + {m.name}
              </Button>
            ))}
          </div>
        </details>
        <label className="wallet-field">
          Wallet relays (one WSS URL per line)
          <textarea rows={3} value={relays} onChange={(e) => setRelays(e.target.value)} />
        </label>
        {creating && (
          <Button
            variant="outline"
            onClick={() =>
              void run(async (r) => {
                await r.discoverAt(relays.split(/\s+/).filter(Boolean));
                onSaved();
              })
            }
          >
            Find existing wallet at these relays
          </Button>
        )}
        <label className="wallet-check">
          <input type="checkbox" checked={nutzaps} onChange={(e) => setNutzaps(e.target.checked)} />
          Accept nutzaps at these mints
        </label>
        <p className="muted">
          This publishes your accepted mints, wallet relays and a separate receiving key. Your
          balance and tokens stay encrypted.
        </p>
        {creating && (
          <label className="wallet-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I trust the selected mints and understand they hold the backing funds.
          </label>
        )}
        <Button
          disabled={!consent || !mints.length}
          onClick={() =>
            void run(async (r) => {
              await r.wallet.configure(
                mints,
                relays.split(/\s+/).filter(Boolean),
                nutzaps,
                creating,
              );
              await r.refresh();
              onSaved();
            })
          }
        >
          {creating ? 'Create encrypted wallet' : 'Save wallet settings'}
        </Button>
      </fieldset>
      <p className="muted">
        Mints with funds or unresolved transactions cannot be removed. Changing a URL adds a
        different mint; it does not move money.
      </p>
      <details>
        <summary>Backup & recovery</summary>
        <p>
          Confirmed wallet events are encrypted to your Nostr account. Pending payments and unshared
          tokens also need this device’s recovery data. Download a backup before clearing browser
          data. Keep your Nostr account recovery separately.
        </p>
        <div className="wallet-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async (r) => {
                const data = await r.exportBackup();
                const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = `napplet-wallet-${r.pubkey.slice(0, 8)}.json`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                setMessage('Encrypted backup downloaded.');
              })
            }
          >
            Download encrypted backup
          </Button>
          <label className="wallet-upload">
            Restore backup
            <input
              type="file"
              accept="application/json,.json"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f)
                  void run(async (r) => {
                    await r.importBackup(await f.text());
                    setMessage('Backup restored. Check pending transactions in Transactions.');
                  });
              }}
            />
          </label>
        </div>
        {message && <p role="status">{message}</p>}
      </details>
    </section>
  );
}
