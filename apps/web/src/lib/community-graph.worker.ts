import { SocialGraph, type NostrEvent } from 'nostr-social-graph';
import { createSocialGraphLoader } from 'applesauce-loaders/loaders';
import { RelayPool } from 'applesauce-relay';
import { filter, Subscription, takeUntil, timer } from 'rxjs';
import { verifiedEvent } from '../../../../packages/protocol/src';
import defaultRelays from '../../../../packages/nostr/discovery-relays.json';
import { readRelayUrl } from '../../../../packages/nostr/src/relay-policy';
import { verifiedFollowEvent } from './community-follow-event';

type Request =
  | { type: 'start'; account: string; relays: string[]; visible: boolean }
  | { type: 'events'; events: NostrEvent[] }
  | { type: 'lookup'; pubkeys: string[] }
  | { type: 'visibility'; visible: boolean }
  | { type: 'stop' };
type Snapshot = { account: string; bytes: Uint8Array; savedAt: number };

const DATABASE = 'napplet-community-graph';
const REMOTE = 'https://graph-api.iris.to/social-graph';
const MAX_REMOTE_BYTES = 64 * 1024 * 1024;
const LOOKUP_RELAYS = [
  'wss://purplepag.es/',
  'wss://relay.ditto.pub/',
  'wss://indexer.coracle.social/',
];
let graph: SocialGraph | undefined;
let account = '';
let generation = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let remoteController: AbortController | undefined;
let recentEvents = new Map<string, NostrEvent>();
let rootSeen = false;
let pool: RelayPool | undefined;
let syncSubscription: Subscription | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let visible = true;
let refreshing = false;
let crawlDistance: 0 | 1 = 1;
let membership = new Set<string>();
let directFollows = new Set<string>();
let revision = 0;
let recalculateTimer: ReturnType<typeof setTimeout> | undefined;
let graphDirty = false;
let crawlAgain = false;
let remoteTried = false;
let rootHintTried = false;
let configuredRelays: string[] = [];
let activeRelays: string[] = [];

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('snapshots', { keyPath: 'account' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readSnapshot(key: string): Promise<Snapshot | undefined> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get(key);
      request.onsuccess = () => resolve(request.result as Snapshot | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
async function writeSnapshot(value: Snapshot): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      transaction.objectStore('snapshots').put(value);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
function publish(source: 'cache' | 'remote' | 'relay' | 'empty', savedAt = Date.now()) {
  if (!graph) return;
  const friends = [...graph.getUsersByFollowDistance(1)];
  const friendsOfFriends = [...graph.getUsersByFollowDistance(2)];
  const followsChanged =
    friends.length !== directFollows.size || friends.some((pubkey) => !directFollows.has(pubkey));
  directFollows = new Set(friends);
  membership = new Set([...friends, ...friendsOfFriends]);
  revision++;
  postMessage({
    type: 'ready',
    account,
    source,
    savedAt,
    revision,
    firstLayerCount: friends.length,
    secondLayerCount: friendsOfFriends.length,
  });
  if (followsChanged && visible) {
    if (refreshing) crawlAgain ||= crawlDistance === 0;
    else scheduleSync(0);
  }
}
function scheduleSave() {
  clearTimeout(saveTimer);
  const key = account;
  const current = generation;
  saveTimer = setTimeout(() => {
    if (!graph || key !== account || current !== generation) return;
    // Root and first-hop follow lists suffice to restore two-hop membership.
    void graph
      .toBinary(undefined, undefined, 1)
      .then((bytes) => {
        if (key === account && current === generation)
          return writeSnapshot({ account: key, bytes, savedAt: Date.now() });
      })
      .catch(() => {});
  }, 1500);
}
async function remoteGraph(root: string, signal: AbortSignal): Promise<SocialGraph> {
  const response = await fetch(REMOTE, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Graph server returned ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_REMOTE_BYTES)
    throw new Error('Graph server response exceeds the browser budget');
  if (!response.body) throw new Error('Graph server returned no body');
  let size = 0;
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > MAX_REMOTE_BYTES)
          throw new Error('Graph server response exceeds the browser budget');
        controller.enqueue(chunk);
      },
    }),
  );
  return SocialGraph.fromBinaryStream(root, stream);
}
async function tryRemoteFallback(current: number) {
  if (remoteTried || rootSeen || graph?.getFollowListCreatedAt(account)) return;
  remoteTried = true;
  const controller = new AbortController();
  remoteController = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const fresh = await remoteGraph(account, controller.signal);
    if (current !== generation || rootSeen || graph?.getFollowListCreatedAt(account)) return;
    graph = fresh;
    if (recentEvents.size) {
      graph.handleEvent([...recentEvents.values()], true);
      await graph.recalculateFollowDistances();
    }
    publish('remote');
    scheduleSave();
  } catch (error) {
    if (current === generation && !controller.signal.aborted)
      console.warn('[Community Mode] Backup graph download failed', error);
  } finally {
    clearTimeout(timeout);
    if (remoteController === controller) remoteController = undefined;
  }
}
function scheduleSync(delay: number) {
  clearTimeout(syncTimer);
  if (account && visible) syncTimer = setTimeout(() => startCrawl(delay === 0 ? 1 : 0), delay);
}
function acceptEvents(events: NostrEvent[], relayVerified = false) {
  const verified = events.flatMap((event) => {
    try {
      return event.kind === 3 ? [relayVerified ? event : verifiedFollowEvent(event)] : [];
    } catch {
      return [];
    }
  });
  if (!verified.length) return;
  for (const event of verified) {
    if (event.pubkey === account) {
      rootSeen = true;
      remoteController?.abort();
    }
    const previous = recentEvents.get(event.pubkey);
    if (
      !previous ||
      event.created_at > previous.created_at ||
      (event.created_at === previous.created_at && event.id > previous.id)
    )
      recentEvents.set(event.pubkey, event);
  }
  if (recentEvents.size > 2048) {
    for (const pubkey of recentEvents.keys())
      if (pubkey !== account) {
        recentEvents.delete(pubkey);
        break;
      }
  }
  if (graph?.handleEvent(verified, true)) {
    graphDirty = true;
    if (!recalculateTimer) recalculateTimer = setTimeout(() => void recalculate(), 300);
  }
}
async function recalculate() {
  recalculateTimer = undefined;
  if (!graph || !graphDirty) return;
  const activeGraph = graph;
  graphDirty = false;
  await activeGraph.recalculateFollowDistances();
  if (graph !== activeGraph) return;
  publish('relay');
  scheduleSave();
  if (graphDirty && !recalculateTimer) recalculateTimer = setTimeout(() => void recalculate(), 300);
}
function startCrawl(distance: 0 | 1) {
  syncTimer = undefined;
  if (!account || !pool || !visible || refreshing) return;
  refreshing = true;
  crawlDistance = distance;
  const current = generation;
  const graphPool = pool;
  const upstream = (relays: string[], filters: Parameters<RelayPool['request']>[1]) =>
    graphPool.request(relays.slice(0, 8), filters).pipe(
      takeUntil(timer(4500)),
      filter((event) => {
        try {
          verifiedFollowEvent(event);
          return true;
        } catch {
          return false;
        }
      }),
    );
  const loader = createSocialGraphLoader(upstream, {
    extraRelays: activeRelays,
    parallel: 128,
    hints: false,
  });
  syncSubscription = loader({ pubkey: account, relays: activeRelays, distance }).subscribe({
    next: (event) => {
      if (current === generation) acceptEvents([event], true);
    },
    error: (error) => {
      if (current === generation) console.warn('[Community Mode] Follow list sync failed', error);
      finish();
    },
    complete: finish,
  });
  function finish() {
    if (current !== generation) return;
    syncSubscription = undefined;
    refreshing = false;
    if (distance === 1 && !rootSeen) void findRootRelayHints(current);
    else if (distance === 1 && !graph?.getFollowListCreatedAt(account))
      void tryRemoteFallback(current);
    if (crawlAgain) {
      crawlAgain = false;
      scheduleSync(0);
    } else scheduleSync(120_000);
  }
}
async function findRootRelayHints(current: number) {
  if (!pool || rootSeen || graph?.getFollowListCreatedAt(account)) return;
  if (rootHintTried) {
    void tryRemoteFallback(current);
    return;
  }
  rootHintTried = true;
  let relayList: NostrEvent | undefined;
  await new Promise<void>((resolve) => {
    pool!
      .request(activeRelays, [{ kinds: [10002], authors: [account], limit: 2 }])
      .pipe(takeUntil(timer(4500)))
      .subscribe({
        next: (event) => {
          try {
            const valid = verifiedEvent(event);
            if (!relayList || valid.created_at > relayList.created_at) relayList = valid;
          } catch {}
        },
        error: () => resolve(),
        complete: () => resolve(),
      });
  });
  if (current !== generation || rootSeen) return;
  const hints =
    relayList?.tags
      .flatMap((tag) => {
        if (tag[0] !== 'r' || (tag[2] && tag[2] !== 'read')) return [];
        try {
          return [readRelayUrl(tag[1], configuredRelays, true)];
        } catch {
          return [];
        }
      })
      .slice(0, 4) ?? [];
  if (hints.length) {
    activeRelays = [...new Set([...hints, ...activeRelays])].slice(0, 8);
    scheduleSync(0);
  } else void tryRemoteFallback(current);
}
async function start(key: string, relays: string[], initiallyVisible: boolean) {
  const current = ++generation;
  account = key;
  graph = undefined;
  membership = new Set();
  directFollows = new Set();
  recentEvents = new Map();
  rootSeen = false;
  remoteTried = false;
  rootHintTried = false;
  configuredRelays = relays;
  activeRelays = [...new Set([...LOOKUP_RELAYS, ...relays.slice(0, 3), ...defaultRelays])].slice(
    0,
    8,
  );
  clearTimeout(recalculateTimer);
  graphDirty = false;
  syncSubscription?.unsubscribe();
  clearTimeout(syncTimer);
  pool?.close();
  pool = new RelayPool();
  visible = initiallyVisible;
  refreshing = false;
  crawlAgain = false;
  scheduleSync(0);
  clearTimeout(saveTimer);
  remoteController?.abort();
  {
    const cached = await readSnapshot(key).catch(() => undefined);
    if (current !== generation) return;
    if (cached?.bytes?.length) {
      try {
        graph = await SocialGraph.fromBinary(key, cached.bytes);
        if (current !== generation) return;
        if (recentEvents.size && graph.handleEvent([...recentEvents.values()], true))
          await graph.recalculateFollowDistances();
        publish('cache', cached.savedAt);
      } catch {
        graph = undefined;
      }
    }
    if (!graph) {
      graph = new SocialGraph(key);
      if (recentEvents.size && graph.handleEvent([...recentEvents.values()], true))
        await graph.recalculateFollowDistances();
      publish('empty');
    }
  }
}
self.onmessage = (message: MessageEvent<Request>) => {
  const request = message.data;
  if (request.type === 'stop') {
    generation++;
    account = '';
    graph = undefined;
    membership = new Set();
    directFollows = new Set();
    recentEvents = new Map();
    rootSeen = false;
    clearTimeout(recalculateTimer);
    remoteController?.abort();
    syncSubscription?.unsubscribe();
    clearTimeout(syncTimer);
    pool?.close();
    pool = undefined;
    clearTimeout(saveTimer);
  } else if (request.type === 'start') {
    void start(request.account, request.relays, request.visible);
  } else if (request.type === 'visibility') {
    visible = request.visible;
    if (visible) scheduleSync(0);
    else {
      clearTimeout(syncTimer);
      syncSubscription?.unsubscribe();
      syncSubscription = undefined;
      refreshing = false;
    }
  } else if (request.type === 'lookup') {
    postMessage({
      type: 'lookup',
      account,
      revision,
      pubkeys: request.pubkeys,
      allowed: request.pubkeys.map((pubkey) => pubkey === account || membership.has(pubkey)),
    });
  } else if (request.type === 'events' && account) {
    acceptEvents(request.events);
  }
};
