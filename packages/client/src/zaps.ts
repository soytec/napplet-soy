import { bech32 } from '@scure/base';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { sha256 as hashBytes } from '@noble/hashes/sha2.js';
import { sha256, verifiedEvent, type SignedEvent } from '../../protocol/src';
import { inspectInvoice } from '../../protocol/src/invoice';
import { oneTag, targetManifest, type SocialScope } from '../../protocol/src/social';
import { downloadBytes, resourceUrl as publicResourceUrl } from './bytes';
class CommunityError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
type ZapContext = { scope: SocialScope; manifest: SignedEvent; relays: string[] };
const allowedSocial = (event: SignedEvent) => event.created_at <= Date.now() / 1000 + 60;
export type ZapEndpoint = {
  pubkey: string;
  lnurl: string;
  callback: string;
  nostrPubkey: string;
  minSendable: number;
  maxSendable: number;
  commentAllowed: number;
};
export type JsonLoader = (url: URL, signal?: AbortSignal) => Promise<any>;
const loadJson: JsonLoader = async (url, signal) =>
  JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      await downloadBytes(
        url.href,
        signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
        20000,
      ),
    ),
  );
function endpointUrl(profile: SignedEvent) {
  const metadata = JSON.parse(profile.content);
  if (typeof metadata.lud16 === 'string' && metadata.lud16.trim()) {
    const match = /^([a-zA-Z0-9._+-]{1,128})@([a-zA-Z0-9.-]{1,253})$/.exec(metadata.lud16);
    if (!match) throw new CommunityError('The author has an invalid Lightning address.');
    return publicResourceUrl(
      `https://${match[2]}/.well-known/lnurlp/${encodeURIComponent(match[1])}`,
    );
  }
  if (typeof metadata.lud06 === 'string') {
    const { prefix, words } = bech32.decode(metadata.lud06 as `${string}1${string}`, 2000);
    if (prefix !== 'lnurl') throw new Error('Invalid LNURL');
    return publicResourceUrl(
      new TextDecoder('utf-8', { fatal: true }).decode(bech32.fromWords(words)),
    );
  }
  throw new CommunityError(
    'This author has not added a Lightning address to their Nostr profile.',
    404,
  );
}
/** A local metadata check; the provider is contacted only when preparing a zap. */
export function hasLightningAddress(profile: SignedEvent) {
  try {
    endpointUrl(profile);
    return true;
  } catch {
    return false;
  }
}
export async function resolveZapEndpoint(
  pubkey: string,
  events: SignedEvent[],
  load: JsonLoader = loadJson,
  signal?: AbortSignal,
): Promise<ZapEndpoint> {
  const profile = events
    .filter((e) => e.kind === 0 && e.pubkey === pubkey && allowedSocial(e))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
  if (!profile) throw new CommunityError('The author’s Lightning profile is unavailable.', 404);
  const url = endpointUrl(verifiedEvent(profile)),
    data = await load(url, signal);
  if (
    data.tag !== 'payRequest' ||
    data.allowsNostr !== true ||
    !/^[a-f0-9]{64}$/.test(data.nostrPubkey) ||
    typeof data.callback !== 'string' ||
    !Number.isSafeInteger(data.minSendable) ||
    !Number.isSafeInteger(data.maxSendable) ||
    data.minSendable < 1 ||
    data.maxSendable < data.minSendable
  )
    throw new CommunityError('This Lightning service does not support Nostr zaps.');
  publicResourceUrl(data.callback);
  return {
    pubkey,
    lnurl: bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url.href)), 2000),
    callback: data.callback,
    nostrPubkey: data.nostrPubkey,
    minSendable: data.minSendable,
    maxSendable: Math.min(data.maxSendable, 1000000000),
    commentAllowed: Math.max(
      0,
      Math.min(280, Number.isSafeInteger(data.commentAllowed) ? data.commentAllowed : 0),
    ),
  };
}
export function validZapRequest(
  event: SignedEvent,
  scope: SocialScope,
  manifests: Map<string, SignedEvent>,
  endpoint: ZapEndpoint,
  fresh = false,
) {
  const amount = oneTag(event, 'amount');
  const msats = amount && /^[1-9][0-9]*$/.test(amount) ? Number(amount) : 0;
  if (
    event.kind !== 9734 ||
    oneTag(event, 'p') !== endpoint.pubkey ||
    endpoint.pubkey !== scope.author ||
    !targetManifest(event, scope, manifests) ||
    oneTag(event, 'lnurl') !== endpoint.lnurl ||
    !Number.isSafeInteger(msats) ||
    msats < endpoint.minSendable ||
    msats > endpoint.maxSendable ||
    event.content.length > endpoint.commentAllowed ||
    event.tags.filter((t) => t[0] === 'e').length !== 1 ||
    event.tags.filter((t) => t[0] === 'relays').length !== 1
  )
    throw new CommunityError('Invalid zap request or amount.');
  const relays = event.tags.find((t) => t[0] === 'relays')!.slice(1);
  if (
    !relays.length ||
    relays.length > 6 ||
    relays.some((r) => {
      try {
        const u = new URL(r);
        return u.protocol !== 'wss:' || !!u.username || !!u.password || !!u.hash || r.length > 256;
      } catch {
        return true;
      }
    })
  )
    throw new CommunityError('Zaps require public WSS relay hints.');
  if (
    fresh &&
    (event.created_at < Date.now() / 1000 - 120 || event.created_at > Date.now() / 1000 + 30)
  )
    throw new CommunityError('The zap request has expired.');
  return msats;
}
/** Plain-description providers bind the payment through their HTTPS callback and
 * signed receipt instead. An explicit description hash must still match exactly. */
