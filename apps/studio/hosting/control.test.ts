import { test, expect } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  NostrClientTransport,
  ApplesauceRelayPool,
  PrivateKeySigner,
  EncryptionMode,
} from '@contextvm/sdk';
import { matchFilters, verifyEvent, type Filter, type NostrEvent } from 'nostr-tools';
import { OwnerStudios, connectStudioControl } from './control';
import type { StudioSurface } from '../surface';

test('Studio CVM derives ownership from encrypted signed transport and rejects cross-owner reads and replay changes', async () => {
  type Socket = Bun.ServerWebSocket<{ subscriptions: Map<string, Filter[]> }>;
  const sockets = new Set<Socket>();
  const events: NostrEvent[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request, { data: { subscriptions: new Map() } })) return;
      return new Response('', { status: 400 });
    },
    websocket: {
      open(ws: Socket) {
        sockets.add(ws);
      },
      close(ws: Socket) {
        sockets.delete(ws);
      },
      message(ws: Socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'REQ') {
          const filters = message.slice(2);
          ws.data.subscriptions.set(message[1], filters);
          for (const event of events)
            if (matchFilters(filters, event)) ws.send(JSON.stringify(['EVENT', message[1], event]));
          ws.send(JSON.stringify(['EOSE', message[1]]));
        } else if (message[0] === 'CLOSE') ws.data.subscriptions.delete(message[1]);
        else if (message[0] === 'EVENT' && verifyEvent(message[1])) {
          const event = message[1];
          events.push(event);
          ws.send(JSON.stringify(['OK', event.id, true, '']));
          for (const peer of sockets)
            for (const [id, filters] of peer.data.subscriptions)
              if (matchFilters(filters, event)) peer.send(JSON.stringify(['EVENT', id, event]));
        }
      },
    },
  });

  const url = `ws://127.0.0.1:${relay.port}`;
  const signers = [new PrivateKeySigner(), new PrivateKeySigner(), new PrivateKeySigner()];
  const keys = await Promise.all(signers.map((s) => s.getPublicKey()));
  const hostSigner = new PrivateKeySigner(),
    hostPool = new ApplesauceRelayPool([url]);
  const pools = signers.map(() => new ApplesauceRelayPool([url]));
  const clients = signers.map(() => new Client({ name: 'studio-control-test', version: '1' }));
  const opened: string[] = [],
    ids = new Map<string, string>(),
    sends: string[] = [];
  const registry = new OwnerStudios(
    () => keys.slice(0, 2),
    async (owner) => {
      opened.push(owner);
      const id = crypto.randomUUID();
      ids.set(owner, id);
      const ensure = (value: string) => {
        if (value !== id) throw new Error('Project not found.');
      };
      return {
        state: async () => ({
          projects: [
            { id, title: owner, phase: 'ready', updatedAt: 'now', messages: [], activity: [] },
          ],
          model: 'fixture',
        }),
        send: async (projectId: string, prompt: string) => {
          ensure(projectId);
          sends.push(prompt);
        },
        file: async (projectId: string) => {
          ensure(projectId);
          return 'private source for ' + owner;
        },
        close: async () => {},
      } as unknown as StudioSurface;
    },
  );
  const server = await connectStudioControl(registry, {
    signer: hostSigner,
    relayHandler: hostPool,
  });
  const call = (
    client: number,
    operation: string,
    input: unknown,
    requestId = crypto.randomUUID(),
  ) =>
    clients[client].callTool({
      name: 'soy_studio_call',
      arguments: { requestId, operation, input },
      _meta: { clientPubkey: keys[1] },
    });
  try {
    for (let i = 0; i < clients.length; i++)
      await clients[i].connect(
        new NostrClientTransport({
          signer: signers[i],
          relayHandler: pools[i],
          serverPubkey: await hostSigner.getPublicKey(),
          encryptionMode: EncryptionMode.REQUIRED,
          logLevel: 'silent',
        }),
      );
    expect((await call(0, 'list', {})).isError).not.toBe(true);
    expect(opened).toEqual(['nostr:' + keys[0]]);
    expect((await call(1, 'list', {})).isError).not.toBe(true);
    expect((await call(2, 'list', {})).isError).toBe(true);
    const a = ids.get('nostr:' + keys[0])!,
      b = ids.get('nostr:' + keys[1])!;
    expect((await call(0, 'file', { id: b, path: 'src/main.ts' })).isError).toBe(true);
    expect((await call(0, 'state', { id: b })).isError).toBe(true);
    expect((await call(0, 'state', { id: a })).isError).not.toBe(true);
    const requestId = crypto.randomUUID(),
      prompt = 'private prompt only our maker sees';
    expect((await call(0, 'send', { id: a, prompt }, requestId)).isError).not.toBe(true);
    expect((await call(0, 'send', { id: a, prompt }, requestId)).isError).not.toBe(true);
    expect(sends).toEqual([prompt]);
    expect((await call(0, 'send', { id: a, prompt: 'changed' }, requestId)).isError).toBe(true);
    expect((await call(0, 'send', { id: a, prompt, owner: keys[1] })).isError).toBe(true);
    expect(events.some((e) => e.content.includes(prompt))).toBe(false);
    expect(events.some((e) => e.content.includes('private source'))).toBe(false);
  } finally {
    await Promise.allSettled(clients.map((c) => c.close()));
    await server.close();
    await registry.close();
    await Promise.allSettled([...pools, hostPool].map((p) => p.disconnect()));
    relay.stop(true);
  }
}, 20000);
