import { expect, test } from 'bun:test';
import {
  FipsNode,
  generateIdentity,
  toHex,
  type Transport,
  type TransportAddress,
  type TransportContext,
} from '@fips/core';
import { TcpBlobTransport } from './vendor/tcpBlobTransport';
import { FipsRpcEndpoint } from './rpc';
import { FipsClient } from './transport';
import { MemoryCarrier } from './test-support/carrier';
const store = {
  get: async () => null,
  put: async () => false,
  has: async () => false,
  delete: async () => false,
};
const digest = async (b: Uint8Array) =>
  toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(b))));
async function provider(
  peers: Map<string, MemoryCarrier>,
  read: (hash: string, signal: AbortSignal) => Promise<Uint8Array | null>,
  rpc?: ConstructorParameters<typeof FipsRpcEndpoint>[1],
) {
  const identity = await generateIdentity(),
    peerId = toHex(identity.publicKey);
  const node = new FipsNode({
    identity,
    transports: [new MemoryCarrier(peers)],
    forwarding: false,
    routingMode: 'reply_learned',
  });
  const blobs = new TcpBlobTransport({
    endpoint: node,
    localStore: store,
    timeoutMs: 2000,
    serveBlob: (h, _p, s) => read(toHex(h), s),
  });
  const operations = new FipsRpcEndpoint(node, rpc);
  await node.start();
  return {
    peerId,
    descriptor: { peerId, seedUrls: ['wss://fixture.example/fips'], rpcPort: 39019 },
    async close() {
      await Promise.all([blobs.close(), operations.close()]);
      await node.stop();
    },
  };
}
test('real FIPS stacks deduplicate overlapping bytes, fail over and preserve JSON/binary RPC status and snapshot', async () => {
  const peers = new Map<string, MemoryCarrier>(),
    bytes = new Uint8Array(96 * 1024).fill(23),
    hash = await digest(bytes);
  let reads = 0,
    rpcCalls = 0;
  const missing = await provider(peers, async () => null);
  const serving = await provider(
    peers,
    async (h) => {
      reads++;
      return h === hash ? bytes : null;
    },
    async (request) => {
      rpcCalls++;
      return {
        status: 206,
        headers: { 'x-atlas-snapshot': request.root },
        ...(request.path === 'offline'
          ? { bytes: new Uint8Array([0, 255, 33]) }
          : { body: { root: request.root } }),
      };
    },
  );
  const client = new FipsClient({
    transports: () => [new MemoryCarrier(peers)],
    bootstrap: [missing, serving].map((p) => ({ transport: 'memory', addr: p.peerId })),
    timeoutMs: 2000,
  });
  try {
    const providers = [missing.descriptor, serving.descriptor];
    const [a, b] = await Promise.all([
      client.fetchBlob(hash, providers),
      client.fetchBlob(hash, providers),
    ]);
    expect(a).toEqual(bytes);
    expect(b).toEqual(bytes);
    expect(reads).toBe(1);
    const json = await client.request(serving.descriptor, {
      root: hash,
      path: 'capabilities',
      method: 'GET',
    });
    expect(json.status).toBe(206);
    expect(json.body).toEqual({ root: hash });
    const binary = await client.request(serving.descriptor, {
      root: hash,
      path: 'offline',
      method: 'POST',
      body: {},
    });
    expect(binary.bytes).toEqual(new Uint8Array([0, 255, 33]));
    expect(rpcCalls).toBe(2);
    expect(client.status().activeTransfers).toBe(0);
    expect(client.diagnostics()).toMatchObject({
      seedGroups: 1,
      connectedPeers: 2,
      openSeedSockets: 0,
    });
    expect(JSON.stringify(client.diagnostics())).not.toContain(serving.peerId);
  } finally {
    await client.stop();
    expect(client.diagnostics()).toMatchObject({
      seedGroups: 0,
      connectedPeers: 0,
      openSeedSockets: 0,
    });
    await serving.close();
    await missing.close();
  }
}, 20000);
test('cancelling the last waiter resets its TCP stream and releases queue capacity without closing other reads', async () => {
  const peers = new Map<string, MemoryCarrier>(),
    slow = new Uint8Array(1024).fill(7),
    fast = new Uint8Array(1024).fill(8);
  const slowHash = await digest(slow),
    fastHash = await digest(fast);
  let requested = 0;
  const server = await provider(peers, async (h, signal) => {
    requested++;
    if (h === fastHash) return fast;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(slow), 1500);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve(null);
        },
        { once: true },
      );
    });
  });
  const client = new FipsClient({
    transports: () => [new MemoryCarrier(peers)],
    bootstrap: [{ transport: 'memory', addr: server.peerId }],
    timeoutMs: 2000,
  });
  try {
    const cancel = new AbortController();
    const pending = client.fetchBlob(slowHash, [server.descriptor], cancel.signal).then(
      () => false,
      () => true,
    );
    for (let i = 0; i < 200 && !requested; i++) await Bun.sleep(5);
    cancel.abort(new DOMException('Viewport moved', 'AbortError'));
    expect(await pending).toBe(true);
    expect(await client.fetchBlob(fastHash, [server.descriptor])).toEqual(fast);
    for (let i = 0; i < 100 && client.status().activeTransfers; i++) await Bun.sleep(5);
    expect(client.status().activeTransfers).toBe(0);
    expect(client.status().retries).toBe(0);
  } finally {
    await client.stop();
    await server.close();
  }
}, 10000);

