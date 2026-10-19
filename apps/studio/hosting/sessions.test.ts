import { test, expect } from 'bun:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { sha256 } from '../../../packages/protocol/src';
import { StudioSessions } from './sessions';

test('a shell NIP-98 signature binds a short-lived CVM key to its owner and exact request', async () => {
  const key = generateSecretKey(),
    other = generateSecretKey(),
    owner = getPublicKey(key);
  let now = Date.now();
  let allowed = true;
  const sessions = new StudioSessions(
    'https://studio.example',
    (p) => allowed && p === owner,
    () => now,
  );
  const body = JSON.stringify({
    client: getPublicKey(generateSecretKey()),
    nonce: crypto.randomUUID(),
  });
  const proof = async (overrides = {}, signer = key) =>
    'Nostr ' +
    Buffer.from(
      JSON.stringify(
        finalizeEvent(
          {
            kind: 27235,
            created_at: Math.floor(now / 1000),
            content: '',
            tags: [
              ['u', 'https://studio.example/api/studio/session'],
              ['method', 'POST'],
              ['payload', await sha256(body)],
            ],
            ...overrides,
          },
          signer,
        ),
      ),
    ).toString('base64');
  await expect(sessions.authorize(await proof({}, other), body)).rejects.toThrow('Reconnect');
  await expect(sessions.authorize(await proof({ content: 'bad' }), body)).rejects.toThrow(
    'Reconnect',
  );
  await expect(
    sessions.authorize(await proof({ created_at: Math.floor(now / 1000) - 61 }), body),
  ).rejects.toThrow('Reconnect');
  await expect(sessions.authorize(await proof(), body + ' ')).rejects.toThrow('Reconnect');
  await expect(
    sessions.authorize(
      await proof({
        tags: [
          ['u', 'https://other.example/api/studio/session'],
          ['method', 'POST'],
          ['payload', await sha256(body)],
        ],
      }),
      body,
    ),
  ).rejects.toThrow('Reconnect');
  const auth = await proof(),
    session = await sessions.authorize(auth, body);
  expect(sessions.client(session.client).owner).toBe(owner);
  expect(sessions.bearer(session.token).owner).toBe(owner);
  await expect(sessions.authorize(auth, body)).rejects.toThrow('Reconnect');
  expect(() => sessions.client(owner)).toThrow('Reconnect');
  allowed = false;
  expect(() => sessions.bearer(session.token)).toThrow('Reconnect');
  allowed = true;
  now = session.expires;
  expect(() => sessions.client(session.client)).toThrow('Reconnect');
  expect(() => sessions.bearer(session.token)).toThrow('Reconnect');
});

test('only the last closed or expired tab disconnects an owner', async () => {
  const key = generateSecretKey(),
    owner = getPublicKey(key),
    closed: string[] = [];
  let now = Date.now();
  const sessions = new StudioSessions(
    'https://studio.example',
    () => true,
    () => now,
    (p) => closed.push(p),
  );
  const open = async () => {
    const body = JSON.stringify({
      client: getPublicKey(generateSecretKey()),
      nonce: crypto.randomUUID(),
    });
    const proof = finalizeEvent(
      {
        kind: 27235,
        created_at: Math.floor(now / 1000),
        content: '',
        tags: [
          ['u', 'https://studio.example/api/studio/session'],
          ['method', 'POST'],
          ['payload', await sha256(body)],
        ],
      },
      key,
    );
    return sessions.authorize(
      'Nostr ' + Buffer.from(JSON.stringify(proof)).toString('base64'),
      body,
    );
  };
  const first = await open(),
    second = await open();
  sessions.revoke(first.client);
  expect(closed).toEqual([]);
  sessions.revoke(second.client);
  expect(closed).toEqual([owner]);
  const third = await open();
  now = third.expires;
  sessions.sweep();
  expect(closed).toEqual([owner, owner]);
});
