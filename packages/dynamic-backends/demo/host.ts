import shim from '@napplet/shim/prelude.global?raw';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { generateSecretKey } from 'nostr-tools';
import { loadArtifact, PLAYER_ALLOW, PLAYER_SANDBOX } from '../../runtime/src';
import { attachNappletHost, type HostPrompt } from '../../runtime/src/host';
import { nappletPrelude } from '../../runtime/src/prelude';
import type { PreviewRevision } from '../../../apps/cli/src/preview/server';
let prompt: HostPrompt | null = null;
const dialog = document.querySelector<HTMLDialogElement>('#consent')!;
const controller = new AbortController();
async function start() {
  if (!['127.0.0.1', 'localhost'].includes(location.hostname))
    throw new Error('Demo identities are only available on loopback.');
  // An explicitly labelled throwaway viewer, never the creator or a real account.
  // Session storage keeps refresh working; closing the tab discards ownership.
  let key = sessionStorage.getItem('minicraft.demo-player');
  if (!key) {
    key = BufferlessHex(generateSecretKey());
    sessionStorage.setItem('minicraft.demo-player', key);
  }
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error('Invalid temporary demo identity. Open a fresh tab.');
  const signer = new PrivateKeySigner(
    Uint8Array.from(key.match(/../g)!, (byte) => parseInt(byte, 16)),
  );
  const pubkey = await signer.getPublicKey();
  document.querySelector('#identity')!.textContent =
    'Temporary demo player · ' + pubkey.slice(0, 8);
  const response = await fetch('/revision', { cache: 'no-store' });
  if (!response.ok) throw new Error('Cannot load the local preview configuration.');
  const info = (await response.json()) as PreviewRevision;
  const documentHtml = await loadArtifact(
    info.artifactHash,
    controller.signal,
    () => nappletPrelude(shim),
    { localUrl: '/artifacts/' + info.artifactHash },
  );
  const frame = document.createElement('iframe');
  frame.title = 'MiniCraft';
  frame.sandbox.value = PLAYER_SANDBOX;
  frame.allow = PLAYER_ALLOW;
  frame.referrerPolicy = 'no-referrer';
  frame.srcdoc = documentHtml;
  document.querySelector('#stage')!.replaceChildren(frame);
  const host = attachNappletHost({
    frame,
    identity: info.hostIdentity,
    backendIdentity: info.backendIdentity,
    manifestId: info.id,
    title: 'MiniCraft local demo',
    relays: info.relays,
    backend: info.backend,
    servers: [],
    pubkey,
    sign: async (expected, template) => {
      if (expected !== pubkey) throw new Error('Demo identity changed.');
      return signer.signEvent(template);
    },
    prompt: (value) => {
      prompt = value;
      frame.inert = !!value;
      if (!value) {
        dialog.close();
        return;
      }
      document.querySelector('#detail')!.textContent = value.value;
      dialog.showModal();
    },
    files: () => {},
  });
  document.querySelector<HTMLButtonElement>('#allow')!.onclick = () => prompt?.answer(true);
  document.querySelector<HTMLButtonElement>('#cancel')!.onclick = () => prompt?.answer(false);
  dialog.oncancel = (event) => {
    event.preventDefault();
    prompt?.dismiss();
  };
  window.addEventListener('pagehide', () => {
    controller.abort();
    host.close();
  });
}
function BufferlessHex(bytes: Uint8Array) {
  return Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
}
void start().catch((error) => {
  const panel = document.querySelector<HTMLElement>('#host-error')!;
  panel.hidden = false;
  panel.textContent = error.message;
});
