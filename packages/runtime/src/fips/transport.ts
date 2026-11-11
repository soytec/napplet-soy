import {
  FipsNode,
  generateIdentity,
  type Transport,
  type PeerEvent,
  type TransportAddress,
  type TransportContext,
} from '@fips/core';
import { WebSocketTransport } from '@fips/transport-websocket';
import { fromHex, toHex } from '@hashtree/core';
import type { FipsProvider } from './contract';
import { TcpBlobTransport } from './vendor/tcpBlobTransport';
import { abortable, FipsRpcEndpoint, type FipsRpcRequest, type FipsRpcResponse } from './rpc';
import type { FipsTransportSnapshot } from './dashboard';
export { FIPS_RPC_TIMEOUT_MS } from './rpc';
/** Includes waiting for transfer slots; per-attempt budgets remain 30 seconds. */
export const FIPS_REQUEST_TIMEOUT_MS = 20 * 60_000;
const discardStore = {
  get: async () => null,
  put: async () => false,
  has: async () => false,
  delete: async () => false,
};
class Queue {
  active = 0;
  private waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    signal?: AbortSignal;
    abort: () => void;
  }> = [];
  constructor(private limit = 2) {}
  acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.release());
    }
    if (this.waiting.length >= 128)
      return Promise.reject(new Error('FIPS transfer queue is full; retry missing data'));
    return new Promise((resolve, reject) => {
      const job = {
        resolve,
        reject,
        signal,
        abort: () => {
          this.waiting = this.waiting.filter((j) => j !== job);
          reject(signal?.reason);
        },
      };
      this.waiting.push(job);
      signal?.addEventListener('abort', job.abort, { once: true });
    });
  }
  private release() {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const next = this.waiting.shift();
      if (next) {
        next.signal?.removeEventListener('abort', next.abort);
        next.resolve(this.release());
      } else this.active--;
    };
  }
}
// One carrier budget across all frames; identity, deduplication and counters stay frame-scoped.
const transfers = new Queue();
/** Observe public transport events without inspecting upstream socket internals. */
class MonitoredWebSocketTransport extends WebSocketTransport {
  private readySeeds = new Set<string>();
  get readySeedCount() {
    return this.readySeeds.size;
  }
  override start(context: TransportContext) {
    return super.start({
      ...context,
      onConnectionState: (event) => {
        if (event.state === 'connected') this.readySeeds.add(event.remoteAddr.addr);
        else this.readySeeds.delete(event.remoteAddr.addr);
        context.onConnectionState?.(event);
      },
    });
  }
  override async stop() {
    this.readySeeds.clear();
    await super.stop();
  }
}
type Connection = {
  key: string;
  cached: Promise<Connection>;
  node: FipsNode;
  blobs: TcpBlobTransport;
  rpc: FipsRpcEndpoint;
  websocket?: MonitoredWebSocketTransport;
  peerId: string;
  peers: Map<string, string>;
  users: number;
  retired: boolean;
  closing?: Promise<void>;
};
export class FipsClient {
  private connections = new Map<string, Promise<Connection>>();
  private liveConnections = new Set<Connection>();
  private activeTransfers = 0;
  private queuedTransfers = 0;
  private async slot(signal: AbortSignal) {
    this.queuedTransfers++;
    let release: () => void;
    try {
      release = await transfers.acquire(signal);
    } finally {
      this.queuedTransfers--;
    }
    this.activeTransfers++;
    return () => {
      this.activeTransfers--;
      release();
    };
  }
  // Reads and operations share the same carrier budget.
  private inflight = new Map<
    string,
    {
      promise: Promise<Uint8Array | null>;
      abort: AbortController;
      waiters: number;
      settled: boolean;
    }
  >();
  private lifetime = new AbortController();
  private counters = {
    retries: 0,
    requests: 0,
    bytesReceived: 0,
    failovers: 0,
    rpcRequests: 0,
  };
  private closedCarrierCounters = {
    connectionAttempts: 0,
    reconnects: 0,
    wireBytesReceived: 0,
    wireBytesSent: 0,
  };
  constructor(
    private options: {
      transports?: (seedUrls: string[]) => Transport[];
      timeoutMs?: number;
      bootstrap?: TransportAddress[];
    } = {},
  ) {}
  private async connection(provider: FipsProvider): Promise<Connection> {
    if (
      (provider.servicePort ?? 39018) !== 39018 ||
      (provider.rpcPort !== undefined && provider.rpcPort !== 39019)
    )
      throw new Error('Unsupported FIPS service port');
    this.lifetime.signal.throwIfAborted();
    const seeds = [...new Set(provider.seedUrls)].sort();
    const key = JSON.stringify(seeds);
    let promise = this.connections.get(key);
    if (!promise) {
      if (this.connections.size >= 8) throw new Error('Too many independent FIPS seed groups');
      promise = (async () => {
        const identity = await generateIdentity();
        const custom = this.options.transports?.(seeds);
        const websocket = custom ? undefined : new MonitoredWebSocketTransport({ seedUrls: seeds });
        const node = new FipsNode({
          identity,
          transports: custom ?? [websocket!],
          forwarding: false,
          routingMode: 'reply_learned',
        });
        const peers = new Map<string, string>();
        node.on('peer', (raw) => {
          const event = raw as PeerEvent;
          const path = JSON.stringify([event.remoteAddr.transport, event.remoteAddr.addr]);
          if (event.state === 'connected') peers.set(path, event.remotePubkey);
          else if (event.state === 'disconnected') peers.delete(path);
        });
        const blobs = new TcpBlobTransport({
          endpoint: node,
          timeoutMs: this.options.timeoutMs ?? 30000,
          localStore: discardStore,
          allowIncomingPeer: () => false,
          maxBytes: 2 * 1024 ** 2,
        });
        const rpc = new FipsRpcEndpoint(node);
        try {
          await node.start();
          for (const address of this.options.bootstrap ?? []) await node.connect(address);
          this.lifetime.signal.throwIfAborted();
        } catch (error) {
          await Promise.all([blobs.close(), rpc.close()]);
          await node.stop();
          throw error;
        }
        const connection: Connection = {
          key,
          cached: promise!,
          node,
          blobs,
          rpc,
          websocket,
          peerId: toHex(identity.publicKey),
          peers,
          users: 0,
          retired: false,
        };
        this.liveConnections.add(connection);
        return connection;
      })();
      this.connections.set(key, promise);
      promise.catch(() => {
        if (this.connections.get(key) === promise) this.connections.delete(key);
      });
    }
    const connection = await promise;
    this.lifetime.signal.throwIfAborted();
    if (connection.retired) return this.connection(provider);
    connection.users++;
    return connection;
  }
  private closeConnection(connection: Connection) {
    return (connection.closing ??= (async () => {
      try {
        await Promise.all([connection.blobs.close(), connection.rpc.close()]);
      } finally {
        try {
          await connection.node.stop();
        } finally {
          const stats = connection.websocket?.stats();
          if (stats) {
            this.closedCarrierCounters.connectionAttempts += stats.connectionAttempts;
            this.closedCarrierCounters.reconnects += stats.reconnectsScheduled;
            this.closedCarrierCounters.wireBytesReceived += stats.bytesReceived;
            this.closedCarrierCounters.wireBytesSent += stats.bytesSent;
          }
          this.liveConnections.delete(connection);
        }
      }
    })());
  }
  private releaseConnection(connection: Connection) {
    connection.users--;
    if (connection.retired && !connection.users)
      void this.closeConnection(connection).catch(() => {});
  }
  private retireConnection(connection: Connection) {
    connection.retired = true;
    if (this.connections.get(connection.key) === connection.cached)
      this.connections.delete(connection.key);
    // Existing operations keep their session. Later reads get fresh routing and
    // handshake state; never replay or interrupt an in-flight stateful RPC.
  }
  async fetchBlob(
    hash: string,
    providers: readonly FipsProvider[],
    signal?: AbortSignal,
  ): Promise<Uint8Array | null> {
    if (!/^[a-f0-9]{64}$/.test(hash) || !providers.length)
      throw new Error('Missing FIPS blob identity or providers');
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    combined.throwIfAborted();
    const key = hash + JSON.stringify(providers);
    let task = this.inflight.get(key);
    if (!task) {
      const abort = new AbortController();
      const taskSignal = AbortSignal.any([this.lifetime.signal, abort.signal]);
      // Keep shared work only while at least one caller still wants it. A queued
      // tile from an abandoned viewport must not delay the current viewport.
      const promise = (async () => {
        const release = await this.slot(taskSignal);
        const errors: unknown[] = [];
        let missing = 0;
        try {
          for (const provider of providers) {
            taskSignal.throwIfAborted();
            let connection: Connection | undefined;
            try {
              connection = await this.connection(provider);
              taskSignal.throwIfAborted();
              this.counters.requests++;
              const bytes = await this.readFromProvider(
                connection.blobs,
                hash,
                provider.peerId,
                taskSignal,
              );
              if (bytes === null) {
                missing++;
                continue;
              }
              if (bytes.length > 2 * 1024 ** 2) throw new Error('Oversized resource block');
              // TcpBlobTransport verifies the hash before returning; HashtreeSource verifies again before persistent caching.
              this.counters.bytesReceived += bytes.length;
              return bytes;
            } catch (error) {
              taskSignal.throwIfAborted();
              if (connection && isRetryableFipsError(error)) this.retireConnection(connection);
              errors.push(error);
              this.counters.failovers++;
            } finally {
              if (connection) this.releaseConnection(connection);
            }
          }
          if (missing === providers.length) return null;
          throw new AggregateError(
            errors,
            'All FIPS providers failed for this blob: ' +
              errors.map(safeCause).join('; ').slice(0, 700),
          );
        } finally {
          release();
        }
      })();
      task = { promise, abort, waiters: 0, settled: false };
      this.inflight.set(key, task);
      const current = task;
      void promise
        .finally(() => {
          current.settled = true;
          if (this.inflight.get(key) === current) this.inflight.delete(key);
        })
        .catch(() => {});
    }
    task.waiters++;
    try {
      return await abortable(task.promise, combined);
    } finally {
      task.waiters--;
      if (!task.waiters && !task.settled) {
        task.abort.abort(new DOMException('Map read is no longer requested', 'AbortError'));
        if (this.inflight.get(key) === task) this.inflight.delete(key);
      }
    }
  }
  private async readFromProvider(
    blobs: TcpBlobTransport,
    hash: string,
    peerId: string,
    signal: AbortSignal,
  ) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try {
        // Abandon only this stream when its last waiter leaves; retain other reads.
        const bytes = await blobs.get(fromHex(hash), [peerId], 0, signal);
        signal.throwIfAborted();
        return bytes;
      } catch (error) {
        if (attempt >= 1 || !isRetryableFipsError(error) || signal.aborted) throw error;
        this.counters.retries++;
        await abortable(new Promise<void>((resolve) => setTimeout(resolve, 750)), signal);
      }
    }
  }
  async request(
    provider: FipsProvider,
    request: FipsRpcRequest,
    signal?: AbortSignal,
  ): Promise<FipsRpcResponse> {
    if (!provider.rpcPort)
      throw new Error('This FIPS provider does not advertise server operations');
    const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
    const release = await this.slot(combined);
    let connection: Connection | undefined;
    try {
      connection = await this.connection(provider);
      this.counters.rpcRequests++;
      return await connection.rpc.request(provider.peerId, request, combined);
    } finally {
      if (connection) this.releaseConnection(connection);
      release();
    }
  }
  status() {
    return {
      ...this.counters,
      activeTransfers: this.activeTransfers,
      queuedTransfers: this.queuedTransfers,
      connections: this.connections.size,
    };
  }
  /** Host-only carrier counters: no transport identity, packets or destination URLs. */
  diagnostics(): FipsTransportSnapshot {
    const result = {
      ...this.closedCarrierCounters,
      seedGroups: this.connections.size,
      connectedPeers: 0,
      openSeedSockets: 0,
    };
    const peers = new Set<string>();
    for (const connection of this.liveConnections) {
      if (!connection.closing) for (const peer of connection.peers.values()) peers.add(peer);
      const stats = connection.websocket?.stats();
      if (stats) {
        if (!connection.closing) result.openSeedSockets += connection.websocket!.readySeedCount;
        result.connectionAttempts += stats.connectionAttempts;
        result.reconnects += stats.reconnectsScheduled;
        result.wireBytesReceived += stats.bytesReceived;
        result.wireBytesSent += stats.bytesSent;
      }
    }
    result.connectedPeers = peers.size;
    return result;
  }
  async stop() {
    this.lifetime.abort(new Error('FIPS client closed'));
    await Promise.all([...this.connections.values()].map((task) => task.catch(() => undefined)));
    await Promise.all(
      [...this.liveConnections].map((connection) => this.closeConnection(connection)),
    );
    this.connections.clear();
  }
}
/** Only transient TCP failures are retried, never authenticated missing/corrupt data. */
export function isRetryableFipsError(error: unknown): boolean {
  if (error instanceof AggregateError)
    return error.errors.length > 0 && error.errors.every(isRetryableFipsError);
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' ||
      /TCP\/FIPS (?:connect|read|write) timed out/.test(error.message))
  );
}

function safeCause(error: unknown): string {
  if (error instanceof AggregateError) return error.errors.map(safeCause).join('; ');
  return error instanceof Error ? error.message : 'Transport failed';
}
