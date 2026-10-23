import { publicRelayUrl } from '../../nostr/src/relay-policy';
import defaults from '../../nostr/discovery-relays.json';

/** Wallet traffic is independent of the shell's local-only development network.
 * These are bootstrap destinations; an existing wallet keeps its chosen relays. */
export function walletBootstrapRelays(configured: string[] = [], hints: string[] = []) {
  const safe = (values: string[]) =>
    values.flatMap((value) => {
      try {
        return [publicRelayUrl(value, true)];
      } catch {
        return [];
      }
    });
  const chosen = safe(configured);
  return [...new Set([...chosen, ...safe(hints), ...(!chosen.length ? safe(defaults) : [])])];
}
