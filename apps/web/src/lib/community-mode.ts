import type { SignedEvent } from '../../../../packages/protocol/src';
import { network } from './network';

type State = {
  account: string | null;
  enabled: boolean;
  ready: boolean;
  source: 'cache' | 'remote' | 'relay' | 'empty' | null;
  savedAt: number | null;
  lookupVersion: number;
};
const KEY = 'napplet:community-mode:';
const CACHE_LIMIT = 8192;
let state: State = {
  account: null,
  enabled: false,
  ready: false,
  source: null,
  savedAt: null,
  lookupVersion: 0,
};
const SERVER_SNAPSHOT: State = state;
let worker: Worker | undefined;
let visibilityController: AbortController | undefined;
let epoch = 0;
let revision = 0;
const lookupCache = new Map<string, boolean>();
const queuedLookups = new Set<string>();
const pendingLookups = new Set<string>();
let lookupScheduled = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
function flushLookups() {
  lookupScheduled = false;
  if (!worker || !state.enabled || !state.ready || !queuedLookups.size) return;
  const pubkeys = [...queuedLookups].slice(0, 256);
  for (const pubkey of pubkeys) queuedLookups.delete(pubkey);
  worker.postMessage({ type: 'lookup', pubkeys });
  if (queuedLookups.size) queueMicrotask(flushLookups);
}
function requestLookup(pubkey: string) {
  if (pendingLookups.has(pubkey)) return;
  pendingLookups.add(pubkey);
  queuedLookups.add(pubkey);
  if (!lookupScheduled) {
    lookupScheduled = true;
    queueMicrotask(flushLookups);
  }
}

export const communityMode = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot() {
    return state;
  },
  getServerSnapshot(): State {
    return SERVER_SNAPSHOT;
  },
  allows(pubkey: string) {
    if (!state.enabled || pubkey === state.account) return true;
    if (!state.ready) return false;
    const cached = lookupCache.get(pubkey);
    if (cached !== undefined) {
      lookupCache.delete(pubkey);
      lookupCache.set(pubkey, cached);
      return cached;
    }
    requestLookup(pubkey);
    return false;
  },
  configure(account: string | null) {
    const enabled = !!account && localStorage.getItem(KEY + account) === '1';
    if (account === state.account && enabled === state.enabled) {
      if (!enabled) delete document.documentElement.dataset.communityPending;
      return;
    }
    epoch++;
    visibilityController?.abort();
    visibilityController = undefined;
    worker?.terminate();
    worker = undefined;
    revision = 0;
    lookupCache.clear();
    queuedLookups.clear();
    pendingLookups.clear();
    state = { account, enabled, ready: false, source: null, savedAt: null, lookupVersion: 0 };
    emit();
    if (!enabled || !account) {
      delete document.documentElement.dataset.communityPending;
      return;
    }
    document.documentElement.dataset.communityPending = 'true';
    const activeEpoch = epoch;
    worker = new Worker(new URL('./community-graph.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      message: MessageEvent<{
        type: string;
        account: string;
        source: State['source'];
        savedAt: number;
        revision: number;
        pubkeys?: string[];
        allowed?: boolean[];
        firstLayerCount: number;
        secondLayerCount: number;
      }>,
    ) => {
      const update = message.data;
      if (activeEpoch !== epoch || update.account !== state.account) return;
      if (update.type === 'lookup') {
        if (update.revision !== revision) return;
        let changed = false;
        update.pubkeys?.forEach((pubkey, index) => {
          pendingLookups.delete(pubkey);
          const allowed = update.allowed?.[index] === true;
          lookupCache.delete(pubkey);
          lookupCache.set(pubkey, allowed);
          if (lookupCache.size > CACHE_LIMIT) lookupCache.delete(lookupCache.keys().next().value!);
          changed ||= allowed;
        });
        if (changed) {
          state = { ...state, lookupVersion: state.lookupVersion + 1 };
          emit();
        }
        return;
      }
      if (update.type !== 'ready') return;
      revision = update.revision;
      lookupCache.clear();
      pendingLookups.clear();
      for (const pubkey of queuedLookups) pendingLookups.add(pubkey);
      console.info('[Community Mode] Social graph updated', {
        source: update.source,
        firstLayerKeys: update.firstLayerCount,
        secondLayerKeys: update.secondLayerCount,
      });
      state = {
        ...state,
        ready: true,
        source: update.source,
        savedAt: update.savedAt,
      };
      emit();
      requestAnimationFrame(() => {
        if (activeEpoch === epoch) delete document.documentElement.dataset.communityPending;
      });
    };
    worker.onerror = () => {
      if (activeEpoch !== epoch) return;
      state = { ...state, ready: true, source: 'empty', savedAt: Date.now() };
      emit();
      requestAnimationFrame(() => {
        if (activeEpoch === epoch) delete document.documentElement.dataset.communityPending;
      });
    };
    worker.postMessage({
      type: 'start',
      account,
      relays: network().relays,
      visible: document.visibilityState !== 'hidden',
    });
    const activeWorker = worker;
    const visibility = () =>
      activeWorker.postMessage({
        type: 'visibility',
        visible: document.visibilityState !== 'hidden',
      });
    visibilityController = new AbortController();
    document.addEventListener('visibilitychange', visibility, {
      signal: visibilityController.signal,
    });
  },
  setEnabled(enabled: boolean) {
    if (!state.account) return;
    if (enabled) localStorage.setItem(KEY + state.account, '1');
    else localStorage.removeItem(KEY + state.account);
    if (enabled) localStorage.setItem('napplet:community-active', '1');
    else localStorage.removeItem('napplet:community-active');
    const account = state.account;
    state = { ...state, account: null };
    this.configure(account);
  },
  observeFollowEvent(event: SignedEvent) {
    if (state.enabled && event.kind === 3 && event.pubkey === state.account)
      worker?.postMessage({ type: 'events', events: [event] });
  },
};
