import { WalletError } from './errors';
import { getTokenMetadata } from '@cashu/cashu-ts';
import { inspectInvoice } from '../../protocol/src/invoice';
import type { NostrEvent } from 'nostr-tools';
import { verifySignature } from '../../protocol/src/verify';

export function nip65ReadRelays(event: NostrEvent | undefined, pubkey: string) {
  if (!event) return [];
  if (event.kind !== 10002 || event.pubkey !== pubkey || !verifySignature(event))
    throw new WalletError('Invalid recipient relay list.');
  return [
    ...new Set(
      event.tags
        .filter((t) => t[0] === 'r' && (!t[2] || t[2] === 'read'))
        .flatMap((t) => {
          try {
            return walletRelays([t[1]]);
          } catch {
            return [];
          }
        }),
    ),
  ];
}

export const transactionNames = {
  deposit: 'Lightning received',
  melt: 'Lightning payment',
  send: 'Cashu sent',
  receive: 'Cashu received',
  nutzap: 'Nutzap sent',
  redeem: 'Nutzap received',
} as const;
export type TransactionKind = keyof typeof transactionNames;
export function sats(value: unknown): number {
  const amount = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0)
    throw new WalletError('Enter a positive whole number of sats.');
  return amount;
}
export function mintUrl(input: string) {
  const url = new URL(input.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new WalletError('Use an HTTPS mint URL without credentials, a query or a fragment.');
  return url.href.replace(/\/+$/, '');
}
export function walletRelays(input: string[]) {
  const urls = [
    ...new Set(
      input.map((value) => {
        const url = new URL(value.trim());
        if (url.protocol !== 'wss:' || url.username || url.password || url.hash)
          throw new WalletError('Use secure WSS wallet relays.');
        return url.href;
      }),
    ),
  ];
  if (!urls.length) throw new WalletError('Choose at least one wallet relay.');
  return urls;
}
/** QR data is input, never navigation or authority to execute a payment. */
export function paymentInput(input: string) {
  const value = input.trim().replace(/^(lightning:|cashu:)/i, '');
  if (/^cashu[AB]/.test(value)) {
    const meta = getTokenMetadata(value);
    if (meta.unit && meta.unit !== 'sat') throw new WalletError('This wallet supports sat tokens.');
    return { type: 'cashu' as const, value, mint: mintUrl(meta.mint) };
  }
  if (/^lnbc/i.test(value)) {
    let checked: ReturnType<typeof inspectInvoice>;
    try {
      checked = inspectInvoice(value.toLowerCase());
    } catch {
      throw new WalletError(
        'This is not a valid, signed Bitcoin Lightning invoice with an amount.',
      );
    }
    if (checked.expiresAt <= Date.now() / 1000) throw new WalletError('This invoice has expired.');
    return {
      type: 'lightning' as const,
      value: value.toLowerCase(),
      invoice: {
        amount: checked.msats,
        expiry: checked.expiresAt,
        paymentHash: checked.paymentHash,
      },
    };
  }
  throw new WalletError(
    'Paste a Lightning invoice or a Cashu token. QR codes never pay automatically.',
  );
}
export function nutzapRecipient(info: NostrEvent) {
  const rawKey = info.tags.find((t) => t[0] === 'pubkey')?.[1] ?? '';
  const key = rawKey.replace(/^02(?=[a-f0-9]{64}$)/, '');
  if (info.kind !== 10019 || !/^[a-f0-9]{64}$/.test(key) || key === info.pubkey)
    throw new WalletError('The recipient has no valid dedicated nutzap key.');
  const mints = info.tags
    .filter((t) => t[0] === 'mint' && (t.length === 2 || t.slice(2).includes('sat')))
    .map((t) => ({ url: mintUrl(t[1]), exact: t[1] }));
  if (!mints.length) throw new WalletError('The recipient does not accept sat nutzaps.');
  return {
    pubkey: info.pubkey,
    key: `02${key}`,
    mints,
    relays: walletRelays(info.tags.filter((t) => t[0] === 'relay').map((t) => t[1])),
  };
}
export function removeMintAllowed(
  url: string,
  balances: Record<string, number>,
  pending: { mint: string; status: string }[],
) {
  if (
    Object.entries(balances).some(([mint, amount]) => mintUrl(mint) === url && amount > 0) ||
    pending.some((t) => t.mint === url && !['complete', 'cancelled'].includes(t.status))
  )
    throw new WalletError(
      'Spend or move this mint’s balance and resolve pending transactions before removing it.',
    );
}
