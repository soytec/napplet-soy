import { expect, test } from 'bun:test';
import {
  FipsNode,
  generateIdentity,
  toHex,
  type Transport,
  type TransportAddress,
  type TransportContext,
} from '@fips/core';
import { sha256, type Hash } from '@hashtree/core';
import { TcpBlobTransport } from './vendor/tcpBlobTransport';

/** No sockets/relays: the real FMP/FSP/TCP stacks run over this deterministic carrier. */
class LocalCarrier implements Transport {
  readonly type = 'memory';
  readonly mtu = 65535;
  readonly maxFrameBytes = 66000;
  dropBodyPackets = false;
  dropAllPackets = false;
  private context?: TransportContext;
  private identity = '';
  private readonly deliveries = new Set<ReturnType<typeof setTimeout>>();
  constructor(private readonly peers: Map<string, LocalCarrier>) {}
  async start(context: TransportContext) {
    this.context = context;
    this.identity = toHex(context.localIdentity.publicKey);
    this.peers.set(this.identity, this);
  }
  async stop() {
    this.peers.delete(this.identity);
    for (const timer of this.deliveries) clearTimeout(timer);
    this.deliveries.clear();
  }
  async connect(address: TransportAddress) {
    if (!this.peers.has(address.addr)) throw new Error('Local peer is unavailable');
  }
  async send(address: TransportAddress, packet: Uint8Array) {
    // Auth/session/TCP control frames still flow, including the client's failure RST.
    if (this.dropAllPackets || (this.dropBodyPackets && packet.length > 800)) return;
    const target = this.peers.get(address.addr);
    if (!target?.context) throw new Error('Local peer stopped');
    const copy = packet.slice();
    const timer = setTimeout(() => {
      this.deliveries.delete(timer);
      target.context?.onPacket({
        transportType: this.type,
        remoteAddr: { transport: this.type, addr: this.identity },
        data: copy,
        receivedAtMs: Date.now(),
      });
    }, 1);
    this.deliveries.add(timer);
  }
}

const discardStore = {
  get: async () => null,
  put: async () => false,
  has: async () => false,
  delete: async () => false,
};

// The package has no stream diagnostics API. Tests inspect retained buffers only;
// production transport code uses the public FipsTcpEndpoint abort/close methods.
type RetainedConnection = {
  sendQueue: number[];
  recvQueue: number[];
  unacked: Array<{ payload: Uint8Array }>;
  reassembly: Array<{ payload: Uint8Array }>;
};
function bufferedStreams(transport: object): number {
  const tcp = transport as unknown as {
    tcp: { stack: { connections: Map<number, RetainedConnection> } };
  };
  return [...tcp.tcp.stack.connections.values()].filter(
    (connection) =>
      connection.sendQueue.length ||
      connection.recvQueue.length ||
      connection.unacked.some((segment) => segment.payload.length) ||
      connection.reassembly.some((segment) => segment.payload.length),
  ).length;
}
async function waitUntil(check: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 1));
  expect(check()).toBe(true);
}

async function fixture() {
  const peers = new Map<string, LocalCarrier>();
  const providerCarrier = new LocalCarrier(peers);
  const clientCarrier = new LocalCarrier(peers);
  const providerIdentity = await generateIdentity();
  const providerId = toHex(providerIdentity.publicKey);
  const providerNode = new FipsNode({
    identity: providerIdentity,
    transports: [providerCarrier],
    forwarding: false,
  });
  const clientNode = new FipsNode({
    identity: await generateIdentity(),
    transports: [clientCarrier],
    forwarding: false,
  });
  const bytes = Uint8Array.from({ length: 128 * 1024 + 17 }, (_, index) => (index * 31 + 17) & 255);
  const hash = await sha256(bytes);
  let reads = 0;
  // Exercise the real provider and client wire stacks, including stream reset.
  const provider = new TcpBlobTransport({
    endpoint: providerNode,
    localStore: discardStore,
    timeoutMs: 2000,
    serveBlob: async (requested) => {
      reads++;
      return toHex(requested) === toHex(hash) ? bytes : null;
    },
  });
  const client = new TcpBlobTransport({
    endpoint: clientNode,
    localStore: discardStore,
    timeoutMs: 500,
    allowIncomingPeer: () => false,
  });
  try {
    await Promise.all([providerNode.start(), clientNode.start()]);
    await clientNode.connect({ transport: 'memory', addr: providerId });
  } catch (error) {
    await Promise.all([client.close(), provider.close()]);
    await Promise.all([clientNode.stop(), providerNode.stop()]);
    throw error;
  }
  return {
    client,
    provider,
    providerCarrier,
    providerId,
    bytes,
    hash,
    reads: () => reads,
    close: async () => {
      await Promise.all([client.close(), provider.close()]);
      await Promise.all([clientNode.stop(), providerNode.stop()]);
    },
  };
}

