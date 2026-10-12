import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { inspectInvoice } from '../../protocol/src/invoice';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { commentScope, socialScope, oneTag } from '../../protocol/src/social';
import { resourceUrl } from './bytes';
import {
  checkZapPayment,
  validPaymentPreimage,
  validZapRequest,
  verifiedZapReceipt,
  type ZapInvoice,
  type ZapEndpoint,
} from './zaps';
import type { ZapTotalsStore, ZapStorage } from './zap-totals';

const KEY = 'napplet:zap-invoices:v1';
const RETENTION = 86400000;
export type PendingZap = {
  target: SignedEvent;
  endpoint: ZapEndpoint;
  relays: string[];
  invoice: ZapInvoice;
  savedAt: number;
};
export type ZapPaymentState = 'waiting' | 'paid' | 'expired' | 'unavailable';
type Notice = { paymentHash: string; state: ZapPaymentState };
const scopeOf = (record: PendingZap) =>
  record.target.kind === 1111 ? commentScope(record.target) : socialScope(record.target);
export function zapReceiptFilters(record: PendingZap) {
  const scope = scopeOf(record);
  const base = {
    kinds: [9735],
    authors: [record.endpoint.nostrPubkey],
    '#p': [record.target.pubkey],
    since: record.invoice.request.created_at - 60,
    limit: 50,
  };
  return [
    { ...base, '#e': [oneTag(record.invoice.request, 'e')!] },
    ...(scope.address ? [{ ...base, '#a': [scope.address] }] : []),
  ];
}

type Job = {
  record: PendingZap;
  controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  running: boolean;
  state: ZapPaymentState;
};
/** Invoice lifetime belongs to the payment, not the open dialog. Storage is local
 * to the browser; neither reminders nor confirmations are published as receipts. */
