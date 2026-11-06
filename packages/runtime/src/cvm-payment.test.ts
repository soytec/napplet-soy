import { expect, test } from 'bun:test';
import { paidInvocation } from './cvm-payment';
import { testInvoice } from '../../wallet/src/fixture';
import { HOST_REQUESTS, RUNTIME_DOMAINS } from './capabilities';
import { nappletPrelude } from './prelude';
const required = (overrides = {}) =>
  Object.assign(new Error('Payment required'), {
    code: -32042,
    data: {
      payment_options: [
        { pmi: 'bitcoin-lightning-bolt11', amount: 21, pay_req: testInvoice(21), ...overrides },
      ],
    },
  });
function setup() {
  let requests = 0,
    approvals = 0;
  const controller = new AbortController();
  const params = { name: 'paid_report', arguments: { receipt: 'private' } };
  const opts = {
    server: 'a'.repeat(64),
    method: 'tools/call',
    params,
    policy: 'prompt' as const,
    signal: controller.signal,
    interaction: () => 'explicit_gating',
    checkout: async (offer: any) => {
      approvals++;
      expect(offer.amountMsat).toBe(21000);
      expect(offer.operation).toBe('paid_report');
    },
    request: async (): Promise<Record<string, unknown>> => {
      requests++;
      if (requests === 1) throw required();
      return { ok: true };
    },
  };
  return { opts, controller, requests: () => requests, approvals: () => approvals };
}
test('explicit gate approves once and retries the identical invocation once', async () => {
  const s = setup();
  expect(await paidInvocation(s.opts)).toEqual({ ok: true });
  expect(s.requests()).toBe(2);
  expect(s.approvals()).toBe(1);
});
test('deny, unconfigured allow, unsupported modes and missing checkout never spend', async () => {
  for (const change of [
    { policy: 'deny' as const },
    { policy: 'allow' as const },
    { checkout: undefined },
    { interaction: () => 'transparent' },
  ]) {
    const s = setup();
    await expect(paidInvocation({ ...s.opts, ...change })).rejects.toThrow('CVM_PAYMENT_REQUIRED');
    expect(s.requests()).toBe(1);
    expect(s.approvals()).toBe(0);
  }
});
test('mismatched, malformed, unsupported and expired native offers never reach checkout', async () => {
  for (const offer of [
    { amount: 22 },
    { pmi: 'other' },
    { pay_req: 'malformed' },
    { ttl: -1 },
    { pay_req: testInvoice(21, undefined, 0) },
  ]) {
    const s = setup();
    await expect(
      paidInvocation({
        ...s.opts,
        request: async () => {
          throw required(offer);
        },
      }),
    ).rejects.toThrow();
    expect(s.approvals()).toBe(0);
  }
});
test('pending or repeated offers never invoke a second checkout or automatic polling', async () => {
  for (const code of [-32042, -32043]) {
    const s = setup();
    let count = 0;
    await expect(
      paidInvocation({
        ...s.opts,
        request: async () => {
          count++;
          throw count === 1 ? required() : Object.assign(new Error('pending'), { code });
        },
      }),
    ).rejects.toThrow('CVM_PAYMENT_PENDING');
    expect(count).toBe(2);
    expect(s.approvals()).toBe(1);
  }
});
test('cancellation after approval stops execution; network errors are never retried', async () => {
  const s = setup();
  await expect(
    paidInvocation({
      ...s.opts,
      checkout: async () => {
        s.controller.abort();
      },
    }),
  ).rejects.toThrow();
  expect(s.requests()).toBe(1);
  let calls = 0;
  await expect(
    paidInvocation({
      ...setup().opts,
      request: async () => {
        calls++;
        throw new Error('transport offline');
      },
    }),
  ).rejects.toThrow('transport offline');
  expect(calls).toBe(1);
});
test('VALUE amendment is not exposed as a runtime or iframe capability', () => {
  expect([...RUNTIME_DOMAINS]).not.toContain('value');
  expect(HOST_REQUESTS.has('value.send')).toBe(false);
  const prelude = nappletPrelude('/* fixture shim */');
  expect(prelude).not.toContain('"value"');
  expect(prelude).toContain('"llm"');
});
