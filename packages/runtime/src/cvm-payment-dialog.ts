import { presentShellDialog, shellActivity } from './shell-ui';
import QRCode from 'qrcode';
import type { CvmCheckout } from './cvm-payment';
import {
  InvoicePaymentSession,
  type InvoicePaymentBackend,
  type InvoicePaymentTransfer,
} from './invoice-payment-session';
import { chooseCapability } from './capability-dialog';
import { inspectInvoice } from '../../protocol/src/invoice';

/** Trusted, shared checkout. No native payment payload is sent into the napplet. */
export function cvmCheckout(
  scope: string,
  title: string,
  backend?: InvoicePaymentBackend,
): CvmCheckout {
  return async (offer) => {
    offer.signal.throwIfAborted();
    const qr = await QRCode.toDataURL(offer.invoice, { width: 240, margin: 2 });
    offer.signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'capability-dialog';
      Object.assign(dialog.style, {
        padding: '24px',
        maxWidth: 'min(520px, 94vw)',
        borderRadius: '14px',
        background: 'var(--background, white)',
        color: 'var(--foreground, #1e2924)',
      });
      const text = (tag: string, value: string) => {
        const e = document.createElement(tag);
        e.textContent = value;
        dialog.append(e);
        return e;
      };
      text('h2', `${offer.amountMsat / 1000} sats · CVM payment`);
      text('p', `${title} requests ${offer.operation}.`);
      const server = text('p', `Service: ${offer.server}`);
      server.style.overflowWrap = 'anywhere';
      text(
        'p',
        'Pay this Lightning invoice once. Payment does not guarantee report delivery. Keep the app’s recovery receipt.',
      );
      const image = document.createElement('img');
      image.src = qr;
      image.alt = 'Lightning invoice QR';
      Object.assign(image.style, { display: 'block', margin: '12px auto', maxWidth: '100%' });
      dialog.append(image);
      const invoice = document.createElement('input');
      invoice.readOnly = true;
      invoice.value = offer.invoice;
      invoice.setAttribute('aria-label', 'Lightning invoice');
      invoice.style.width = '100%';
      dialog.append(invoice);
      const status = text('p', 'Scan or copy the invoice to use another wallet.');
      status.setAttribute('role', 'status');
      let dispose = () => {};
      let stopAvailability = () => {};
      let activity: ReturnType<typeof shellActivity> | undefined;
      let finished = false,
        busy = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        offer.signal.removeEventListener('abort', abort);
        activity?.dismiss();
        stopAvailability();
        dispose();
        dialog.remove();
        error ? reject(error) : resolve();
      };
      const abort = () =>
        finish(
          new Error('CVM payment cancelled or expired. Check wallet activity before trying again.'),
        );
      const button = (label: string, action: () => void | Promise<void>) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        Object.assign(b.style, { padding: '10px', margin: '6px 8px 0 0' });
        b.onclick = () => {
          void Promise.resolve(action()).catch(() => {
            status.textContent =
              'The action could not complete. Check wallet activity before trying again.';
          });
        };
        dialog.append(b);
        return b;
      };
      const copy = button('Copy invoice', async () => {
        await navigator.clipboard.writeText(offer.invoice);
        status.textContent = 'Invoice copied.';
      });
      const external = button('I’ve paid — continue', () => finish());
      if (backend) {
        const label = text('label', 'Maximum wallet fees (sats) ');
        const fees = document.createElement('input');
        fees.type = 'number';
        fees.min = '0';
        fees.step = '1';
        fees.value = '10';
        fees.style.width = '70px';
        label.append(fees);
        const pay = button('Pay from wallet', async () => {
          if (busy) return;
          if (backend.available?.() === false) {
            status.textContent =
              'Shell wallet unavailable. Scan or copy the invoice to use another wallet.';
            return;
          }
          const maxFeesMsat = Number(fees.value) * 1000;
          if (!Number.isSafeInteger(maxFeesMsat) || maxFeesMsat < 0) {
            status.textContent = 'Enter a valid maximum fee.';
            return;
          }
          busy = true;
          pay.disabled = true;
          copy.disabled = true;
          external.disabled = true;
          dispose();
          activity = shellActivity('Preparing your wallet payment…');
          const journal = new InvoicePaymentSession(
            scope,
            localStorage,
            backend,
            offer.signal,
            async (message) => {
              activity?.update('Review the payment in the shell dialog.');
              const approved =
                (await chooseCapability(
                  message,
                  [{ id: 'approve', label: 'Approve this payment' }],
                  offer.signal,
                )) === 'approve';
              activity?.update('Submitting your approved wallet payment…');
              return approved;
            },
            () => {},
            async (work) => {
              if (!navigator.locks) throw new Error('Wallet requires Web Locks.');
              return navigator.locks.request('napplet:value:spend', work);
            },
          );
          try {
            const result = (await journal.handle({
              type: 'invoice.send',
              request: {
                rail: 'bolt11',
                target: { type: 'bolt11', invoice: offer.invoice },
                amountMsat: offer.amountMsat,
                requestKey: `cvm:${offer.server}:${inspectInvoice(offer.invoice).paymentHash}`,
                maxFeesMsat,
                comment: `${title}: ${offer.operation}`.slice(0, 500),
              },
            })) as { result: InvoicePaymentTransfer };
            if (result.result.status === 'settled') {
              activity?.success('Wallet payment confirmed.');
              activity = undefined;
              finish();
              return;
            }
            if (result.result.status === 'cancelled') {
              busy = false;
              pay.disabled = false;
              copy.disabled = false;
              external.disabled = false;
              activity?.dismiss();
              status.textContent = 'Payment cancelled.';
            } else {
              activity?.error('Payment is unconfirmed. Check wallet activity before paying again.');
              image.remove();
              invoice.remove();
              status.textContent =
                'Payment is unconfirmed. Check wallet activity and the service’s confirmation action; do not pay again.';
              external.textContent = 'Return to service';
              external.disabled = false;
            }
          } catch {
            activity?.error(
              'Payment could not be confirmed. Check wallet activity before paying again.',
            );
            image.remove();
            invoice.remove();
            status.textContent =
              'Payment did not complete or its outcome is unknown. Check wallet activity; do not pay again.';
            external.textContent = 'Return to service';
            external.disabled = false;
          }
          if (!finished && !offer.signal.aborted) dispose = presentShellDialog(dialog);
        });
        const updateAvailability = () => {
          const available = backend.available?.() !== false;
          label.hidden = !available;
          pay.hidden = !available;
          // Never re-enable an uncertain or in-progress payment on a setting change.
          pay.disabled = busy || !available;
        };
        updateAvailability();
        stopAvailability = backend.subscribeAvailability?.(updateAvailability) ?? (() => {});
      }
      button('Close', () =>
        finish(new Error('CVM payment cancelled. Your service order remains recoverable.')),
      );
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        abort();
      });
      offer.signal.addEventListener('abort', abort, { once: true });
      document.body.append(dialog);
      dispose = presentShellDialog(dialog);
    });
  };
}
