import { expect, test } from 'bun:test';
import { encodeAndHash, LinkType, toHex, fromHex } from '@hashtree/core';
import { FipsResourceSession, type FipsTransport } from './session';
import { parseRoots } from './policy';
import type { FipsRoot } from './contract';
import {
  clearRecentSessions,
  disconnectSession,
  fipsDashboardSnapshot,
  registerFipsDashboardSession,
} from './dashboard';
const hash = async (b: Uint8Array) =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b))));
const provider = {
  peerId: '02' + '1'.repeat(64),
  seedUrls: ['wss://seed.example.com/fips'],
  servicePort: 39018 as const,
  rpcPort: 39019 as const,
};
async function fixture() {
  const a = new Uint8Array(1024).fill(21),
    b = new Uint8Array(1024).fill(22);
  const ha = await hash(a),
    hb = await hash(b);
  const node = await encodeAndHash({
    type: LinkType.File,
    links: [
      { hash: fromHex(ha), type: LinkType.Blob, size: a.length },
      { hash: fromHex(hb), type: LinkType.Blob, size: b.length },
    ],
  });
  const root = toHex(node.hash);
  const blocks = new Map([
    [root, node.data],
    [ha, a],
    [hb, b],
  ]);
  const descriptor: FipsRoot = {
    root,
    bytes: 2048,
    chunkBytes: 1024,
    providers: [provider],
    expires: Math.floor(Date.now() / 1000) + 600,
  };
  let reads = 0,
    stopped = 0,
    operations = 0;
  const transport: FipsTransport = {
    async fetchBlob(h, _providers, signal) {
      signal?.throwIfAborted();
      reads++;
      return blocks.get(h) ?? null;
    },
    async request(_p, request) {
      operations++;
      return { status: 200, headers: { 'x-atlas-snapshot': root }, body: { root: request.root } };
    },
    status: () => ({
      requests: reads,
      rpcRequests: operations,
      bytesReceived: 0,
      retries: 0,
      failovers: 0,
      activeTransfers: 0,
      queuedTransfers: 0,
      connections: 0,
    }),
    async stop() {
      stopped++;
    },
  };
  return {
    descriptor,
    blocks,
    ha,
    hb,
    a,
    transport,
    reads: () => reads,
    stopped: () => stopped,
    operations: () => operations,
  };
}
test('verified ancestors authorize selective leaves; warm cache still requires a live, frame-scoped grant', async () => {
  const f = await fixture();
  const s = new FipsResourceSession({
    approve: async () => true,
    enabled: () => true,
    transport: f.transport,
  });
  const other = new FipsResourceSession({
    approve: async () => true,
    enabled: () => true,
    transport: f.transport,
  });
  try {
    const [id] = await s.open([f.descriptor]);
    await expect(s.bytes(id!, f.ha)).rejects.toThrow('descendant');
    expect(f.reads()).toBe(0);
    await s.bytes(id!, f.descriptor.root);
    expect(await s.bytes(id!, f.ha)).toEqual(f.a);
    expect(await s.bytes(id!, f.ha)).toEqual(f.a);
    expect(f.reads()).toBe(2); // The unrelated half of the file was never fetched.
    expect(s.stats().cacheHits).toBe(1);
    await expect(other.bytes(id!, f.ha)).rejects.toThrow('revoked');
    s.release(id!);
    await expect(s.bytes(id!, f.ha)).rejects.toThrow('revoked');
    const [reopened] = await s.open([f.descriptor]);
    await expect(s.bytes(reopened!, f.ha)).rejects.toThrow('descendant');
    await s.bytes(reopened!, f.descriptor.root);
    expect(await s.bytes(reopened!, f.ha)).toEqual(f.a);
    expect(f.reads()).toBe(2); // Re-approval rebuilds proof from verified cached nodes.
  } finally {
    s.close();
    other.close();
  }
});
test('tampering and inconsistent Merkle lengths are rejected before cache or descendant authorization', async () => {
  const f = await fixture(),
    s = new FipsResourceSession({
      approve: async () => true,
      enabled: () => true,
      transport: f.transport,
    });
  try {
    const [id] = await s.open([f.descriptor]);
    await s.bytes(id!, f.descriptor.root);
    f.blocks.set(f.ha, new Uint8Array(1024).fill(99));
    await expect(s.bytes(id!, f.ha)).rejects.toThrow('SHA-256');
    f.blocks.set(f.ha, f.a);
    expect(await s.bytes(id!, f.ha)).toEqual(f.a);
    const [wrong] = await s.open([{ ...f.descriptor, bytes: 3000 }]);
    await expect(s.bytes(wrong!, f.descriptor.root)).rejects.toThrow('length mismatch');
    await expect(s.bytes(wrong!, f.hb)).rejects.toThrow('descendant');
  } finally {
    s.close();
  }
});
test('expiry, refused approval and shell block cannot be bypassed by roots, providers or cache', async () => {
  const f = await fixture();
  let enabled = true;
  const s = new FipsResourceSession({
    approve: async () => true,
    enabled: () => enabled,
    transport: f.transport,
  });
  const denied = new FipsResourceSession({
    approve: async () => false,
    enabled: () => true,
    transport: f.transport,
  });
  try {
    await expect(denied.open([f.descriptor])).rejects.toThrow('approved');
    const [id] = await s.open([f.descriptor]);
    await s.bytes(id!, f.descriptor.root);
    enabled = false;
    await expect(s.bytes(id!, f.descriptor.root)).rejects.toThrow('disabled');
    expect(() => parseRoots([{ ...f.descriptor, expires: 1 }])).toThrow('expired');
    for (const seed of [
      'ws://evil.example/a',
      'wss://127.0.0.1/a',
      'wss://user:pass@example.com',
      'wss://10.1.1.1/a',
      'wss://seed.example.com:9999/a',
    ])
      expect(() =>
        parseRoots([{ ...f.descriptor, providers: [{ ...provider, seedUrls: [seed] }] }]),
      ).toThrow();
    expect(() => parseRoots([{ ...f.descriptor, arbitrary: true }])).toThrow();
    expect(f.reads()).toBe(1);
  } finally {
    s.close();
    denied.close();
  }
});
test('retiring a root cancels late reads and releasing one root keeps unrelated roots usable', async () => {
  const f = await fixture();
  let finish!: (value: Uint8Array) => void;
  f.transport.fetchBlob = async () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const s = new FipsResourceSession({
    approve: async () => true,
    enabled: () => true,
    transport: f.transport,
  });
  try {
    const [id] = await s.open([f.descriptor]);
    const pending = s.bytes(id!, f.descriptor.root).then(
      () => null,
      (error) => error,
    );
    await Bun.sleep(0);
    s.release(id!);
    finish(f.blocks.get(f.descriptor.root)!);
    expect(await pending).toBeInstanceOf(DOMException);
    expect(s.stats().verifiedBlobs).toBe(0);
    f.transport.fetchBlob = async (h) => f.blocks.get(h) ?? null;
    const [newId] = await s.open([f.descriptor]);
    await s.bytes(newId!, f.descriptor.root);
    expect(s.stats().verifiedBlobs).toBe(1);
  } finally {
    s.close();
  }
});
test('root-pinned operations retain status and snapshot, require consent and never replay uncertain results', async () => {
  const f = await fixture();
  let approvals = 0;
  const peers: string[] = [];
  f.transport.request = async (p) => {
    peers.push(p.peerId);
    throw new Error('Response lost; execution is uncertain');
  };
  const s = new FipsResourceSession({
    approve: async () => {
      approvals++;
      return true;
    },
    enabled: () => true,
    transport: f.transport,
  });
  try {
    const [id] = await s.open([
      { ...f.descriptor, providers: [provider, { ...provider, peerId: '03' + '2'.repeat(64) }] },
    ]);
    await expect(s.request(id!, { method: 'POST', path: 'route', body: {} })).rejects.toThrow(
      'uncertain',
    );
    expect(peers).toEqual([provider.peerId]);
    expect(approvals).toBe(2);
    await expect(s.request(id!, { method: 'POST', path: 'admin/delete' })).rejects.toThrow();
    expect(peers.length).toBe(1);
    f.transport.request = async (_p, req) => ({
      status: 409,
      headers: { 'x-atlas-snapshot': req.root },
      bytes: new Uint8Array([1, 2, 3]),
    });
    const result = await s.request(id!, { method: 'GET', path: 'capabilities' });
    expect(result.status).toBe(409);
    expect(result.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.headers?.['x-atlas-snapshot']).toBe(f.descriptor.root);
  } finally {
    s.close();
  }
});

