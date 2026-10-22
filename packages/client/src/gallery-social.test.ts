import { test, expect } from 'bun:test';
import { finalizeEvent, getPublicKey, matchFilters, type Filter } from 'nostr-tools';
import { ProtocolClient } from './nostr';
import { GallerySocialReader } from './gallery-social';
import { publicNapplet } from '../../backend/src/public-model';
import {
  socialScope,
  likeTemplate,
  commentTemplate,
  deletionTemplate,
} from '../../protocol/src/social';
import { resolveZapEndpoint } from './zaps';
import type { SignedEvent } from '../../protocol/src';
import { invoice } from '../../../tests/fixtures/direct-wallet';
import fixtures from '../../backend/data/catalog.json';

const author = new Uint8Array(32),
  alice = new Uint8Array(32).fill(7),
  bob = new Uint8Array(32).fill(8);
author[31] = 1; // Public fixture keys only.
const now = Math.floor(Date.now() / 1000);
function relayFixture(events: SignedEvent[], allowed: (e: SignedEvent) => boolean = () => true) {
  const queries: Filter[][] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(r, server) {
      if (server.upgrade(r)) return;
      return new Response();
    },
    websocket: {
      message(socket, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] !== 'REQ') return;
        queries.push(m.slice(2));
        for (const event of events)
          if (matchFilters(m.slice(2), event)) socket.send(JSON.stringify(['EVENT', m[1], event]));
        socket.send(JSON.stringify(['EOSE', m[1]]));
      },
    },
  });
  const client = new ProtocolClient(() => [`ws://127.0.0.1:${relay.port}`], allowed);
  return {
    client,
    queries,
    close() {
      client.close();
      relay.stop(true);
    },
  };
}

test('a 48-napplet collection reads zap totals in one sweep with shared queries, not one read per card', async () => {
  const entries = await Promise.all(
    Array.from({ length: 48 }, (_, i) =>
      publicNapplet(
        finalizeEvent(
          {
            ...fixtures[0].current,
            tags: fixtures[0].current.tags.map((t) =>
              t[0] === 'd' ? ['d', `gallery-fixture-${i}`] : t,
            ),
          },
          author,
        ),
        [],
      ),
    ),
  );
  const events = entries.map((n) =>
    finalizeEvent(likeTemplate(socialScope(n.manifest), n.manifest, now), alice),
  );
  const fixture = relayFixture(events);
  try {
    const reader = new GallerySocialReader(fixture.client);
    const result = await reader.read(entries);
    expect(Object.keys(result.counts)).toHaveLength(48);
    expect(Object.values(result.counts).every((c) => c.msats === 0 && !c.liked)).toBe(true);
    expect(result.refreshing).toBe(false);
    // Two 32-entry groups, one receipt read each; likes and comments are COUNTed elsewhere.
    expect(fixture.queries).toHaveLength(2);
    expect(fixture.queries.flat().every((f) => f.kinds?.includes(9735))).toBe(true);
    expect(result.zapped).toHaveLength(0);
  } finally {
    fixture.close();
  }
});

test('cards on screen are read before the rotating remainder of a large collection', async () => {
  const entries = await Promise.all(
    Array.from({ length: 80 }, (_, i) =>
      publicNapplet(
        finalizeEvent(
          {
            ...fixtures[0].current,
            tags: fixtures[0].current.tags.map((t) =>
              t[0] === 'd' ? ['d', `visible-fixture-${i}`] : t,
            ),
          },
          author,
        ),
        [],
      ),
    ),
  );
  const fixture = relayFixture([]);
  try {
    const visible = new Set(entries.slice(-4).map((n) => n.revisionId));
    const result = await new GallerySocialReader(fixture.client).read(
      entries,
      undefined,
      undefined,
      undefined,
      visible,
    );
    for (const id of visible) expect(result.counts[id]).toBeDefined();
    expect(Object.keys(result.counts)).toHaveLength(64);
  } finally {
    fixture.close();
  }
});