async function compatibleInvoiceDescription(hash: string | null, serializedRequest: string) {
  return hash === null || hash === (await sha256(new TextEncoder().encode(serializedRequest)));
}
export async function requestZapInvoice(
  context: ZapContext,
  manifests: Map<string, SignedEvent>,
  endpoint: ZapEndpoint,
  input: unknown,
  load: JsonLoader = loadJson,
) {
  const event = verifiedEvent(input);
  if (!allowedSocial(event)) throw new CommunityError('This account is blocked here.', 403);
  const amount = validZapRequest(event, context.scope, manifests, endpoint, true);
  const serialized = JSON.stringify(event),
    url = publicResourceUrl(endpoint.callback);
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('nostr', serialized);
  url.searchParams.set('lnurl', endpoint.lnurl);
  if (event.content) url.searchParams.set('comment', event.content);
  const response = await load(url);
  if (response.status === 'ERROR' || typeof response.pr !== 'string')
    throw new CommunityError('The Lightning provider could not create an invoice.', 502);
  const invoice = inspectInvoice(response.pr);
  const provider = url.hostname;
  if (invoice.msats !== amount)
    throw new CommunityError(
      `${provider} returned an invoice for ${invoice.msats / 1000} sats; you requested ${amount / 1000} sats. Create a new invoice.`,
      502,
    );
  if (!(await compatibleInvoiceDescription(invoice.descriptionHash, serialized)))
    throw new CommunityError(
      `${provider} returned an invoice whose description hash does not match this zap request. Retry; if it persists, contact the creator’s Lightning provider.`,
      502,
    );
  if (invoice.expiresAt <= Date.now() / 1000)
    throw new CommunityError(`${provider} returned an expired invoice. Create a new invoice.`, 502);
  let verify: string | undefined;
  if (typeof response.verify === 'string') {
    try {
      verify = publicResourceUrl(response.verify).href;
    } catch {
      /* Optional: relay receipts still work. */
    }
  }
  return {
    invoice: response.pr,
    msats: amount,
    expiresAt: invoice.expiresAt,
    paymentHash: invoice.paymentHash,
    request: event,
    verify,
  };
}
export type ZapInvoice = Awaited<ReturnType<typeof requestZapInvoice>>;

