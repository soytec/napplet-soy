import type { EventTemplate, NostrEvent } from 'nostr-tools';
import {
  studioChannel,
  studioTemplate,
  verifyStudioSignature,
} from '../../packages/identity/src/studio-channel';

/** Account material stays in the shell's vault/origin. Only templates and signatures cross. */
export function connectShellSigner(shellOrigin: string, host: Window = window) {
  const channel = crypto.randomUUID();
  const target = new URL('/studio-connect', shellOrigin);
  target.hash = new URLSearchParams({ origin: host.location.origin, channel }).toString();
  const popup = host.open(target.href, `soy-studio-${channel}`, 'popup,width=600,height=780');
  if (!popup)
    return Promise.reject(new Error('Allow the account window to open, then connect again.'));
  let pubkey = '',
    closed = false;
  const pending = new Map<
    string,
    { resolve: (e: NostrEvent) => void; reject: (e: Error) => void }
  >();
  let rejectConnection: (e: Error) => void = () => {};
  const disconnect = (message = 'The account window closed or disconnected. Connect again.') => {
    if (closed) return;
    closed = true;
    clearInterval(watch);
    clearTimeout(connectTimeout);
    host.removeEventListener('message', receive);
    for (const p of pending.values()) p.reject(new Error(message));
    pending.clear();
    rejectConnection(new Error(message));
    popup.close();
  };
  let connected: (value: {
    pubkey: string;
    signEvent: (t: EventTemplate) => Promise<NostrEvent>;
    close: () => void;
    alive: () => boolean;
  }) => void;
  const result = new Promise<{
    pubkey: string;
    signEvent: (t: EventTemplate) => Promise<NostrEvent>;
    close: () => void;
    alive: () => boolean;
  }>((resolve, reject) => {
    connected = resolve;
    rejectConnection = reject;
  });
  const signEvent = async (input: EventTemplate): Promise<NostrEvent> => {
    if (closed || popup.closed) throw new Error('Reconnect your shell account before publishing.');
    const template = studioTemplate.parse(input);
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The signer did not respond. Unlock it and retry.'));
      }, 120000);
      pending.set(id, {
        resolve: (event) => {
          clearTimeout(timeout);
          try {
            resolve(verifyStudioSignature(pubkey, template, event));
          } catch {
            reject(new Error('The signer returned a different event or account.'));
          }
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
      popup.postMessage(
        { protocol: studioChannel, channel, type: 'sign', id, pubkey, template },
        target.origin,
      );
    });
  };
  const receive = (event: MessageEvent) => {
    if (event.source !== popup || event.origin !== target.origin) return;
    const data = event.data;
    if (!data || data.protocol !== studioChannel || data.channel !== channel) return;
    if (
      data.type === 'connected' &&
      !pubkey &&
      typeof data.pubkey === 'string' &&
      /^[a-f0-9]{64}$/.test(data.pubkey)
    ) {
      pubkey = data.pubkey;
      clearTimeout(connectTimeout);
      connected({ pubkey, signEvent, close: disconnect, alive: () => !closed && !popup.closed });
    } else if (data.type === 'disconnected')
      disconnect('The selected shell account changed. Reconnect before continuing.');
    else if (data.type === 'signed' && typeof data.id === 'string') {
      const request = pending.get(data.id);
      if (!request) return;
      pending.delete(data.id);
      if (data.event) request.resolve(data.event);
      else request.reject(new Error('Signing was declined or the signer disconnected.'));
    }
  };
  host.addEventListener('message', receive);
  const watch = setInterval(() => {
    if (popup.closed) disconnect();
  }, 500);
  const connectTimeout = setTimeout(
    () => disconnect('Account connection timed out. Connect again when ready.'),
    240000,
  );
  return result;
}