test('viewer like state honors release references, deletions, moderation and account changes', async () => {
  const entries = await Promise.all(fixtures.map((f) => publicNapplet(f.current, [])));
  const first = entries[0],
    scope = socialScope(first.manifest);
  const previous = finalizeEvent(
    { ...first.manifest, created_at: first.manifest.created_at - 1 },
    author,
  );
  const deletedLike = finalizeEvent(likeTemplate(scope, first.manifest, now - 2), bob);
  const activeLike = finalizeEvent(likeTemplate(scope, first.manifest, now - 1), alice);
  const comment = finalizeEvent(commentTemplate(scope, 'Original note', undefined, now - 3), alice);
  const deletedComment = finalizeEvent(
    commentTemplate(scope, 'Remove me', undefined, now - 2),
    bob,
  );
  const reply = finalizeEvent(commentTemplate(scope, 'Reply', comment, now - 1), bob);
  const events = [
    previous,
    deletedLike,
    activeLike,
    comment,
    deletedComment,
    reply,
    finalizeEvent(likeTemplate(scope, previous, now - 3), alice),
    finalizeEvent(deletionTemplate([deletedLike, deletedComment], now), bob),
    finalizeEvent(deletionTemplate([activeLike], now), bob), // Cannot delete Alice's reaction.
    ...entries
      .slice(1)
      .map((n) => finalizeEvent(likeTemplate(socialScope(n.manifest), n.manifest, now), alice)),
  ];
  const blocked = new Set<string>();
  const fixture = relayFixture(events, (e) => !blocked.has(e.pubkey));
  let endpointCalls = 0;
  const reader = new GallerySocialReader(fixture.client, async () => {
    endpointCalls++;
    throw new Error('No receipts');
  });
  try {
    const data = await reader.read(entries, getPublicKey(alice));
    expect(data.counts[first.revisionId]).toEqual({ liked: true, msats: 0, zapCount: 0 });
    expect(data.refreshing).toBe(false);
    expect(fixture.queries).toHaveLength(1); // One shared read; no receipts need dependencies.
    expect(endpointCalls).toBe(0);
    // Bob deleted his own like; deleting Alice's reaction had no effect.
    expect((await reader.read(entries, getPublicKey(bob))).counts[first.revisionId].liked).toBe(
      false,
    );
    // Known counts are available synchronously, with the new viewer applied.
    const initial: boolean[] = [];
    const refresh = reader.read(entries, getPublicKey(bob), undefined, (v) =>
      initial.push(v.counts[first.revisionId]?.liked ?? true),
    );
    expect(initial[0]).toBe(false);
    await refresh;
    blocked.add(getPublicKey(alice));
    expect((await reader.read(entries, getPublicKey(alice))).counts[first.revisionId].liked).toBe(
      false,
    );
    // Leaving the page stops every progress callback, including pending coalesced updates.
    const controller = new AbortController();
    let updates = 0;
    await expect(
      reader.read(entries, undefined, controller.signal, () => {
        updates++;
        controller.abort();
      }),
    ).rejects.toThrow();
    await Bun.sleep(70);
    expect(updates).toBe(1);
  } finally {
    fixture.close();
  }
});

test('slow LNURL verification never holds up viewer state and shared provider lookup validates/deduplicates receipts', async () => {
  const entries = await Promise.all(fixtures.slice(0, 2).map((f) => publicNapplet(f.current, [])));
  const profile = finalizeEvent(
    {
      kind: 0,
      created_at: now,
      tags: [],
      content: JSON.stringify({ lud16: 'alice@wallet.example' }),
    },
    author,
  );
  const provider = new Uint8Array(32).fill(9);
  const endpoint = await resolveZapEndpoint(entries[0].pubkey, [profile], async () => ({
    tag: 'payRequest',
    allowsNostr: true,
    nostrPubkey: getPublicKey(provider),
    callback: 'https://wallet.example/callback',
    minSendable: 1000,
    maxSendable: 1000000,
  }));
  const events: SignedEvent[] = [profile];
  for (const n of entries) {
    const scope = socialScope(n.manifest);
    events.push(finalizeEvent(likeTemplate(scope, n.manifest, now), alice));
    events.push(finalizeEvent(commentTemplate(scope, 'Already readable', undefined, now), alice));
    const request = finalizeEvent(
      {
        kind: 9734,
        created_at: now,
        content: '',
        tags: [
          ['p', n.pubkey],
          ['e', n.revisionId],
          ['a', scope.key],
          ['amount', '21000'],
          ['relays', 'wss://relay.example'],
          ['lnurl', endpoint.lnurl],
        ],
      },
      alice,
    );
    const description = JSON.stringify(request);
    const tags = [
      ...request.tags.filter((t) => ['p', 'e', 'a'].includes(t[0])),
      ['description', description],
      ['bolt11', invoice(21000, description)],
    ];
    events.push(finalizeEvent({ kind: 9735, created_at: now, content: '', tags }, provider));
    events.push(finalizeEvent({ kind: 9735, created_at: now + 1, content: '', tags }, provider));
    events.push(finalizeEvent({ kind: 9735, created_at: now, content: '', tags }, bob)); // Wrong provider.
  }
  const fixture = relayFixture(events);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let endpointCalls = 0;
  const reader = new GallerySocialReader(fixture.client, async () => {
    endpointCalls++;
    entered();
    await gate;
    return endpoint;
  });
  let latest: Awaited<ReturnType<typeof reader.read>> | undefined;
  const reading = reader.read(entries, getPublicKey(alice), undefined, (data) => {
    latest = data;
  });
  try {
    await started;
    expect(latest!.counts[entries[0].revisionId]).toMatchObject({ liked: true, msats: null });
    expect(latest!.zapped).toHaveLength(0);
    release();
    const result = await reading;
    expect(endpointCalls).toBe(1);
    for (const n of entries)
      expect(result.counts[n.revisionId]).toMatchObject({ msats: 21000, zapCount: 1 });
    expect(result.zapped).toHaveLength(2);
  } finally {
    release();
    await reading.catch(() => {});
    fixture.close();
  }
});
