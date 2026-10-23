import {
  Wallet as CashuWallet,
  OutputData,
  Amount,
  getDecodedToken,
  getEncodedToken,
  normalizeProofAmounts,
  serializeProofs,
  deserializeProofs,
  serializeSwapPreview,
  deserializeSwapPreview,
  sumProofs,
  verifyDleqIfPresent,
  hashToCurve,
  type Proof,
  type OutputDataLike,
  type SwapPreview,
} from '@cashu/cashu-ts';
import { NutWallet, type NutWalletOptions } from 'applesauce-wallet/wallet';
import { WalletFactory, WalletTokenFactory } from 'applesauce-wallet/factories';
import {
  getTokenContent,
  getWalletPrivateKey,
  getWalletMints,
  getWalletRelays,
} from 'applesauce-wallet/helpers';
import { generateSecretKey, getPublicKey, type NostrEvent, type EventTemplate } from 'nostr-tools';
import { bytesToHex } from '@noble/hashes/utils.js';
import { firstValueFrom, BehaviorSubject } from 'rxjs';
import { WalletJournal } from './journal';
import {
  mintUrl,
  nutzapRecipient,
  paymentInput,
  removeMintAllowed,
  sats,
  walletRelays,
  nip65ReadRelays,
} from './policy';
import {
  pendingFunds,
  type WalletStorage,
  type WalletTransaction,
  type SavedOutputs,
} from './types';
import { verifySignature } from '../../protocol/src/verify';
import { WalletError } from './errors';

const now = () => Math.floor(Date.now() / 1000);
const serialOutputs = (outputs: OutputDataLike[], keysetId: string): SavedOutputs => ({
  keysetId,
  outputData: outputs.map(OutputData.serialize),
});
const proofSum = (proofs: Proof[]) => sumProofs(proofs).toNumber();
const sendTotal = (preview: SwapPreview) =>
  (preview.sendOutputs ?? []).reduce(
    (n, o) => n + Amount.from(o.blindedMessage.amount).toNumber(),
    0,
  );

/** NIP-60 reader from Applesauce; durable, explicitly confirmed monetary operations around cashu-ts.
 * All mutating calls must run inside the shell's account Web Lock, including recovery. */
