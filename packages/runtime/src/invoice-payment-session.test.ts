import { expect, test } from 'bun:test';
import { InvoicePaymentSession, type InvoicePaymentBackend } from './invoice-payment-session';
import { testInvoice } from '../../wallet/src/fixture';
const request = () => ({
  rail: 'bolt11',
  target: { type: 'bolt11', invoice: testInvoice(21) },
  amountMsat: 21000,
  requestKey: 'order-secret',
  maxFeesMsat: 1000,
});
function setup() {
  const data = new Map<string, string>(),
    store = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => {
        data.set(k, v);
      },
    };
  let payments = 0,
    approved = true;
  const backend: InvoicePaymentBackend = {
    prepare: async () => ({ id: 'wallet-tx', feesMsat: 1000, label: 'Fixture mint' }),
    pay: async () => {
      payments++;
      return 'settled';
    },
    status: async () => 'settled',
  };
  const make = (scope = 'app:alice') =>
    new InvoicePaymentSession(
      scope,
      store,
      backend,
      new AbortController().signal,
      async () => approved,
      () => {},
      async (f) => f(),
    );
  return {
    make,
    backend,
    data,
    payments: () => payments,
    consent: (v: boolean) => {
      approved = v;
    },
  };
}
test('send journals before spending and repeated/reloaded requests do not pay twice', async () => {
  const s = setup(),
    r = request();
  const a: any = await s.make().handle({ type: 'invoice.send', request: r }),
    b: any = await s.make().handle({ type: 'invoice.send', request: r });
  expect(a.result.status).toBe('settled');
  expect(b.result.transferId).toBe(a.result.transferId);
  expect(s.payments()).toBe(1);
  await expect(
    s.make('app:bob').handle({ type: 'invoice.status', transferId: a.result.transferId }),
  ).rejects.toThrow('unknown');
  await expect(
    s.make().handle({ type: 'invoice.send', request: { ...r, maxFeesMsat: 2000 } }),
  ).rejects.toThrow('conflict');
});
test('uncertain payment survives reload and only status reconciles it', async () => {
  const s = setup(),
    r = request();
  let calls = 0;
  s.backend.pay = async () => {
    calls++;
    expect([...s.data.values()].join()).toContain('unknown');
    throw new Error('transport lost');
  };
  const a: any = await s.make().handle({ type: 'invoice.send', request: r });
  expect(a.result.status).toBe('unknown');
  await s.make().handle({ type: 'invoice.send', request: r });
  expect(calls).toBe(1);
  const state: any = await s
    .make()
    .handle({ type: 'invoice.status', transferId: a.result.transferId });
  expect(state.status.status).toBe('settled');
});
test('declined requests can be consented again without accumulating stale intent records', async () => {
  const s = setup(),
    r = request();
  s.consent(false);
  const declined: any = await s.make().handle({ type: 'invoice.send', request: r });
  expect(declined.result.status).toBe('cancelled');
  expect(s.payments()).toBe(0);
  s.consent(true);
  const accepted: any = await s.make().handle({ type: 'invoice.send', request: r });
  expect(accepted.result.transferId).toBe(declined.result.transferId);
  await s.make().handle({ type: 'invoice.send', request: r });
  expect(s.payments()).toBe(1);
});
test('invoice amount, expiry and fee ceilings are checked before payment', async () => {
  const s = setup(),
    r = request();
  await expect(
    s.make().handle({ type: 'invoice.send', request: { ...r, amountMsat: 22000 } }),
  ).rejects.toThrow('amount mismatch');
  await expect(
    s.make().handle({ type: 'invoice.send', request: { ...r, maxFeesMsat: 999 } }),
  ).rejects.toThrow('fees');
  await expect(
    s.make().handle({
      type: 'invoice.send',
      request: { ...r, target: { type: 'bolt11', invoice: testInvoice(21, undefined, 0) } },
    }),
  ).rejects.toThrow('expired');
  expect(s.payments()).toBe(0);
});
