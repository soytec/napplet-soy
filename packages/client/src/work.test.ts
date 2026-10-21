import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey, matchFilters, nip19 } from 'nostr-tools';
import fixtures from '../../backend/data/catalog.json';
import {
  commentTemplate,
  deletionTemplate,
  likeTemplate,
  socialScope,
} from '../../protocol/src/social';
import { ProtocolClient } from './nostr';
import { readWork, WorkReadState } from './work';
import { readProposals, readRepository } from '../../collaboration/src/protocol';

test.each(['clone URL', 'naddr', 'publication fallback'])(
  'My work retains repository relay hints from the %s independently of catalog relays',
  async (format) => {
    const authorKey = new Uint8Array(32).fill(3),
      contributor = new Uint8Array(32).fill(7),
      author = getPublicKey(authorKey),
      now = Math.floor(Date.now() / 1000);
    type Event = ReturnType<typeof finalizeEvent>;
    const serve = (events: Event[]) =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
        websocket: {
          message(socket, message) {
            const m = JSON.parse(String(message));
            if (m[0] !== 'REQ') return;
            for (const event of events)
              if (matchFilters(m.slice(2), event))
                socket.send(JSON.stringify(['EVENT', m[1], event]));
            socket.send(JSON.stringify(['EOSE', m[1]]));
          },
        },
      });
    const catalogEvents: Event[] = [],
      gitEvents: Event[] = [],
      catalogRelay = serve(catalogEvents),
      gitRelay = serve(gitEvents);
    const catalogUrl = `ws://127.0.0.1:${catalogRelay.port}`,
      gitUrl = `ws://127.0.0.1:${gitRelay.port}`;
    const address = `30617:${author}:toy`;
    const repository = finalizeEvent(
      {
        kind: 30617,
        created_at: now - 30,
        content: '',
        tags: [
          ['d', 'toy'],
          ['relays', gitUrl],
          ['clone', 'https://git.example/toy.git'],
        ],
      },
      authorKey,
    );
    const hintedSource =
      format === 'naddr'
        ? `nostr://${nip19.naddrEncode({ kind: 30617, pubkey: author, identifier: 'toy', relays: [gitUrl] })}`
        : `nostr://${nip19.npubEncode(author)}/${encodeURIComponent(gitUrl)}/toy`;
    const source =
      format === 'publication fallback' ? `nostr://${nip19.npubEncode(author)}/toy` : hintedSource;
    const manifest = finalizeEvent(
      {
        ...fixtures[0].current,
        created_at: now - 20,
        tags: [...fixtures[0].current.tags.filter((t) => t[0] !== 'source'), ['source', source]],
      },
      authorKey,
    );
    const proposal = finalizeEvent(
      {
        kind: 1618,
        created_at: now - 10,
        content: 'More blocks',
        tags: [
          ['a', address],
          ['p', author],
          ['c', 'a'.repeat(40)],
          ['clone', 'https://git.example/toy.git'],
          ['subject', 'More blocks'],
        ],
      },
      contributor,
    );
    catalogEvents.push(manifest);
    gitEvents.push(repository, proposal);
    const localClient = () => {
      const client = new ProtocolClient(() => [catalogUrl]);
      // Public relay hints need no allowlisting. For this loopback-only fixture,
      // authorize the Git endpoint only when the caller actually passes its hint.
      client.query = async (filters, hints = [], ...options) => {
        const transport = new ProtocolClient(() => [
          catalogUrl,
          ...hints.filter((hint) => hint === gitUrl),
        ]);
        try {
          return await transport.query(filters, hints, ...options);
        } finally {
          transport.close();
        }
      };
      return client;
    };
    const pageClient = localClient();
    const dashboardClient = localClient();
    try {
      // The page has its own fresh client: success cannot depend on warming the
      // dashboard cache. Repository events exist only on the separate Git relay.
      const page = await readProposals(pageClient, await readRepository(pageClient, hintedSource));
      expect(page.map((p) => p.root.id)).toEqual([proposal.id]);
      const result = await readWork(
        dashboardClient,
        author,
        [
          {
            manifest,
            title: 'Toy',
            href: '/n/toy',
            relays: format === 'publication fallback' ? [gitUrl, catalogUrl] : [catalogUrl],
          },
        ],
        AbortSignal.timeout(4000),
      );
      expect(result.proposals.map((p) => p.proposal.root.id)).toEqual([proposal.id]);
      expect(result.proposals[0].incoming).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.activity.map((a) => a.id)).toContain(proposal.id);
    } finally {
      pageClient.close();
      dashboardClient.close();
      catalogRelay.stop(true);
      gitRelay.stop(true);
    }
  },
);

