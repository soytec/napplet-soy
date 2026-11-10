import { useId, useSyncExternalStore } from 'react';
import { fipsEnabled, onFipsPolicyChange, setFipsEnabled } from './policy';

/** Shared by the website and soyLI's normal preview. */
export function FipsSettings() {
  const id = useId();
  const enabled = useSyncExternalStore(onFipsPolicyChange, fipsEnabled, () => true);
  return (
    <fieldset className="multiplayer-settings">
      <legend>Public FIPS resources · experimental</legend>
      <p>
        Read immutable content from peers without signing in. Each new set of roots and providers
        needs your approval. Peer and seed connections can reveal your IP address.
      </p>
      <label htmlFor={id}>Resource connections</label>
      <select
        id={id}
        value={enabled ? 'ask' : 'block'}
        onChange={(e) => setFipsEnabled(e.target.value === 'ask')}
      >
        <option value="ask">Ask before connecting</option>
        <option value="block">Block</option>
      </select>
      <p>
        Changing this setting closes active resource grants. Providers and seeds appear in the
        approval; publisher and map selection stay inside the napplet. Already delivered bytes
        cannot be recalled.
      </p>
    </fieldset>
  );
}