export class ZapPayments {
  durable = false;
  private records: PendingZap[] | undefined;
  private listeners = new Map<string, Set<(notice: Notice) => void>>();
  private jobs = new Map<string, Job>();
  constructor(
    private options: {
      totals: ZapTotalsStore;
      storage?: () => ZapStorage;
      query: (
        record: PendingZap,
        signal: AbortSignal,
        receive: (event: SignedEvent) => void,
      ) => Promise<SignedEvent[]>;
      check?: typeof checkZapPayment;
      now?: () => number;
    },
  ) {}
  private now = () => (this.options.now ?? Date.now)();
  private key(record: PendingZap) {
    return `${scopeOf(record).key}:${record.invoice.paymentHash}`;
  }
  private valid(input: unknown): PendingZap {
    const record = input as PendingZap;
    const target = verifiedEvent(record.target);
    if (![35129, 15129, 5129, 1111].includes(target.kind)) throw new Error('Wrong payment target');
    const request = verifiedEvent(record.invoice.request);
    const invoice = inspectInvoice(record.invoice.invoice);
    const endpoint = record.endpoint;
    if (
      !/^[a-f0-9]{64}$/.test(endpoint.nostrPubkey) ||
      endpoint.pubkey !== target.pubkey ||
      !Array.isArray(record.relays) ||
      !record.relays.length ||
      record.relays.length > 8 ||
      record.relays.some((value) => {
        if (typeof value !== 'string' || value.length > 256) return true;
        const url = new URL(value);
        return url.protocol !== 'wss:' || !!url.username || !!url.password || !!url.hash;
      }) ||
      !Number.isSafeInteger(record.savedAt) ||
      record.savedAt > this.now() + 60000 ||
      invoice.expiresAt * 1000 + RETENTION <= this.now() ||
      invoice.paymentHash !== record.invoice.paymentHash ||
      invoice.msats !== record.invoice.msats ||
      invoice.expiresAt !== record.invoice.expiresAt ||
      (invoice.descriptionHash !== null &&
        invoice.descriptionHash !==
          bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(record.invoice.request)))))
    )
      throw new Error('Invalid saved invoice');
    resourceUrl(endpoint.callback);
    if (record.invoice.verify) resourceUrl(record.invoice.verify);
    const scope = scopeOf({ ...record, target });
    const amount = validZapRequest(request, scope, new Map([[target.id, target]]), {
      ...endpoint,
      minSendable: 1,
      maxSendable: 1000000000,
      commentAllowed: 4000,
    });
    if (amount !== invoice.msats) throw new Error('Wrong saved invoice amount');
    return { ...record, target, invoice: { ...record.invoice } };
  }
  private all() {
    if (!this.records) {
      this.records = [];
      try {
        const raw = this.options.storage?.().getItem(KEY);
        if (raw && raw.length <= 524288) {
          const saved = JSON.parse(raw);
          if (Array.isArray(saved))
            for (const value of saved.slice(-32))
              try {
                this.records.push(this.valid(value));
              } catch {
                /* Invalid reminders cannot count as payments. */
              }
        }
      } catch {
        /* The payment still works when browser storage is unavailable. */
      }
    }
    return this.records;
  }
  private persist() {
    this.records = this.all()
      .filter((r) => r.invoice.expiresAt * 1000 + RETENTION > this.now())
      .slice(-32);
    while (JSON.stringify(this.records).length > 524288) this.records.shift();
    try {
      this.options.storage?.().setItem(KEY, JSON.stringify(this.records));
      this.durable = !!this.options.storage;
    } catch {
      this.durable = false;
    }
  }
  pending(scope: string) {
    return this.all()
      .filter(
        (r) => scopeOf(r).key === scope && r.invoice.expiresAt * 1000 + RETENTION > this.now(),
      )
      .at(-1);
  }
  remember(input: Omit<PendingZap, 'savedAt'>) {
    const record = this.valid({ ...input, savedAt: this.now() });
    this.records = [...this.all().filter((r) => this.key(r) !== this.key(record)), record];
    this.persist();
    this.begin(record);
    return record;
  }
  confirmPreimage(scope: string, paymentHash: string, preimage: unknown) {
    if (!validPaymentPreimage(preimage, paymentHash)) return false;
    if (!this.all().some((r) => scopeOf(r).key === scope && r.invoice.paymentHash === paymentHash))
      return this.options.totals.has(scope, paymentHash);
    this.finish(scope, paymentHash);
    return true;
  }
  private finish(scope: string, paymentHash: string) {
    const record = this.all().find(
      (r) => scopeOf(r).key === scope && r.invoice.paymentHash === paymentHash,
    );
    if (!record) return;
    this.options.totals.confirm(scope, record.invoice);
    this.records = this.all().filter((r) => this.key(r) !== this.key(record));
    this.persist();
    const job = this.jobs.get(this.key(record));
    if (job) {
      job.state = 'paid';
      clearTimeout(job.timer);
      job.controller.abort();
      this.jobs.delete(this.key(record));
    }
    this.emit(record, 'paid');
  }
  private emit(record: PendingZap, state: ZapPaymentState) {
    for (const listener of this.listeners.get(scopeOf(record).key) ?? [])
      listener({ paymentHash: record.invoice.paymentHash, state });
  }
  watch(scope: string, listener: (notice: Notice) => void) {
    const listeners = this.listeners.get(scope) ?? new Set();
    listeners.add(listener);
    this.listeners.set(scope, listeners);
    for (const record of this.all().filter((r) => scopeOf(r).key === scope)) this.begin(record);
    for (const job of this.jobs.values())
      if (scopeOf(job.record).key === scope)
        listener({ paymentHash: job.record.invoice.paymentHash, state: job.state });
    const refresh = () => this.checkNow(scope);
    globalThis.window?.addEventListener('focus', refresh);
    globalThis.document?.addEventListener('visibilitychange', refresh);
    return () => {
      globalThis.window?.removeEventListener('focus', refresh);
      globalThis.document?.removeEventListener('visibilitychange', refresh);
      listeners.delete(listener);
      if (listeners.size) return;
      this.listeners.delete(scope);
      for (const [key, job] of this.jobs)
        if (scopeOf(job.record).key === scope) {
          clearTimeout(job.timer);
          job.controller.abort();
          this.jobs.delete(key);
        }
    };
  }
  checkNow(scope: string) {
    for (const job of this.jobs.values())
      if (scopeOf(job.record).key === scope && job.state !== 'paid') {
        clearTimeout(job.timer);
        void this.check(job);
      }
  }
  private begin(record: PendingZap) {
    const scope = scopeOf(record).key;
    if (!this.listeners.get(scope)?.size || this.jobs.has(this.key(record))) return;
    const job: Job = {
      record,
      controller: new AbortController(),
      running: false,
      state: 'waiting',
    };
    this.jobs.set(this.key(record), job);
    void this.check(job);
  }
  private async check(job: Job) {
    if (job.running || job.controller.signal.aborted || globalThis.document?.hidden) return;
    const { record, controller } = job,
      scope = scopeOf(record);
    if (record.invoice.expiresAt * 1000 + RETENTION <= this.now()) {
      job.state = 'expired';
      this.emit(record, 'expired');
      return;
    }
    job.running = true;
    const seen = new Set<string>(),
      checks: Promise<void>[] = [];
    const receive = (event: SignedEvent) => {
      if (seen.has(event.id) || controller.signal.aborted) return;
      seen.add(event.id);
      checks.push(
        (async () => {
          try {
            const receipt = await verifiedZapReceipt(
              event,
              scope,
              new Map([[record.target.id, record.target]]),
              record.endpoint,
            );
            if (
              receipt.paymentHash === record.invoice.paymentHash &&
              receipt.requestId === record.invoice.request.id &&
              !controller.signal.aborted
            )
              this.finish(scope.key, record.invoice.paymentHash);
          } catch {
            /* Unrelated or invalid receipts do not confirm this invoice. */
          }
        })(),
      );
    };
    try {
      const results = await Promise.allSettled([
        ...(record.invoice.verify
          ? [
              (async () => {
                if (
                  await (this.options.check ?? checkZapPayment)(record.invoice, controller.signal)
                )
                  if (!controller.signal.aborted)
                    this.finish(scope.key, record.invoice.paymentHash);
              })(),
            ]
          : []),
        this.options
          .query(record, controller.signal, receive)
          .then((events) => events.forEach(receive)),
      ]);
      await Promise.allSettled(checks);
      if (!controller.signal.aborted) {
        job.state =
          record.invoice.expiresAt <= this.now() / 1000
            ? 'expired'
            : results.some((r) => r.status === 'rejected')
              ? 'unavailable'
              : 'waiting';
        this.emit(record, job.state);
      }
    } finally {
      job.running = false;
      if (!controller.signal.aborted)
        job.timer = setTimeout(() => void this.check(job), job.state === 'expired' ? 30000 : 2000);
    }
  }
}
