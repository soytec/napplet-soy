import { PrivateKeySigner } from '@contextvm/sdk/signer';
import type { EventTemplate, NostrEvent } from 'nostr-tools';
import { CvmConnection, validateProvider } from '../../packages/multiplayer/src/client';
import { sha256 } from '../../packages/protocol/src/artifact';
import type { StudioClient } from './local-client';

type Account = {
  pubkey: string;
  currentPubkey: () => string | undefined;
  sign: (pubkey: string, template: EventTemplate) => Promise<NostrEvent>;
};
/** The shell signs one authorization. A tab-only ephemeral key handles encrypted
 * control calls; it never gains permission to sign publications for the account. */
export function hostedStudioClient(
  origin: string,
  account: Account,
): StudioClient & { close: () => Promise<void> } {
  if (new URL(origin).protocol !== 'https:') throw new Error('Hosted Studio requires HTTPS.');
  let session: { token: string; expires: number; cvm: CvmConnection } | undefined;
  let pending: Promise<void> | undefined;
  let closed = false;
  let connectionError: Error | undefined;
  const lifetime = new AbortController();
  const assertAccount = () => {
    if (closed || account.currentPubkey() !== account.pubkey)
      throw new Error('Studio account changed. Reconnect with the selected account.');
  };
  const connect = async () => {
    assertAccount();
    if (connectionError) throw connectionError;
    if (session && session.expires > Date.now()) return;
    if (session) throw new Error('Your Studio session expired. Reconnect before continuing.');
    await (pending ??= (async () => {
      const config = await fetch(origin + '/api/studio/config', {
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]),
        cache: 'no-store',
      });
      if (!config.ok) throw new Error('Hosted Studio is unavailable. Try again shortly.');
      const provider = validateProvider((await config.json()).provider);
      const signer = new PrivateKeySigner();
      const body = JSON.stringify({
        client: await signer.getPublicKey(),
        nonce: crypto.randomUUID(),
      });
      const url = origin + '/api/studio/session';
      const event = await account.sign(account.pubkey, {
        kind: 27235,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', url],
          ['method', 'POST'],
          ['payload', await sha256(body)],
        ],
      });
      assertAccount();
      const response = await fetch(url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Nostr ' + btoa(JSON.stringify(event)),
        },
        signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]),
      });
      const grant = await response.json();
      if (!response.ok) throw new Error(grant.error ?? 'Could not authorize Studio.');
      if (!/^[a-f0-9]{64}$/.test(grant.token) || !Number.isSafeInteger(grant.expires))
        throw new Error('Invalid Studio session.');
      if (closed || account.currentPubkey() !== account.pubkey) {
        await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + grant.token },
          signal: AbortSignal.timeout(5000),
          keepalive: true,
        }).catch(() => {});
        assertAccount();
      }
      session = { ...grant, cvm: new CvmConnection(provider, signer) };
    })()
      .catch((error) => {
        connectionError = error instanceof Error ? error : new Error('Could not connect Studio.');
        throw connectionError;
      })
      .finally(() => {
        pending = undefined;
      }));
  };
  const http = async (path: string, init: RequestInit = {}) => {
    await connect();
    assertAccount();
    const response = await fetch(origin + '/api/studio/' + path, {
      ...init,
      headers: { ...init.headers, Authorization: 'Bearer ' + session!.token },
      cache: 'no-store',
      signal: AbortSignal.any([lifetime.signal, init.signal ?? AbortSignal.timeout(30000)]),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error ?? 'Private Studio transfer failed.');
    }
    assertAccount();
    return response;
  };
  const put = async (bytes: Blob, signal?: AbortSignal) =>
    (
      await (
        await http('transfers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: bytes,
          signal,
        })
      ).json()
    ).id as string;
  const call = async (path: string, body?: unknown, upload?: string): Promise<Response> => {
    await connect();
    assertAccount();
    if (body !== undefined && new TextEncoder().encode(JSON.stringify(body)).length > 10000) {
      upload = await put(new Blob([JSON.stringify(body)]));
      body = undefined;
    }
    const result = await session!.cvm.request(
      'tools/call',
      {
        name: 'soy_studio_call',
        arguments: {
          requestId: crypto.randomUUID(),
          createdAt: Date.now(),
          path,
          ...(body !== undefined ? { body } : {}),
          ...(upload ? { upload } : {}),
        },
      },
      25000,
    );
    assertAccount();
    const text = (result.content as { type: string; text?: string }[])?.find(
      (c) => c.type === 'text',
    )?.text;
    if (!text) throw new Error('Studio returned an invalid response.');
    const reply = JSON.parse(text);
    if (result.isError) throw new Error(reply.message ?? 'Studio could not complete that action.');
    if (reply.transfer) {
      if (!/^[a-f0-9-]{36}$/.test(reply.transfer)) throw new Error('Invalid private transfer.');
      const response = await http('transfers/' + reply.transfer);
      const bytes = await response.arrayBuffer();
      // Consumption is explicit; retrying the CVM read can create a fresh transfer.
      await http('transfers/' + reply.transfer, { method: 'DELETE' });
      return new Response(bytes, {
        status: reply.status,
        headers: {
          'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
        },
      });
    }
    return Response.json(reply.value, { status: reply.status });
  };
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await call(path, body);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Studio could not complete that action.');
    return result;
  };
  return {
    mode: 'hosted',
    api,
    url: (path) => origin + '/api/studio/' + path,
    token: () => session?.token ?? '',
    media: async (path) => {
      const response = await call(path);
      if (!response.ok) throw new Error('Could not load this draft’s media.');
      return response.blob();
    },
    upload: async (path, metadata, file, progress, signal) => {
      progress(0);
      const upload = await put(file, signal);
      progress(90);
      const response = await call(path, metadata, upload);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? 'Asset import failed.');
      progress(100);
      return value;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      lifetime.abort();
      const active = session;
      session = undefined;
      if (active) {
        // Start keepalive revocation synchronously, before an unload can suspend
        // this page while the relay transport is closing.
        const revoke = fetch(origin + '/api/studio/session', {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + active.token },
          signal: AbortSignal.timeout(5000),
          keepalive: true,
        }).catch(() => {});
        await Promise.allSettled([revoke, active.cvm.close()]);
      }
    },
  };
}
