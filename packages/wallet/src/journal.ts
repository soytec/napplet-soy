import { WalletError } from './errors';
import type { WalletStorage, WalletTransaction } from './types';

/** All callers hold the account's Web Lock. Persist before network side effects. */
export class WalletJournal {
  constructor(readonly storage: WalletStorage) {}
  async list(): Promise<WalletTransaction[]> {
    return JSON.parse((await this.storage.getItem('transactions')) ?? '[]');
  }
  async put(tx: WalletTransaction) {
    const entries = await this.list();
    await this.storage.setItem(
      'transactions',
      JSON.stringify([tx, ...entries.filter((t) => t.id !== tx.id)]),
    );
  }
  async get(id: string) {
    const tx = (await this.list()).find((t) => t.id === id);
    if (!tx)
      throw new WalletError('Transaction not found on this device. Restore its wallet backup.');
    return tx;
  }
}
