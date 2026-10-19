import { test, expect } from 'bun:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { sha256 } from '../../../packages/protocol/src';
import { StudioSessions } from './sessions';
import { StudioTransfers } from './transfers';
import { studioHttp } from './http';

test('hosted HTTP authenticates exact NIP-98 session bodies and keeps binary transfers owner-private', async () => {
  const origin = 'https://studio.example';
  const a = generateSecretKey(),
    b = generateSecretKey();
  const sessions = new StudioSessions(origin, () => true),
    transfers = new StudioTransfers();
  const handler = studioHttp({
    origin,
    sessions,
    transfers,
    provider: { pubkey: 'a'.repeat(64), relays: ['wss://relay.example'] },
  });
  const request = (path: string, init?: RequestInit) =>
    handler(new Request(origin + '/api/studio/' + path, init));
  const authorize = async (key: Uint8Array) => {
    const body = JSON.stringify({
      client: getPublicKey(generateSecretKey()),
      nonce: crypto.randomUUID(),
    });
    const proof = finalizeEvent(
      {
        kind: 27235,
        content: '',
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['u', origin + '/api/studio/session'],
          ['method', 'POST'],
          ['payload', await sha256(body)],
        ],
      },
      key,
    );
    const headers = {
      Authorization: 'Nostr ' + Buffer.from(JSON.stringify(proof)).toString('base64'),
      Origin: origin,
    };
    expect((await request('session', { method: 'POST', body: body + ' ', headers })).status).toBe(
      401,
    );
    const result = await request('session', { method: 'POST', body, headers });
    expect(result.status).toBe(200);
    expect((await request('session', { method: 'POST', body, headers })).status).toBe(401);
    return (await result.json()).token;
  };
  const tokenA = await authorize(a),
    tokenB = await authorize(b);
  const headers = {
    Authorization: 'Bearer ' + tokenA,
    'Content-Type': 'application/octet-stream',
    Origin: origin,
  };
  expect(
    (
      await request('transfers', {
        method: 'POST',
        headers: { ...headers, Origin: 'https://attacker.example' },
        body: 'private',
      })
    ).status,
  ).toBe(403);
  const id = (
    await (await request('transfers', { method: 'POST', headers, body: 'private project' })).json()
  ).id;
  expect((await request('transfers/' + id)).status).toBe(401);
  expect(
    (await request('transfers/' + id, { headers: { Authorization: 'Bearer ' + tokenB } })).status,
  ).toBe(400);
  expect(await (await request('transfers/' + id, { headers })).text()).toBe('private project');
  expect((await request('session', { method: 'DELETE', headers })).status).toBe(200);
  expect((await request('transfers/' + id, { headers })).status).toBe(401);
});
