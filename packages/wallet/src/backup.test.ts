import { test, expect } from 'bun:test';
import { PrivateKeySigner } from 'applesauce-signers';
import { encryptBackup, decryptBackup, validateBackup, type WalletBackup } from './backup';
import { paymentInput, mintUrl, sats, walletRelays } from './policy';
import { walletErrorMessage } from './errors';
import { testInvoice } from './fixture';

test('large encrypted backup restores, rejects missing/reordered/tampered chunks and foreign identities', async () => {
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey();
  const event = await signer.signEvent({
    kind: 7376,
    created_at: 1,
    tags: [],
    content: await signer.nip44.encrypt(pubkey, 'secret encrypted history'),
  });
  const data: WalletBackup = {
    version: 1,
    pubkey,
    events: [event],
    outbox: null,
    transactions: [
      {
        id: 'test',
        type: 'send',
        status: 'complete',
        mint: 'https://mint.test',
        amount: 8,
        fee: 0,
        createdAt: 1,
        token: 'cashuB' + 'secret😀'.repeat(12000),
      },
    ],
  };
  const encoded = await encryptBackup(data, signer),
    envelope = JSON.parse(encoded);
  expect(encoded).not.toContain('secret');
  expect(envelope.chunks.length).toBeGreaterThan(2);
  expect(JSON.stringify(await decryptBackup(encoded, pubkey, signer))).toBe(JSON.stringify(data));
  for (const chunks of [
    envelope.chunks.slice(1),
    [...envelope.chunks].reverse(),
    [...envelope.chunks.slice(0, -1), 'bad ciphertext'],
  ])
    await expect(
      decryptBackup(JSON.stringify({ ...envelope, chunks }), pubkey, signer),
    ).rejects.toThrow();
  await expect(decryptBackup(encoded, 'b'.repeat(64), signer)).rejects.toThrow('this account');
  expect(() =>
    validateBackup({ ...data, events: [{ ...event, pubkey: 'b'.repeat(64) }] }, pubkey),
  ).toThrow('foreign');
});
test('wallet inputs reject navigation, noninteger amounts, expired invoices and unsafe services', () => {
  for (const amount of [0, -1, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1])
    expect(() => sats(amount)).toThrow();
  for (const url of [
    'http://mint.test',
    'https://user:secret@mint.test',
    'https://mint.test/?key=x',
  ])
    expect(() => mintUrl(url)).toThrow();
  expect(() => walletRelays(['ws://relay.test'])).toThrow();
  expect(() => paymentInput('https://phishing.test')).toThrow();
  expect(() => paymentInput(testInvoice(1, undefined, 0))).toThrow('expired');
  expect(paymentInput('lightning:' + testInvoice(8).toUpperCase()).type).toBe('lightning');
  expect(walletErrorMessage(Error('cashuBsecret credential'))).not.toContain('secret');
});
