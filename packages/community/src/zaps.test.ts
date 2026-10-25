import { test, expect } from 'bun:test';
import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 as hashBytes } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { inspectInvoice } from '../../protocol/src/invoice';
import { socialScope, commentScope, commentTemplate, eventScope } from '../../protocol/src/social';
import {
  resolveZapEndpoint,
  requestZapInvoice,
  verifiedZapReceipt,
  zapTotals,
} from '../../backend/src/zaps';
import { verifiedEvent } from '../../protocol/src';
import type { SocialContext } from '../../backend/src/social-service';
const author = generateSecretKey(),
  alice = generateSecretKey(),
  provider = generateSecretKey(),
  node = generateSecretKey();
const now = Math.floor(Date.now() / 1000),
  encoder = new TextEncoder();
const words = (n: number) => {
  const w: number[] = [];
  do {
    w.unshift(n % 32);
    n = Math.floor(n / 32);
  } while (n);
  return w;
};
function invoice(
  msats: number,
  description: string,
  { expiry = 3600, badSignature = false, plainDescription = false } = {},
) {
  const prefix = `lnbc${msats * 10}p`,
    timestamp = words(now);
  while (timestamp.length < 7) timestamp.unshift(0);
  const field = (tag: number, bytes: Uint8Array) => {
    const w = bech32.toWords(bytes);
    return [tag, ...[Math.floor(w.length / 32), w.length % 32], ...w];
  };
  const x = words(expiry);
  const data = [
    ...timestamp,
    ...field(1, hashBytes(new Uint8Array(32).fill(7))),
    ...field(16, new Uint8Array(32).fill(9)),
    ...field(
      plainDescription ? 13 : 23,
      plainDescription ? encoder.encode(description) : hashBytes(encoder.encode(description)),
    ),
    6,
    Math.floor(x.length / 32),
    x.length % 32,
    ...x,
  ];
  const padded = [...data];
  while (padded.length % 8) padded.push(0);
  const bytes = bech32.fromWords(padded).slice(0, Math.ceil((data.length * 5) / 8));
  const digest = hashBytes(new Uint8Array([...encoder.encode(prefix), ...bytes]));
  const signed = secp256k1.sign(digest, node, { prehash: false, format: 'recovered' });
  const signature = new Uint8Array([...signed.slice(1), signed[0]]);
  if (badSignature) signature.fill(0);
  return bech32.encode(prefix, [...data, ...bech32.toWords(signature)], 12000);
}
async function fixture() {
  const manifest = finalizeEvent(
    {
      kind: 35129,
      created_at: now - 100,
      content: '',
      tags: [
        ['d', 'first'],
        ['path', '/index.html', 'b'.repeat(64)],
      ],
    },
    author,
  );
  const context: SocialContext = {
    manifest,
    scope: socialScope(manifest),
    relays: ['wss://relay.example'],
  };
  const profile = finalizeEvent(
    {
      kind: 0,
      created_at: now - 50,
      content: JSON.stringify({ lud16: 'alice@wallet.example' }),
      tags: [],
    },
    author,
  );
  const endpoint = await resolveZapEndpoint(getPublicKey(author), [profile], async () => ({
    tag: 'payRequest',
    allowsNostr: true,
    nostrPubkey: getPublicKey(provider),
    minSendable: 1000,
    maxSendable: 1000000,
    commentAllowed: 100,
    callback: 'https://wallet.example/callback',
  }));
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: now,
      content: 'nice',
      tags: [
        ['p', getPublicKey(author)],
        ['e', manifest.id],
        ['a', context.scope.key],
        ['k', '35129'],
        ['amount', '21000'],
        ['lnurl', endpoint.lnurl],
        ['relays', ...context.relays],
      ],
    },
    alice,
  );
  return { context, endpoint, request, manifests: new Map([[manifest.id, manifest]]) };
}
test('zap invoices bind amount and description to the signed request; never accept a substituted invoice', async () => {
  const { context, endpoint, request, manifests } = await fixture();
  const description = JSON.stringify(verifiedEvent(request));
  const result = await requestZapInvoice(context, manifests, endpoint, request, async (url) => {
    expect(url.searchParams.get('nostr')).toBe(description);
    return { pr: invoice(21000, description) };
  });
  expect(result.msats).toBe(21000);
  expect(inspectInvoice(result.invoice).paymentHash).toBe(
    bytesToHex(hashBytes(new Uint8Array(32).fill(7))),
  );
  for (const plainDescription of [false, true]) {
    const text = plainDescription ? request.content : description;
    await expect(
      requestZapInvoice(context, manifests, endpoint, request, async () => ({
        pr: invoice(22000, text, { plainDescription }),
      })),
    ).rejects.toThrow('wallet.example returned an invoice for 22 sats; you requested 21 sats');
    await expect(
      requestZapInvoice(context, manifests, endpoint, request, async () => ({
        pr: invoice(21000, text, { plainDescription, badSignature: true }),
      })),
    ).rejects.toThrow('signature');
    await expect(
      requestZapInvoice(context, manifests, endpoint, request, async () => ({
        pr: invoice(21000, text, { plainDescription, expiry: 0 }),
      })),
    ).rejects.toThrow('wallet.example returned an expired invoice. Create a new invoice');
  }
  await expect(
    requestZapInvoice(context, manifests, endpoint, request, async () => ({
      pr: invoice(21000, 'some other purchase'),
    })),
  ).rejects.toThrow('wallet.example returned an invoice whose description hash does not match');
});
test('plain-description providers support invoice creation and signed zap receipts', async () => {
  const { context, endpoint, request, manifests } = await fixture();
  // Minibits returned a valid, correctly priced invoice whose d-tag was the note
  // (or empty without a comment), but no h-tag binding it to the signed request.
  for (const description of ['derp', '']) {
    const pr = invoice(21000, description, { plainDescription: true });
    expect(inspectInvoice(pr).msats).toBe(21000);
    expect(inspectInvoice(pr).descriptionHash).toBeNull();
    const result = await requestZapInvoice(context, manifests, endpoint, request, async (url) => {
      expect(url.origin).toBe('https://wallet.example');
      expect(verifiedEvent(JSON.parse(url.searchParams.get('nostr')!)).id).toBe(request.id);
      return { pr };
    });
    expect(result.invoice).toBe(pr);
    expect(result.msats).toBe(21000);
    const receipt = finalizeEvent(
      {
        kind: 9735,
        created_at: now,
        content: '',
        tags: [
          ...request.tags.filter((t) => ['p', 'e', 'a'].includes(t[0])),
          ['description', JSON.stringify(request)],
          ['bolt11', pr],
        ],
      },
      provider,
    );
    expect((await verifiedZapReceipt(receipt, context.scope, manifests, endpoint)).msats).toBe(
      21000,
    );
  }
});
for (const plainDescription of [false, true])
  test(`zap receipts (${plainDescription ? 'plain description' : 'description hash'}) require the advertised provider and exact recipient, request and payment hash`, async () => {
    const { context, endpoint, request, manifests } = await fixture(),
      description = JSON.stringify(request);
    const tags = [
      ...request.tags.filter((t) => ['p', 'e', 'a'].includes(t[0])),
      ['description', description],
      [
        'bolt11',
        invoice(21000, plainDescription ? request.content : description, { plainDescription }),
      ],
      ['preimage', '07'.repeat(32)],
      ['P', request.pubkey],
    ];
    const receipt = finalizeEvent({ kind: 9735, created_at: now, content: '', tags }, provider);
    expect((await verifiedZapReceipt(receipt, context.scope, manifests, endpoint)).msats).toBe(
      21000,
    );
    await expect(
      verifiedZapReceipt(
        finalizeEvent({ kind: 9735, created_at: now, content: '', tags }, alice),
        context.scope,
        manifests,
        endpoint,
      ),
    ).rejects.toThrow('Untrusted');
    const duplicateReceipt = finalizeEvent(
      { kind: 9735, created_at: now + 1, content: '', tags },
      provider,
    );
    const forgedReceipt = finalizeEvent({ kind: 9735, created_at: now, content: '', tags }, alice);
    const totals = await zapTotals(
      context,
      { manifests, events: [receipt, duplicateReceipt, forgedReceipt] },
      endpoint,
    );
    expect(totals.zapCount).toBe(1);
    expect(totals.msats).toBe(21000);
    const wrong = finalizeEvent(
      {
        kind: 9735,
        created_at: now,
        content: '',
        tags: tags.map((t) => (t[0] === 'p' ? ['p', getPublicKey(alice)] : t)),
      },
      provider,
    );
    await expect(verifiedZapReceipt(wrong, context.scope, manifests, endpoint)).rejects.toThrow(
      'target',
    );
    const bad = finalizeEvent(
      {
        kind: 9735,
        created_at: now,
        content: '',
        tags: tags.map((t) => (t[0] === 'preimage' ? ['preimage', '00'.repeat(32)] : t)),
      },
      provider,
    );
    await expect(verifiedZapReceipt(bad, context.scope, manifests, endpoint)).rejects.toThrow(
      'preimage',
    );
    for (const replacement of [
      ['e', 'f'.repeat(64)],
      [
        'bolt11',
        invoice(22000, plainDescription ? request.content : description, { plainDescription }),
      ],
      ['bolt11', invoice(21000, 'a different request')],
      ['description', JSON.stringify({ ...request, content: 'changed without signing' })],
    ]) {
      const invalid = finalizeEvent(
        {
          kind: 9735,
          created_at: now,
          content: '',
          tags: tags.map((t) => (t[0] === replacement[0] ? replacement : t)),
        },
        provider,
      );
      await expect(
        verifiedZapReceipt(invalid, context.scope, manifests, endpoint),
      ).rejects.toThrow();
    }
  });

