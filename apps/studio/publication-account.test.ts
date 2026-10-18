import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { bindPublicationAccount } from './publication-account';

const template = { kind: 35129, created_at: 1, tags: [['d', 'demo']], content: '' };
test('shared shell publication preserves exact templates and rejects changes to account or permissions', async () => {
  const key = generateSecretKey(),
    pubkey = getPublicKey(key);
  let current: string | null = pubkey;
  let calls = 0;
  const account = {
    pubkey,
    currentPubkey: () => current,
    connect: async () => {},
    sign: async (_: string, value: typeof template) => {
      calls++;
      return finalizeEvent(value, key);
    },
  };
  const signer = bindPublicationAccount(account);
  expect((await signer.signEvent(template)).pubkey).toBe(pubkey);
  expect(calls).toBe(1);
  await expect(signer.signEvent({ ...template, kind: 1 })).rejects.toThrow();
  expect(calls).toBe(1);
  current = getPublicKey(generateSecretKey());
  expect(signer.alive()).toBe(false);
  await expect(signer.signEvent(template)).rejects.toThrow('account changed');
  current = pubkey;
  const delayed = bindPublicationAccount({
    ...account,
    sign: async (_, value) => {
      current = null;
      return finalizeEvent(value, key);
    },
  });
  await expect(delayed.signEvent(template)).rejects.toThrow('during signing');
  current = pubkey;
  signer.close();
  await expect(signer.signEvent(template)).rejects.toThrow();
});
test('shared shell publication checks returned event instead of trusting an adapter', async () => {
  const key = generateSecretKey(),
    pubkey = getPublicKey(key);
  const signer = bindPublicationAccount({
    pubkey,
    currentPubkey: () => pubkey,
    connect: async () => {},
    sign: async (_, value) => finalizeEvent({ ...value, content: 'changed' }, key),
  });
  await expect(signer.signEvent(template)).rejects.toThrow('does not match');
});
