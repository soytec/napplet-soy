import { z } from 'zod';
import { inspectInvoice } from '../../protocol/src/invoice';

export type CvmCheckout = (offer: {
  server: string;
  operation: string;
  invoice: string;
  amountMsat: number;
  signal: AbortSignal;
}) => Promise<void>;
export const paymentRequired = () =>
  new Error('CVM_PAYMENT_REQUIRED: Payment requires explicit approval in a compatible shell.');
const offerSchema = z.object({
  payment_options: z
    .array(
      z.object({
        pmi: z.string(),
        amount: z.number().positive().finite(),
        pay_req: z.string().max(12000),
        ttl: z.number().positive().finite().optional(),
      }),
    )
    .min(1)
    .max(16),
});

/** One invocation, one approval, one retry of identical arguments. No payment polling. */
export async function paidInvocation(options: {
  server: string;
  method: string;
  params?: Record<string, unknown>;
  request: () => Promise<Record<string, unknown>>;
  interaction: () => string | undefined;
  policy: 'deny' | 'prompt' | 'allow';
  checkout?: CvmCheckout;
  signal: AbortSignal;
}) {
  try {
    return await options.request();
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code === -32043)
      throw new Error(
        'CVM_PAYMENT_PENDING: Payment is still being confirmed. Do not pay again; use the service’s explicit confirmation action.',
      );
    if (code !== -32042) throw error;
    if (
      options.policy !== 'prompt' ||
      !options.checkout ||
      options.interaction() !== 'explicit_gating'
    )
      throw paymentRequired();
    const parsed = offerSchema.safeParse((error as { data?: unknown }).data);
    if (!parsed.success)
      throw new Error('CVM_PAYMENT_REQUIRED: Invalid payment offer. No payment was made.');
    const offer = parsed.data.payment_options.find((o) => o.pmi === 'bitcoin-lightning-bolt11');
    if (!offer)
      throw new Error('CVM_PAYMENT_REQUIRED: This shell supports Lightning invoices only.');
    const invoice = inspectInvoice(offer.pay_req);
    // ContextVM's BOLT11 PMI quotes sats. The signed invoice is authoritative.
    if (
      invoice.msats !== Math.round(offer.amount * 1000) ||
      !Number.isSafeInteger(offer.amount * 1000)
    )
      throw new Error('CVM_PAYMENT_REQUIRED: Invoice and offer amounts differ.');
    const remaining = Math.min(invoice.expiresAt * 1000 - Date.now(), (offer.ttl ?? 300) * 1000);
    if (remaining <= 0) throw new Error('CVM_PAYMENT_REQUIRED: Invoice expired.');
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(Math.ceil(remaining))]);
    await options.checkout({
      server: options.server,
      operation:
        options.method === 'tools/call'
          ? String(options.params?.name ?? options.method)
          : options.method,
      invoice: offer.pay_req,
      amountMsat: invoice.msats,
      signal,
    });
    signal.throwIfAborted();
    try {
      return await options.request();
    } catch (retryError) {
      if ([-32042, -32043].includes((retryError as { code?: number })?.code ?? 0))
        throw new Error(
          'CVM_PAYMENT_PENDING: The service has not confirmed payment yet. Do not pay again; use its explicit confirmation action.',
        );
      throw retryError; // Never retry an ambiguous execution or replace an invoice.
    }
  }
}