test('host cache controls release bytes without changing grants and diagnostics omit seed paths or credentials', async () => {
  const f = await fixture();
  let approvals = 0;
  const s = new FipsResourceSession({
    approve: async () => {
      approvals++;
      return true;
    },
    enabled: () => true,
    transport: f.transport,
  });
  try {
    const [id] = await s.open([
      {
        ...f.descriptor,
        providers: [
          {
            ...provider,
            seedUrls: ['wss://seed.example.com/private-path?token=not-for-diagnostics#'],
          },
        ],
      },
    ]);
    await s.bytes(id!, f.descriptor.root);
    await s.bytes(id!, f.ha);
    const first = s.dashboardSnapshot();
    expect(first.cacheEntries).toBe(2);
    expect(first.cacheBytes).toBeGreaterThan(1024);
    expect(first.grants[0]!.providers[0]!.seeds).toEqual(['wss://seed.example.com']);
    expect(first.grants[0]!.operationsAllowed).toBe(false);
    s.clearCache();
    expect(s.dashboardSnapshot()).toMatchObject({ cacheBytes: 0, cacheEntries: 0 });
    expect(s.dashboardSnapshot().grants[0]!.id).toBe(id);
    expect(await s.bytes(id!, f.ha)).toEqual(f.a);
    expect(f.reads()).toBe(3);
    expect(approvals).toBe(1);
    await s.request(id!, { path: 'capabilities', method: 'GET' });
    expect(s.dashboardSnapshot().grants[0]!.operationsAllowed).toBe(true);
    s.release(id!);
    expect(s.dashboardSnapshot().grants).toHaveLength(0);
    await expect(s.bytes(id!, f.ha)).rejects.toThrow('revoked');
  } finally {
    s.close();
  }
});

