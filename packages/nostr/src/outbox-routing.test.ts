import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { OutboxRelayPlanner } from './outbox-routing';

const key = new Uint8Array(32).fill(41);
const other = new Uint8Array(32).fill(42);
const author = getPublicKey(key),
  recipient = getPublicKey(other);
const fallback = 'wss://fallback.example/';
const record = (tags: string[][], created_at = 100, signingKey = key) =>
  finalizeEvent({ kind: 10002, tags, content: '', created_at }, signingKey);

test('read and own-write use write markers; required recipient delivery uses read markers', async () => {
  const event = record([
    ['r', 'wss://both.example'],
    ['r', 'wss://write.example', 'write'],
    ['r', 'wss://read.example', 'read'],
    ['r', 'wss://ignored.example', 'invalid'],
  ]);
  const planner = new OutboxRelayPlanner([fallback], async () => ({
    events: [event],
    incomplete: false,
  }));
  expect((await planner.resolve([author], 'author-read')).relays).toEqual([
    'wss://both.example/',
    'wss://write.example/',
  ]);
  expect((await planner.resolve([author], 'own-write')).relays).toEqual([
    'wss://both.example/',
    'wss://write.example/',
  ]);
  expect((await planner.resolve([author], 'recipient-inbox')).relays).toEqual([
    'wss://both.example/',
    'wss://read.example/',
  ]);
});

test('only verified latest author records route; fresh cache expires and is bounded by host lifetime', async () => {
  let now = 1000000,
    calls = 0;
  const old = record([['r', 'wss://old.example']], 90);
  const latest = record([['r', 'wss://latest.example']], 100);
  const forged = { ...record([['r', 'wss://forged.example']], 110), sig: '0'.repeat(128) };
  const foreign = record([['r', 'wss://foreign.example']], 120, other);
  const planner = new OutboxRelayPlanner(
    [fallback],
    async () => {
      calls++;
      return { events: [old, latest, forged, foreign], incomplete: false };
    },
    () => now,
  );
  expect(await planner.resolve([author], 'author-read')).toMatchObject({
    relays: ['wss://latest.example/'],
    source: 'nip65',
    incomplete: false,
  });
  expect((await planner.resolve([author], 'author-read')).source).toBe('cache');
  expect(calls).toBe(1);
  now += 60001;
  expect((await planner.resolve([author], 'author-read')).source).toBe('nip65');
  planner.close();
  await expect(planner.resolve([author], 'author-read')).rejects.toThrow('closed');
  expect(calls).toBe(2);
});

test('equal timestamp replacements use lowest event id regardless of relay order', async () => {
  const events = [record([['r', 'wss://one.example']]), record([['r', 'wss://two.example']])];
  const winner = [...events].sort((a, b) => a.id.localeCompare(b.id))[0];
  for (const ordered of [events, [...events].reverse()]) {
    const planner = new OutboxRelayPlanner([fallback], async () => ({
      events: ordered,
      incomplete: false,
    }));
    expect((await planner.resolve([author], 'author-read')).relays).toEqual([
      winner.tags[0][1] + '/',
    ]);
  }
});

test('mixed author coverage includes fallback and reports missing authors', async () => {
  const planner = new OutboxRelayPlanner([fallback], async () => ({
    events: [record([['r', 'wss://own.example']])],
    incomplete: false,
  }));
  expect(await planner.resolve([author, recipient], 'author-read')).toMatchObject({
    relays: ['wss://own.example/', fallback],
    missingAuthors: [recipient],
    incomplete: true,
  });
  expect(await planner.resolve([recipient], 'recipient-inbox')).toMatchObject({
    relays: [],
    missingAuthors: [recipient],
  });
});

test('partial discovery cannot become a complete cached plan', async () => {
  let calls = 0;
  const planner = new OutboxRelayPlanner([fallback], async () => {
    calls++;
    return { events: [record([['r', 'wss://own.example']])], incomplete: true };
  });
  expect((await planner.resolve([author], 'author-read')).incomplete).toBe(true);
  expect((await planner.resolve([author], 'author-read')).incomplete).toBe(true);
  expect(calls).toBe(2);
  await expect(planner.publication(author, {})).rejects.toThrow('incomplete');
});