test('invoice inspection agrees with the independent BOLT-11 hashed-description vector', () => {
  // https://github.com/lightning/bolts/blob/master/11-payment-encoding.md#examples
  const vector =
    'lnbc20m1pvjluezsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygspp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqhp58yjmdan79s6qqdhdzgynm4zwqd5d7xmw5fk98klysy043l2ahrqs9qrsgq7ea976txfraylvgzuxs8kgcw23ezlrszfnh8r6qtfpr6cxga50aj6txm9rxrydzd06dfeawfk6swupvz4erwnyutnjq7x39ymw6j38gp7ynn44';
  const decoded = inspectInvoice(vector);
  expect(decoded.msats).toBe(2000000000);
  expect(decoded.descriptionHash).toBe(
    '3925b6f67e2c340036ed12093dd44e0368df1b6ea26c53dbe4811f58fd5db8c1',
  );
  expect(decoded.expiresAt).toBe(1496314658 + 3600);
  expect(() => inspectInvoice(vector.slice(0, -1) + 'q')).toThrow();
});

test('comment zaps bind the invoice and receipt to the commenter, independently of the napplet author', async () => {
  const { context: napplet, endpoint: authorEndpoint } = await fixture();
  const comment = finalizeEvent(commentTemplate(napplet.scope, 'A helpful comment'), alice);
  const context = { ...napplet, manifest: comment, scope: commentScope(comment) };
  const targets = new Map([[comment.id, comment]]);
  const endpoint = { ...authorEndpoint, pubkey: comment.pubkey };
  const request = finalizeEvent(
    {
      kind: 9734,
      created_at: now,
      content: '',
      tags: [
        ['p', comment.pubkey],
        ['e', comment.id],
        ['k', '1111'],
        ['amount', '21000'],
        ['lnurl', endpoint.lnurl],
        ['relays', ...context.relays],
      ],
    },
    author,
  );
  const description = JSON.stringify(verifiedEvent(request));
  const result = await requestZapInvoice(context, targets, endpoint, request, async () => ({
    pr: invoice(21000, description),
  }));
  expect(result.msats).toBe(21000);
  await expect(requestZapInvoice(context, targets, authorEndpoint, request)).rejects.toThrow();
  await expect(requestZapInvoice(napplet, targets, endpoint, request)).rejects.toThrow();
  const receipt = finalizeEvent(
    {
      kind: 9735,
      created_at: now,
      content: '',
      tags: [
        ['p', comment.pubkey],
        ['e', comment.id],
        ['description', description],
        ['bolt11', result.invoice],
      ],
    },
    provider,
  );
  expect((await verifiedZapReceipt(receipt, context.scope, targets, endpoint)).msats).toBe(21000);
  await expect(
    verifiedZapReceipt(receipt, napplet.scope, targets, authorEndpoint),
  ).rejects.toThrow();
  const ambiguous = finalizeEvent(
    { ...request, tags: [...request.tags, ['a', napplet.scope.key]] },
    author,
  );
  await expect(requestZapInvoice(context, targets, endpoint, ambiguous)).rejects.toThrow();
});

