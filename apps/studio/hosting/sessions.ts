import { z } from 'zod';
import { verifiedEvent, sha256 } from '../../../packages/protocol/src';
import { DiagnosticError } from '../../../packages/diagnostics/src';

const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const sessionInput = z.object({ client: hex, nonce: z.uuid() }).strict();
const denied = () =>
  new DiagnosticError('STUDIO_AUTH', 'Reconnect Studio using the selected shell account.');
export type HostedSession = { owner: string; client: string; token: string; expires: number };

/** A NIP-98 signed POST authorizes a tab's ephemeral CVM key, never publication.
 * Signing remains a separate exact-event request to the selected shell account. */
export class StudioSessions {
  private clients = new Map<string, HostedSession>();
  private tokens = new Map<string, HostedSession>();
  private consumed = new Map<string, number>();
  constructor(
    readonly origin: string,
    private admitted: (owner: string) => boolean,
    private now = Date.now,
    private onOwnerDisconnected?: (owner: string) => void,
  ) {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== 'https:')
      throw new Error('Use the canonical HTTPS shell origin.');
  }
  private prune() {
    for (const [id, expires] of this.consumed) if (expires < this.now()) this.consumed.delete(id);
    for (const [client, session] of this.clients)
      if (session.expires <= this.now()) this.revoke(client);
  }
  async authorize(authorization: string, body: string) {
    this.prune();
    if (
      authorization.length > 12000 ||
      !/^Nostr [A-Za-z0-9+/]+=*$/.test(authorization) ||
      body.length > 1024
    )
      throw denied();
    let event;
    try {
      event = verifiedEvent(
        JSON.parse(Buffer.from(authorization.slice(6), 'base64').toString('utf8')),
      );
    } catch {
      throw denied();
    }
    const tag = (name: string) => {
      const tags = event.tags.filter((t) => t[0] === name);
      return tags.length === 1 && tags[0].length === 2 ? tags[0][1] : undefined;
    };
    const now = Math.floor(this.now() / 1000);
    if (
      event.kind !== 27235 ||
      event.content ||
      event.created_at < now - 60 ||
      event.created_at > now + 30 ||
      tag('u') !== this.origin + '/api/studio/session' ||
      tag('method') !== 'POST' ||
      tag('payload') !== (await sha256(body)) ||
      !this.admitted(event.pubkey) ||
      this.consumed.has(event.id)
    )
      throw denied();
    const input = sessionInput.parse(JSON.parse(body));
    // Rebinding an ephemeral key would make outstanding control calls ambiguous.
    if (this.clients.has(input.client)) throw denied();
    if (
      this.clients.size >= 256 ||
      this.consumed.size >= 2048 ||
      [...this.clients.values()].filter((s) => s.owner === event.pubkey).length >= 8
    )
      throw new DiagnosticError(
        'STUDIO_CAPACITY',
        'Too many Studio sessions. Close an existing session or try later.',
      );
    const session = {
      owner: event.pubkey,
      client: input.client,
      token: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'),
      expires: this.now() + 8 * 60 * 60 * 1000,
    };
    this.clients.set(input.client, session);
    this.tokens.set(session.token, session);
    this.consumed.set(event.id, this.now() + 120000);
    return { ...session };
  }
  client(pubkey: string) {
    this.prune();
    const session = this.clients.get(pubkey);
    if (!session || !this.admitted(session.owner)) throw denied();
    return { ...session };
  }
  bearer(token: string) {
    this.prune();
    const session = this.tokens.get(token);
    if (!session || !this.admitted(session.owner)) throw denied();
    return { ...session };
  }
  sweep() {
    this.prune();
  }
  revoke(client: string) {
    const session = this.clients.get(client);
    if (session) this.tokens.delete(session.token);
    this.clients.delete(client);
    if (session && ![...this.clients.values()].some((s) => s.owner === session.owner))
      this.onOwnerDisconnected?.(session.owner);
  }
}
