import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useNostr } from '@/components/nostr-provider';
import { browserIdentity } from '@/lib/browser-identity';
import {
  studioChannel,
  studioSignerOrigin,
  studioSignRequest,
} from '../../../../packages/identity/src/studio-channel';

export const Route = createFileRoute('/studio-connect')({ component: StudioConnect });
function StudioConnect() {
  const account = useNostr();
  const [peer, setPeer] = useState<{ origin: string; channel: string }>();
  const [approved, setApproved] = useState('');
  const [status, setStatus] = useState('');
  const signing = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    const origin = params.get('origin') ?? '',
      channel = params.get('channel') ?? '';
    if (
      window.opener &&
      studioSignerOrigin(origin, location.origin) &&
      /^[a-f0-9-]{36}$/.test(channel)
    )
      setPeer({ origin, channel });
    else setStatus('Open account connection from Studio to continue.');
  }, []);
  useEffect(() => {
    if (!peer || !approved) return;
    const opener = window.opener;
    const send = (data: object) =>
      opener?.postMessage({ protocol: studioChannel, channel: peer.channel, ...data }, peer.origin);
    if (account.pubkey !== approved) {
      send({ type: 'disconnected' });
      setApproved('');
      return;
    }
    let live = true;
    const handled = new Set<string>();
    const receive = async (event: MessageEvent) => {
      if (!live || event.origin !== peer.origin || event.source !== opener) return;
      const parsed = studioSignRequest.safeParse(event.data);
      if (
        !parsed.success ||
        parsed.data.channel !== peer.channel ||
        parsed.data.pubkey !== approved
      )
        return;
      const request = parsed.data;
      if (handled.has(request.id)) return;
      if (signing.current) {
        send({ type: 'signed', id: request.id });
        return;
      }
      if (handled.size >= 256) {
        send({ type: 'disconnected' });
        setApproved('');
        return;
      }
      handled.add(request.id);
      signing.current = true;
      setStatus('Waiting for your signer to approve the publication request…');
      try {
        const signed = await browserIdentity().sign(approved, request.template);
        if (live) {
          send({ type: 'signed', id: request.id, event: signed });
          setStatus('Signature sent to Studio. Keep this window open until publication finishes.');
        }
      } catch {
        if (live) {
          send({ type: 'signed', id: request.id });
          setStatus('Signing did not complete. Unlock your signer and retry in Studio.');
        }
      } finally {
        signing.current = false;
      }
    };
    window.addEventListener('message', receive);
    send({ type: 'connected', pubkey: approved });
    return () => {
      live = false;
      window.removeEventListener('message', receive);
      send({ type: 'disconnected' });
    };
  }, [peer, approved, account.pubkey]);
  return (
    <section className="create-page">
      <span className="eyebrow">YOUR ACCOUNT, YOUR CREATIONS</span>
      <h1>
        Connect Studio<span className="coral">.</span>
      </h1>
      <p className="create-intro">
        Use your existing napplet.soy account to publish from Studio. Your keys stay with this app
        or your remote signer.
      </p>
      {peer && (
        <>
          <p>
            Studio: <strong>{peer.origin}</strong>
          </p>
          <p className="public-key">Account: {account.pubkey ?? 'Choose an account first.'}</p>
          <button className="creation-choice-action" onClick={() => void account.connect()}>
            Choose or change account
          </button>
          {!approved && (
            <>
              <p>
                Allow this Studio window to request signatures for napplet releases, Git source,
                proposals and Blossom uploads with the selected account. Review your release in
                Studio before publishing. Closing this window disconnects it.
              </p>
              <button
                className="creation-choice-action"
                disabled={!account.pubkey || account.needsReconnect}
                onClick={() => {
                  setApproved(account.pubkey!);
                  setStatus('Connected. Return to Studio and keep this account window open.');
                }}
              >
                Connect this account
              </button>
            </>
          )}
          {approved && (
            <button className="creation-choice-action" onClick={() => setApproved('')}>
              Disconnect Studio
            </button>
          )}
        </>
      )}
      <p role="status">{status}</p>
    </section>
  );
}
