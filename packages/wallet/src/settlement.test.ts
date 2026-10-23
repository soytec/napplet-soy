import { expect, test } from 'bun:test';
import { settlementCandidates, showDepositCode, transactionFeedback } from './settlement';
import type { WalletTransaction } from './types';
const base: WalletTransaction = {
  id: 'one',
  type: 'deposit',
  status: 'invoice',
  mint: 'https://mint.test',
  amount: 21,
  fee: 0,
  createdAt: 1,
  invoice: 'lnbc',
  quoteExpires: 100,
};
test('paid, expired and completed deposit invoices no longer offer a QR to pay', () => {
  expect(showDepositCode(base, 99)).toBe(true);
  expect(showDepositCode(base, 100)).toBe(false);
  for (const quoteState of ['PAID', 'ISSUED'] as const) {
    expect(showDepositCode({ ...base, quoteState }, 99)).toBe(false);
    expect(transactionFeedback({ ...base, quoteState })).toContain('Invoice paid');
  }
  expect(showDepositCode({ ...base, status: 'pending' }, 99)).toBe(false);
  expect(showDepositCode({ ...base, status: 'complete' }, 99)).toBe(false);
  expect(transactionFeedback({ ...base, status: 'complete' })).toBe('Lightning received');
});
test('polling includes expired invoices and sent tokens but excludes unapproved outgoing payments', () => {
  const sent = {
    ...base,
    id: 'send',
    type: 'send' as const,
    status: 'complete' as const,
    token: 'cashuB',
  };
  expect(settlementCandidates([base, sent]).map((t) => t.id)).toEqual(['one', 'send']);
  const review = { ...base, id: 'review', type: 'melt' as const, status: 'review' as const };
  expect(settlementCandidates([base, sent, review]).map((t) => t.id)).toEqual(['send']);
  expect(settlementCandidates([{ ...sent, tokenState: 'spent' }])).toEqual([]);
  expect(transactionFeedback(sent)).toBe('Cashu token ready to share');
  expect(transactionFeedback({ ...sent, tokenState: 'spent' })).toBe('Cashu token redeemed');
});
