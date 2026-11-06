import { expect, test } from 'bun:test';
import { attachNappletHost } from './host';
import { IntentWorkspace } from './intent-session';
import { fakeNappletFrame, fakeShellWindow, withGlobals } from './host-test-support';

test('bound host replies with official invoke result and cold delivery follows target shell init', async () => {
  const shell = fakeShellWindow();
  const restore = withGlobals({ window: shell.window, localStorage: {} });
  const workspace = new IntentWorkspace({ choose: async () => null, launch: async () => {} });
  workspace.register({ id: 'attested-source', contracts: [] });
  workspace.register({
    id: 'editor',
    contracts: [{ convention: 'napplet:black-site/map-edit', params: ['address'] }],
  });
  const source = fakeNappletFrame(shell),
    target = fakeNappletFrame(shell);
  const sentSource = source.sent,
    sentTarget = target.sent;
  const make = (endpoint: typeof source, id: string) =>
    attachNappletHost({
      frame: endpoint.frame,
      identity: id,
      manifestId: 'a'.repeat(64),
      relays: [],
      pubkey: null,
      prompt: () => {},
      files: () => {},
      intent: { workspace, catalogId: id },
    });
  const deliver = (endpoint: typeof source, data: Record<string, unknown>) =>
    endpoint.deliver(data);
  let sourceHost: ReturnType<typeof attachNappletHost> | undefined,
    targetHost: ReturnType<typeof attachNappletHost> | undefined;
  try {
    sourceHost = make(source, 'attested-source');
    source.hello();
    deliver(source, { type: 'shell.ready' });
    deliver(source, {
      type: 'intent.invoke',
      id: 'call',
      request: {
        archetype: 'black-site',
        action: 'map-edit',
        convention: 'napplet:black-site/map-edit',
        payload: { address: 'one' },
        sender: 'forged',
      },
    });
    await Bun.sleep(5);
    expect(sentSource.at(-1)).toEqual({
      type: 'intent.invoke.result',
      id: 'call',
      result: {
        ok: true,
        archetype: 'black-site',
        action: 'map-edit',
        convention: 'napplet:black-site/map-edit',
        handler: 'editor',
      },
    });
    sourceHost.close();
    targetHost = make(target, 'editor');
    target.hello();
    expect(sentTarget).toEqual([]);
    deliver(target, { type: 'shell.ready' });
    expect(sentTarget.map((m) => m.type)).toEqual([
      'shell.init',
      'intent.deliver',
      'keys.bindings',
    ]);
    expect(sentTarget.find((message) => message.type === 'intent.deliver')).toEqual({
      type: 'intent.deliver',
      delivery: {
        sender: 'attested-source',
        archetype: 'black-site',
        action: 'map-edit',
        convention: 'napplet:black-site/map-edit',
        payload: { address: 'one' },
      },
    });
  } finally {
    sourceHost?.close();
    targetHost?.close();
    restore();
  }
});

test('bound host delivers structured payloads and returns correlated limit errors', async () => {
  const napplet = fakeNappletFrame();
  const restore = withGlobals({ window: napplet.window, localStorage: {} });
  const workspace = new IntentWorkspace({ choose: async () => null, launch: async () => {} });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register({
    id: 'target',
    contracts: [{ convention: 'napplet:test/open', params: [] }],
  });
  const deliveries: Record<string, unknown>[] = [];
  const target = workspace.attach('target', (message) => deliveries.push(message));
  target.ready();
  const replies = napplet.sent;
  const host = attachNappletHost({
    frame: napplet.frame,
    identity: 'source',
    manifestId: 'a'.repeat(64),
    relays: [],
    pubkey: null,
    prompt: () => {},
    files: () => {},
    intent: { workspace, catalogId: 'source' },
  });
  napplet.hello();
  const send = (data: Record<string, unknown>) => napplet.deliver(data);
  const message = (id: string, payload: unknown) => ({
    type: 'intent.invoke',
    id,
    request: { archetype: 'test', action: 'open', convention: 'napplet:test/open', payload },
  });
  try {
    send(message('before-init', 'available without SHELL'));
    await Bun.sleep(10);
    expect(replies.find((reply) => reply.id === 'before-init')).toMatchObject({
      result: { ok: true },
    });
    send({ type: 'shell.ready' });
    // Another frame's window-level message has no channel to this napplet.
    napplet.post(message('wrong-source', 'ignored'), { source: {} });
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const accepted = [
      circular,
      { counter: 1n },
      'x'.repeat(400 * 1024),
      new Uint8Array(400 * 1024),
      new Map([['answer', 42n]]),
    ];
    for (const [index, payload] of accepted.entries()) {
      const id = `valid-${index}`;
      send(message(id, payload));
      await Bun.sleep(10);
      expect(replies.find((reply) => reply.id === id)).toMatchObject({
        type: 'intent.invoke.result',
        id,
        result: { ok: true },
      });
      expect(deliveries.at(-1)).toMatchObject({
        type: 'intent.deliver',
        delivery: { sender: 'source', payload },
      });
    }
    expect(deliveries).toHaveLength(accepted.length + 1);
    expect(replies.some((reply) => reply.id === 'wrong-source')).toBe(false);
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 70; i++) cursor = cursor.next = {};
    const rejected = [
      'x'.repeat(1024 * 1024 + 1), // Payload cap applies independently of envelope allowance.
      new Uint8Array(new ArrayBuffer(2 * 1024 * 1024), 0, 1),
      deep,
      new Array(200000),
    ];
    for (const [index, payload] of rejected.entries()) {
      const id = `oversized-${index}`;
      send(message(id, payload));
      await Bun.sleep(5);
      expect(replies.filter((reply) => reply.id === id)).toEqual([
        {
          type: 'intent.invoke.result',
          id,
          result: { ok: false, error: 'intent payload too large' },
        },
      ]);
    }
    send({ ...message('extra-field', null), extra: new ArrayBuffer(2 * 1024 * 1024) });
    await Bun.sleep(5);
    expect(replies.find((reply) => reply.id === 'extra-field')).toMatchObject({
      result: { ok: false, error: 'intent payload too large' },
    });
    expect(deliveries).toHaveLength(accepted.length + 1);
    // Refusal leaves the session usable, with the existing non-INTENT envelope cap intact.
    send({ type: 'theme.get', id: 'oversized-other', extra: 'x'.repeat(400 * 1024) });
    send(message('after-refusal', 'still works'));
    await Bun.sleep(10);
    expect(replies.some((reply) => reply.id === 'oversized-other')).toBe(false);
    expect(replies.find((reply) => reply.id === 'after-refusal')).toMatchObject({
      result: { ok: true },
    });
  } finally {
    host.close();
    target.close();
    workspace.dropPending('target');
    restore();
  }
});
