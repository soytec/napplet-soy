import type { SignedEvent } from '../../../../packages/protocol/src';
import { legacySnapshotAddress } from '../../../../packages/protocol/src/manifest';
import { ProtocolClient } from '../../../../packages/client/src/nostr';
import { readRelayUrl } from '../../../../packages/nostr/src/relay-policy';
import { resourceUrl } from '../../../../packages/client/src/bytes';
import defaults from '../../../../packages/nostr/discovery-relays.json';
import type { BackendProvider } from '../../../../packages/multiplayer/src/client';
export type ClientPolicy = {
  backend?: BackendProvider;
  relays: string[];
  blossom: string[];
  rules: { type: string; target: string }[];
  featured: { type: string; target: string }[];
};
let policy: ClientPolicy = {
  relays: ['wss://relay.napplet.soy', ...defaults],
  blossom: ['https://blossom.napplet.soy'],
  rules: [],
  featured: [],
};
export function configureClient(value: ClientPolicy) {
  policy = value;
}
export function network() {
  try {
    const saved = JSON.parse(localStorage.getItem('napplet:network') ?? 'null');
    if (saved) return validateNetwork(saved);
  } catch {}
  return { relays: policy.relays, blossom: policy.blossom };
}
export function validateNetwork(value: { relays: string[]; blossom: string[] }) {
  if (
    !Array.isArray(value.relays) ||
    !value.relays.length ||
    value.relays.length > 8 ||
    !Array.isArray(value.blossom) ||
    value.blossom.length > 8
  )
    throw new Error('Choose 1–8 relays and up to 8 Blossom servers.');
  return {
    relays: [...new Set(value.relays.map((r) => readRelayUrl(r, value.relays, true)))],
    blossom: [
      ...new Set(value.blossom.map((b) => resourceUrl(b, value.blossom).href.replace(/\/$/, ''))),
    ],
  };
}
export function saveNetwork(value: { relays: string[]; blossom: string[] } | null) {
  if (value) localStorage.setItem('napplet:network', JSON.stringify(validateNetwork(value)));
  else localStorage.removeItem('napplet:network');
  location.reload();
}
export function blocked(type: string, target: string) {
  return policy.rules.some((r) => r.type === type && r.target === target);
}
export function manifestAllowed(e: SignedEvent) {
  const address = `${e.kind}:${e.pubkey}:${e.kind === 15129 ? '' : (e.tags.find((t) => t[0] === 'd')?.[1] ?? '')}`;
  const snapshotAddress = legacySnapshotAddress(e);
  return (
    !blocked('pubkey', e.pubkey) &&
    !blocked('event', e.id) &&
    !blocked('address', address) &&
    (!snapshotAddress || !blocked('address', snapshotAddress)) &&
    !e.tags.some(
      (t) => (t[0] === 'path' && blocked('hash', t[2])) || (t[0] === 'x' && blocked('hash', t[1])),
    )
  );
}
export const featuredRules = () => policy.featured;
export const backendProvider = () => policy.backend;
let instance: ProtocolClient | undefined;
let cacheReady: Promise<void> = Promise.resolve();
export const publicEventCacheReady = () =>
  Promise.race([cacheReady, new Promise<void>((resolve) => setTimeout(resolve, 400))]);
export const protocolClient = () => {
  if (!instance) {
    instance = new ProtocolClient(() => network().relays, manifestAllowed);
    if (typeof window !== 'undefined')
      cacheReady = import('./event-cache')
        .then(({ startBrowserEventCache }) => startBrowserEventCache(instance!))
        .catch(() => console.warn('Public event cache unavailable; using relay reads.'));
  }
  return instance;
};
