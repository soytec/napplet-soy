import { useSyncExternalStore } from 'react';
import { finalizeEvent, getPublicKey } from 'nostr-tools';

// Disposable fixture accounts only. No remote signer, mint or relay is used.
const key = new Uint8Array(32).fill(7);
export const alice = getPublicKey(key),
  bob = 'b'.repeat(64);
export const state = {
  pubkey: alice as string | null,
  ready: true,
  needsReconnect: false,
  opens: 0,
  closes: 0,
  checks: 0,
  runtimeLoads: 0,
  delay: false,
  fail: false,
  opening: [] as (() => void)[],
  finishSpend: undefined as (() => void) | undefined,
  lightning: true,
};
const listeners = new Set<() => void>();
export function update(patch: Partial<typeof state>) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn());
}
export function useNostr() {
  const pubkey = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state.pubkey,
  );
  return {
    pubkey,
    ready: state.ready,
    needsReconnect: state.needsReconnect,
    connect: async () => update({ pubkey: alice }),
  };
}
export const browserIdentity = () => ({
  state: { pubkey: state.pubkey, reconnect: false },
  reconnect: async () => {},
});
export const nutzap = finalizeEvent(
  {
    kind: 10019,
    created_at: 1,
    content: '',
    tags: [
      ['pubkey', '02' + alice],
      ['mint', 'https://mint.example'],
      ['relay', 'wss://relay.example'],
    ],
  },
  key,
);
export const target = finalizeEvent({ kind: 1618, created_at: 1, content: '', tags: [] }, key);
export function useZapRecipient() {
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state.lightning,
  );
  return { lightning: state.lightning, nutzap, profile: undefined, relayList: undefined };
}
export const paymentClient = () => ({ query: async () => [] });
export const readSocial = async () => ({ events: [], manifests: new Map() });
export const network = () => ({ relays: ['wss://relay.example'], blossom: [] });
export const signForAccount = async (_key: string, template: any) => finalizeEvent(template, key);
export const signAnonymousZap = async (template: any) => finalizeEvent(template, key);

export function CreatorLink({ pubkey }: { pubkey: string }) {
  return <span>{pubkey.slice(0, 8)}</span>;
}

export function invoiceRequest(msats: number) {
  return finalizeEvent(
    {
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ['p', target.pubkey],
        ['e', target.id],
        ['amount', String(msats)],
        ['lnurl', 'fixture'],
        ['relays', 'wss://relay.example'],
      ],
    },
    key,
  );
}
