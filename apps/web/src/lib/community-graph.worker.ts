import { SocialGraph, type NostrEvent } from 'nostr-social-graph';

type Request =
  { type: 'start'; account: string } | { type: 'events'; events: NostrEvent[] } | { type: 'stop' };
type Snapshot = { account: string; bytes: Uint8Array; savedAt: number };

const DATABASE = 'napplet-community-graph';
const REMOTE = 'https://graph-api.iris.to/social-graph';
const MAX_REMOTE_BYTES = 64 * 1024 * 1024;
let graph: SocialGraph | undefined;
let account = '';
let generation = 0;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let remoteController: AbortController | undefined;
let recentEvents = new Map<string, NostrEvent>();

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
  const allowed = [...graph.getUsersByFollowDistance(1), ...graph.getUsersByFollowDistance(2)];
  postMessage({
    type: 'ready',
    account,
    source,
    savedAt,
    allowed,
    friends: [...graph.getUsersByFollowDistance(1)],
  });
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
async function start(key: string) {
  const current = ++generation;
  account = key;
  graph = undefined;
  recentEvents = new Map();
  clearTimeout(saveTimer);
  remoteController?.abort();
  const controller = new AbortController();
  remoteController = controller;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
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
    try {
      const fresh = await remoteGraph(key, controller.signal);
      if (current !== generation) return;
      graph = fresh;
      if (recentEvents.size) {
        graph.handleEvent([...recentEvents.values()], true);
        await graph.recalculateFollowDistances();
      }
      publish('remote');
      scheduleSave();
    } catch {
      if (current !== generation) return;
      if (!graph) {
        graph = new SocialGraph(key);
        publish('empty');
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}
self.onmessage = (message: MessageEvent<Request>) => {
  const request = message.data;
  if (request.type === 'stop') {
    generation++;
    account = '';
    graph = undefined;
    recentEvents = new Map();
    remoteController?.abort();
    clearTimeout(saveTimer);
  } else if (request.type === 'start') {
    void start(request.account);
  } else if (request.type === 'events' && account) {
    for (const event of request.events) {
      const previous = recentEvents.get(event.pubkey);
      if (
        !previous ||
        event.created_at > previous.created_at ||
        (event.created_at === previous.created_at && event.id > previous.id)
      )
        recentEvents.set(event.pubkey, event);
    }
    if (recentEvents.size > 2048) recentEvents.delete(recentEvents.keys().next().value!);
    if (graph?.handleEvent(request.events, true)) {
      void graph.recalculateFollowDistances().then(() => {
        publish('relay');
        scheduleSave();
      });
    }
  }
};
