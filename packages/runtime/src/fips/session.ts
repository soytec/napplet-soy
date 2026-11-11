import { decodeTreeNode, LinkType, toHex } from '@hashtree/core';
import { FipsClient } from './transport';
import { abortable, validateRpcRequest } from './rpc';
import {
  FIPS_BLOCK_BYTES,
  FIPS_CACHE_BYTES,
  FIPS_TIMEOUT_MS,
  type FipsRoot,
  type FipsStats,
  type FipsOperation,
} from './contract';
import { parseRoots } from './policy';
import type { FipsSessionSnapshot, FipsTransportSnapshot } from './dashboard';

export type FipsTransport = Pick<FipsClient, 'fetchBlob' | 'request' | 'status' | 'stop'> &
  Partial<Pick<FipsClient, 'diagnostics'>>;
type Link = { type: LinkType; size: number; depth: number };
type Grant = {
  descriptor: FipsRoot;
  abort: AbortController;
  links: Map<string, Link>;
  rpcPeer?: string;
  rpcAllowed?: boolean;
};
const cancelled = () => new DOMException('Resource session closed or grant revoked', 'AbortError');

/** One account/document scope, with its own identity, connections, counters and cache. */
export class FipsResourceSession {
  private lifetime = new AbortController();
  private grants = new Map<string, Grant>();
  private cache = new Map<string, Uint8Array>();
  private cacheBytes = 0;
  private proofLinks = 0;
  private pending = 0;
  private opening = false;
  private operationApprovals = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private transport?: { client: FipsTransport; release: () => void };
  private finalTransportStatus?: ReturnType<FipsTransport['status']>;
  private finalTransportSnapshot?: FipsTransportSnapshot;
  private counters = { verifiedBlobs: 0, cacheHits: 0, errors: 0, cancelledRequests: 0 };
  constructor(
    private options: {
      approve: (description: string, signal: AbortSignal) => Promise<boolean>;
      enabled: () => boolean;
      localSeeds?: string[];
      transport?: FipsTransport;
      changed?: (stats: FipsStats) => void;
    },
  ) {}
  stats(): FipsStats {
    const s = this.transport?.client.status() ?? this.finalTransportStatus;
    return {
      ...this.counters,
      networkRequests: (s?.requests ?? 0) + (s?.rpcRequests ?? 0),
      fipsBytes: s?.bytesReceived ?? 0,
      activeTransfers: this.lifetime.signal.aborted ? 0 : (s?.activeTransfers ?? 0),
      queuedTransfers: this.lifetime.signal.aborted ? 0 : (s?.queuedTransfers ?? 0),
      retries: s?.retries ?? 0,
      failovers: s?.failovers ?? 0,
    };
  }
  /** Shell-only state; do not add this to the experimental app-facing wire API. */
  dashboardSnapshot(): FipsSessionSnapshot {
    const stats = this.stats();
    const transport = this.transport?.client.diagnostics?.() ??
      this.finalTransportSnapshot ?? {
        seedGroups: this.transport?.client.status().connections ?? 0,
        connectedPeers: 0,
        openSeedSockets: 0,
        connectionAttempts: 0,
        reconnects: 0,
        wireBytesReceived: 0,
        wireBytesSent: 0,
      };
    return {
      state: this.lifetime.signal.aborted
        ? 'closed'
        : this.opening || this.operationApprovals
          ? 'approving'
          : stats.activeTransfers || stats.queuedTransfers
            ? transport.connectedPeers
              ? 'transferring'
              : 'connecting'
            : transport.connectedPeers
              ? 'connected'
              : 'idle',
      stats,
      pendingRequests: this.pending + (this.opening ? 1 : 0),
      cacheBytes: this.cacheBytes,
      cacheEntries: this.cache.size,
      transport,
      grants: [...this.grants].map(([id, grant]) => ({
        id,
        root: grant.descriptor.root,
        bytes: grant.descriptor.bytes,
        expires: grant.descriptor.expires,
        operationsAllowed: !!grant.rpcAllowed,
        providers: grant.descriptor.providers.map((provider) => ({
          peerId: provider.peerId,
          // Queries, fragments and paths can contain credentials or app data.
          seeds: [...new Set(provider.seedUrls.map((seed) => new URL(seed).origin))],
        })),
      })),
    };
  }
  clearCache() {
    this.cache.clear();
    this.cacheBytes = 0;
    this.emit();
  }
  private emit() {
    this.options.changed?.(this.stats());
  }
  private trackCancellation(signal: AbortSignal) {
    // Abort listeners run synchronously, so a teardown receipt includes cancelled
    // work before its promise catch/finally handlers have had a chance to run.
    const count = () => {
      this.counters.cancelledRequests++;
      this.emit();
    };
    signal.addEventListener('abort', count, { once: true });
    return () => signal.removeEventListener('abort', count);
  }
  private client() {
    return (this.transport ??= this.options.transport
      ? {
          client: this.options.transport,
          release: () => {
            void this.options.transport!.stop();
          },
        }
      : (() => {
          const client = new FipsClient();
          return {
            client,
            release: () => {
              void client.stop().catch(() => {});
            },
          };
        })()).client;
  }
  private check() {
    this.lifetime.signal.throwIfAborted();
    if (!this.options.enabled())
      throw new Error('FIPS resources are disabled in shell network settings');
  }
  private grant(id: string) {
    this.check();
    const g = this.grants.get(id);
    if (g && g.descriptor.expires * 1000 <= Date.now()) this.release(id);
    if (!g || g.abort.signal.aborted)
      throw new Error('Resource grant expired or revoked. Refresh and approve this root again.');
    return g;
  }
  async open(raw: unknown, signal?: AbortSignal) {
    this.check();
    const roots = parseRoots(raw, this.options.localSeeds);
    if (this.opening || this.grants.size + roots.length > 32)
      throw new Error('Too many root grants or an approval is already open');
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const untrack = this.trackCancellation(combined);
    this.opening = true;
    this.emit();
    try {
      const description =
        `Read ${roots.length} immutable resource root(s) over FIPS? No account or signing key is used. The shell verifies blocks; peers and seeds can observe connections.\n\n` +
        roots
          .map(
            (r) =>
              `Root ${r.root}\n${r.bytes.toLocaleString()} bytes (selective reads, not a full download)\n` +
              r.providers
                .map((p) => `Provider ${p.peerId}\nSeeds ${p.seedUrls.join(', ')}`)
                .join('\n'),
          )
          .join('\n\n');
      if (!(await this.options.approve(description, combined)))
        throw new Error('Resource access was not approved');
      combined.throwIfAborted();
      this.check();
      // Validate again after a slow approval: expiry cannot be extended by the dialog.
      parseRoots(roots, this.options.localSeeds);
      const ids = roots.map((descriptor) => {
        const id = crypto.randomUUID();
        this.grants.set(id, {
          descriptor,
          abort: new AbortController(),
          links: new Map([
            [
              descriptor.root,
              {
                type: descriptor.bytes <= descriptor.chunkBytes ? LinkType.Blob : LinkType.File,
                size: descriptor.bytes,
                depth: 0,
              },
            ],
          ]),
        });
        this.proofLinks++;
        return id;
      });
      this.scheduleExpiry();
      return ids;
    } finally {
      untrack();
      this.opening = false;
      this.emit();
    }
  }
  private scheduleExpiry() {
    clearTimeout(this.timer);
    if (!this.grants.size) return;
    const next = Math.min(...[...this.grants.values()].map((g) => g.descriptor.expires * 1000));
    this.timer = setTimeout(
      () => {
        for (const [id, g] of this.grants)
          if (g.descriptor.expires * 1000 <= Date.now()) this.release(id);
        this.scheduleExpiry();
      },
      Math.max(1, Math.min(2147483647, next - Date.now())),
    );
  }
  private async run<T>(
    id: string,
    signal: AbortSignal | undefined,
    action: (g: Grant, signal: AbortSignal) => Promise<T>,
  ) {
    const g = this.grant(id);
    if (this.pending >= 128)
      throw new Error('Resource queue is full. Retry missing data after current reads finish.');
    const combined = AbortSignal.any([
      this.lifetime.signal,
      g.abort.signal,
      AbortSignal.timeout(FIPS_TIMEOUT_MS),
      ...(signal ? [signal] : []),
    ]);
    combined.throwIfAborted();
    const untrack = this.trackCancellation(combined);
    this.pending++;
    this.emit();
    try {
      const value = await abortable(action(g, combined), combined);
      combined.throwIfAborted();
      this.grant(id);
      return value;
    } catch (error) {
      if (!combined.aborted) this.counters.errors++;
      throw error;
    } finally {
      untrack();
      this.pending--;
      this.emit();
    }
  }
  async bytes(id: string, hash: string, signal?: AbortSignal) {
    const g = this.grant(id),
      link = g.links.get(hash);
    if (!/^[a-f0-9]{64}$/.test(hash) || !link)
      throw new Error('Block is not a verified descendant of the approved root');
    return this.run(id, signal, async (_, signal) => {
      // Authority and membership are checked before every cache lookup.
      const key = hash,
        hit = this.cache.get(key);
      if (hit) {
        this.children(g, link, hit);
        this.counters.cacheHits++;
        this.cache.delete(key);
        this.cache.set(key, hit);
        return hit.slice();
      }
      const bytes = await this.client().fetchBlob(hash, g.descriptor.providers, signal);
      signal.throwIfAborted();
      this.grant(id);
      if (!bytes) throw new Error('None of the approved providers has this block');
      if (bytes.length > FIPS_BLOCK_BYTES) throw new Error('Resource block exceeds 2 MiB');
      const digest = toHex(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
      );
      signal.throwIfAborted();
      this.grant(id);
      if (digest !== hash) throw new Error('Resource block failed SHA-256 verification');
      this.children(g, link, bytes);
      this.counters.verifiedBlobs++;
      const saved = bytes.slice();
      this.cacheBytes -= this.cache.get(key)?.length ?? 0;
      this.cache.delete(key);
      this.cache.set(key, saved);
      this.cacheBytes += saved.length;
      while (this.cacheBytes > FIPS_CACHE_BYTES) {
        const oldest = this.cache.keys().next().value!;
        this.cacheBytes -= this.cache.get(oldest)!.length;
        this.cache.delete(oldest);
      }
      return saved.slice();
    });
  }
  private children(g: Grant, parent: Link, bytes: Uint8Array) {
    if (parent.type === LinkType.Blob) {
      if (bytes.length !== parent.size || bytes.length > g.descriptor.chunkBytes)
        throw new Error('Hashtree leaf length mismatch');
      return;
    }
    const node = decodeTreeNode(bytes);
    if (
      parent.depth >= 16 ||
      node.type !== LinkType.File ||
      !node.links.length ||
      node.links.length > 128
    )
      throw new Error('Unsupported Hashtree file node');
    let total = 0;
    const children = new Map<string, Link>();
    for (const link of node.links) {
      if (
        !(link.hash instanceof Uint8Array) ||
        link.hash.length !== 32 ||
        link.key ||
        link.name !== undefined ||
        ![LinkType.Blob, LinkType.File].includes(link.type) ||
        !Number.isSafeInteger(link.size) ||
        link.size <= 0
      )
        throw new Error('Invalid Hashtree file link');
      total += link.size;
      if (!Number.isSafeInteger(total) || total > parent.size)
        throw new Error('Hashtree subtree length mismatch');
      const hash = toHex(link.hash),
        old = g.links.get(hash) ?? children.get(hash);
      if (old && (old.type !== link.type || old.size !== link.size))
        throw new Error('Conflicting Hashtree file link');
      children.set(hash, { type: link.type, size: link.size, depth: parent.depth + 1 });
    }
    if (total !== parent.size) throw new Error('Hashtree subtree length mismatch');
    const additions = [...children.keys()].filter((h) => !g.links.has(h)).length;
    if (this.proofLinks + additions > 1_000_000)
      throw new Error('Resource proof budget reached; close unused roots');
    for (const [h, l] of children) if (!g.links.has(h)) g.links.set(h, l);
    this.proofLinks += additions;
  }
  async request(id: string, operation: FipsOperation, signal?: AbortSignal) {
    const g = this.grant(id);
    if (!operation || Object.keys(operation).some((k) => !['path', 'method', 'body'].includes(k)))
      throw new Error('Invalid root-pinned operation');
    const request = validateRpcRequest({ ...operation, root: g.descriptor.root });
    const op = request.path.replace(/^members\/m[0-9]{1,3}\//, '');
    if (
      request.method === 'GET'
        ? op !== 'capabilities' || request.body !== undefined
        : !['route', 'isochrone', 'search', 'reverse', 'peak', 'features', 'offline'].includes(op)
    )
      throw new Error('Operation is outside the Atlas v1 application profile');
    if (new TextEncoder().encode(JSON.stringify(request)).length > 16384)
      throw new Error('Operation request exceeds 16 KiB');
    const providers = g.descriptor.providers.filter((p) => p.rpcPort === 39019);
    const provider = providers.find((p) => p.peerId === (g.rpcPeer ?? providers[0]?.peerId));
    if (!provider) throw new Error('No approved operations provider');
    return this.run(id, signal, async (_, signal) => {
      if (!g.rpcAllowed) {
        this.operationApprovals++;
        this.emit();
        try {
          if (
            !(await this.options.approve(
              `Allow Atlas v1 map operations for root ${g.descriptor.root} at provider ${provider.peerId}? Requests stay pinned to this provider and are never replayed automatically.`,
              signal,
            ))
          )
            throw new Error('Map operation was not approved');
        } finally {
          this.operationApprovals--;
          this.emit();
        }
        signal.throwIfAborted();
        this.grant(id);
        g.rpcAllowed = true;
      }
      g.rpcPeer = provider.peerId;
      // A lost response may mean execution succeeded. Never try another provider.
      return this.client().request(provider, request, signal);
    });
  }
  release(id: string) {
    const g = this.grants.get(id);
    if (!g) return;
    g.abort.abort(cancelled());
    this.proofLinks -= g.links.size;
    this.grants.delete(id);
    // Retain verified bytes for a later explicitly approved reopen in this frame.
    // Root/descendant authority is always re-established before cache lookup.
    this.scheduleExpiry();
    this.emit();
  }
  close() {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort(cancelled());
    for (const id of this.grants.keys()) this.release(id);
    clearTimeout(this.timer);
    this.finalTransportStatus = this.transport?.client.status();
    const transport = this.dashboardSnapshot().transport;
    this.finalTransportSnapshot = {
      ...transport,
      seedGroups: 0,
      connectedPeers: 0,
      openSeedSockets: 0,
    };
    this.transport?.release();
    this.transport = undefined;
    this.cache.clear();
    this.cacheBytes = 0;
  }
}
