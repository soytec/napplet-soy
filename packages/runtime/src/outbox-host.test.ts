import { expect, test } from 'bun:test';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { attachNappletHost } from './host';

test('host deduplicates publication dispatch and account changes cancel a late signer before relay writes', async () => {
  const globals = ['window', 'localStorage'] as const;
  const saved = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const sent: Record<string, unknown>[] = [];
  const source = { postMessage: (message: Record<string, unknown>) => sent.push(message) };
  let listener: (event: MessageEvent) => void = () => {};
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener(type: string, fn: typeof listener) {
        if (type === 'message') listener = fn;
      },
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {} });
  const key = new Uint8Array(32).fill(61),
    pubkey = getPublicKey(key);
  let signs = 0,
    writes = 0,
    signerFails = false;
  let reads = 0;
  let hold: Promise<void> | undefined;
  let release!: () => void;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      message(ws, raw) {
        const [type, value] = JSON.parse(String(raw));
        if (type === 'EVENT') {
          writes++;
          ws.send(JSON.stringify(['OK', value.id, true, '']));
        } else if (type === 'REQ') {
          reads++;
          ws.send(JSON.stringify(['EOSE', value]));
        }
      },
    },
  });
  const url = `ws://127.0.0.1:${relay.port}/`;
  const host = attachNappletHost({
    frame: { contentWindow: source } as unknown as HTMLIFrameElement,
    identity: 'verified-third-party',
    manifestId: 'a'.repeat(64),
    relays: [url],
    pubkey,
    sign: async (_, template) => {
      signs++;
      if (signerFails)
        throw new Error('Signer connection refused: ECONNREFUSED token=fixture-secret');
      await hold;
      return finalizeEvent(template, key);
    },
    prompt: (prompt) => {
      prompt?.answer(true);
    },
    files() {},
  });
  const deliver = (data: Record<string, unknown>) =>
    listener({ data, source, origin: 'null' } as unknown as MessageEvent);
  const until = async (predicate: () => boolean) => {
    for (let i = 0; i < 500; i++) {
      if (predicate()) return;
      await Bun.sleep(2);
    }
    throw new Error('Host fixture did not settle');
  };
  const message = {
    type: 'outbox.publish',
    id: 'same',
    event: { kind: 1, created_at: 1700000000, content: 'one request', tags: [] },
    options: { toOutbox: false, relays: [url] },
  };
  try {
    deliver({ type: 'shell.ready' });
    deliver(message);
    deliver(message);
    await until(() => sent.filter((value) => value.type === 'outbox.publish.result').length === 2);
    expect(signs).toBe(1);
    expect(writes).toBe(1);
    expect(
      sent.filter((value) => value.type === 'outbox.publish.result').map((value) => value.ok),
    ).toEqual([true, true]);
    deliver({ ...message, event: { ...message.event, content: 'changed' } });
    await until(() => sent.some((value) => String(value.error).includes('request-id-reused')));
    expect(signs).toBe(1);
    deliver({
      type: 'outbox.subscribe',
      id: 'subscribe',
      subId: 'stream',
      filters: { kinds: [1] },
    });
    await until(() => reads > 0);
    deliver({ type: 'outbox.close', id: 'close', subId: 'stream' });
    await until(() =>
      sent.some((value) => value.type === 'outbox.closed' && value.subId === 'stream'),
    );
    deliver({
      type: 'outbox.subscribe',
      id: 'invalid-subscribe',
      subId: 'invalid-stream',
      filters: { kinds: ['invalid'] },
    });
    await until(() =>
      sent.some((value) => value.type === 'outbox.closed' && value.subId === 'invalid-stream'),
    );
    await Bun.sleep(0);
    expect(
      sent.filter((value) => value.type === 'outbox.closed' && value.subId === 'invalid-stream'),
    ).toHaveLength(1);
    expect(
      sent.some((value) =>
        ['outbox.subscribe.result', 'outbox.close.result'].includes(String(value.type)),
      ),
    ).toBe(false);
    signerFails = true;
    deliver({ ...message, id: 'signer-failure' });
    await until(() => sent.some((value) => value.id === 'signer-failure'));
    const failure = sent.find((value) => value.id === 'signer-failure')!;
    expect(failure.error).toContain('ECONNREFUSED');
    expect(failure.error).not.toContain('fixture-secret');
    expect(writes).toBe(1);
    signerFails = false;
    hold = new Promise((resolve) => {
      release = resolve;
    });
    deliver({ ...message, id: 'late' });
    await until(() => signs === 3);
    host.updateIdentity(null);
    release();
    await Bun.sleep(25);
    expect(writes).toBe(1);
    expect(sent.some((value) => value.id === 'late' && value.ok === true)).toBe(false);
    // Malformed protected records cannot fall through to general signing.
    for (const kind of [30078, 35858, 5])
      deliver({ ...message, id: `protected-${kind}`, event: { ...message.event, kind } });
    await Bun.sleep(10);
    expect(signs).toBe(3);
  } finally {
    host.close();
    relay.stop(true);
    globals.forEach((key, i) => {
      if (saved[i]) Object.defineProperty(globalThis, key, saved[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