test('verified addressed zap receipts survive replacement when the old manifest is pruned', async () => {
  const { context, endpoint, request } = await fixture();
  const next = finalizeEvent(
    { ...context.manifest, created_at: context.manifest.created_at + 1 },
    author,
  );
  const targets = new Map([[next.id, next]]);
  for (const withKind of [true, false]) {
    const historical = withKind
      ? request
      : finalizeEvent({ ...request, tags: request.tags.filter((t) => t[0] !== 'k') }, alice);
    const description = JSON.stringify(historical);
    const receipt = finalizeEvent(
      {
        kind: 9735,
        created_at: now,
        content: '',
        tags: [
          ...historical.tags.filter((t) => ['p', 'e', 'a'].includes(t[0])),
          ['description', description],
          ['bolt11', invoice(21000, description)],
          ['preimage', '07'.repeat(32)],
        ],
      },
      provider,
    );
    expect((await verifiedZapReceipt(receipt, socialScope(next), targets, endpoint)).msats).toBe(
      21000,
    );
    const totals = await zapTotals(
      { ...context, scope: socialScope(next), manifest: next },
      { events: [receipt], manifests: targets },
      endpoint,
    );
    expect(totals).toMatchObject({ zapCount: 1, msats: 21000 });
    // The browser reader applies the same target and cryptographic receipt checks.
    const browser = await import('../../client/src/zaps');
    expect(
      (await browser.verifiedZapReceipt(receipt, socialScope(next), targets, endpoint)).msats,
    ).toBe(21000);
  }
});

