import { lazy, Suspense, useId } from 'react';
import { useWallet } from './wallet-provider';
import { useNostr } from '../nostr-provider';
import { Button } from '../ui/button';

const Panel = lazy(() => import('./wallet-panel').then((m) => ({ default: m.WalletPanel })));

export function WalletSwitch() {
  const wallet = useWallet();
  const { pubkey } = useNostr();
  const description = useId();
  return (
    <div className="wallet-preference">
      <label className="wallet-switch">
        <span>NIP-60 wallet</span>
        <input
          type="checkbox"
          role="switch"
          checked={wallet.enabled}
          disabled={!pubkey}
          aria-describedby={description}
          onChange={(event) => wallet.setEnabled(event.target.checked)}
        />
      </label>
      <small id={description} className="muted">
        {!pubkey
          ? 'Sign in to enable your wallet.'
          : wallet.enabled
            ? 'Enabled for this account on this browser. Switch off to stop wallet loading and sync.'
            : 'Off. Enable to load your Cashu wallet. Your signer may ask to decrypt it.'}
      </small>
    </div>
  );
}

/** Keep QR, mint and private-wallet modules unloaded until explicit opt-in. */
export function WalletAccess({ full = false }: { full?: boolean }) {
  const wallet = useWallet();
  const { pubkey, connect } = useNostr();
  return (
    <div className={full ? 'wallet-full' : undefined}>
      <WalletSwitch />
      {wallet.enabled ? (
        <Suspense fallback={<p role="status">Opening wallet tools…</p>}>
          <Panel full={full} />
        </Suspense>
      ) : (
        <div className="wallet-disabled">
          <p>
            External Lightning wallets still work. Switching off keeps your funds and saved recovery
            data.
          </p>
          {!pubkey && <Button onClick={() => void connect()}>Sign in</Button>}
        </div>
      )}
    </div>
  );
}
