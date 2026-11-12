import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import {
  WalletProvider,
  useWallet,
} from '../../../../apps/web/src/components/wallet/wallet-provider';
import { WalletAccess } from '../../../../apps/web/src/components/wallet/wallet-access';
import { ZapButton } from '../../../../apps/web/src/components/zap-button.tsx';
import { zapPayments } from '../../../../apps/web/src/lib/zap-payments';
import { eventScope } from '../../../../packages/protocol/src/social';
import { state, update, target, alice, bob, invoiceRequest } from './environment';
import type { ZapInvoice } from '../../../../packages/client/src/zaps';
const scope = eventScope(target);
function App() {
  const wallet = useWallet();
  const [view, setView] = useState(true),
    [seeded, setSeeded] = useState(false);
  Object.assign(window, {
    walletFixture: {
      state,
      update,
      alice,
      bob,
      open: wallet.open,
      invoice(invoice: ZapInvoice) {
        zapPayments.remember({
          target,
          invoice: { ...invoice, request: invoiceRequest(invoice.msats) },
          relays: ['wss://relay.example'],
          endpoint: {
            pubkey: target.pubkey,
            nostrPubkey: target.pubkey,
            lnurl: 'fixture',
            callback: 'https://wallet.example/callback',
            minSendable: 1000,
            maxSendable: 1000000,
            commentAllowed: 0,
          },
        });
        setSeeded(true);
      },
      spend: () =>
        wallet.run(async () => {
          await new Promise<void>((done) => {
            state.finishSpend = done;
          });
          return 'finished';
        }),
    },
  });
  return (
    <>
      <output data-wallet-state>
        {JSON.stringify({
          enabled: wallet.enabled,
          opened: wallet.opened,
          busy: wallet.busy,
          runtime: wallet.runtime?.pubkey,
          balance: wallet.balance,
          error: wallet.error,
        })}
      </output>
      <button onClick={() => setView(!view)}>Navigate</button>
      <button onClick={() => update({ pubkey: state.pubkey === alice ? bob : alice })}>
        Switch account
      </button>
      <button onClick={() => update({ pubkey: null })}>Sign out</button>
      {view ? <WalletAccess /> : <p>Another page</p>}
      <ZapButton
        key={String(seeded)}
        data={{ manifest: target, scope, relays: [] }}
        reference="fixture"
      />
    </>
  );
}
createRoot(document.getElementById('app')!).render(
  <WalletProvider>
    <App />
  </WalletProvider>,
);