// Fanout vectors adapted from napplet-web packages/nap/src/outbox/shim.test.ts
// at 44d663a14af0f91a3797614c76e5c3d684cec52e. The upstream binding forwards
// these exact options; target selection belongs to this trusted host.
test('publication unions own outbox, explicit relays and requested inboxes without p-tag inference', async () => {
  const events = [
    record([['r', 'wss://own.example', 'write']]),
    record(
      [
        ['r', 'wss://inbox.example', 'read'],
        ['r', 'wss://own.example', 'read'],
      ],
      100,
      other,
    ),
  ];
  const planner = new OutboxRelayPlanner([fallback], async () => ({ events, incomplete: false }));
  expect(
    await planner.publication(author, { toInboxes: [recipient], relays: ['wss://own.example/'] }),
  ).toEqual(['wss://own.example/', 'wss://inbox.example/']);
  expect(await planner.publication(author, { toOutbox: false, toInboxes: [recipient] })).toEqual([
    'wss://inbox.example/',
    'wss://own.example/',
  ]);
  expect(
    await planner.publication(author, { toOutbox: false, relays: ['wss://explicit.example'] }),
  ).toEqual(['wss://explicit.example/']);
});

test('missing recipient metadata never substitutes fallback, including when explicit relays exist', async () => {
  const planner = new OutboxRelayPlanner([fallback], async () => ({
    events: [],
    incomplete: false,
  }));
  expect(await planner.publication(author, {})).toEqual([fallback]);
  await expect(
    planner.publication(author, { toInboxes: [recipient], relays: ['wss://explicit.example'] }),
  ).rejects.toThrow('Required recipient inbox');
  await expect(planner.publication(author, { toOutbox: false })).rejects.toThrow(
    'No publish destinations',
  );
});

test('policy denies private relays and required fanout cannot silently truncate', async () => {
  const many = Array.from({ length: 9 }, (_, i) => ['r', `wss://r${i}.example`]);
  const planner = new OutboxRelayPlanner([fallback], async () => ({
    events: [record(many)],
    incomplete: false,
  }));
  expect(await planner.resolve([author], 'author-read')).toMatchObject({
    incomplete: true,
    limited: true,
  });
  await expect(planner.publication(author, {})).rejects.toThrow('incomplete');
  await expect(
    planner.publication(author, { toOutbox: false, toInboxes: [author] }),
  ).rejects.toThrow('exceeds');
  await expect(
    planner.publication(author, { toOutbox: false, relays: ['wss://192.168.1.1'] }),
  ).rejects.toThrow('not allowed');
  await expect(
    planner.publication(author, { toOutbox: false, relays: ['ws://127.0.0.1:1234'] }),
  ).rejects.toThrow('not allowed');
});

test('author quota omissions are visible and cannot satisfy recipient fanout', async () => {
  const authors = Array.from({ length: 17 }, (_, i) =>
    getPublicKey(new Uint8Array(32).fill(i + 1)),
  );
  let requested = 0;
  const planner = new OutboxRelayPlanner([fallback], async (input) => {
    requested = input.length;
    return { events: [], incomplete: false };
  });
  const result = await planner.resolve(authors, 'author-read');
  expect(requested).toBe(16);
  expect(result.missingAuthors).toContain(authors[16]);
  expect(result.limited).toBe(true);
  await expect(planner.publication(author, { toInboxes: authors })).rejects.toThrow(
    'Required recipient inbox',
  );
});

test('separately valid own and inbox plans cannot overflow the combined publish cap', async () => {
  const events = [
    record(Array.from({ length: 5 }, (_, i) => ['r', `wss://own${i}.example`, 'write'])),
    record(
      Array.from({ length: 4 }, (_, i) => ['r', `wss://inbox${i}.example`, 'read']),
      100,
      other,
    ),
  ];
  const planner = new OutboxRelayPlanner([fallback], async () => ({ events, incomplete: false }));
  await expect(planner.publication(author, { toInboxes: [recipient] })).rejects.toThrow(
    'no targets were dropped',
  );
});

