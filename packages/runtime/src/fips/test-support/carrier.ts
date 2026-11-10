import { toHex, type Transport, type TransportAddress, type TransportContext } from '@fips/core';
export class MemoryCarrier implements Transport {
  readonly type = 'memory';
  readonly mtu = 65535;
  readonly maxFrameBytes = 66000;
  context?: TransportContext;
  identity = '';
  constructor(private peers: Map<string, MemoryCarrier>) {}
  async start(context: TransportContext) {
    this.context = context;
    this.identity = toHex(context.localIdentity.publicKey);
    this.peers.set(this.identity, this);
  }
  async stop() {
    this.peers.delete(this.identity);
    this.context = undefined;
  }
  async connect(address: TransportAddress) {
    if (!this.peers.has(address.addr)) throw new Error('Peer unavailable');
  }
  async send(address: TransportAddress, packet: Uint8Array) {
    const target = this.peers.get(address.addr);
    if (!target?.context) throw new Error('Peer stopped');
    const copy = packet.slice();
    queueMicrotask(() =>
      target.context?.onPacket({
        transportType: this.type,
        remoteAddr: { transport: this.type, addr: this.identity },
        data: copy,
        receivedAtMs: Date.now(),
      }),
    );
  }
}
