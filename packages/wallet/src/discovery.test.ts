import { expect, test } from 'bun:test';
import { EventStore } from 'applesauce-core';
import { PrivateKeySigner } from 'applesauce-signers';
import { WalletFactory } from 'applesauce-wallet/factories';
import { unlockWallet } from 'applesauce-wallet/helpers';
import type { Filter } from 'nostr-tools';
import { discoverWalletRelays } from './discovery';

test('cold discovery requests only metadata and only visits additional destinations once', async () => {
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey();
  const store = new EventStore();
  const event = await WalletFactory.create(['https://mint.test'], undefined, [
    'wss://bootstrap.test',
    'wss://wallet.test',
  ]).sign(signer);
  const reads: { relays: string[]; filters: Filter[] }[] = [];
  const result = await discoverWalletRelays({
    pubkey,
    store,
    fallback: ['wss://bootstrap.test'],
    current: ['wss://bootstrap.test/'],
    unlock: async () => {
      await unlockWallet(store.getReplaceable(17375, pubkey)!, signer);
    },
    collect: async (relays, filters) => {
      reads.push({ relays, filters });
      store.add(JSON.parse(JSON.stringify(event)));
    },
  });
  expect(reads.map((read) => read.relays)).toEqual([
    ['wss://bootstrap.test/'],
    ['wss://wallet.test/'],
  ]);
  expect(result).toEqual(['wss://bootstrap.test/', 'wss://wallet.test/']);
  for (const read of reads) {
    expect(read.filters).toEqual([{ kinds: [10019, 10002, 17375], authors: [pubkey] }]);
  }
});

test('warm discovery uses the saved wallet relays without repeating bootstrap reads', async () => {
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey();
  const store = new EventStore();
  store.add(
    await WalletFactory.create(['https://mint.test'], undefined, [
      'wss://second.test',
      'wss://first.test',
    ]).sign(signer),
  );
  const reads: string[][] = [];
  const relays = await discoverWalletRelays({
    pubkey,
    store,
    fallback: ['wss://bootstrap.test'],
    current: ['wss://bootstrap.test'],
    unlock: async () => {
      await unlockWallet(store.getReplaceable(17375, pubkey)!, signer);
    },
    collect: async (urls) => {
      reads.push(urls);
    },
  });
  expect(reads).toEqual([['wss://first.test/', 'wss://second.test/']]);
  expect(relays).toEqual(reads[0]);
});

test('wallet discovery follows relay hints and propagates failed reads instead of reporting an empty wallet', async () => {
  const signer = new PrivateKeySigner(),
    pubkey = await signer.getPublicKey();
  const store = new EventStore();
  store.add(
    await signer.signEvent({
      kind: 10019,
      created_at: 1,
      content: '',
      tags: [['relay', 'wss://hint.test']],
    }),
  );
  const reads: string[][] = [];
  await expect(
    discoverWalletRelays({
      pubkey,
      store,
      fallback: ['wss://bootstrap.test'],
      current: [],
      unlock: async () => {
        throw Error('No wallet to unlock');
      },
      collect: async (urls) => {
        reads.push(urls);
        if (urls.includes('wss://hint.test/')) throw Error('relay lookup failed');
      },
    }),
  ).rejects.toThrow('relay lookup failed');
  expect(reads).toEqual([['wss://bootstrap.test/'], ['wss://hint.test/']]);
});