test('dashboard keeps an authenticated peer connected when one of its carrier paths disconnects', async () => {
  class PathCarrier implements Transport {
    readonly mtu = 65535;
    readonly maxFrameBytes = 66000;
    private carrier: MemoryCarrier;
    private context?: TransportContext;
    constructor(
      readonly type: string,
      peers: Map<string, MemoryCarrier>,
    ) {
      this.carrier = new MemoryCarrier(peers);
    }
    start(context: TransportContext) {
      this.context = context;
      return this.carrier.start({
        ...context,
        onPacket: (packet) =>
          context.onPacket({
            ...packet,
            transportType: this.type,
            remoteAddr: { ...packet.remoteAddr, transport: this.type },
          }),
      });
    }
    stop() {
      return this.carrier.stop();
    }
    connect(address: TransportAddress) {
      return this.carrier.connect(address);
    }
    send(address: TransportAddress, packet: Uint8Array) {
      return this.carrier.send(address, packet);
    }
    disconnect(peerId: string) {
      this.context?.onConnectionState?.({
        remoteAddr: { transport: this.type, addr: peerId },
        state: 'disconnected',
      });
      return this.stop();
    }
  }
  const identity = await generateIdentity(),
    peerId = toHex(identity.publicKey);
  const paths = [new Map<string, MemoryCarrier>(), new Map<string, MemoryCarrier>()];
  const node = new FipsNode({
    identity,
    transports: paths.map((peers, i) => new PathCarrier(`path-${i}`, peers)),
    forwarding: false,
    routingMode: 'reply_learned',
  });
  const bytes = new Uint8Array(1024).fill(31),
    hash = await digest(bytes);
  const blobs = new TcpBlobTransport({
    endpoint: node,
    localStore: store,
    timeoutMs: 2000,
    serveBlob: async () => bytes,
  });
  await node.start();
  const carriers = paths.map((peers, i) => new PathCarrier(`path-${i}`, peers));
  const client = new FipsClient({
    transports: () => carriers,
    bootstrap: carriers.map((carrier) => ({ transport: carrier.type, addr: peerId })),
    timeoutMs: 2000,
  });
  try {
    const descriptor = { peerId, seedUrls: ['wss://fixture.example/fips'] };
    expect(await client.fetchBlob(hash, [descriptor])).toEqual(bytes);
    expect(client.diagnostics()).toMatchObject({
      seedGroups: 1,
      connectedPeers: 1,
      openSeedSockets: 0,
    });
    await carriers[0]!.disconnect(peerId);
    expect(client.diagnostics().connectedPeers).toBe(1);
    expect(await client.fetchBlob(hash, [descriptor])).toEqual(bytes);
    await carriers[1]!.disconnect(peerId);
    expect(client.diagnostics().connectedPeers).toBe(0);
    await client.stop();
    expect(client.diagnostics()).toMatchObject({
      connectedPeers: 0,
      openSeedSockets: 0,
      seedGroups: 0,
    });
  } finally {
    await client.stop();
    await blobs.close();
    await node.stop();
  }
}, 10000);

