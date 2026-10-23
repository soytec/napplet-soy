import { lazy, Suspense } from 'react';
const MintInvoicePayment = lazy(() =>
  import('./wallet/wallet-zap').then((m) => ({ default: m.MintInvoicePayment })),
);
const NutzapOption = lazy(() =>
  import('./wallet/wallet-zap').then((m) => ({ default: m.NutzapOption })),
);
import { readSocial } from '@/lib/protocol-social';
import { readAvailableProfile } from '../../../../packages/client/src/social';
import {
  resolveZapEndpoint,
  requestZapInvoice,
  zapTotals,
  type ZapInvoice,
} from '../../../../packages/client/src/zaps';
import { commentScope } from '../../../../packages/protocol/src/social';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Zap, Check, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import { useNostr } from './nostr-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { signForAccount, signAnonymousZap } from '@/lib/community-client';
import { protocolClient, network } from '@/lib/network';
import { zapTotalsStore, useZapTotals } from '@/lib/zap-totals';
import { zapPayments } from '@/lib/zap-payments';
import type { SignedEvent } from '../../../../packages/protocol/src';
import type { SocialScope } from '../../../../packages/protocol/src/social';
import type { ZapEndpoint } from '../../../../packages/backend/src/zaps';
import { LightningCode } from './lightning-code';
const short = (pubkey: string) => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
export function ZapButton({
  data,
  reference,
  commentTarget,
  trigger,
}: {
  data: { manifest: SignedEvent; scope: SocialScope; relays: string[] };
  reference: string;
  commentTarget?: SignedEvent;
  trigger?: ReactElement;
}) {
  const { pubkey } = useNostr();
  const keyRef = useRef(pubkey);
  keyRef.current = pubkey;
  const [open, setOpen] = useState(false),
    [endpoint, setEndpoint] = useState<ZapEndpoint | null>(null),
    [sats, setSats] = useState('21'),
    [comment, setComment] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [invoice, setInvoice] = useState<ZapInvoice | null>(null),
    [paymentState, setPaymentState] = useState<'waiting' | 'paid' | 'expired' | 'unavailable'>(
      'waiting',
    ),
    [webln, setWebln] = useState(false),
    [relayHints, setRelayHints] = useState(data.relays),
    [anonymous, setAnonymous] = useState(!pubkey);
  const asAnonymous = !pubkey || anonymous;
  const target = commentTarget ?? data.manifest;
  const scope = commentTarget ? commentScope(commentTarget) : data.scope;
  const totals = useZapTotals(scope.key);
  const current = useRef({ open, invoice, target: scope.key });
  current.current = { open, invoice, target: scope.key };
  useEffect(() => {
    const pending = zapPayments.pending(scope.key);
    if (pending) {
      current.current.invoice = pending.invoice;
      setInvoice(pending.invoice);
      setEndpoint(pending.endpoint);
      setRelayHints(pending.relays);
    }
    return zapPayments.watch(scope.key, ({ paymentHash, state }) => {
      if (
        current.current.invoice?.paymentHash !== paymentHash ||
        current.current.target !== scope.key
      )
        return;
      setPaymentState(state);
      if (state === 'paid') {
        setBusy(false);
        setMessage('');
      }
    });
  }, [scope.key]);
  useEffect(
    () => () => {
      current.current.open = false;
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setMessage('');
    const pending = zapPayments.pending(scope.key);
    setWebln(!!(window as any).webln);
    if (pending) {
      current.current.invoice = pending.invoice;
      setInvoice(pending.invoice);
      setEndpoint(pending.endpoint);
      setRelayHints(pending.relays);
      return () => controller.abort();
    }
    setEndpoint(null);
    setInvoice(null);
    setPaymentState('waiting');
    setAnonymous(!pubkey);
    setWebln(!!(window as any).webln);
    (async () => {
      if (target.tags.some((t) => t[0] === 'zap'))
        throw new Error(
          'This creation requests split zaps. Use a client supporting its recipient split.',
        );
      const relays = [...new Set([...network().relays, ...data.relays])].slice(0, 8);
      const event = await readAvailableProfile(
        protocolClient(),
        target.pubkey,
        relays,
        controller.signal,
      );
      const endpoint = await resolveZapEndpoint(
        target.pubkey,
        event ? [event] : [],
        undefined,
        controller.signal,
      );
      // Receipt totals are independent of preparing a payment. Keep them in the background.
      void readSocial(data.manifest, data.relays, controller.signal)
        .then(async (social) => {
          const context = { ...data, manifest: target, scope };
          const targets = commentTarget
            ? new Map([[commentTarget.id, commentTarget]])
            : social.manifests;
          const value = await zapTotals(context, social, endpoint, targets);
          if (!controller.signal.aborted) zapTotalsStore.observe(scope.key, value.receipts);
        })
        .catch(() => {
          /* Existing verified totals survive a failed refresh. */
        });
      return { endpoint, relays };
    })()
      .then((value) => {
        if (controller.signal.aborted) return;
        setEndpoint(value.endpoint);
        setRelayHints(value.relays ?? data.relays);
        setSats(
          String(
            Math.min(
              Math.floor(value.endpoint.maxSendable / 1000),
              Math.max(21, Math.ceil(value.endpoint.minSendable / 1000)),
            ),
          ),
        );
      })
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [open, reference, target.id]);
  useEffect(() => {
    if (!open || paymentState !== 'paid') return;
    const timer = setTimeout(() => setOpen(false), 1200);
    return () => clearTimeout(timer);
  }, [open, paymentState]);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          if (value) {
            const pending = zapPayments.pending(scope.key);
            current.current.invoice = pending?.invoice ?? null;
            setInvoice(pending?.invoice ?? null);
            setPaymentState('waiting');
          }
          setOpen(value);
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button
            data-tone="gold"
            data-effect="zap"
            variant={commentTarget ? 'ghost' : 'outline'}
            size={commentTarget ? 'xs' : 'default'}
            aria-label={commentTarget ? 'Zap comment' : undefined}
          >
            <Zap size={16} />
            {!totals ? 'Zap' : `${(totals.msats / 1000).toLocaleString()} sats zapped`}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="zap-dialog">
        <DialogHeader>
          <DialogTitle>
            {commentTarget
              ? 'A little lightning for the commenter'
              : 'A little lightning for the creator'}
          </DialogTitle>
          <DialogDescription>
            Send Lightning sats or Cashu nutzaps to the author. Review the amount and confirm with
            your chosen wallet.
          </DialogDescription>
        </DialogHeader>
        {endpoint && !invoice && (
          <form
            className="community-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setMessage('');
              try {
                const targetKey = scope.key;
                const msats = Number(sats) * 1000;
                if (
                  !Number.isSafeInteger(msats) ||
                  msats < endpoint.minSendable ||
                  msats > endpoint.maxSendable
                )
                  throw new Error('Choose an amount within the displayed range.');
                const relays = relayHints.filter((r) => r.startsWith('wss:')).slice(0, 6);
                if (!relays.length)
                  throw new Error(
                    'Zaps need public relays. Local-only development does not send Lightning requests.',
                  );
                const template = {
                  kind: 9734,
                  created_at: Math.floor(Date.now() / 1000),
                  content: comment,
                  tags: [
                    ['p', endpoint.pubkey],
                    ['e', target.id],
                    ['k', String(target.kind)],
                    ...(!commentTarget && data.scope.address ? [['a', data.scope.address]] : []),
                    ['amount', String(msats)],
                    ['lnurl', endpoint.lnurl],
                    ['relays', ...relays],
                  ],
                };
                const event = asAnonymous
                  ? await signAnonymousZap(template)
                  : await signForAccount(pubkey!, template);
                if (!asAnonymous && keyRef.current !== pubkey)
                  throw new Error('Your account changed.');
                const context = {
                  ...data,
                  manifest: target,
                  scope: commentTarget ? commentScope(commentTarget) : data.scope,
                };
                const prepared = await requestZapInvoice(
                  context,
                  new Map([[target.id, target]]),
                  endpoint,
                  event,
                );
                if (!current.current.open || current.current.target !== targetKey) return;
                const pending = zapPayments.remember({
                  target,
                  endpoint,
                  relays: relayHints.filter((relay) => new URL(relay).protocol === 'wss:'),
                  invoice: prepared,
                });
                current.current.invoice = pending.invoice;
                setInvoice(pending.invoice);
                setPaymentState('waiting');
                if (!zapPayments.durable)
                  setMessage(
                    'This browser could not save invoice recovery. Keep the page open until confirmation.',
                  );
              } catch (error) {
                setMessage((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {pubkey && (
              <label className="anonymous-choice">
                <input
                  type="checkbox"
                  checked={anonymous}
                  disabled={busy}
                  onChange={(event) => setAnonymous(event.target.checked)}
                />
                Zap anonymously
              </label>
            )}
            {asAnonymous && (
              <p className="muted">
                A fresh one-time key signs this zap. Your Nostr profile is not attached; the payment
                and receipt remain public.
              </p>
            )}
            <label>
              Satoshis
              <input
                type="number"
                min={Math.ceil(endpoint.minSendable / 1000)}
                max={Math.floor(endpoint.maxSendable / 1000)}
                step="1"
                value={sats}
                onChange={(e) => setSats(e.target.value)}
                required
                disabled={busy}
              />
            </label>
            <p className="muted">
              {Math.ceil(endpoint.minSendable / 1000).toLocaleString()}–
              {Math.floor(endpoint.maxSendable / 1000).toLocaleString()} sats ·{' '}
              {new URL(endpoint.callback).hostname}
            </p>
            {endpoint.commentAllowed > 0 && (
              <label>
                Note (optional)
                <input
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={endpoint.commentAllowed}
                  disabled={busy}
                />
              </label>
            )}
            <Button disabled={busy}>
              {busy
                ? 'Preparing invoice…'
                : asAnonymous
                  ? 'Create anonymous zap invoice'
                  : 'Create zap invoice'}
            </Button>
          </form>
        )}
        {invoice && paymentState === 'paid' && (
          <div className="zap-invoice" role="status" aria-live="polite">
            <Check size={32} aria-hidden="true" />
            <strong>Zap sent!</strong>
            <p>{(invoice.msats / 1000).toLocaleString()} sats sent. Thank you!</p>
          </div>
        )}
        {invoice && paymentState === 'expired' && (
          <div className="zap-invoice" role="status">
            <p>
              This invoice has expired. If you already paid, check your wallet before creating
              another.
            </p>
            <Button
              onClick={() => {
                current.current.invoice = null;
                setInvoice(null);
                setPaymentState('waiting');
                setMessage('');
              }}
            >
              Create another invoice
            </Button>
          </div>
        )}
        {invoice && (paymentState === 'waiting' || paymentState === 'unavailable') && (
          <div className="zap-invoice">
            <strong>
              {(invoice.msats / 1000).toLocaleString()} sats to {short(target.pubkey)}
            </strong>
            <p role="status">
              <LoaderCircle size={16} className="animate-spin inline" aria-hidden="true" /> Waiting
              for payment…
            </p>
            {paymentState === 'unavailable' && (
              <p role="status">
                Payment confirmation is temporarily unavailable. Your wallet may have paid; we’ll
                keep checking.
              </p>
            )}
            {!invoice.verify && (
              <p className="muted">
                This provider does not offer a payment-status URL. Confirmation depends on its
                public zap receipt.
              </p>
            )}
            <Button variant="outline" onClick={() => zapPayments.checkNow(scope.key)}>
              Check payment
            </Button>
            <Suspense fallback={<p>Loading wallet payment…</p>}>
              <MintInvoicePayment invoice={invoice} scope={scope.key} />
            </Suspense>
            <LightningCode value={invoice.invoice} label="Zap invoice QR code" />
            <textarea aria-label="Lightning invoice" readOnly value={invoice.invoice} />
            <div className="social-actions">
              <Button asChild>
                <a href={`lightning:${invoice.invoice}`}>Open Lightning wallet</a>
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  navigator.clipboard
                    .writeText(invoice.invoice)
                    .then(() => setMessage('Invoice copied.'))
                    .catch(() => setMessage('Select and copy the invoice above.'))
                }
              >
                Copy invoice
              </Button>
              {webln && (
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setMessage('');
                    try {
                      if (invoice.expiresAt <= Date.now() / 1000)
                        throw new Error('This invoice has expired. Create another.');
                      const wallet = (window as any).webln;
                      await wallet.enable();
                      const result = await wallet.sendPayment(invoice.invoice);
                      const confirmed = zapPayments.confirmPreimage(
                        scope.key,
                        invoice.paymentHash,
                        result?.preimage,
                      );
                      if (!current.current.open || current.current.invoice !== invoice) return;
                      if (!confirmed)
                        setMessage('Your wallet reports payment sent. Waiting for confirmation…');
                    } catch (error) {
                      if (current.current.open && current.current.invoice === invoice)
                        setMessage((error as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Pay with browser wallet
                </Button>
              )}
            </div>
            <p className="muted">
              Expires {new Date(invoice.expiresAt * 1000).toLocaleTimeString()}. Keep this invoice
              until your wallet confirms its status. Pending invoices are remembered in this browser
              so confirmation can resume after a reload.
            </p>
          </div>
        )}
        {!endpoint && !message && <p role="status">Looking up the creator’s Lightning address…</p>}
        {message && <p role="status">{message}</p>}
        {!invoice && (
          <Suspense fallback={<p>Loading nutzap options…</p>}>
            <NutzapOption target={target} relays={data.relays} />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  );
}