export class ShellWallet extends NutWallet {
  readonly journal: WalletJournal;
  readonly transactions$ = new BehaviorSubject<WalletTransaction[]>([]);
  readonly progress$ = new BehaviorSubject('');
  private alive = true;
  constructor(
    options: NutWalletOptions,
    readonly storage: WalletStorage,
    readonly assertAccount: () => void,
  ) {
    super({ ...options, autoUnlock: false, useDeleteEvents: true });
    this.journal = new WalletJournal(storage);
  }
  override stop() {
    this.alive = false;
    super.stop();
  }
  private check() {
    if (!this.alive) throw new WalletError('Wallet closed. Reopen it for this account.');
    this.assertAccount();
  }
  async refreshTransactions() {
    this.transactions$.next(await this.journal.list());
  }
  satBalances() {
    const all = this.eventStore.getByFilters({ kinds: [7375], authors: [this.pubkey] });
    const removed = new Set(
      all.flatMap((e) => [
        ...(getTokenContent(e)?.del ?? []),
        ...e.tags.filter((t) => t[0] === 'del').map((t) => t[1]),
      ]),
    );
    const seen = new Set<string>(),
      balances: Record<string, number> = {};
    for (const e of all) {
      const t = getTokenContent(e);
      if (!t || removed.has(e.id) || (t.unit && t.unit !== 'sat')) continue;
      const mint = mintUrl(t.mint);
      for (const p of t.proofs) {
        const key = `${mint}:${p.secret}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const amount = Number(p.amount);
        if (!Number.isSafeInteger(amount) || amount < 0)
          throw new WalletError('Invalid wallet proof amount.');
        balances[mint] = (balances[mint] ?? 0) + amount;
      }
    }
    return balances;
  }
  private async save(tx: WalletTransaction) {
    await this.journal.put(tx);
    await this.refreshTransactions();
  }
  private async unblocked(except?: string) {
    this.check();
    if (
      (await this.journal.list()).some(
        (t) => t.id !== except && (pendingFunds(t) || t.status === 'review'),
      )
    )
      throw new WalletError('Resolve the pending transaction in Activity before spending again.');
    if (await this.storage.getItem('outbox'))
      throw new WalletError('Retry wallet sync before starting another transaction.');
  }
  private walletEvent() {
    const event = this.eventStore.getReplaceable(17375, this.pubkey);
    if (!event || !getWalletMints(event)) throw new WalletError('Unlock your wallet first.');
    return event;
  }
  private trusted(url: string) {
    const mint = mintUrl(url);
    if (!getWalletMints(this.walletEvent())!.some((m) => mintUrl(m) === mint))
      throw new WalletError('Add this mint in wallet settings after reviewing it.');
    return mint;
  }
  async cashu(mint: string) {
    return this.getCashuWallet(mintUrl(mint));
  }
  async inspectMint(url: string) {
    const wallet = new CashuWallet(mintUrl(url), { unit: 'sat' });
    await wallet.loadMint();
    const info = await wallet.mint.getInfo();
    if (
      info.nuts['4']?.disabled ||
      info.nuts['5']?.disabled ||
      !info.nuts['4']?.methods?.some((m) => m.method === 'bolt11' && m.unit === 'sat') ||
      !info.nuts['5']?.methods?.some((m) => m.method === 'bolt11' && m.unit === 'sat')
    )
      throw new WalletError('This mint does not support sat Lightning deposits and payments.');
    return {
      name: info.name,
      nutzaps: !!info.nuts['11']?.supported && !!info.nuts['12']?.supported,
    };
  }
  /** Persist the signed batch before the first publish. Retry identical events after a partial ACK. */
  async publishBatch(events: NostrEvent[], relays?: string[], receiptRelays: string[] = []) {
    this.check();
    const configuring = events.some((e) => e.kind === 17375);
    const own = walletRelays(
      configuring && relays
        ? relays
        : this.resolvePublishRelays().length
          ? this.resolvePublishRelays()
          : await firstValueFrom(this.relays$),
    );
    const discovery = await firstValueFrom(this.relays$);
    const items = events.map((event) => ({
      event,
      relays:
        event.kind === 9321
          ? walletRelays(relays ?? [])
          : event.kind === 10019
            ? [...new Set([...own, ...discovery])]
            : event.kind === 7376 && event.tags.some((t) => t[0] === 'e' && t[3] === 'redeemed')
              ? [...new Set([...own, ...receiptRelays])]
              : own,
      required: event.kind === 9321 ? walletRelays(relays ?? []) : own,
    }));
    await this.storage.setItem('outbox', JSON.stringify({ items }));
    await this.flush();
  }
  async flush() {
    this.check();
    const saved = await this.storage.getItem('outbox');
    if (!saved) return;
    const { items } = JSON.parse(saved) as {
      items: { event: NostrEvent; relays: string[]; required: string[] }[];
    };
    for (const { event, relays, required } of items) {
      this.check();
      this.progress$.next('Saving encrypted wallet changes to your relays…');
      const results = await this.pool.publish(relays, event, {
        timeout: 10000,
        retries: false,
        waitForAuth: this.pubkey,
        onAuthRequired: async ({ relay }) => {
          this.check();
          await relay.authenticate(this.signer);
        },
      });
      if (!results.some((r) => r.ok && required.includes(new URL(r.from).href)))
        throw new WalletError(
          'No relay acknowledged the wallet update. The signed update is saved; retry sync.',
        );
      if (event.kind === 17375)
        await this.storage.setItem('wallet-reference', JSON.stringify(event));
      this.eventStore.add(event);
    }
    await this.storage.removeItem('outbox');
  }
  protected override async publish(event: NostrEvent, relays?: string[]) {
    await this.publishBatch([event], relays);
  }
  async configure(mints: string[], relays: string[], receiveNutzaps: boolean, creating = false) {
    await this.unblocked();
    mints = [...new Set(mints.map(mintUrl))];
    relays = walletRelays(relays);
    if (!mints.length) throw new WalletError('Keep at least one mint.');
    const existing = this.eventStore.getReplaceable(17375, this.pubkey);
    if (creating && existing) throw new WalletError('A wallet already exists. Unlock it instead.');
    if (!creating && !existing) throw new WalletError('Load or create your wallet first.');
    const old = existing && getWalletMints(existing);
    const balances = this.satBalances();
    for (const removed of (old ?? []).filter((m) => !mints.includes(mintUrl(m))))
      removeMintAllowed(mintUrl(removed), balances, await this.journal.list());
    for (const mint of mints) {
      const info = await this.inspectMint(mint);
      if (receiveNutzaps && !info.nutzaps)
        throw new WalletError(
          'Receiving nutzaps requires NUT-11 and NUT-12 support on every advertised mint.',
        );
    }
    this.check();
    const key = existing ? getWalletPrivateKey(this.walletEvent()) : generateSecretKey();
    if (!key)
      throw new WalletError(
        'The existing wallet receiving key is missing. Restore its backup before changing settings.',
      );
    // Replaceable events created in the same second must still supersede the previous event.
    const signed = await WalletFactory.create(mints, key, relays)
      .created(Math.max(now(), (existing?.created_at ?? 0) + 1))
      .sign(this.signer);
    const previousInfo = this.eventStore.getReplaceable(10019, this.pubkey);
    const info = await this.signer.signEvent({
      kind: 10019,
      created_at: Math.max(now(), (previousInfo?.created_at ?? 0) + 1),
      content: '',
      tags: [
        ['pubkey', getPublicKey(key)],
        ...relays.map((r) => ['relay', r]),
        ...(receiveNutzaps ? mints.map((m) => ['mint', m, 'sat']) : []),
      ],
    });
    await this.publishBatch([signed, info], relays);
    await this.unlock();
    this.resync();
  }
  private transaction(
    type: WalletTransaction['type'],
    mint: string,
    amount: number,
  ): WalletTransaction {
    return {
      id: crypto.randomUUID(),
      type,
      mint,
      amount,
      createdAt: now(),
      status: 'review',
      fee: 0,
    };
  }
  async deposit(
    mintOrOptions: string | Parameters<NutWallet['deposit']>[0],
    amount?: number,
  ): Promise<void> {
    if (typeof mintOrOptions !== 'string')
      throw new WalletError('Use the reviewable wallet deposit flow.');
    await this.unblocked();
    const mint = this.trusted(mintOrOptions),
      value = sats(amount);
    this.progress$.next('Requesting a Lightning invoice…');
    const quote = await (await this.cashu(mint)).createMintQuoteBolt11(value);
    const parsed = paymentInput(quote.request);
    if (parsed.type !== 'lightning' || parsed.invoice.amount !== value * 1000)
      throw new WalletError('The mint returned an invoice for an unexpected amount.');
    const tx = {
      ...this.transaction('deposit', mint, value),
      status: 'invoice' as const,
      invoice: quote.request,
      quote: quote.quote,
      quoteExpires: quote.expiry ?? undefined,
    };
    await this.save(tx);
  }
  private async select(mint: string) {
    await this.unlock();
    const all = this.eventStore.getByFilters({ kinds: [7375], authors: [this.pubkey] });
    const removed = new Set(all.flatMap((e) => getTokenContent(e)?.del ?? []));
    const spent = all.filter(
      (e) =>
        !removed.has(e.id) &&
        getTokenContent(e)?.unit !== 'usd' &&
        ['sat', undefined].includes(getTokenContent(e)?.unit) &&
        mintUrl(getTokenContent(e)?.mint ?? 'https://invalid') === mint,
    );
    const proofs = normalizeProofAmounts(spent.flatMap((e) => getTokenContent(e)?.proofs ?? []));
    const unique = proofs.filter((p, i) => proofs.findIndex((q) => q.secret === p.secret) === i);
    if (!unique.length) throw new WalletError('No spendable sats at this mint.');
    const states = await (await this.cashu(mint)).checkProofsStates(unique);
    if (states.length !== unique.length || states.some((s) => s.state !== 'UNSPENT'))
      throw new WalletError(
        'Some funds were spent or reserved by another wallet. Sync before trying again.',
      );
    return { spent, proofs: unique };
  }
  async prepareSend(
    mintInput: string,
    amount: number,
    recipient?: NostrEvent,
    target?: NostrEvent,
    comment = '',
    relayList?: NostrEvent,
  ) {
    await this.unblocked();
    const mint = this.trusted(mintInput),
      value = sats(amount),
      wallet = await this.cashu(mint);
    const { spent, proofs } = await this.select(mint);
    const builder = wallet.ops.send(value, proofs);
    if (recipient) {
      if (
        !verifySignature(recipient) ||
        (target && (target.pubkey !== recipient.pubkey || !verifySignature(target)))
      )
        throw new WalletError('The recipient or target event could not be verified.');
      const info = nutzapRecipient(recipient);
      if (!info.mints.some((m) => m.url === mint))
        throw new WalletError('The recipient does not accept this mint.');
      builder.asP2PK({ pubkey: info.key }).includeFees(true);
    }
    const preview = await builder.prepare();
    const tx = {
      ...this.transaction(recipient ? 'nutzap' : 'send', mint, value),
      swap: serializeSwapPreview(preview),
      unselected: serializeProofs(preview.unselectedProofs ?? []),
      fee: preview.fees.toNumber() + sendTotal(preview) - value,
      spent,
      recipient,
      deliveryRelays: recipient
        ? [
            ...new Set([
              ...nutzapRecipient(recipient).relays,
              ...nip65ReadRelays(relayList, recipient.pubkey),
            ]),
          ]
        : undefined,
      target,
      comment,
    };
    await this.save(tx);
    return tx;
  }
  async preparePayment(mintInput: string, input: string) {
    await this.unblocked();
    const parsed = paymentInput(input);
    if (parsed.type !== 'lightning') throw new WalletError('Use Receive to redeem a Cashu token.');
    const previous = (await this.journal.list()).find(
      (t) => t.paymentHash === parsed.invoice.paymentHash && t.status !== 'cancelled',
    );
    if (previous)
      throw new WalletError(
        'This invoice already has a wallet transaction. Open Activity to check it.',
      );
    const mint = this.trusted(mintInput),
      wallet = await this.cashu(mint);
    this.progress$.next('Getting the payment amount and maximum fee…');
    const quote = await wallet.createMeltQuoteBolt11(parsed.value);
    const amount = quote.amount.toNumber(),
      feeReserve = quote.fee_reserve.toNumber();
    if (
      amount !== Math.ceil(parsed.invoice.amount! / 1000) ||
      !Number.isSafeInteger(feeReserve) ||
      feeReserve < 0
    )
      throw new WalletError('The mint returned an unexpected payment quote.');
    const { spent, proofs } = await this.select(mint);
    const preview = await wallet.ops
      .send(amount + feeReserve, proofs)
      .includeFees(true)
      .prepare();
    const tx = {
      ...this.transaction('melt', mint, amount),
      invoice: parsed.value,
      paymentHash: parsed.invoice.paymentHash,
      quote: quote.quote,
      quoteExpires: quote.expiry,
      quoteAmount: amount,
      feeReserve,
      spent,
      fee: sendTotal(preview) - amount + preview.fees.toNumber(),
      swap: serializeSwapPreview(preview),
      unselected: serializeProofs(preview.unselectedProofs ?? []),
    };
    await this.save(tx);
    return tx;
  }
  async prepareReceive(input: string, nutzap?: NostrEvent, senderRelays?: NostrEvent) {
    await this.unblocked();
    const parsed = paymentInput(input);
    if (parsed.type !== 'cashu') throw new WalletError('Use Pay for a Lightning invoice.');
    const mint = this.trusted(parsed.mint),
      wallet = await this.cashu(mint);
    const token = wallet.decodeToken(parsed.value);
    const states = await wallet.checkProofsStates(token.proofs);
    if (states.length !== token.proofs.length || states.some((s) => s.state !== 'UNSPENT'))
      throw new WalletError('This token is already spent or pending at the mint.');
    if (nutzap) {
      if (
        (await this.journal.list()).some(
          (t) => t.redeemed?.includes(nutzap.id) && t.status !== 'cancelled',
        )
      )
        throw new WalletError('This nutzap already has a transaction. Check Activity.');
      const verified = wallet.decodeToken(await this.validateNutzap(nutzap));
      if (
        JSON.stringify(serializeProofs(verified.proofs)) !==
          JSON.stringify(serializeProofs(token.proofs)) ||
        mintUrl(verified.mint) !== mint
      )
        throw new WalletError('The token does not match the nutzap being redeemed.');
    }
    const builder = wallet.ops.receive(token);
    const key = getWalletPrivateKey(this.walletEvent());
    if (key) builder.privkey(bytesToHex(key));
    if (nutzap) builder.requireDleq(true);
    const preview = await builder.prepare();
    const tx = {
      ...this.transaction(
        nutzap ? 'redeem' : 'receive',
        mint,
        proofSum(token.proofs) - preview.fees.toNumber(),
      ),
      swap: serializeSwapPreview(preview),
      fee: preview.fees.toNumber(),
      sourceToken: parsed.value,
      redeemed: nutzap ? [nutzap.id] : undefined,
      nutzap,
      receiptRelays: nutzap ? nip65ReadRelays(senderRelays, nutzap.pubkey) : undefined,
    };
    await this.save(tx);
    return tx;
  }
  async validateNutzap(event: NostrEvent) {
    const infoEvent = this.eventStore.getReplaceable(10019, this.pubkey);
    if (
      !infoEvent ||
      !verifySignature(event) ||
      event.kind !== 9321 ||
      event.tags.filter((t) => t[0] === 'p').length !== 1 ||
      event.tags.find((t) => t[0] === 'p')?.[1] !== this.pubkey ||
      event.tags.some((t) => t[0] === 'unit' && t[1] !== 'sat')
    )
      throw new WalletError('This nutzap is not addressed to your sat wallet.');
    const info = nutzapRecipient(infoEvent),
      url = event.tags.find((t) => t[0] === 'u')?.[1];
    if (
      !url ||
      event.tags.filter((t) => t[0] === 'u').length !== 1 ||
      !info.mints.some((m) => m.exact === url)
    )
      throw new WalletError('This nutzap uses a mint you have not agreed to receive from.');
    const proofs = deserializeProofs(event.tags.filter((t) => t[0] === 'proof').map((t) => t[1]));
    if (!proofs.length) throw new WalletError('This nutzap contains no proofs.');
    if (new Set(proofs.map((p) => p.secret)).size !== proofs.length)
      throw new WalletError('This nutzap repeats the same proof.');
    if (info.key !== `02${getPublicKey(getWalletPrivateKey(this.walletEvent())!)}`)
      throw new WalletError(
        'The advertised receiving key does not match this wallet. Restore the matching wallet before redeeming.',
      );
    const wallet = await this.cashu(url);
    await wallet.ensureOperableKeysets(proofs.map((p) => p.id));
    for (const proof of proofs) {
      const secret = JSON.parse(proof.secret);
      if (
        secret[0] !== 'P2PK' ||
        secret[1]?.data !== info.key ||
        (secret[1]?.tags ?? []).some(
          (t: string[]) =>
            !['sigflag', 'n_sigs'].includes(t[0]) ||
            (t[0] === 'n_sigs' && t[1] !== '1') ||
            (t[0] === 'sigflag' && !['SIG_INPUTS', 'SIG_ALL'].includes(t[1])),
        ) ||
        !proof.dleq ||
        !verifyDleqIfPresent(proof, wallet.getKeyset(proof.id))
      )
        throw new WalletError('The nutzap’s lock or DLEQ proof could not be verified.');
    }
    const redeemed = await firstValueFrom(this.history$);
    if (redeemed?.some((h) => h.redeemed.includes(event.id)))
      throw new WalletError('This nutzap has already been redeemed.');
    return getEncodedToken({ mint: url, unit: 'sat', proofs });
  }
  async cancel(id: string) {
    this.check();
    const tx = await this.journal.get(id);
    if (tx.status !== 'review')
      throw new WalletError(
        'Only an unsubmitted review can be cancelled. Pending payments must be checked.',
      );
    tx.status = 'cancelled';
    await this.save(tx);
  }
  async archiveExpiredInvoice(id: string) {
    this.check();
    const tx = await this.journal.get(id);
    if (
      tx.type !== 'deposit' ||
      tx.status !== 'invoice' ||
      !tx.quoteExpires ||
      tx.quoteExpires > now()
    )
      throw new WalletError('Only an expired, unpaid deposit invoice can be archived.');
    const quote = await (await this.cashu(this.trusted(tx.mint))).checkMintQuoteBolt11(tx.quote!);
    if (quote.state !== 'UNPAID') return this.resume(id);
    tx.status = 'cancelled';
    tx.message = 'Expired unpaid invoice';
    await this.save(tx);
    return tx;
  }
  /** A failed melt can leave the preswap completed. Swap the reserved proofs back,
   * only after the mint reports the invoice unpaid and every input unspent. */
  async reclaimPayment(id: string) {
    this.check();
    const tx = await this.journal.get(id);
    if (
      tx.type !== 'melt' ||
      tx.status !== 'pending' ||
      !tx.send ||
      tx.events ||
      tx.message === 'Lightning paid'
    )
      throw new WalletError('This payment cannot be reclaimed. Check its status instead.');
    await this.unblocked(id);
    const wallet = await this.cashu(this.trusted(tx.mint));
    if (!tx.recoverySwap) {
      const quote = await wallet.checkMeltQuoteBolt11(tx.quote!);
      if (quote.state !== 'UNPAID')
        throw new WalletError(
          'The mint reports this payment paid or in flight. Check it instead of reclaiming.',
        );
      const proofs = deserializeProofs(tx.send),
        states = await wallet.checkProofsStates(proofs);
      if (states.length !== proofs.length || states.some((s) => s.state !== 'UNSPENT'))
        throw new WalletError(
          'Reserved proofs are not all unspent. Keep this payment pending and check again.',
        );
      tx.recoverySwap = serializeSwapPreview(
        await wallet.ops.receive({ mint: tx.mint, unit: 'sat', proofs }).prepare(),
      );
      await this.save(tx);
    }
    return this.resume(id);
  }
  /** Restores exact blinded outputs after a lost mint/swap response (NUT-09). Never invent new outputs. */
  private async restoreOutputs(wallet: CashuWallet, outputs: OutputDataLike[]) {
    if (!outputs.length) return [];
    const result = await wallet.mint.restore({ outputs: outputs.map((o) => o.blindedMessage) });
    if (result.outputs.length !== outputs.length || result.signatures.length !== outputs.length)
      throw new WalletError(
        'The mint has not returned every saved output. Keep this transaction pending and retry recovery.',
      );
    await wallet.ensureOperableKeysets(result.signatures.map((s) => s.id));
    return outputs.map((output) => {
      const index = result.outputs.findIndex((o) => o.B_ === output.blindedMessage.B_);
      if (index < 0) throw new WalletError('Mint recovery returned an unexpected output.');
      return OutputData.deserialize(OutputData.serialize(output)).toProof(
        result.signatures[index],
        wallet.getKeyset(result.signatures[index].id),
      );
    });
  }
  private async swap(wallet: CashuWallet, preview: SwapPreview) {
    try {
      // prepare() only constructs outputs. P2PK witnesses are produced at execution,
      // using the dedicated wallet key, including after restoring a journal.
      const key = getWalletPrivateKey(this.walletEvent());
      return await wallet.completeSwap(preview, key ? bytesToHex(key) : undefined);
    } catch {
      const keep = await this.restoreOutputs(wallet, preview.keepOutputs ?? []);
      const send = await this.restoreOutputs(wallet, preview.sendOutputs ?? []);
      return { keep: [...keep, ...(preview.unselectedProofs ?? [])], send };
    }
  }
  /** Read settlement without authorizing or retrying an outgoing mint payment. */
  async checkSettlement(id: string) {
    this.check();
    const tx = await this.journal.get(id);
    if (tx.type === 'send' && tx.status === 'complete' && tx.token && tx.tokenState !== 'spent') {
      const wallet = await this.cashu(tx.mint);
      const { proofs } = wallet.decodeToken(tx.token);
      const states = await wallet.checkProofsStates(proofs);
      this.check();
      if (
        !proofs.length ||
        states.length !== proofs.length ||
        states.some(
          (s, i) =>
            s.Y !== hashToCurve(new TextEncoder().encode(proofs[i].secret)).toHex(true) ||
            !['UNSPENT', 'PENDING', 'SPENT'].includes(s.state),
        )
      )
        throw new WalletError('The mint returned an incomplete token status. Try checking again.');
      const state = states.every((s) => s.state === 'SPENT')
        ? 'spent'
        : states.some((s) => s.state === 'SPENT')
          ? 'partial'
          : states.some((s) => s.state === 'PENDING')
            ? 'pending'
            : 'unspent';
      if (state !== tx.tokenState) {
        tx.tokenState = state;
        await this.save(tx);
      }
      return tx;
    }
    if (tx.type === 'deposit' && ['invoice', 'pending'].includes(tx.status)) return this.resume(id);
    if (
      tx.type === 'melt' &&
      tx.status === 'pending' &&
      tx.confirmed &&
      tx.meltOutputs &&
      !tx.recoverySwap
    )
      return this.resume(id, false, true);
    return tx;
  }
  async resume(id: string, confirm = false, settlementOnly = false) {
    const tx = await this.journal.get(id);
    if (tx.status === 'complete' || tx.status === 'cancelled') return tx;
    this.check();
    if (await this.storage.getItem('outbox')) await this.flush();
    await this.unblocked(id);
    if (tx.status === 'review' && !confirm)
      throw new WalletError('Review and confirm this transaction first.');
    const wallet = await this.cashu(this.trusted(tx.mint));
    try {
      if (tx.type === 'deposit' && !tx.keep) {
        const quote = await wallet.checkMintQuoteBolt11(tx.quote!);
        if (tx.quoteState !== quote.state) {
          tx.quoteState = quote.state;
          await this.save(tx);
        }
        if (quote.state === 'UNPAID') {
          this.progress$.next('Waiting for your Lightning payment…');
          return tx;
        }
        if (quote.state === 'ISSUED' && !tx.mintOutputs)
          throw new WalletError(
            'This quote was claimed elsewhere. Sync your wallet; do not pay it again.',
          );
        tx.status = 'pending';
        await this.save(tx);
        if (!tx.mintOutputs) {
          const preview = await wallet.prepareMint('bolt11', tx.amount, quote);
          tx.mintOutputs = serialOutputs(preview.outputData, preview.keysetId);
          await this.save(tx);
        }
        const outputs = tx.mintOutputs.outputData.map(OutputData.deserialize);
        let proofs: Proof[];
        try {
          proofs = await wallet.completeMint({
            method: 'bolt11',
            quote,
            payload: { quote: tx.quote!, outputs: outputs.map((o) => o.blindedMessage) },
            keysetId: tx.mintOutputs.keysetId,
            outputData: outputs,
          });
        } catch {
          proofs = await this.restoreOutputs(wallet, outputs);
        }
        tx.keep = serializeProofs(proofs);
        await this.save(tx);
      } else if (tx.swap && !tx.keep) {
        if (tx.type === 'melt' && tx.status === 'review' && (tx.quoteExpires ?? 0) <= now())
          throw new WalletError('This payment quote expired. Cancel it and prepare a new quote.');
        tx.status = 'pending';
        tx.confirmed = true;
        await this.save(tx);
        this.check();
        this.progress$.next('Swapping proofs at the mint…');
        const result = await this.swap(wallet, deserializeSwapPreview(tx.swap));
        tx.keep = serializeProofs([...result.keep, ...deserializeProofs(tx.unselected ?? [])]);
        tx.send = serializeProofs(result.send);
        if (tx.type === 'send')
          tx.token = getEncodedToken({ mint: tx.mint, proofs: result.send, unit: 'sat' });
        await this.save(tx);
      }
      if (tx.recoverySwap && !tx.recovered) {
        this.progress$.next('Recovering funds from the unpaid invoice…');
        const result = await this.swap(wallet, deserializeSwapPreview(tx.recoverySwap));
        tx.keep = serializeProofs([...deserializeProofs(tx.keep ?? []), ...result.keep]);
        tx.recovered = true;
        tx.message = 'Unpaid invoice; funds recovered';
        tx.amount = 0;
        tx.fee =
          deserializeSwapPreview(tx.swap!).fees.toNumber() +
          deserializeSwapPreview(tx.recoverySwap).fees.toNumber();
        await this.save(tx);
      }
      if (tx.type === 'melt' && !tx.recovered && !tx.events && tx.message !== 'Lightning paid') {
        let quote = await wallet.checkMeltQuoteBolt11(tx.quote!);
        if (
          quote.amount.toNumber() !== tx.quoteAmount ||
          quote.fee_reserve.toNumber() !== tx.feeReserve
        )
          throw new WalletError(
            'The mint changed the reviewed payment quote. Keep this transaction for recovery.',
          );
        if (quote.state === 'PENDING') {
          this.progress$.next('Lightning payment is in flight. Check again shortly.');
          return tx;
        }
        // Background settlement checks may finish a paid quote, but never submit
        // or resubmit an unpaid outgoing payment, even if a previous call failed.
        if (settlementOnly && quote.state !== 'PAID') return tx;
        if (!tx.meltOutputs && quote.state !== 'PAID') {
          const preview = await wallet.prepareMelt('bolt11', quote, deserializeProofs(tx.send!));
          tx.meltOutputs = serialOutputs(preview.outputData, preview.keysetId);
          await this.save(tx);
        }
        if (!tx.meltOutputs)
          throw new WalletError(
            'Missing saved payment change outputs. Restore the transaction backup.',
          );
        const outputs = tx.meltOutputs.outputData.map(OutputData.deserialize);
        if (quote.state !== 'PAID') {
          this.check();
          this.progress$.next('Paying the Lightning invoice…');
          const result = await wallet.completeMelt({
            method: 'bolt11',
            quote,
            inputs: deserializeProofs(tx.send!),
            outputData: outputs,
            keysetId: tx.meltOutputs.keysetId,
          });
          quote = await wallet.checkMeltQuoteBolt11(tx.quote!);
          if (quote.state !== 'PAID') {
            this.progress$.next('Payment is not confirmed. Funds remain reserved; check again.');
            return tx;
          }
          // Use the saved quote's signatures below so retries reconstruct the identical change.
          if (!quote.change) quote.change = result.quote.change;
        }
        const sigs = (quote.change ?? []).filter((s) => !Amount.from(s.amount).isZero());
        await wallet.ensureOperableKeysets(sigs.map((s) => s.id));
        const change = wallet.createMeltChangeProofs(outputs, sigs);
        tx.keep = serializeProofs([...deserializeProofs(tx.keep!), ...change]);
        tx.preimage = quote.payment_preimage ?? undefined;
        const swap = deserializeSwapPreview(tx.swap!);
        tx.fee =
          swap.fees.toNumber() +
          proofSum(deserializeProofs(tx.send!)) -
          tx.amount -
          proofSum(change);
        if (tx.fee < 0)
          throw new WalletError(
            'The mint returned inconsistent payment change. Keep the transaction for recovery.',
          );
        // Persist completed melt separately, before requesting Nostr signatures.
        tx.message = 'Lightning paid';
        await this.save(tx);
      }
      if (!tx.events) await this.prepareEvents(tx);
      await this.publishBatch(
        tx.events!,
        tx.deliveryRelays ?? (tx.recipient ? nutzapRecipient(tx.recipient).relays : undefined),
        tx.receiptRelays,
      );
      tx.status = 'complete';
      tx.lastError = undefined;
      await this.save(tx);
      await this.unlock();
      this.progress$.next('Wallet updated.');
      return tx;
    } catch (error) {
      // Mint responses can echo proofs or API credentials. Never put raw errors in UI/logs.
      tx.lastError =
        error instanceof WalletError
          ? error.message
          : tx.status === 'pending'
            ? 'Not yet confirmed. Your recovery data is saved. Check this transaction before sending again.'
            : 'The operation could not complete. Check the mint and wallet relays, then retry.';
      await this.save(tx);
      throw new WalletError(tx.lastError);
    }
  }
  private async prepareEvents(tx: WalletTransaction) {
    this.check();
    this.progress$.next('Approve the encrypted wallet updates in your signer…');
    const incoming = ['deposit', 'receive', 'redeem'].includes(tx.type);
    const keep = deserializeProofs(tx.keep ?? []),
      spent = tx.spent?.map((e) => e.id) ?? [];
    const events: NostrEvent[] = [];
    // Even empty change carries del, so a missed deletion cannot resurrect spent proofs.
    const token = keep.length
      ? await WalletTokenFactory.create({ mint: tx.mint, proofs: keep, unit: 'sat' }, spent).sign(
          this.signer,
        )
      : await this.signer.signEvent({
          kind: 7375,
          created_at: now(),
          tags: spent.map((id) => ['del', id]),
          content: await this.signer.nip44!.encrypt(
            this.pubkey,
            JSON.stringify({ mint: tx.mint, proofs: [], unit: 'sat', del: spent }),
          ),
        });
    events.push(token);
    if (tx.type === 'nutzap') {
      const recipient = nutzapRecipient(tx.recipient!);
      const proofs = deserializeProofs(tx.send!);
      const cashu = await this.cashu(tx.mint);
      if (
        proofs.some(
          (p) =>
            !p.dleq ||
            JSON.parse(p.secret)[1]?.data !== recipient.key ||
            !verifyDleqIfPresent(p, cashu.getKeyset(p.id)),
        )
      )
        throw new WalletError('Mint did not supply valid locked DLEQ proofs for this nutzap.');
      const target = tx.target;
      const tags = [
        ['p', recipient.pubkey],
        ['u', recipient.mints.find((m) => m.url === tx.mint)!.exact],
        ['unit', 'sat'],
        ...serializeProofs(proofs).map((p) => ['proof', p]),
      ];
      if (target) {
        tags.push(['e', target.id], ['k', String(target.kind)]);
        if (target.kind >= 30000 && target.kind < 40000)
          tags.push([
            'a',
            `${target.kind}:${target.pubkey}:${target.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`,
          ]);
        else if (target.kind >= 10000 && target.kind < 20000)
          tags.push(['a', `${target.kind}:${target.pubkey}:`]);
      }
      events.push(
        await this.signer.signEvent({
          kind: 9321,
          created_at: now(),
          content: tx.comment ?? '',
          tags,
        }),
      );
    }
    const historyTags = [
      ['direction', incoming ? 'in' : 'out'],
      ['amount', String(tx.amount)],
      ['unit', 'sat'],
      ['e', token.id, '', 'created'],
      ...spent.map((id) => ['e', id, '', 'destroyed']),
      ['mint', tx.mint],
      ['fee', String(tx.fee)],
      ['type', tx.type],
    ];
    const content = await this.signer.nip44!.encrypt(this.pubkey, JSON.stringify(historyTags));
    events.push(
      await this.signer.signEvent({
        kind: 7376,
        created_at: now(),
        content,
        tags: [
          ...(tx.redeemed ?? []).map((id) => ['e', id, '', 'redeemed']),
          ...(tx.nutzap ? [['p', tx.nutzap.pubkey]] : []),
        ],
      }),
    );
    if (spent.length)
      events.push(
        await this.signer.signEvent({
          kind: 5,
          // Applesauce rounds event time; a token can be one second ahead of
          // our clock. Its deletion must not predate the event being replaced.
          created_at: Math.max(now(), ...(tx.spent ?? []).map((e) => e.created_at)),
          content: '',
          tags: [['k', '7375'], ...spent.map((id) => ['e', id])],
        }),
      );
    tx.events = events;
    await this.save(tx);
  }
}