test('frames share a two-transfer budget but never expose another frame’s counters or connections', async () => {
  const peers = new Map<string, MemoryCarrier>(),
    payload = new Uint8Array(1024).fill(9),
    hash = await digest(payload);
  const pending: (() => void)[] = [];
  const server = await provider(peers, async () => {
    await new Promise<void>((resolve) => pending.push(resolve));
    return payload;
  });
  const clients = Array.from(
    { length: 3 },
    () =>
      new FipsClient({
        transports: () => [new MemoryCarrier(peers)],
        bootstrap: [{ transport: 'memory', addr: server.peerId }],
        timeoutMs: 2000,
      }),
  );
  try {
    const reads = clients.map((client) => client.fetchBlob(hash, [server.descriptor]));
    for (let i = 0; i < 100 && pending.length < 2; i++) await Bun.sleep(5);
    expect(pending).toHaveLength(2);
    expect(clients.map((c) => c.status().activeTransfers)).toEqual([1, 1, 0]);
    expect(clients[2]!.status()).toMatchObject({
      requests: 0,
      bytesReceived: 0,
      connections: 0,
      queuedTransfers: 1,
    });
    for (const resolve of pending.splice(0)) resolve();
    await Promise.all(reads.slice(0, 2));
    for (let i = 0; i < 100 && pending.length < 1; i++) await Bun.sleep(5);
    expect(pending).toHaveLength(1);
    for (const resolve of pending.splice(0)) resolve();
    await Promise.all(reads);
    for (const client of clients)
      expect(client.status()).toMatchObject({
        requests: 1,
        bytesReceived: 1024,
        activeTransfers: 0,
        queuedTransfers: 0,
      });
  } finally {
    for (const resolve of pending.splice(0)) resolve();
    await Promise.all(clients.map((client) => client.stop()));
    await server.close();
  }
}, 10000);

test('retry after an exhausted carrier gets a fresh connection without aborting an in-flight operation', async () => {
  class InterruptedCarrier extends MemoryCarrier {
    interrupted = false;
    override async send(address: TransportAddress, packet: Uint8Array) {
      if (!this.interrupted) await super.send(address, packet);
    }
  }
  const peers = new Map<string, MemoryCarrier>();
  const bytes = new Uint8Array(1024).fill(29);
  const hash = await digest(bytes);
  const operationStarted = Promise.withResolvers<void>();
  const completeOperation = Promise.withResolvers<void>();
  let rpcCalls = 0;
  const server = await provider(
    peers,
    async () => bytes,
    async () => {
      rpcCalls++;
      operationStarted.resolve();
      await completeOperation.promise;
      return { status: 200, body: { completed: true } };
    },
  );
  const carriers: InterruptedCarrier[] = [];
  const client = new FipsClient({
    transports: () => {
      const carrier = new InterruptedCarrier(peers);
      carriers.push(carrier);
      return [carrier];
    },
    bootstrap: [{ transport: 'memory', addr: server.peerId }],
    timeoutMs: 500,
  });
  try {
    expect(await client.fetchBlob(hash, [server.descriptor])).toEqual(bytes);
    const operation = client.request(server.descriptor, {
      root: hash,
      path: 'offline',
      method: 'POST',
    });
    void operation.catch(() => {});
    await operationStarted.promise;
    carriers[0]!.interrupted = true;
    await expect(client.fetchBlob(hash, [server.descriptor])).rejects.toBeInstanceOf(
      AggregateError,
    );
    // A user retry must replace the unusable carrier, not repeat the same failed session.
    expect(await client.fetchBlob(hash, [server.descriptor])).toEqual(bytes);
    expect(carriers).toHaveLength(2);
    completeOperation.resolve();
    expect((await operation).body).toEqual({ completed: true });
    expect(rpcCalls).toBe(1);
    expect(client.status().activeTransfers).toBe(0);
  } finally {
    completeOperation.resolve();
    await client.stop();
    await server.close();
  }
}, 10000);
