import type { SignedEvent } from '../../../../packages/protocol/src';
import { protocolClient } from './network';

type State = {
  account: string | null;
  enabled: boolean;
  ready: boolean;
  source: 'cache' | 'remote' | 'relay' | 'empty' | null;
  savedAt: number | null;
  allowed: ReadonlySet<string>;
};
const KEY = 'napplet:community-mode:';
const EMPTY = new Set<string>();
let state: State = {
  account: null,
  enabled: false,
  ready: false,
  source: null,
  savedAt: null,
  allowed: EMPTY,
};
const SERVER_SNAPSHOT: State = state;
let worker: Worker | undefined;
let friends: string[] = [];
let cursor = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let refreshRunning = false;
let refreshController: AbortController | undefined;
let epoch = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

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
    return (
      !state.enabled || (state.ready && (pubkey === state.account || state.allowed.has(pubkey)))
    );
  },
  configure(account: string | null) {
    const enabled = !!account && localStorage.getItem(KEY + account) === '1';
    if (account === state.account && enabled === state.enabled) {
      if (!enabled) delete document.documentElement.dataset.communityPending;
      return;
    }
    epoch++;
    clearTimeout(timer);
    timer = undefined;
    refreshController?.abort();
    refreshController = undefined;
    refreshRunning = false;
    worker?.terminate();
    worker = undefined;
    friends = [];
    cursor = 0;
    state = { account, enabled, ready: false, source: null, savedAt: null, allowed: EMPTY };
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
        allowed: string[];
        friends: string[];
      }>,
    ) => {
      const update = message.data;
      if (activeEpoch !== epoch || update.account !== state.account || update.type !== 'ready')
        return;
      friends = update.friends;
      state = {
        ...state,
        ready: true,
        source: update.source,
        savedAt: update.savedAt,
        allowed: new Set(update.allowed),
      };
      emit();
      requestAnimationFrame(() => {
        if (activeEpoch === epoch) delete document.documentElement.dataset.communityPending;
      });
      if (!timer && !refreshRunning)
        timer = setTimeout(refresh, update.source === 'remote' ? 60_000 : 0);
    };
    worker.onerror = () => {
      if (activeEpoch !== epoch) return;
      state = { ...state, ready: true, source: 'empty', savedAt: Date.now(), allowed: EMPTY };
      emit();
      requestAnimationFrame(() => {
        if (activeEpoch === epoch) delete document.documentElement.dataset.communityPending;
      });
    };
    worker.postMessage({ type: 'start', account });
    const cachedFollows = protocolClient().cached([{ kinds: [3], authors: [account] }]);
    if (cachedFollows.length) worker.postMessage({ type: 'events', events: cachedFollows });
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

async function refresh() {
  timer = undefined;
  if (refreshRunning || !state.enabled || !state.account) return;
  if (document.visibilityState === 'hidden') {
    timer = setTimeout(refresh, 60_000);
    return;
  }
  refreshRunning = true;
  const controller = new AbortController();
  refreshController = controller;
  const activeEpoch = epoch;
  try {
    // Update the root every cycle and rotate through friends in bounded batches.
    const group = friends.length ? friends.slice(cursor, cursor + 32) : [];
    cursor = friends.length ? (cursor + group.length) % friends.length : 0;
    const authors = [state.account, ...group];
    const events: SignedEvent[] = [];
    for (let offset = 0; offset < authors.length; offset += 32) {
      const chunk = authors.slice(offset, offset + 32);
      events.push(
        ...(await protocolClient().query(
          [{ kinds: [3], authors: chunk, limit: chunk.length * 2 }],
          [],
          controller.signal,
        )),
      );
      if (activeEpoch !== epoch) return;
    }
    worker?.postMessage({ type: 'events', events });
  } catch {
    // Retain the last usable graph and retry on the next cycle.
  } finally {
    if (refreshController === controller) {
      refreshRunning = false;
      refreshController = undefined;
      if (activeEpoch === epoch && state.enabled) timer = setTimeout(refresh, 120_000);
    }
  }
}
