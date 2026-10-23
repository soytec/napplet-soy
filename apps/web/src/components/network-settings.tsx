import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { network, saveNetwork } from '@/lib/network';
import { Button } from '@/components/ui/button';
import { MultiplayerSettings } from '../../../../packages/runtime/src/multiplayer-settings';
export function NetworkSettings() {
  const [relays, setRelays] = useState(''),
    [blossom, setBlossom] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const n = network();
    setRelays(n.relays.join('\n'));
    setBlossom(n.blossom.join('\n'));
  }, []);
  const lines = (s: string) =>
    s
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  return (
    <section className="manage-network" aria-label="Relay settings">
      <h2>Your relays & storage</h2>
      <p>
        This browser reads and publishes Nostr events directly to these relays. Files load from
        their published Blossom locations; your servers are fallbacks. These settings stay on this
        device.
      </p>
      <form
        className="community-form"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            saveNetwork({ relays: lines(relays), blossom: lines(blossom) });
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          Nostr relays · one URL per line
          <textarea
            aria-label="Nostr relays"
            rows={5}
            value={relays}
            onChange={(e) => setRelays(e.target.value)}
            spellCheck={false}
          />
        </label>
        <p>
          Shared creations inside napplets use the first relay by default. Choose one that lets
          other players read public application data; some relays keep it private to its author.
        </p>
        <label>
          Blossom servers · one URL per line
          <textarea
            aria-label="Blossom servers"
            rows={4}
            value={blossom}
            onChange={(e) => setBlossom(e.target.value)}
            spellCheck={false}
          />
        </label>
        <p>
          Use WSS and HTTPS on the live web. Storage and Lightning providers must allow browser
          requests (CORS). Site names, featured selections and moderation belong to napplet.soy.
        </p>
        <div className="social-actions">
          <Button type="submit">Save and reload</Button>
          <Button type="button" variant="outline" onClick={() => saveNetwork(null)}>
            Use site defaults
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </form>
      <aside className="manage-wallet-note">
        <h3>Wallet relays</h3>
        <p>
          Wallet reads and writes use their own public WSS relays, including during local
          development. Changing the website relays above does not move an existing wallet.
        </p>
        <Link to="/manage" hash="wallet">
          Manage wallet relays in Wallet settings ↗
        </Link>
      </aside>
      <MultiplayerSettings />
    </section>
  );
}
