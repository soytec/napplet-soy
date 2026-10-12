import 'fake-indexeddb/auto';
import { test, expect } from 'bun:test';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';
import { NostrIDB, openDB } from 'nostr-idb';
import { isFromCache } from 'applesauce-core/helpers';
import { ProtocolClient } from '../../../../packages/client/src/nostr';
import { startBrowserEventCache } from './event-cache';

test('restores verified public events and deletions, rejecting a tampered cache record', async () => {
  const db = await openDB('napplet-public-events');
  const stored = new NostrIDB(db, { writeInterval: 20, pruneInterval: 60000 });
  const key = generateSecretKey();
  const manifest = finalizeEvent({ kind: 35129, created_at: 100, tags: [['d', 'demo']], content: 'demo' }, key);
  const deletion = finalizeEvent({ kind: 5, created_at: 101, tags: [['e', manifest.id]], content: '' }, key);
  await stored.add(manifest);
  await stored.add(deletion);
  await stored.add({ ...manifest, id: 'f'.repeat(64), content: 'tampered' });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await stored.stop();

  const client = new ProtocolClient(() => []);
  await startBrowserEventCache(client);
  expect(client.cached([{ ids: [manifest.id] }]).map((event) => event.id)).toContain(manifest.id);
  expect(isFromCache(client.cached([{ ids: [manifest.id] }])[0])).toBe(true);
  expect(client.cached([{ kinds: [5] }]).map((event) => event.id)).toContain(deletion.id);
  expect(client.cached([{ ids: ['f'.repeat(64)] }])).toHaveLength(0);

  const reaction = finalizeEvent({ kind: 7, created_at: 102, tags: [['e', manifest.id]], content: '+' }, key);
  const laterDeletion = finalizeEvent({ kind: 5, created_at: 103, tags: [['e', reaction.id]], content: '' }, key);
  client.seed([reaction, laterDeletion]);
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect((await stored.event(reaction.id))?.id).toBe(reaction.id);
  expect((await stored.event(laterDeletion.id))?.id).toBe(laterDeletion.id);
});
