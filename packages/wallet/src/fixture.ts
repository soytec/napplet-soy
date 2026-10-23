// Test-only mint. Real blinded signatures and DLEQ, in-memory fake Lightning.
import {
  Mint,
  Wallet,
  Amount,
  createBlindSignature,
  createDLEQProof,
  deriveKeysetId,
  pointFromHex,
  hashToCurve,
  verifyP2PKSpendingConditions,
  normalizeProofAmounts,
  type RequestFn,
  type RequestOptions,
} from '@cashu/cashu-ts';
import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export function testInvoice(amount: number, preimage = new Uint8Array(32).fill(7), expiry = 3600) {
  const words = (n: number) => {
    const v: number[] = [];
    do {
      v.unshift(n % 32);
      n = Math.floor(n / 32);
    } while (n);
    return v;
  };
  const field = (tag: number, bytes: Uint8Array) => {
    const w = bech32.toWords(bytes);
    return [tag, Math.floor(w.length / 32), w.length % 32, ...w];
  };
  const stamp = words(Math.floor(Date.now() / 1000));
  while (stamp.length < 7) stamp.unshift(0);
  const x = words(expiry),
    prefix = `lnbc${amount * 10000}p`;
  const data = [
    ...stamp,
    ...field(1, sha256(preimage)),
    ...field(16, new Uint8Array(32).fill(9)),
    ...field(13, new TextEncoder().encode('Test mint only')),
    6,
    Math.floor(x.length / 32),
    x.length % 32,
    ...x,
  ];
  const padded = [...data];
  while (padded.length % 8) padded.push(0);
  const bytes = bech32.fromWords(padded).slice(0, Math.ceil((data.length * 5) / 8));
  const hash = sha256(new Uint8Array([...new TextEncoder().encode(prefix), ...bytes]));
  const sig = secp256k1.sign(hash, new Uint8Array(32).fill(1), {
    prehash: false,
    format: 'recovered',
  });
  return bech32.encode(
    prefix,
    [...data, ...bech32.toWords(new Uint8Array([...sig.slice(1), sig[0]]))],
    12000,
  );
}
export class TestMint {
  url = 'https://mint.test';
  keys: Record<string, string> = {};
  secrets = new Map<string, Uint8Array>();
  id: string;
  issued = new Map<string, any>();
  spent = new Set<string>();
  deposits = new Map<string, any>();
  melts = new Map<string, any>();
  swaps = 0;
  meltCalls = 0;
  dropSwap = false;
  dropMint = false;
  dropMelt = false;
  pendingMelt = false;
  failMelt = false;
  beforeMutation?: () => Promise<void>;
  constructor(readonly fee = 0) {
    for (let i = 0; i < 20; i++) {
      const secret = new Uint8Array(32);
      secret[31] = i + 1;
      const amount = String(2 ** i);
      this.secrets.set(amount, secret);
      this.keys[amount] = bytesToHex(secp256k1.getPublicKey(secret, true));
    }
    this.id = deriveKeysetId(this.keys, { input_fee_ppk: fee });
  }
  sign(output: any, overrideAmount?: number) {
    const amount = Amount.from(overrideAmount ?? output.amount),
      key = this.secrets.get(amount.toString())!;
    const B = pointFromHex(output.B_),
      sig = createBlindSignature(B, key, this.id),
      dleq = createDLEQProof(B, key);
    const result = {
      amount: amount.toNumber(),
      id: this.id,
      C_: sig.C_.toHex(true),
      dleq: { s: bytesToHex(dleq.s), e: bytesToHex(dleq.e) },
    };
    this.issued.set(output.B_, {
      output: { ...output, amount: amount.toNumber() },
      signature: result,
    });
    return result;
  }
  y(secret: string) {
    return hashToCurve(new TextEncoder().encode(secret)).toHex(true);
  }
  request: RequestFn = async <T>({ endpoint, requestBody }: RequestOptions) => {
    const path = new URL(endpoint).pathname,
      body = requestBody as any;
    let response: any;
    if (path === '/v1/info')
      response = {
        name: 'Mock mint',
        nuts: {
          4: { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
          5: { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
          7: { supported: true },
          8: { supported: true },
          9: { supported: true },
          11: { supported: true },
          12: { supported: true },
        },
      };
    else if (path === '/v1/keysets')
      response = {
        keysets: [{ id: this.id, unit: 'sat', active: true, input_fee_ppk: this.feecode() }],
      };
    else if (path.startsWith('/v1/keys'))
      response = {
        keysets: [{ id: this.id, unit: 'sat', keys: this.keys, input_fee_ppk: this.fee }],
      };
    else if (path === '/v1/checkstate')
      response = {
        states: body.Ys.map((Y: string) => ({ Y, state: this.spent.has(Y) ? 'SPENT' : 'UNSPENT' })),
      };
    else if (path === '/v1/mint/quote/bolt11') {
      const id = crypto.randomUUID();
      response = {
        quote: id,
        amount: Number(body.amount),
        unit: 'sat',
        request: testInvoice(Number(body.amount), crypto.getRandomValues(new Uint8Array(32))),
        state: 'UNPAID',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };
      this.deposits.set(id, response);
    } else if (path.startsWith('/v1/mint/quote/bolt11/'))
      response = this.deposits.get(path.split('/').at(-1)!);
    else if (path === '/v1/mint/bolt11') {
      await this.beforeMutation?.();
      const q = this.deposits.get(body.quote);
      if (q?.state !== 'PAID') throw Error('Quote not paid');
      response = { signatures: body.outputs.map((o: any) => this.sign(o)) };
      q.state = 'ISSUED';
      if (this.dropMint) {
        this.dropMint = false;
        throw Error('Lost mint response');
      }
    } else if (path === '/v1/swap') {
      await this.beforeMutation?.();
      for (const proof of normalizeProofAmounts(body.inputs)) {
        if (proof.secret.startsWith('["P2PK"') && !verifyP2PKSpendingConditions(proof).success)
          throw Error('P2PK witness is required');
      }
      if (body.inputs.some((p: any) => this.spent.has(this.y(p.secret))))
        throw Error('Already spent');
      this.swaps++;
      for (const p of body.inputs) this.spent.add(this.y(p.secret));
      response = { signatures: body.outputs.map((o: any) => this.sign(o)) };
      if (this.dropSwap) {
        this.dropSwap = false;
        throw Error('Lost swap response');
      }
    } else if (path === '/v1/restore') {
      const found = body.outputs.map((o: any) => this.issued.get(o.B_)).filter(Boolean);
      response = {
        outputs: found.map((v: any) => v.output),
        signatures: found.map((v: any) => v.signature),
      };
    } else if (path === '/v1/melt/quote/bolt11') {
      const quote = crypto.randomUUID();
      response = {
        quote,
        unit: 'sat',
        request: body.request,
        amount: 8,
        fee_reserve: 2,
        state: 'UNPAID',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      };
      this.melts.set(quote, response);
    } else if (path.startsWith('/v1/melt/quote/bolt11/'))
      response = this.melts.get(path.split('/').at(-1)!);
    else if (path === '/v1/melt/bolt11') {
      await this.beforeMutation?.();
      this.meltCalls++;
      const q = this.melts.get(body.quote);
      if (this.failMelt) throw Error('Lightning route unavailable');
      if (this.pendingMelt) {
        q.state = 'PENDING';
        response = q;
      } else {
        for (const p of body.inputs) this.spent.add(this.y(p.secret));
        q.state = 'PAID';
        q.payment_preimage = '07'.repeat(32);
        q.change = body.outputs.length ? [this.sign(body.outputs[0], 1)] : [];
        response = q;
        if (this.dropMelt) {
          this.dropMelt = false;
          throw Error('Lost melt response');
        }
      }
    } else throw Error(`Unexpected test mint endpoint: ${path}`);
    // A real HTTP server does not share mutable objects with its clients.
    return JSON.parse(JSON.stringify(response)) as T;
  };
  feecode() {
    return this.fee;
  }
  async wallet() {
    const w = new Wallet(new Mint(this.url, { customRequest: this.request }), { unit: 'sat' });
    await w.loadMint();
    return w;
  }
  async fund(amount: number) {
    const w = await this.wallet();
    const q = await w.createMintQuoteBolt11(amount);
    this.deposits.get(q.quote).state = 'PAID';
    return w.completeMint(await w.prepareMint('bolt11', amount, { ...q, state: 'PAID' }));
  }
}
