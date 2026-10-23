import type { ISigner } from 'applesauce-signers';
import { WalletError } from './errors';
import { mintUrl, walletRelays, transactionNames } from './policy';
import { deserializeSwapPreview, deserializeProofs, OutputData } from '@cashu/cashu-ts';
import { verifySignature } from '../../protocol/src/verify';
import type { WalletTransaction } from './types';
import type { NostrEvent } from 'nostr-tools';

export type WalletBackup = {
  version: 1;
  pubkey: string;
  transactions: WalletTransaction[];
  outbox: string | null;
  events: NostrEvent[];
};
export function validateBackup(value: unknown, pubkey: string): WalletBackup {
  const data = value as WalletBackup;
  if (
    data?.version !== 1 ||
    data.pubkey !== pubkey ||
    !Array.isArray(data.transactions) ||
    !Array.isArray(data.events)
  )
    throw new WalletError('Invalid wallet backup for this account.');
  const ownEvent = (e: NostrEvent) => {
    if (
      e?.pubkey !== pubkey ||
      ![5, 17375, 7375, 7376, 10019, 9321].includes(e.kind) ||
      !verifySignature(e)
    )
      throw new WalletError('Wallet backup contains an invalid or foreign event.');
  };
  data.events.forEach(ownEvent);
  const ids = new Set<string>();
  for (const tx of data.transactions) {
    if (
      !tx ||
      typeof tx.id !== 'string' ||
      ids.has(tx.id) ||
      !Object.hasOwn(transactionNames, tx.type) ||
      !['review', 'pending', 'invoice', 'complete', 'cancelled'].includes(tx.status) ||
      !Number.isSafeInteger(tx.amount) ||
      tx.amount < 0 ||
      !Number.isSafeInteger(tx.fee) ||
      tx.fee < 0 ||
      !Number.isSafeInteger(tx.createdAt)
    )
      throw new WalletError('Invalid wallet transaction in backup.');
    ids.add(tx.id);
    mintUrl(tx.mint);
    for (const relays of [tx.deliveryRelays, tx.receiptRelays])
      if (relays?.length) walletRelays(relays);
    for (const preview of [tx.swap, tx.recoverySwap]) if (preview) deserializeSwapPreview(preview);
    for (const proofs of [tx.keep, tx.send, tx.unselected]) if (proofs) deserializeProofs(proofs);
    for (const outputs of [tx.mintOutputs, tx.meltOutputs])
      if (outputs) outputs.outputData.forEach(OutputData.deserialize);
    tx.events?.forEach(ownEvent);
    tx.spent?.forEach(ownEvent);
  }
  if (data.outbox) {
    const box = JSON.parse(data.outbox);
    if (!Array.isArray(box.items)) throw new WalletError('Invalid saved wallet publication.');
    for (const item of box.items) {
      ownEvent(item.event);
      walletRelays(item.relays);
      walletRelays(item.required);
    }
  }
  return data;
}
/** Chunked self-encryption respects NIP-44's plaintext limit without limiting wallet history.
 * Chunk ids/order/count are authenticated inside each chunk, not trusted from the envelope. */
export async function encryptBackup(data: WalletBackup, signer: ISigner) {
  const value = JSON.stringify(data),
    id = crypto.randomUUID(),
    parts: string[] = [];
  // 12k UTF-16 code units remain comfortably below 65535 UTF-8 bytes including metadata.
  for (let i = 0; i < value.length; i += 12000) parts.push(value.slice(i, i + 12000));
  const chunks = [];
  for (let index = 0; index < parts.length; index++)
    chunks.push(
      await signer.nip44!.encrypt(
        data.pubkey,
        JSON.stringify({ id, index, count: parts.length, text: parts[index] }),
      ),
    );
  return JSON.stringify({ version: 1, pubkey: data.pubkey, chunks });
}
export async function decryptBackup(value: string, pubkey: string, signer: ISigner) {
  const outer = JSON.parse(value);
  if (
    outer.version !== 1 ||
    outer.pubkey !== pubkey ||
    !Array.isArray(outer.chunks) ||
    !outer.chunks.length
  )
    throw new WalletError('Choose an encrypted wallet backup for this account.');
  let id: string | undefined,
    text = '';
  for (let index = 0; index < outer.chunks.length; index++) {
    const chunk = JSON.parse(await signer.nip44!.decrypt(pubkey, outer.chunks[index]));
    id ??= chunk.id;
    if (
      typeof id !== 'string' ||
      chunk.id !== id ||
      chunk.index !== index ||
      chunk.count !== outer.chunks.length ||
      typeof chunk.text !== 'string'
    )
      throw new WalletError('Backup chunks are incomplete or out of order.');
    text += chunk.text;
  }
  return validateBackup(JSON.parse(text), pubkey);
}
