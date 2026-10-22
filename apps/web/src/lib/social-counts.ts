import { RelayPool } from 'applesauce-relay';
import { createCountService, type CountCache, type CountService } from 'applesauce-loaders/loaders';
import { BehaviorSubject } from 'rxjs';
import { firstCountRelay } from '../../../../packages/client/src/social-counts';
import { network } from './network';

const remembered = 'napplet:count-relay';

/** Answers survive reloads so returning visitors see counts before any relay answers. */
function browserCountCache(): CountCache | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('napplet-social-counts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('counts');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = <T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>) =>
    open().then(
      (database) =>
        new Promise<T>((resolve, reject) => {
          const request = use(database.transaction('counts', mode).objectStore('counts'));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        }),
    );
  return {
    async get(key) {
      const entry = await run<{ value: unknown; expires: number } | undefined>('readonly', (s) =>
        s.get(key),
      );
      return entry && (!entry.expires || entry.expires > Date.now()) ? entry.value : undefined;
    },
    set: (key, value, ttl) =>
      run('readwrite', (s) => s.put({ value, expires: ttl ? Date.now() + ttl : 0 }, key)),
  };
}

/** Start with the last NIP-45 relay this browser used, then confirm against current settings. */
function countRelays(pool: RelayPool) {
  const relays = network().relays;
  let last: string | null = null;
  try {
    last = localStorage.getItem(remembered);
  } catch {}
  const selected = new BehaviorSubject<string[]>(last && relays.includes(last) ? [last] : []);
  void firstCountRelay(relays, (url) => pool.relay(url).getSupported()).then((relay) => {
    if (relay !== selected.value[0]) selected.next(relay ? [relay] : []);
    try {
      if (relay) localStorage.setItem(remembered, relay);
      else localStorage.removeItem(remembered);
    } catch {}
  });
  return selected;
}

let service: CountService | undefined;
/** One browser-wide count service; cards and rankings share each metric's request. */
export function socialCounts() {
  if (typeof window === 'undefined') return undefined;
  if (!service) {
    const pool = new RelayPool();
    service = createCountService(pool, { relays: countRelays(pool), cache: browserCountCache() });
  }
  return service;
}
