import type { FipsStats } from './contract';

/** Trusted shell diagnostics. This store is never included in the napplet binding. */
export type FipsTransportSnapshot = {
  seedGroups: number;
  connectedPeers: number;
  /** Seed carriers ready after their transport handshake, not merely configured URLs. */
  openSeedSockets: number;
  connectionAttempts: number;
  reconnects: number;
  wireBytesReceived: number;
  wireBytesSent: number;
};
export type FipsGrantSnapshot = {
  id: string;
  root: string;
  bytes: number;
  expires: number;
  operationsAllowed: boolean;
  providers: { peerId: string; seeds: string[] }[];
};
export type FipsSessionSnapshot = {
  state: 'idle' | 'approving' | 'connecting' | 'connected' | 'transferring' | 'error' | 'closed';
  stats: FipsStats;
  pendingRequests: number;
  cacheBytes: number;
  cacheEntries: number;
  grants: FipsGrantSnapshot[];
  transport: FipsTransportSnapshot;
  lastError?: string;
};
export type FipsDashboardSession = FipsSessionSnapshot & {
  id: string;
  title: string;
  address?: string;
  startedAt: number;
  endedAt?: number;
};
export type FipsDashboardSnapshot = {
  sessions: FipsDashboardSession[];
  recentSessions: FipsDashboardSession[];
};
type Source = {
  snapshot: () => FipsSessionSnapshot;
  disconnect: () => void;
  revokeGrant: (grantId: string) => void;
  clearCache: () => void;
};
type Entry = {
  metadata: Pick<FipsDashboardSession, 'id' | 'title' | 'address' | 'startedAt'>;
  source: Source;
};
const empty: FipsDashboardSnapshot = { sessions: [], recentSessions: [] };
let snapshot = empty;
const sources = new Map<string, Entry>();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function publish(next: FipsDashboardSnapshot) {
  // React's external-store snapshot must stay referentially stable between changes.
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  for (const listener of listeners) listener();
}
function refresh() {
  publish({
    sessions: [...sources.values()].map(({ metadata, source }) => ({
      ...metadata,
      ...source.snapshot(),
    })),
    recentSessions: snapshot.recentSessions,
  });
}
function polling() {
  if (listeners.size && sources.size) timer ??= setInterval(refresh, 500);
  else {
    clearInterval(timer);
    timer = undefined;
  }
}
export function subscribeFipsDashboard(listener: () => void) {
  listeners.add(listener);
  refresh();
  polling();
  return () => {
    listeners.delete(listener);
    polling();
  };
}
export const fipsDashboardSnapshot = () => snapshot;
export const serverFipsDashboardSnapshot = () => empty;

/** Only the host registers sources. Public metadata comes from its verified catalog. */
export function registerFipsDashboardSession(
  metadata: { title?: string; address?: string },
  source: Source,
) {
  const id = crypto.randomUUID();
  const entry: Entry = {
    metadata: {
      id,
      title:
        (metadata.title ?? 'Napplet').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 160) || 'Napplet',
      // A selected public event reference, never an account or transport identity.
      ...(metadata.address && /^event:[a-f0-9]{64}$/.test(metadata.address)
        ? { address: metadata.address }
        : {}),
      startedAt: Date.now(),
    },
    source,
  };
  sources.set(id, entry);
  refresh();
  polling();
  return {
    id,
    update: () => {
      if (sources.has(id)) refresh();
    },
    end: (retainRecent = true) => {
      if (!sources.delete(id)) return;
      const final = source.snapshot();
      const ended: FipsDashboardSession = {
        ...entry.metadata,
        ...final,
        endedAt: Date.now(),
        state: 'closed',
        stats: { ...final.stats, activeTransfers: 0, queuedTransfers: 0 },
        pendingRequests: 0,
        cacheBytes: 0,
        cacheEntries: 0,
        grants: [],
        transport: { ...final.transport, seedGroups: 0, connectedPeers: 0, openSeedSockets: 0 },
      };
      publish({
        sessions: snapshot.sessions.filter((session) => session.id !== id),
        recentSessions: retainRecent
          ? [ended, ...snapshot.recentSessions].slice(0, 10)
          : snapshot.recentSessions,
      });
      polling();
    },
  };
}

export function disconnectSession(id: string) {
  sources.get(id)?.source.disconnect();
}
export function revokeGrant(sessionId: string, grantId: string) {
  sources.get(sessionId)?.source.revokeGrant(grantId);
  refresh();
}
export function clearSessionCache(id: string) {
  sources.get(id)?.source.clearCache();
  refresh();
}
export function disconnectAll() {
  for (const { source } of [...sources.values()]) source.disconnect();
}
export function clearRecentSessions() {
  publish({ ...snapshot, recentSessions: [] });
}

/** Error text may originate in an RPC response: disclose categories, never its body. */
export function fipsDashboardError(error: unknown, action: string) {
  const text = error instanceof Error ? error.message : '';
  const operation =
    action === 'request'
      ? 'Provider operation'
      : action === 'open'
        ? 'Resource approval'
        : 'Resource read';
  if (error instanceof Error && (error.name === 'TimeoutError' || /timed out|timeout/i.test(text)))
    return `${operation} timed out. Retry from the napplet.`;
  if (/not approved/i.test(text)) return `${operation} was not approved.`;
  if (/disabled|permissions changed/i.test(text))
    return 'Resource access is blocked or its permission changed.';
  if (/expired|revoked|session closed/i.test(text))
    return 'Resource access ended. Approve the roots again to continue.';
  if (/SHA-256|hash mismatch|length mismatch|Hashtree|Merkle/i.test(text))
    return 'Resource content failed verification and was not delivered.';
  if (/None of the approved providers has this block/i.test(text))
    return 'The approved providers did not have this resource block.';
  if (/queue is full|Too many/i.test(text))
    return 'The resource limit was reached. Retry after current work finishes.';
  if (/Invalid|Unsupported|outside the|not a verified descendant/i.test(text))
    return `${operation} was outside the approved resource contract.`;
  return `${operation} failed. Retry from the napplet or reconnect its resources.`;
}
