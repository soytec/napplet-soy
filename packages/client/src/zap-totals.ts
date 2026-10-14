export type ZapPayment = { paymentHash: string; msats: number };
export type ZapCount = { zapCount: number; msats: number };
export type ZapStorage = Pick<Storage, 'getItem' | 'setItem'>;
const CONFIRMATIONS_KEY = 'napplet:zap-confirmations:v1';
const CONFIRMATION_TTL = 30 * 86400000;
type Confirmation = ZapPayment & { scope: string; at: number };

/** Local confirmations bridge relay lag; matching receipts never count twice.
 * Feed only checked provider receipts, LUD-21 confirmations or wallet preimages. */
export class ZapTotalsStore {
  private confirmations: Confirmation[] = [];
  constructor(
    private storage?: () => ZapStorage,
    private now = Date.now,
  ) {
    try {
      const raw = storage?.().getItem(CONFIRMATIONS_KEY);
      if (!raw || raw.length > 65536) return;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return;
      for (const item of saved.slice(-128))
        if (
          typeof item?.scope === 'string' &&
          item.scope.length <= 512 &&
          /^[a-f0-9]{64}$/.test(item.paymentHash) &&
          Number.isSafeInteger(item.msats) &&
          item.msats > 0 &&
          item.msats <= 1000000000 &&
          Number.isSafeInteger(item.at) &&
          item.at <= now() &&
          item.at > now() - CONFIRMATION_TTL
        ) {
          this.confirmations.push({
            scope: item.scope,
            paymentHash: item.paymentHash,
            msats: item.msats,
            at: item.at,
          });
          this.observe(item.scope, [item]);
        }
    } catch {
      /* Storage unavailable or damaged: verified relay totals still work. */
    }
  }
  private scopes = new Map<string, Map<string, number>>();
  private totals = new Map<string, ZapCount>();
  private listeners = new Set<() => void>();
  private paymentListeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  onPayment = (listener: () => void) => {
    this.paymentListeners.add(listener);
    return () => {
      this.paymentListeners.delete(listener);
    };
  };
  get = (scope: string) => this.totals.get(scope);
  has = (scope: string, paymentHash: string) => this.scopes.get(scope)?.has(paymentHash) ?? false;
  observe(scope: string, payments: ZapPayment[]) {
    const entries = this.scopes.get(scope) ?? new Map<string, number>();
    for (const payment of payments) {
      if (
        /^[a-f0-9]{64}$/.test(payment.paymentHash) &&
        Number.isSafeInteger(payment.msats) &&
        payment.msats > 0 &&
        !entries.has(payment.paymentHash)
      )
        entries.set(payment.paymentHash, payment.msats);
    }
    while (entries.size > 2000) entries.delete(entries.keys().next().value!);
    this.scopes.set(scope, entries);
    const next = {
      zapCount: entries.size,
      msats: [...entries.values()].reduce((a, b) => a + b, 0),
    };
    const previous = this.get(scope);
    if (!previous || previous.zapCount !== next.zapCount || previous.msats !== next.msats) {
      this.totals.set(scope, next);
      while (this.scopes.size > 256) {
        const key = this.scopes.keys().next().value!;
        this.scopes.delete(key);
        this.totals.delete(key);
      }
      for (const listener of this.listeners) listener();
    }
    return this.get(scope)!;
  }
  confirm(scope: string, payment: ZapPayment) {
    if (
      !/^[a-f0-9]{64}$/.test(payment.paymentHash) ||
      !Number.isSafeInteger(payment.msats) ||
      payment.msats <= 0 ||
      payment.msats > 1000000000
    )
      return;
    if (
      !this.confirmations.some(
        (item) => item.scope === scope && item.paymentHash === payment.paymentHash,
      )
    ) {
      this.confirmations = [
        ...this.confirmations.filter((item) => item.at > this.now() - CONFIRMATION_TTL),
        { scope, paymentHash: payment.paymentHash, msats: payment.msats, at: this.now() },
      ].slice(-128);
      while (JSON.stringify(this.confirmations).length > 65536) this.confirmations.shift();
      try {
        this.storage?.().setItem(CONFIRMATIONS_KEY, JSON.stringify(this.confirmations));
      } catch {
        /* A quota or privacy setting must not undo confirmed payment. */
      }
    }
    const before = this.get(scope);
    const after = this.observe(scope, [payment]);
    if (before !== after) for (const listener of this.paymentListeners) listener();
  }
}