export function validPaymentPreimage(preimage: unknown, paymentHash: string) {
  return (
    typeof preimage === 'string' &&
    /^[a-f0-9]{64}$/i.test(preimage) &&
    bytesToHex(hashBytes(hexToBytes(preimage))) === paymentHash
  );
}

/** LUD-21 is optional. Never confuse another invoice or an unsettled response with payment. */
export async function checkZapPayment(
  invoice: ZapInvoice,
  signal?: AbortSignal,
  load: JsonLoader = loadJson,
) {
  if (!invoice.verify) return false;
  const result = await load(publicResourceUrl(invoice.verify), signal);
  return (
    result.status === 'OK' &&
    result.settled === true &&
    result.pr === invoice.invoice &&
    (result.preimage == null || validPaymentPreimage(result.preimage, invoice.paymentHash))
  );
}
export async function verifiedZapReceipt(
  input: unknown,
  scope: SocialScope,
  manifests: Map<string, SignedEvent>,
  endpoint: ZapEndpoint,
) {
  const receipt = verifiedEvent(input);
  if (receipt.kind !== 9735 || receipt.pubkey !== endpoint.nostrPubkey || !allowedSocial(receipt))
    throw new Error('Untrusted zap receipt');
  const description = oneTag(receipt, 'description');
  if (!description) throw new Error('Missing zap request');
  const request = verifiedEvent(JSON.parse(description));
  if (!allowedSocial(request)) throw new Error('Blocked sender');
  // Historical requests can predate the provider's current limits or omit optional lnurl.
  const endpointForReceipt = {
    ...endpoint,
    minSendable: 1,
    maxSendable: Number.MAX_SAFE_INTEGER,
    commentAllowed: 4000,
  };
  const requestForValidation = oneTag(request, 'lnurl')
    ? request
    : { ...request, tags: [...request.tags, ['lnurl', endpoint.lnurl]] };
  const amount = validZapRequest(requestForValidation, scope, manifests, endpointForReceipt);
  for (const key of ['p', 'e', 'a'])
    if (oneTag(receipt, key) !== oneTag(request, key)) throw new Error('Wrong receipt target');
  if (oneTag(receipt, 'P') && oneTag(receipt, 'P') !== request.pubkey)
    throw new Error('Wrong zap sender');
  const invoice = inspectInvoice(oneTag(receipt, 'bolt11') ?? '');
  if (
    invoice.msats !== amount ||
    !(await compatibleInvoiceDescription(invoice.descriptionHash, description))
  )
    throw new Error('Wrong zap invoice');
  const preimage = oneTag(receipt, 'preimage');
  if (
    preimage &&
    (!/^[a-f0-9]{64}$/.test(preimage) ||
      bytesToHex(hashBytes(hexToBytes(preimage))) !== invoice.paymentHash)
  )
    throw new Error('Wrong payment preimage');
  return {
    id: receipt.id,
    requestId: request.id,
    pubkey: request.pubkey,
    msats: amount,
    paymentHash: invoice.paymentHash,
  };
}
/** Reuse the same provider verification for detail totals and gallery rankings. */
export async function zapTotals(
  context: ZapContext,
  data: { events: SignedEvent[]; manifests: Map<string, SignedEvent> },
  endpoint: ZapEndpoint,
  targets = data.manifests,
) {
  const receipts = [];
  const hashes = new Set<string>();
  for (const event of data.events.filter((e) => e.kind === 9735).slice(0, 150))
    try {
      const receipt = await verifiedZapReceipt(event, context.scope, targets, endpoint);
      if (!hashes.has(receipt.paymentHash)) {
        receipts.push(receipt);
        hashes.add(receipt.paymentHash);
      }
    } catch {}
  return {
    receipts,
    zapCount: receipts.length,
    msats: receipts.reduce((sum, r) => sum + r.msats, 0),
  };
}
