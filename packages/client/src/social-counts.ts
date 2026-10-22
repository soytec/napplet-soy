import type { CountMetric, CountTarget } from 'applesauce-loaders/loaders';
import type { SignedEvent } from '../../protocol/src';
import { socialScope } from '../../protocol/src/social';

/** Raw NIP-45 like total: kind-7 reactions bound to the napplet's address, or its pinned ID. */
export const likesMetric: CountMetric = {
  id: 'napplet-likes:v1',
  filters: (target) => [
    target.address ? { kinds: [7], '#a': [target.address] } : { kinds: [7], '#e': [target.id] },
  ],
};

/** Addressed napplets count across revisions; pinned snapshots count their own ID. */
export function countTarget(manifest: SignedEvent): CountTarget {
  const { address } = socialScope(manifest);
  return {
    id: manifest.id,
    kind: manifest.kind,
    created_at: manifest.created_at,
    ...(address ? { address } : {}),
  };
}

/**
 * Each COUNT answer comes from one relay, so mixing relays would show numbers from different
 * datasets side by side. Use the first configured relay that advertises NIP-45; relays that
 * do not support it often ignore COUNT instead of refusing it, which would stall each attempt.
 */
export async function firstCountRelay(
  relays: string[],
  supported: (relay: string) => Promise<number[] | null>,
  timeoutMs = 2500,
) {
  const checks = relays.map((relay) =>
    Promise.race([
      supported(relay).then(
        (nips) => !!nips?.includes(45),
        () => false,
      ),
      new Promise<boolean>((resolve) => setTimeout(resolve, timeoutMs, false)),
    ]),
  );
  // Checks run in parallel; resolve at the first supporting relay in configured order.
  for (const [i, check] of checks.entries()) if (await check) return relays[i];
  return undefined;
}