test('failed TCP blob reads release retained buffers before retry and recovery', async () => {
  const env = await fixture();
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      env.providerCarrier.dropBodyPackets = true;
      for (let failure = 0; failure < 2; failure++) {
        let caught: unknown;
        try {
          await env.client.get(env.hash, [env.providerId], 0);
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(AggregateError);
        const errors = (caught as AggregateError).errors;
        expect(errors.length).toBeGreaterThan(0);
        expect(
          errors.every(
            (error) => error instanceof Error && error.message === 'TCP/FIPS read timed out',
          ),
        ).toBe(true);
        await waitUntil(
          () => bufferedStreams(env.client) === 0 && bufferedStreams(env.provider) === 0,
        );
      }
      env.providerCarrier.dropBodyPackets = false;
      const received = await env.client.get(env.hash, [env.providerId], 0);
      expect(received).toEqual(env.bytes);
      expect(toHex(await sha256(received!))).toBe(toHex(env.hash));
      await waitUntil(
        () => bufferedStreams(env.client) === 0 && bufferedStreams(env.provider) === 0,
      );
    }
    // Two internal transport attempts per failed get, plus one successful recovery per cycle.
    expect(env.reads()).toBe(10);
  } finally {
    await env.close();
  }
}, 10000);

test('valid missing and complete verified responses remain readable', async () => {
  const env = await fixture();
  try {
    expect(await env.client.get(new Uint8Array(32) as Hash, [env.providerId], 0)).toBeNull();
    expect(await env.client.get(env.hash, [env.providerId], 0)).toEqual(env.bytes);
    await waitUntil(() => bufferedStreams(env.client) === 0 && bufferedStreams(env.provider) === 0);
    expect(env.reads()).toBe(2);
  } finally {
    await env.close();
  }
}, 5000);

test('a connected FIPS session recovers after inbound control and data packet loss', async () => {
  const env = await fixture();
  try {
    expect(await env.client.get(env.hash, [env.providerId], 0)).toEqual(env.bytes);
    env.providerCarrier.dropAllPackets = true;
    await expect(env.client.get(env.hash, [env.providerId], 0)).rejects.toBeInstanceOf(
      AggregateError,
    );
    env.providerCarrier.dropAllPackets = false;
    expect(await env.client.get(env.hash, [env.providerId], 0)).toEqual(env.bytes);
  } finally {
    await env.close();
  }
}, 5000);

test('transient blob polling failures do not escape the timer or stop later polls', async () => {
  const { TcpBlobTransport } = await import('./vendor/tcpBlobTransport');
  const { FipsNode, generateIdentity } = await import('@fips/core');
  const node = new FipsNode({
    identity: await generateIdentity(),
    transports: [new LocalCarrier(new Map())],
  });
  await node.start();
  const transport = new TcpBlobTransport({
    endpoint: node,
    localStore: discardStore,
  });
  const internal = transport as unknown as {
    tcp: { poll: () => Promise<void> };
  };
  const poll = internal.tcp.poll.bind(internal.tcp);
  let count = 0;
  let resolve!: () => void;
  const recovered = new Promise<void>((done) => {
    resolve = done;
  });
  internal.tcp.poll = async () => {
    if (++count === 1) throw new Error('temporary carrier send failure');
    await poll();
    resolve();
  };
  try {
    await recovered;
    expect(count).toBeGreaterThanOrEqual(2);
  } finally {
    internal.tcp.poll = poll;
    await transport.close();
    await node.stop();
  }
});
