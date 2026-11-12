import { z } from 'zod';
import { inspectInvoice } from '../../protocol/src/invoice';
export const invoicePaymentRequest = z
  .object({
    rail: z.literal('bolt11'),
    amountMsat: z.number().int().positive().safe(),
    target: z.object({ type: z.literal('bolt11'), invoice: z.string().max(12000) }).strict(),
    requestKey: z.string().min(1).max(160).optional(),
    maxFeesMsat: z.number().int().nonnegative().safe().optional(),
    comment: z.string().max(500).optional(),
  })
  .strict();
export type InvoicePaymentRequest = z.infer<typeof invoicePaymentRequest>;
type State = 'pending' | 'unknown' | 'settled' | 'failed' | 'cancelled';
export type InvoicePaymentTransfer = {
  ok: boolean;
  transferId: string;
  status: State;
  rail: 'bolt11';
  amountMsat: number;
  updatedAt: number;
  error?: string;
};
type Record = InvoicePaymentTransfer & {
  scope: string;
  request: InvoicePaymentRequest;
  hash: string;
  backendId?: string;
};
export interface InvoicePaymentBackend {
  /** Shell-only availability; absent means the backend is always available. */
  available?: () => boolean;
  subscribeAvailability?: (listener: () => void) => () => void;
  prepare(
    invoice: string,
    signal: AbortSignal,
  ): Promise<{ id: string; feesMsat: number; label: string }>;
  pay(id: string): Promise<State>;
  status(id: string): Promise<State>;
}
type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** Durable intent before dispatch; only the owning app/account can see a transfer. */
/** Shell-internal invoice journal, not a NAP-VALUE domain or frame API. */
export class InvoicePaymentSession {
  constructor(
    private scope: string,
    private store: Store,
    private backend: InvoicePaymentBackend | undefined,
    private signal: AbortSignal,
    private consent: (text: string) => Promise<boolean>,
    private push: (data: { [key: string]: unknown }) => void,
    private lock: <T>(work: () => Promise<T>) => Promise<T>,
  ) {}
  private records(): Record[] {
    // Retain the local prototype journal key so pending spends stay recoverable.
    return JSON.parse(this.store.getItem('napplet:value:v1') ?? '[]');
  }
  private save(record: Record) {
    const rows = this.records().filter((r) => r.transferId !== record.transferId);
    this.store.setItem('napplet:value:v1', JSON.stringify([...rows, record]));
  }
  private visible(r: Record): InvoicePaymentTransfer {
    return {
      ok: r.ok,
      transferId: r.transferId,
      status: r.status,
      rail: r.rail,
      amountMsat: r.amountMsat,
      updatedAt: r.updatedAt,
      ...(r.error ? { error: r.error } : {}),
    };
  }
  async handle(message: {
    type?: unknown;
    request?: unknown;
    transferId?: unknown;
  }): Promise<object> {
    this.signal.throwIfAborted();
    if (message.type === 'invoice.status')
      return this.lock(async () => {
        const record = this.records().find(
          (r) => r.scope === this.scope && r.transferId === message.transferId,
        );
        if (!record) throw new Error('unknown transfer');
        if (record.backendId && ['pending', 'unknown'].includes(record.status) && this.backend) {
          try {
            record.status = await this.backend.status(record.backendId);
            record.updatedAt = Math.floor(Date.now() / 1000);
            record.ok = ['pending', 'settled'].includes(record.status);
            this.save(record);
          } catch {
            /* Keep uncertainty; status checking never retries spending. */
          }
        }
        this.signal.throwIfAborted();
        return { status: { ...this.visible(record), ok: true } };
      });
    const request = invoicePaymentRequest.parse(message.request),
      invoice = inspectInvoice(request.target.invoice);
    if (invoice.msats !== request.amountMsat)
      throw new Error('invalid target: Invoice amount mismatch.');
    if (message.type === 'invoice.quote') {
      if (invoice.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('invoice expired');
      if (!this.backend)
        throw new Error('wallet unavailable: Use the invoice QR or configure the shell wallet.');
      return {
        quote: {
          ok: true,
          rail: 'bolt11',
          amountMsat: invoice.msats,
          expiresAt: invoice.expiresAt,
        },
      };
    }
    if (!request.requestKey || request.maxFeesMsat === undefined)
      throw new Error('invalid target: Supply requestKey and maxFeesMsat.');
    return this.lock(async () => {
      this.signal.throwIfAborted();
      const records = this.records(),
        existing = records.find(
          (r) => r.scope === this.scope && r.request.requestKey === request.requestKey,
        );
      if (existing) {
        if (JSON.stringify(existing.request) !== JSON.stringify(request))
          throw new Error('request key conflict');
        if (existing.status !== 'cancelled') return { result: this.visible(existing) };
      }
      if (
        records.some(
          (r) =>
            r.hash === invoice.paymentHash && r.status !== 'cancelled' && r.status !== 'failed',
        )
      )
        throw new Error(
          'payment already recorded: Check shell wallet activity before doing anything else.',
        );
      if (invoice.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('invoice expired');
      if (!this.backend) throw new Error('wallet unavailable: Use the invoice QR.');
      const prepared = await this.backend.prepare(request.target.invoice, this.signal);
      this.signal.throwIfAborted();
      if (
        !Number.isSafeInteger(prepared.feesMsat) ||
        prepared.feesMsat < 0 ||
        prepared.feesMsat > request.maxFeesMsat!
      )
        throw new Error('amount out of policy: Maximum fees exceed your request.');
      const record: Record = {
        scope: this.scope,
        request,
        hash: invoice.paymentHash,
        backendId: prepared.id,
        transferId: existing?.transferId ?? crypto.randomUUID(),
        status: 'cancelled',
        ok: false,
        rail: 'bolt11',
        amountMsat: invoice.msats,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      if (
        !(await this.consent(
          `Pay ${invoice.msats / 1000} sats from ${prepared.label}?\nMaximum fees: ${prepared.feesMsat / 1000} sats.\nRequested by this napplet. ${request.comment ?? ''}\nInvoice payment hash: ${invoice.paymentHash}`,
        ))
      ) {
        this.save(record);
        return { result: this.visible(record) };
      }
      this.signal.throwIfAborted();
      if (invoice.expiresAt <= Math.floor(Date.now() / 1000)) throw new Error('invoice expired');
      record.status = 'unknown';
      this.save(record); // persisted BEFORE wallet dispatch
      try {
        record.status = await this.backend.pay(prepared.id);
      } catch {
        record.error = 'Payment outcome unconfirmed. Check status; do not pay the invoice again.';
      }
      record.ok = ['pending', 'settled'].includes(record.status);
      record.updatedAt = Math.floor(Date.now() / 1000);
      this.save(record);
      this.signal.throwIfAborted();
      const status = this.visible(record);
      this.push({ type: 'invoice.status.changed', status });
      return { result: status };
    });
  }
}
