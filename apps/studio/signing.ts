import type { EventTemplate } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import type { Account, Accounts } from '../../packages/identity/src/accounts';
import type { CreatorSigner } from '../../packages/identity/src/signer';
import { checkPubkey } from '../../packages/identity/src/signer';
import { DiagnosticError } from '../../packages/diagnostics/src';
import { studioSigningKinds } from '../../packages/identity/src/studio-channel';

type Request = { id: string; template: EventTemplate; pubkey: string };
type Pending = {
  request: Request;
  resolve: (event: SignedEvent) => void;
  reject: (error: Error) => void;
};
const fail = (message: string) =>
  new DiagnosticError('STUDIO_SIGNER', message, {
    recovery:
      'Connect the same publishing account and resume. Never paste a private key into chat.',
  });

/** An ephemeral, tab-owned bridge. Only the publisher can enqueue event templates. */
export class BrowserSigning {
  private sessions = new Map<
    string,
    { pubkey: string; requests: Map<string, Pending>; active: boolean }
  >();
  connect(pubkey: string) {
    if (!/^[a-f0-9]{64}$/.test(pubkey)) throw fail('The signer returned an invalid public key.');
    checkPubkey(pubkey, 'public');
    if (this.sessions.size >= 16) {
      for (const [id, session] of this.sessions) if (!session.active) this.sessions.delete(id);
      if (this.sessions.size >= 16)
        throw fail('Too many active signing sessions. Stop a publication first.');
    }
    const id = crypto.randomUUID();
    this.sessions.set(id, { pubkey, requests: new Map(), active: false });
    return { id, pubkey };
  }
  private session(id: string) {
    const session = this.sessions.get(id);
    if (!session) throw fail('The signing connection expired. Connect your shell account again.');
    return session;
  }
  pubkey(id: string) {
    return this.session(id).pubkey;
  }
  next(id: string) {
    return this.session(id).requests.values().next().value?.request ?? null;
  }
  reply(id: string, requestId: string, signed?: unknown) {
    const session = this.session(id);
    const pending = session.requests.get(requestId);
    if (!pending) throw fail('This signing request is no longer active.');
    session.requests.delete(requestId);
    if (!signed) {
      pending.reject(fail('Signing was declined or the account disconnected.'));
      return;
    }
    try {
      const event = verifiedEvent(signed);
      const template = pending.request.template;
      if (
        event.pubkey !== session.pubkey ||
        event.kind !== template.kind ||
        event.content !== template.content ||
        event.created_at !== template.created_at ||
        JSON.stringify(event.tags) !== JSON.stringify(template.tags)
      )
        throw fail('The signature does not match the requested publication or account.');
      pending.resolve(event);
    } catch {
      const error = fail('The signer returned a different event, account or invalid signature.');
      pending.reject(error);
      throw error;
    }
  }
  accounts(id: string, signal: AbortSignal): Pick<Accounts, 'current' | 'signer'> {
    const session = this.session(id);
    const account: Account = { id, pubkey: session.pubkey, type: 'remote', status: 'ready' };
    const signer: CreatorSigner = {
      getPublicKey: async () => session.pubkey,
      signEvent: async (template) => {
        signal.throwIfAborted();
        if (!studioSigningKinds.includes(template.kind))
          throw fail('This event kind is outside studio publication.');
        session.active = true;
        const request = {
          id: crypto.randomUUID(),
          template: structuredClone(template),
          pubkey: session.pubkey,
        };
        return new Promise<SignedEvent>((resolve, reject) => {
          const finish = () => {
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            session.requests.delete(request.id);
          };
          const abort = () => {
            finish();
            reject(fail('Signing was cancelled.'));
          };
          const timer = setTimeout(() => {
            finish();
            reject(fail('The signer did not respond within two minutes.'));
          }, 120000);
          session.requests.set(request.id, {
            request,
            resolve: (event) => {
              finish();
              resolve(event);
            },
            reject: (error) => {
              finish();
              reject(error);
            },
          });
          signal.addEventListener('abort', abort, { once: true });
        });
      },
      close: async () => {
        this.end(id);
      },
    };
    return { current: async () => account, signer: async () => signer };
  }
  end(id: string) {
    const session = this.sessions.get(id);
    if (!session) return;
    for (const pending of [...session.requests.values()])
      pending.reject(fail('The signing session ended.'));
    session.requests.clear();
    session.active = false;
  }
  close() {
    for (const id of this.sessions.keys()) this.end(id);
    this.sessions.clear();
  }
}
