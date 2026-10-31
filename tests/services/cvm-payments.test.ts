import { expect, test } from 'bun:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  NostrServerTransport,
  PrivateKeySigner,
  ApplesauceRelayPool,
  EncryptionMode,
  withServerPayments,
} from '@contextvm/sdk';
import { z } from 'zod';
import { startLocalBackendRelay } from '../../packages/multiplayer/src/local-relay';
import { NappletBackend } from '../../packages/runtime/src/backend-session';
import { testInvoice } from '../../packages/wallet/src/fixture';

test('encrypted NAP-CVM: native gate, stable free identity, deny isolation, same paid retry and no offers forwarded to frame', async () => {
  const relay = startLocalBackendRelay(),
    signer = new PrivateKeySigner('1'.repeat(64)),
    pool = new ApplesauceRelayPool([relay.url]);
  const server = new McpServer({ name: 'paid-fixture', version: '1' });
  let created = 0,
    paid = false,
    runs = 0,
    approvals = 0;
  const actors: string[] = [],
    notifications: unknown[] = [];
  const invoice = testInvoice(21);
  server.registerTool('free', { inputSchema: {} }, async (_args, extra) => ({
    content: [],
    structuredContent: { actor: extra._meta?.clientPubkey },
  }));
  server.registerTool(
    'report',
    { inputSchema: { receipt: z.string() } },
    async ({ receipt }, extra) => {
      runs++;
      actors.push(String(extra._meta?.clientPubkey));
      return { content: [], structuredContent: { receipt } };
    },
  );
  const transport = withServerPayments(
    new NostrServerTransport({
      signer,
      relayHandler: pool,
      injectClientPubkey: true,
      encryptionMode: EncryptionMode.REQUIRED,
      logLevel: 'silent',
    }),
    {
      pricedCapabilities: [
        { method: 'tools/call', name: 'report', amount: 21, currencyUnit: 'sats' },
      ],
      processors: [
        {
          pmi: 'bitcoin-lightning-bolt11',
          createPaymentRequired: async () => {
            created++;
            return { amount: 21, pmi: 'bitcoin-lightning-bolt11', pay_req: invoice, ttl: 60 };
          },
          verifyPayment: async ({ abortSignal }) => {
            while (!paid && !abortSignal?.aborted) await Bun.sleep(5);
            if (abortSignal?.aborted) throw new Error('cancelled');
            return {};
          },
        },
      ],
    },
  );
  await server.connect(transport);
  const provider = { pubkey: await signer.getPublicKey(), relays: [relay.url] };
  const clientSigner = new PrivateKeySigner('2'.repeat(64));
  const backend = new NappletBackend(
    clientSigner,
    [relay.url],
    provider,
    (m) => notifications.push(m),
    async () => true,
    [],
    undefined,
    async (offer) => {
      approvals++;
      expect(offer.invoice).toBe(invoice);
      paid = true;
      await Bun.sleep(30);
    },
  );
  const call = (name: string, payment: 'deny' | 'prompt' | 'allow' = 'prompt') =>
    backend.handle({
      type: 'cvm.request',
      server: provider,
      message: {
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: { name, arguments: name === 'free' ? {} : { receipt: 'exact-input' } },
      },
      options: { payment, timeoutMs: 15000 },
    }) as Promise<any>;
  try {
    const first = await call('free'),
      next = await call('free');
    expect(first.message.result.structuredContent.actor).toBe(await clientSigner.getPublicKey());
    expect(next.message.result.structuredContent.actor).toBe(
      first.message.result.structuredContent.actor,
    );
    for (const policy of ['deny', 'allow'] as const)
      expect((await call('report', policy)).message.error.message).toContain(
        'CVM_PAYMENT_REQUIRED',
      );
    expect(created).toBe(0);
    expect(approvals).toBe(0);
    const result = await call('report');
    expect(result.message.error).toBeUndefined();
    expect(result.message.result.structuredContent.receipt).toBe('exact-input');
    expect(created).toBe(1);
    expect(approvals).toBe(1);
    expect(runs).toBe(1);
    expect(actors[0]).not.toBe(await clientSigner.getPublicKey());
    expect((await call('report', 'deny')).message.error.message).toContain('CVM_PAYMENT_REQUIRED');
    expect(runs).toBe(1);
    expect(JSON.stringify(notifications)).not.toContain(invoice);
    paid = false;
    let entered!: () => void;
    const opened = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const cancelled = new NappletBackend(
      new PrivateKeySigner('3'.repeat(64)),
      [relay.url],
      provider,
      () => {},
      async () => true,
      [],
      undefined,
      (offer) =>
        new Promise<void>((_resolve, reject) => {
          entered();
          offer.signal.addEventListener('abort', () => reject(new Error('Checkout cancelled')), {
            once: true,
          });
        }),
    );
    try {
      const running = cancelled.handle({
        type: 'cvm.request',
        server: provider,
        message: {
          jsonrpc: '2.0',
          id: 'cancel',
          method: 'tools/call',
          params: { name: 'report', arguments: { receipt: 'cancelled' } },
        },
        options: { payment: 'prompt', timeoutMs: 15000 },
      }) as Promise<any>;
      await Promise.race([
        opened,
        running.then((result) => {
          throw new Error(JSON.stringify(result));
        }),
      ]);
      await cancelled.handle({ type: 'cvm.close', server: provider });
      expect((await running).message.error.message).toContain('cancelled');
      expect(runs).toBe(1);
    } finally {
      cancelled.close();
    }
  } finally {
    backend.close();
    await server.close();
    await pool.disconnect();
    relay.close();
  }
}, 60000);