test('closing during discovery prevents a late relay plan and explicit-only publication', async () => {
  let finish!: (value: { events: ReturnType<typeof record>[]; incomplete: boolean }) => void;
  const planner = new OutboxRelayPlanner(
    [fallback],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = planner.resolve([author], 'author-read');
  planner.close();
  finish({ events: [record([['r', 'wss://late.example']])], incomplete: false });
  await expect(pending).rejects.toThrow('closed');
  await expect(
    planner.publication(author, { toOutbox: false, relays: ['wss://explicit.example'] }),
  ).rejects.toThrow('closed');
});

test('refresh cannot replace fresh metadata with an older signed record and discovery failure uses read fallback', async () => {
  const key = new Uint8Array(32).fill(17);
  const now = Math.floor(Date.now() / 1000);
  const latest = finalizeEvent(
    { kind: 10002, content: '', tags: [['r', 'wss://latest.example/', 'write']], created_at: now },
    key,
  );
  const older = finalizeEvent(
    {
      kind: 10002,
      content: '',
      tags: [['r', 'wss://older.example/', 'write']],
      created_at: now - 10,
    },
    key,
  );
  const planner = new OutboxRelayPlanner(['wss://fallback.example/'], async () => ({
    events: [older],
    incomplete: false,
  }));
  planner.observe(latest);
  expect((await planner.resolve([latest.pubkey], 'author-read', 100, true)).relays).toEqual([
    'wss://latest.example/',
  ]);
  planner.close();
  const failed = new OutboxRelayPlanner(['wss://fallback.example/'], async () => {
    throw new Error('transport unavailable');
  });
  expect(await failed.resolve([latest.pubkey], 'author-read')).toMatchObject({
    relays: ['wss://fallback.example/'],
    incomplete: true,
  });
  await expect(
    failed.publication(latest.pubkey, { toOutbox: false, toInboxes: [latest.pubkey] }),
  ).rejects.toThrow('unavailable');
  failed.close();
});

test('observing a signed relay list cannot promote incomplete discovery into publish coverage', async () => {
  const signed = finalizeEvent(
    {
      kind: 10002,
      content: '',
      tags: [['r', 'wss://inbox.example/', 'read']],
      created_at: Math.floor(Date.now() / 1000),
    },
    new Uint8Array(32).fill(19),
  );
  let discoveries = 0;
  const planner = new OutboxRelayPlanner(['wss://fallback.example/'], async () => {
    discoveries++;
    return { events: [signed], incomplete: true };
  });
  planner.observe(signed);
  expect(await planner.resolve([signed.pubkey], 'recipient-inbox')).toMatchObject({
    relays: ['wss://inbox.example/'],
    incomplete: true,
  });
  await expect(
    planner.publication(signed.pubkey, { toOutbox: false, toInboxes: [signed.pubkey] }),
  ).rejects.toThrow('incomplete');
  expect(discoveries).toBe(2);
  planner.close();
});

test('a newer observation during awaited discovery cannot be overwritten by a completed older response', async () => {
  const key = new Uint8Array(32).fill(36);
  const now = Math.floor(Date.now() / 1000);
  const list = (relay: string, created_at: number) =>
    finalizeEvent({ kind: 10002, content: '', tags: [['r', relay, 'write']], created_at }, key);
  const older = list('wss://older.example/', now - 1);
  const newer = list('wss://newer.example/', now);
  let finish!: (value: { events: (typeof older)[]; incomplete: boolean }) => void;
  const planner = new OutboxRelayPlanner(
    ['wss://fallback.example/'],
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  planner.observe(older);
  const pending = planner.resolve([older.pubkey], 'author-read');
  planner.observe(newer);
  finish({ events: [older], incomplete: false });
  expect((await pending).relays).toEqual(['wss://newer.example/']);
  expect(await planner.resolve([older.pubkey], 'author-read')).toMatchObject({
    relays: ['wss://newer.example/'],
    source: 'cache',
  });
  planner.close();
});
