import { isFromCache, persistEventsToCache } from 'applesauce-core/helpers';
import { NostrIDB, openDB } from 'nostr-idb';
import { verifiedEvent } from '../../../../packages/protocol/src';
import type { ProtocolClient } from '../../../../packages/client/src/nostr';

/** Browser-only persistence for public, signed events in the Applesauce store. */
export async function startBrowserEventCache(client: ProtocolClient): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  let cache: NostrIDB;
  try {
    cache = new NostrIDB(await openDB('napplet-public-events'), {
      maxEvents: 8000,
      batchWrite: 100,
    });
  } catch {
    return; // Private browsing or disabled storage must not block relay reads.
  }

  // Applesauce's helper batches store inserts and skips events marked as cache-sourced.
  // Its internal logger absorbs write errors; report a bounded diagnostic here.
  const write = async (events: Parameters<InstanceType<typeof NostrIDB>['add']>[0][]) => {
    try {
      await Promise.all(events.map((event) => cache.add(event)));
    } catch {
      console.warn('Public event cache write failed; relay reads remain available.');
    }
  };
  persistEventsToCache(client.store, write, { batchTime: 250, maxBatchSize: 100 });
  client.deletionEvents.subscribe((event) => {
    if (!isFromCache(event)) void write([event]);
  });

  // Route loaders may have seeded the store before the dynamic cache module loaded.
  const alreadyLoaded = client.cached([{ since: 0, limit: 1000 }]).filter((event) => !isFromCache(event));
  if (alreadyLoaded.length) void write(alreadyLoaded);

  // Restore a bounded recent window. Reverify each record: a database entry is not
  // proof that its signature passed validation in this or a previous session.
  try {
    const cached = await cache.query({ since: 0, limit: 2000 });
    const restored = [];
    for (const raw of cached) {
      try {
        const event = verifiedEvent(raw);
        restored.push(event);
      } catch {
        void cache.deleteEvent(raw.id).catch(() => {});
      }
    }
    client.seed(restored, true);
  } catch {
    console.warn('Public event cache read failed; relay reads remain available.');
  }
}