test('My work finds incoming/outgoing proposals and validates social and merge activity', async () => {
  const authorKey = new Uint8Array(32);
  authorKey[31] = 1;
  const contributor = new Uint8Array(32).fill(7),
    stranger = new Uint8Array(32).fill(8);
  const author = getPublicKey(authorKey),
    sender = getPublicKey(contributor),
    now = Math.floor(Date.now() / 1000);
  const repoAddress = `30617:${author}:toy`;
  let events: ReturnType<typeof finalizeEvent>[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(socket, message) {
        const m = JSON.parse(String(message));
        if (m[0] !== 'REQ') return;
        for (const event of events)
          if (matchFilters(m.slice(2), event)) socket.send(JSON.stringify(['EVENT', m[1], event]));
        socket.send(JSON.stringify(['EOSE', m[1]]));
      },
    },
  });
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const repo = finalizeEvent(
    {
      kind: 30617,
      content: '',
      created_at: now - 100,
      tags: [
        ['d', 'toy'],
        ['relays', relayUrl],
        ['clone', 'https://git.example/toy.git'],
      ],
    },
    authorKey,
  );
  const manifest = finalizeEvent(
    {
      ...fixtures[0].current,
      created_at: now - 80,
      tags: [
        ...fixtures[0].current.tags.filter((t) => t[0] !== 'source'),
        ['source', `nostr://${nip19.npubEncode(author)}/toy`],
      ],
    },
    authorKey,
  );
  const scope = socialScope(manifest);
  const like = finalizeEvent(likeTemplate(scope, manifest, now - 70), contributor);
  const deletedLike = finalizeEvent(likeTemplate(scope, manifest, now - 60), contributor);
  const removed = finalizeEvent(deletionTemplate([deletedLike], now - 50), contributor);
  const fakeRemove = finalizeEvent(deletionTemplate([like], now - 49), stranger);
  const futureLike = finalizeEvent(likeTemplate(scope, manifest, now + 120), stranger);
  const comment = finalizeEvent(
    commentTemplate(scope, 'Good game', undefined, now - 40),
    contributor,
  );
  const selfComment = finalizeEvent(
    commentTemplate(scope, 'Thanks', undefined, now - 30),
    authorKey,
  );
  const proposal = finalizeEvent(
    {
      kind: 1618,
      created_at: now - 20,
      content: 'More blocks',
      tags: [
        ['a', repoAddress],
        ['p', author],
        ['c', 'a'.repeat(40)],
        ['clone', 'https://git.example/toy.git'],
        ['subject', 'More blocks'],
      ],
    },
    contributor,
  );
  const untrustedMerge = finalizeEvent(
    { kind: 1631, created_at: now - 10, content: '', tags: [['e', proposal.id, '', 'root']] },
    stranger,
  );
  events = [
    repo,
    manifest,
    like,
    deletedLike,
    removed,
    fakeRemove,
    futureLike,
    comment,
    selfComment,
    proposal,
    untrustedMerge,
    { ...like, id: 'e'.repeat(64), sig: '0'.repeat(128) },
  ];
  const client = new ProtocolClient(() => [relayUrl]);
  try {
    const publications = [{ manifest, title: 'Toy', href: '/n/toy', relays: [relayUrl] }];
    const result = await readWork(client, author, publications, AbortSignal.timeout(4000));
    expect(result.warnings).toEqual([]);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].incoming).toBe(true);
    expect(result.proposals[0].proposal.status).toBe('open');
    expect(result.activity.map((a) => a.id).sort()).toEqual(
      [proposal.id, comment.id, like.id].sort(),
    );
    expect(result.activity.find((a) => a.id === proposal.id)?.href).toBe(
      `/n/toy?proposal=${proposal.id}#proposals`,
    );
    const missingSource = finalizeEvent(
      {
        ...manifest,
        tags: [
          ...manifest.tags.filter((t) => !['d', 'source'].includes(t[0])),
          ['d', 'missing'],
          ['source', `nostr://${nip19.npubEncode(author)}/missing`],
        ],
      },
      authorKey,
    );
    const updates: string[][] = [];
    const partial = await readWork(
      client,
      author,
      [...publications, { ...publications[0], manifest: missingSource }],
      AbortSignal.timeout(4000),
      (data) => updates.push(data.activity.map((a) => a.id)),
    );
    expect(partial.warnings).toContain(
      'Some proposal repositories could not be read. Refresh to retry.',
    );
    expect(partial.activity.map((a) => a.id).sort()).toEqual(
      [proposal.id, comment.id, like.id].sort(),
    );
    expect(updates.some((ids) => ids.includes(like.id))).toBe(true);
    const merged = finalizeEvent(
      { kind: 1631, created_at: now, content: '', tags: [['e', proposal.id, '', 'root']] },
      authorKey,
    );
    events.push(merged);
    const outgoing = await readWork(client, sender, [], AbortSignal.timeout(4000));
    expect(outgoing.proposals).toHaveLength(1);
    expect(outgoing.proposals[0].incoming).toBe(false);
    expect(outgoing.proposals[0].proposal.status).toBe('merged');
    expect(outgoing.activity.map((a) => a.id)).toEqual([merged.id]);
  } finally {
    client.close();
    relay.stop(true);
  }
});

test('read markers survive reload and stay account-scoped without hiding late events', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const id = 'a'.repeat(64),
    late = 'b'.repeat(64);
  const a = new WorkReadState('creator-a', storage);
  a.mark([id]);
  expect(new WorkReadState('creator-a', storage).unread(id)).toBe(false);
  expect(new WorkReadState('creator-b', storage).unread(id)).toBe(true);
  expect(a.unread(late)).toBe(true);
  const unavailable = new WorkReadState('creator-c', {
    getItem: () => {
      throw new Error();
    },
    setItem: () => {
      throw new Error();
    },
  });
  unavailable.mark([id]);
  expect(unavailable.unread(id)).toBe(false);
});
