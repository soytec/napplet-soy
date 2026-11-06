import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { z } from 'zod';
import { NostrClientTransport } from '@contextvm/sdk/transport';
import { ApplesauceRelayPool } from '@contextvm/sdk/relay';
import { EncryptionMode, type NostrSigner } from '@contextvm/sdk/core';
import { readRelayUrl } from '../../nostr/src/relay-policy';

export function rtcConfiguration(input: unknown, local = false): RTCConfiguration {
  const value = z
    .object({
      iceServers: z
        .array(
          z
            .object({
              urls: z.array(z.string().max(512)).max(8),
              username: z.string().max(200).optional(),
              credential: z.string().max(200).optional(),
            })
            .strict(),
        )
        .max(4),
      relayOnly: z.boolean().optional(),
    })
    .passthrough()
    .parse(input);
  for (const entry of value.iceServers)
    for (const url of entry.urls) {
      if (!/^(stun|stuns|turn|turns):[^\s@]+$/.test(url)) throw new Error('Invalid ICE URL');
      const address = new URL(url.replace(/^[a-z]+:/, 'wss://'));
      if (local && ['127.0.0.1', '[::1]'].includes(address.hostname)) continue;
      readRelayUrl(address.href, [], true);
    }
  return { iceServers: value.iceServers, iceTransportPolicy: value.relayOnly ? 'relay' : 'all' };
}

export const providerSchema = z
  .object({
    pubkey: z.string().regex(/^[a-f0-9]{64}$/),
    relays: z.array(z.string().max(256)).min(1).max(8),
  })
  .strict();
export type BackendProvider = z.infer<typeof providerSchema>;
export function validateProvider(value: unknown, allowedLocal: string[] = []): BackendProvider {
  const provider = providerSchema.parse(value);
  return {
    pubkey: provider.pubkey,
    relays: [...new Set(provider.relays.map((url) => readRelayUrl(url, allowedLocal, true)))],
  };
}

/** One bounded, encrypted provider session; shared by browsers and compiled soyLI. */
export class CvmConnection {
  readonly client = new Client({ name: 'napplet-soy', version: '1' }, { capabilities: {} });
  private pool: ApplesauceRelayPool;
  private transport: NostrClientTransport;
  private ready?: Promise<void>;
  private dead = false;
  private lifetime = new AbortController();
  get closed() {
    return this.dead;
  }
  get signal() {
    return this.lifetime.signal;
  }
  constructor(
    readonly provider: BackendProvider,
    signer: NostrSigner,
    notify: (message: unknown) => void = () => {},
    explicitPayments = false,
  ) {
    this.pool = new ApplesauceRelayPool(provider.relays, {
      publishOptions: { timeout: 5000, retries: 0 },
    });
    this.transport = new NostrClientTransport({
      signer,
      serverPubkey: provider.pubkey,
      relayHandler: this.pool,
      encryptionMode: EncryptionMode.REQUIRED,
      logLevel: 'silent',
      oversizedTransfer: { enabled: false },
      openStream: { enabled: false },
    });
    if (explicitPayments) {
      this.transport.setClientPmis(['bitcoin-lightning-bolt11']);
      this.transport.setPaymentInteraction('explicit_gating');
    }
    this.client.fallbackNotificationHandler = async (message) => {
      // Native checkout offers belong to the shell, never the untrusted frame.
      // Transparent payments cannot meet our per-invocation approval policy.
      if (message.method.startsWith('notifications/payment_')) {
        if (message.method === 'notifications/payment_required') {
          this.lifetime.abort(
            new Error('CVM_PAYMENT_REQUIRED: This service needs explicit-gating payment support.'),
          );
          void this.close();
        }
        return;
      }
      if (!this.dead) notify(message);
    };
  }
  get paymentInteraction() {
    return this.transport.getEffectivePaymentInteraction();
  }
  async pricedTool(
    method: string,
    params: Record<string, unknown> | undefined,
    timeoutMs: number,
    signal: AbortSignal,
  ) {
    if (method !== 'tools/call') return false;
    if (!this.transport.getServerToolsListEvent())
      await this.request('tools/list', undefined, timeoutMs, signal);
    return (
      this.transport
        .getServerToolsListEvent()
        ?.tags.some((tag) => tag[0] === 'cap' && tag[1] === `tool:${params?.name}`) ?? false
    );
  }
  async request(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = 30000,
    signal?: AbortSignal,
  ) {
    if (this.dead) throw new Error('CVM session closed');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)
      throw new Error('CVM timeout must be between 1 and 300000 ms');
    const deadline = Date.now() + timeoutMs;
    const bounded = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(timeoutMs),
      ...(signal ? [signal] : []),
    ]);
    this.ready ??= this.client
      .connect(this.transport, { timeout: Math.min(10000, timeoutMs), signal: bounded })
      .catch(async (error) => {
        await this.close();
        throw error;
      });
    await this.ready;
    bounded.throwIfAborted();
    const result = await this.client.request(
      { method, ...(params ? { params } : {}) },
      z.object({}).passthrough(),
      { timeout: Math.max(1, deadline - Date.now()), signal: bounded },
    );
    if (JSON.stringify(result).length > 256000) throw new Error('CVM response too large');
    return result;
  }
  async tool(name: string, args: Record<string, unknown> = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content).slice(0, 400));
    return result.structuredContent as Record<string, unknown>;
  }
  async close() {
    if (this.dead) return;
    this.dead = true;
    this.lifetime.abort();
    await this.client.close().catch(() => {});
    await this.pool.disconnect();
  }
}
