import { WebSocketServer, type WebSocket } from 'ws';
import { once } from 'node:events';
import type { Transport, TransportAddress, TransportContext } from '@fips/core';
import { decodeLocalKeyHint, encodeLocalKeyHintResponse } from '@fips/transport-websocket';
/** An isolated, authenticated FIPS peer reached with the real browser carrier. */
export class WebSocketCarrier implements Transport {
  readonly type = 'websocket';
  readonly mtu = 1400;
  readonly maxFrameBytes = 66000;
  private context?: TransportContext;
  private sockets = new Map<string, WebSocket>();
  private server?: WebSocketServer;
  url = '';
  async start(context: TransportContext) {
    this.context = context;
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(this.server, 'listening');
    this.url = `ws://127.0.0.1:${(this.server.address() as { port: number }).port}/fips`;
    this.server.on('connection', (socket) => {
      const id = crypto.randomUUID();
      this.sockets.set(id, socket);
      socket.on('message', (raw) => {
        const data = new Uint8Array(raw as Buffer),
          hint = decodeLocalKeyHint(data);
        if (hint?.kind === 'request')
          socket.send(encodeLocalKeyHintResponse(hint.nonce, context.localIdentity.xOnlyPubkey));
        else
          this.context?.onPacket({
            transportType: this.type,
            remoteAddr: { transport: this.type, addr: id },
            data,
            receivedAtMs: Date.now(),
          });
      });
      socket.on('close', () => {
        this.sockets.delete(id);
        context.onConnectionState?.({
          remoteAddr: { transport: this.type, addr: id },
          state: 'disconnected',
        });
      });
    });
  }
  async connect(address: TransportAddress) {
    if (!this.sockets.has(address.addr)) throw new Error('Peer closed');
  }
  async send(address: TransportAddress, packet: Uint8Array) {
    const socket = this.sockets.get(address.addr);
    if (!socket) throw new Error('Peer closed');
    socket.send(packet);
  }
  async stop() {
    this.context = undefined;
    for (const socket of this.sockets.values()) socket.terminate();
    this.sockets.clear();
    if (this.server) await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
  disconnect() {
    for (const socket of this.sockets.values()) socket.terminate();
  }
}
