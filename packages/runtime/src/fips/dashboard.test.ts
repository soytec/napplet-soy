import { expect, test } from 'bun:test';
import {
  clearRecentSessions,
  clearSessionCache,
  disconnectAll,
  disconnectSession,
  fipsDashboardError,
  fipsDashboardSnapshot,
  registerFipsDashboardSession,
  revokeGrant,
  serverFipsDashboardSnapshot,
  subscribeFipsDashboard,
  type FipsSessionSnapshot,
} from './dashboard';

function fixture(): FipsSessionSnapshot {
  return {
    state: 'transferring',
    stats: {
      networkRequests: 2,
      fipsBytes: 1024,
      activeTransfers: 1,
      queuedTransfers: 2,
      retries: 0,
      failovers: 0,
      verifiedBlobs: 1,
      cacheHits: 1,
      errors: 0,
      cancelledRequests: 0,
    },
    pendingRequests: 3,
    cacheBytes: 1024,
    cacheEntries: 1,
    grants: [
      {
        id: 'grant',
        root: 'a'.repeat(64),
        bytes: 1024,
        expires: 1,
        operationsAllowed: false,
        providers: [{ peerId: '02' + 'b'.repeat(64), seeds: ['wss://seed.example'] }],
      },
    ],
    transport: {
      seedGroups: 1,
      connectedPeers: 1,
      openSeedSockets: 1,
      connectionAttempts: 1,
      reconnects: 0,
      wireBytesReceived: 1500,
      wireBytesSent: 50,
    },
  };
}

test('host registry observes controls, stable snapshots and bounded closed receipts without keeping sessions alive', () => {
  clearRecentSessions();
  const live = fixture();
  let revoked = '',
    clears = 0,
    disconnected = 0,
    notices = 0;
  const entry = registerFipsDashboardSession(
    { title: 'Document reader', address: 'event:' + 'c'.repeat(64) },
    {
      snapshot: () => live,
      disconnect: () => {
        disconnected++;
        entry.end();
      },
      revokeGrant: (id) => {
        revoked = id;
        live.grants = [];
      },
      clearCache: () => {
        clears++;
        live.cacheBytes = 0;
        live.cacheEntries = 0;
      },
    },
  );
  const unsubscribe = subscribeFipsDashboard(() => notices++);
  try {
    const initial = fipsDashboardSnapshot();
    entry.update();
    expect(fipsDashboardSnapshot()).toBe(initial);
    expect(serverFipsDashboardSnapshot()).toEqual({ sessions: [], recentSessions: [] });
    revokeGrant(entry.id, 'grant');
    clearSessionCache(entry.id);
    expect(revoked).toBe('grant');
    expect(clears).toBe(1);
    expect(fipsDashboardSnapshot().sessions[0]!.grants).toHaveLength(0);
    expect(fipsDashboardSnapshot().sessions[0]!.cacheBytes).toBe(0);
    disconnectSession(entry.id);
    expect(disconnected).toBe(1);
    expect(fipsDashboardSnapshot().sessions).toHaveLength(0);
    const receipt = fipsDashboardSnapshot().recentSessions[0]!;
    expect(receipt).toMatchObject({
      state: 'closed',
      cacheBytes: 0,
      cacheEntries: 0,
      pendingRequests: 0,
      grants: [],
      stats: { fipsBytes: 1024, activeTransfers: 0, queuedTransfers: 0 },
      transport: { connectedPeers: 0, openSeedSockets: 0, seedGroups: 0, wireBytesReceived: 1500 },
    });
    expect(receipt.endedAt).toBeNumber();
    live.stats.fipsBytes = 5000;
    entry.update();
    expect(fipsDashboardSnapshot().recentSessions[0]!.stats.fipsBytes).toBe(1024);
    disconnectSession(entry.id);
    revokeGrant(entry.id, 'stale');
    clearSessionCache(entry.id);
    expect(disconnected).toBe(1);
    expect(revoked).toBe('grant');
    expect(clears).toBe(1);
    for (let i = 0; i < 12; i++) {
      const next = registerFipsDashboardSession(
        { title: `Reader ${i}`, address: 'wss://user:secret@seed.example/?token=private' },
        {
          snapshot: fixture,
          disconnect: () => next.end(),
          revokeGrant() {},
          clearCache() {},
        },
      );
      disconnectAll();
    }
    expect(fipsDashboardSnapshot().recentSessions).toHaveLength(10);
    expect(fipsDashboardSnapshot().recentSessions[0]!.title).toBe('Reader 11');
    expect(fipsDashboardSnapshot().recentSessions[0]!.address).toBeUndefined();
    expect(notices).toBeGreaterThan(0);
    clearRecentSessions();
    expect(fipsDashboardSnapshot().recentSessions).toHaveLength(0);
  } finally {
    unsubscribe();
    entry.end(false);
    clearRecentSessions();
  }
});

test('dashboard errors never copy provider response bodies or secret-bearing URLs', () => {
  const secret =
    'personal route from 48.12345,16.12345; password=hidden; https://secret.example/private?token=hidden';
  expect(fipsDashboardError(new Error(secret), 'request')).toBe(
    'Provider operation failed. Retry from the napplet or reconnect its resources.',
  );
  expect(fipsDashboardError(new Error(`TCP/FIPS read timed out: ${secret}`), 'bytes')).toBe(
    'Resource read timed out. Retry from the napplet.',
  );
  expect(
    fipsDashboardError(new Error(`Resource block failed SHA-256 verification: ${secret}`), 'bytes'),
  ).toBe('Resource content failed verification and was not delivered.');
  expect(
    fipsDashboardError(new Error(`Map operation was not approved: ${secret}`), 'request'),
  ).toBe('Provider operation was not approved.');
});

test('an observed idle session updates when a seed disconnects without a resource request', async () => {
  const live = fixture();
  live.state = 'connected';
  live.stats = { ...live.stats, activeTransfers: 0, queuedTransfers: 0 };
  const entry = registerFipsDashboardSession(
    { title: 'Idle reader' },
    {
      snapshot: () => live,
      disconnect: () => entry.end(),
      revokeGrant() {},
      clearCache() {},
    },
  );
  const unsubscribe = subscribeFipsDashboard(() => {});
  try {
    live.state = 'idle';
    live.transport = { ...live.transport, connectedPeers: 0, openSeedSockets: 0, reconnects: 1 };
    await Bun.sleep(550);
    expect(
      fipsDashboardSnapshot().sessions.find((session) => session.id === entry.id),
    ).toMatchObject({
      state: 'idle',
      transport: { connectedPeers: 0, openSeedSockets: 0, reconnects: 1 },
    });
  } finally {
    unsubscribe();
    entry.end(false);
  }
});