test('disconnect receipts retain transport totals and count pending cancellations synchronously exactly once', async () => {
  clearRecentSessions();
  const f = await fixture();
  const status = f.transport.status;
  f.transport.status = () => ({ ...status(), bytesReceived: 4096 });
  const s = new FipsResourceSession({
    approve: async () => true,
    enabled: () => true,
    transport: f.transport,
  });
  const entry = registerFipsDashboardSession(
    { title: 'Closing reader' },
    {
      snapshot: () => s.dashboardSnapshot(),
      disconnect: () => {
        s.close();
        entry.end();
      },
      revokeGrant: (id) => s.release(id),
      clearCache: () => s.clearCache(),
    },
  );
  try {
    const [id] = await s.open([f.descriptor]);
    await s.bytes(id!, f.descriptor.root);
    const late = Promise.withResolvers<Uint8Array>();
    f.transport.fetchBlob = async () => late.promise;
    const pending = s.bytes(id!, f.ha).then(
      () => false,
      () => true,
    );
    disconnectSession(entry.id);
    expect(fipsDashboardSnapshot().recentSessions[0]!.stats).toMatchObject({
      fipsBytes: 4096,
      networkRequests: 1,
      cancelledRequests: 1,
      activeTransfers: 0,
      queuedTransfers: 0,
    });
    late.resolve(f.a);
    expect(await pending).toBe(true);
    expect(s.stats()).toMatchObject({ fipsBytes: 4096, networkRequests: 1, cancelledRequests: 1 });
    expect(fipsDashboardSnapshot().recentSessions[0]!.stats.cancelledRequests).toBe(1);
    expect(s.dashboardSnapshot()).toMatchObject({ cacheBytes: 0, cacheEntries: 0, grants: [] });
  } finally {
    s.close();
    entry.end(false);
    clearRecentSessions();
  }
});
