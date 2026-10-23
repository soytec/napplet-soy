import type { NostrEvent } from 'nostr-tools';
import type { SerializedSwapPreview, SerializedOutputData } from '@cashu/cashu-ts';
import type { TransactionKind } from './policy';

export interface WalletStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<void>;
}
export type SavedOutputs = { keysetId: string; outputData: SerializedOutputData[] };
export type WalletTransaction = {
  id: string;
  type: TransactionKind;
  mint: string;
  amount: number;
  createdAt: number;
  status: 'invoice' | 'review' | 'pending' | 'complete' | 'cancelled';
  fee: number;
  message?: string;
  invoice?: string;
  paymentHash?: string;
  preimage?: string;
  quote?: string;
  quoteExpires?: number;
  quoteAmount?: number;
  feeReserve?: number;
  swap?: SerializedSwapPreview;
  recoverySwap?: SerializedSwapPreview;
  recovered?: boolean;
  mintOutputs?: SavedOutputs;
  meltOutputs?: SavedOutputs;
  keep?: string[];
  send?: string[];
  unselected?: string[];
  spent?: NostrEvent[];
  token?: string;
  sourceToken?: string;
  nutzap?: NostrEvent;
  recipient?: NostrEvent;
  deliveryRelays?: string[];
  receiptRelays?: string[];
  target?: NostrEvent;
  comment?: string;
  events?: NostrEvent[];
  redeemed?: string[];
  confirmed?: boolean;
  lastError?: string;
};
export const pendingFunds = (t: WalletTransaction) => t.status === 'pending';