for (const kind of [1617, 1618, 1619, 35129])
  test(`contribution zap (${kind}) rejects another author, release, or inherited napplet address`, async () => {
    const { context: napplet, endpoint: authorEndpoint } = await fixture();
    const contribution = finalizeEvent(
      { kind, created_at: now, content: 'A useful contribution', tags: [['d', 'version']] },
      alice,
    );
    const context = { ...napplet, manifest: contribution, scope: eventScope(contribution) };
    const targets = new Map([[contribution.id, contribution]]);
    const endpoint = { ...authorEndpoint, pubkey: contribution.pubkey };
    const request = finalizeEvent(
      {
        kind: 9734,
        created_at: now,
        content: '',
        tags: [
          ['p', contribution.pubkey],
          ['e', contribution.id],
          ['k', String(kind)],
          ['amount', '21000'],
          ['lnurl', endpoint.lnurl],
          ['relays', ...context.relays],
        ],
      },
      author,
    );
    const description = JSON.stringify(verifiedEvent(request));
    const result = await requestZapInvoice(context, targets, endpoint, request, async () => ({
      pr: invoice(21000, description),
    }));
    expect(result.msats).toBe(21000);
    await expect(requestZapInvoice(context, targets, authorEndpoint, request)).rejects.toThrow();
    await expect(requestZapInvoice(napplet, targets, endpoint, request)).rejects.toThrow();
    const changed = finalizeEvent({ ...contribution, content: 'A later version' }, alice);
    await expect(
      requestZapInvoice({ ...context, scope: eventScope(changed) }, targets, endpoint, request),
    ).rejects.toThrow();
    const inherited = finalizeEvent(
      { ...request, tags: [...request.tags, ['a', napplet.scope.key]] },
      author,
    );
    await expect(requestZapInvoice(context, targets, endpoint, inherited)).rejects.toThrow();
    const receipt = finalizeEvent(
      {
        kind: 9735,
        created_at: now,
        content: '',
        tags: [
          ['p', contribution.pubkey],
          ['e', contribution.id],
          ['description', description],
          ['bolt11', result.invoice],
        ],
      },
      provider,
    );
    expect((await verifiedZapReceipt(receipt, context.scope, targets, endpoint)).msats).toBe(21000);
    await expect(
      verifiedZapReceipt(receipt, napplet.scope, targets, authorEndpoint),
    ).rejects.toThrow();
  });
