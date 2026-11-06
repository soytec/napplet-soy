import { test, expect } from 'bun:test';
import { attachNappletHost, type NappletRevocation } from './host';
import type { NappletMedia } from './media-session';
import { fakeNappletFrame, withGlobals } from './host-test-support';

const base = {
  manifestId: 'a'.repeat(64),
  relays: [],
  pubkey: null,
  prompt() {},
  files() {},
};

test('NAP traffic is bound to the hello port and replies never use the frame Window', () => {
  const napplet = fakeNappletFrame();
  const restore = withGlobals({ window: napplet.window, localStorage: {} });
  const revoked: NappletRevocation[] = [];
  const host = attachNappletHost({
    ...base,
    frame: napplet.frame,
    identity: 'port-test',
    revoked: (reason) => revoked.push(reason),
  });
  try {
    // Before the handoff there is no channel; nothing can be delivered.
    host.updateIdentity('b'.repeat(64));
    expect(napplet.sent).toEqual([]);
    // Other frames' window-level traffic is not this napplet's concern.
    napplet.post({ type: 'napplet.hello' }, { source: {}, ports: [{}] });
    napplet.post({ type: 'identity.getPublicKey', id: 'other' }, { source: {} });
    expect(revoked).toEqual([]);
    napplet.hello();
    napplet.load();
    napplet.deliver({ type: 'identity.getPublicKey', id: 'bound' });
    expect(napplet.sent).toEqual([
      { type: 'identity.getPublicKey.result', id: 'bound', pubkey: 'b'.repeat(64) },
    ]);
    napplet.deliver({ type: 'shell.ready' });
    expect(napplet.sent.map((m) => m.type)).toContain('shell.init');
    expect(revoked).toEqual([]);
  } finally {
    host.close();
    restore();
  }
  // Closing without evidence tears the port down without reporting a revocation.
  expect(napplet.port.closed).toBe(true);
  expect(napplet.listening()).toBe(0);
  expect(revoked).toEqual([]);
});

for (const [name, evidence, reason] of [
  [
    'any later window-level message',
    (napplet: ReturnType<typeof fakeNappletFrame>) =>
      napplet.post({ type: 'identity.getPublicKey', id: 'legacy' }),
    'window-message',
  ],
  [
    'a second hello',
    (napplet: ReturnType<typeof fakeNappletFrame>) => napplet.hello(),
    'second-hello',
  ],
  [
    'a second load',
    (napplet: ReturnType<typeof fakeNappletFrame>) => {
      napplet.load();
      napplet.load();
    },
    'second-load',
  ],
  [
    'a failed port',
    (napplet: ReturnType<typeof fakeNappletFrame>) => napplet.port.onmessageerror?.(),
    'port-closed',
  ],
] as const) {
  test(`replacement evidence (${name}) closes the port and revokes every grant once`, () => {
    const napplet = fakeNappletFrame();
    const restore = withGlobals({ window: napplet.window, localStorage: {} });
    const revoked: NappletRevocation[] = [];
    let configuration: unknown = 'unset';
    const host = attachNappletHost({
      ...base,
      frame: napplet.frame,
      identity: 'revocation-test',
      configuration: (value) => (configuration = value),
      revoked: (value) => revoked.push(value),
    });
    try {
      napplet.hello();
      napplet.deliver({ type: 'identity.getPublicKey', id: 'before' });
      expect(napplet.sent).toHaveLength(1);
      evidence(napplet);
      expect(revoked).toEqual([reason]);
      expect(napplet.port.closed).toBe(true);
      expect(napplet.listening()).toBe(0);
      expect(configuration).toBeNull();
      // A port that was transferred out of the document has no surviving authority.
      napplet.port.closed = false;
      napplet.deliver({ type: 'identity.getPublicKey', id: 'after' });
      expect(napplet.sent).toHaveLength(1);
      napplet.hello();
      evidence(napplet);
      host.close();
      expect(revoked).toEqual([reason]);
    } finally {
      host.close();
      restore();
    }
  });
}

test('the bootstrap handoff must be the first frame message and carry exactly one port', () => {
  const cases: Array<[string, (napplet: ReturnType<typeof fakeNappletFrame>) => void]> = [
    ['NAP before hello', (n) => n.post({ type: 'identity.getPublicKey', id: 'early' })],
    ['hello without a port', (n) => n.post({ type: 'napplet.hello' })],
    ['hello with two ports', (n) => n.post({ type: 'napplet.hello' }, { ports: [n.port, {}] })],
    [
      'hello from a real origin',
      (n) => n.post({ type: 'napplet.hello' }, { origin: 'https://evil.example', ports: [n.port] }),
    ],
    ['malformed data', (n) => n.post(null)],
  ];
  for (const [name, attempt] of cases) {
    const napplet = fakeNappletFrame();
    const restore = withGlobals({ window: napplet.window, localStorage: {} });
    const revoked: NappletRevocation[] = [];
    const host = attachNappletHost({
      ...base,
      frame: napplet.frame,
      identity: 'handoff-test',
      revoked: (reason) => revoked.push(reason),
    });
    try {
      attempt(napplet);
      expect({ name, revoked }).toEqual({ name, revoked: ['invalid-hello'] });
      napplet.hello();
      napplet.deliver({ type: 'identity.getPublicKey', id: 'late' });
      expect(napplet.sent).toEqual([]);
    } finally {
      host.close();
      restore();
    }
  }
});

test('media reports are port/account bound without SHELL and cannot exhaust lifecycle commands', () => {
  const napplet = fakeNappletFrame();
  const restore = withGlobals({ window: napplet.window, localStorage: {} });
  const sent = napplet.sent;
  let media: NappletMedia | null = null;
  const host = attachNappletHost({
    ...base,
    frame: napplet.frame,
    identity: 'media-test',
    media(value) {
      media = value;
    },
  });
  napplet.hello();
  const deliver = napplet.deliver;
  const create = (id: string) => {
    deliver({
      type: 'media.session.create',
      id,
      owner: 'napplet',
      capabilities: ['pause', 'stop'],
    });
    return sent.find((m) => m.id === id)?.sessionId;
  };
  try {
    const sessionId = create('first');
    expect(sessionId).toBeString();
    // Another frame's window-level message carries no napplet authority.
    napplet.post({ type: 'media.state', sessionId, status: 'playing' }, { source: {} });
    expect(media!.getSnapshot()[0].status).toBe('stopped');
    deliver({ type: 'media.state', sessionId, status: 'playing' });
    expect(media!.getSnapshot()[0].status).toBe('playing');
    host.updateIdentity('b'.repeat(64));
    expect(sent).toContainEqual({ type: 'media.command', sessionId, action: 'stop' });
    deliver({ type: 'media.state', sessionId, status: 'playing' });
    expect(media!.getSnapshot()).toEqual([]);
    const replacement = create('replacement');
    expect(replacement).toBeString();
    for (let i = 0; i < 500; i++)
      deliver({ type: 'media.state', sessionId: replacement, status: 'playing', position: i });
    deliver({ type: 'media.session.destroy', sessionId: replacement });
    expect(media!.getSnapshot()).toEqual([]);
    expect(create('after-flood')).toBeString();
    expect(sent.some((m) => m.type === 'shell.init')).toBe(false);
    host.close();
    const count = sent.length;
    create('closed');
    expect(sent).toHaveLength(count);
  } finally {
    host.close();
    restore();
  }
});

test('retiring an account aborts resources and suppresses late replies even when request IDs are reused', async () => {
  const napplet = fakeNappletFrame();
  const sent = napplet.sent;
  const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  const restore = withGlobals({
    window: napplet.window,
    localStorage: {},
    fetch: (_: unknown, init: RequestInit) =>
      new Promise<Response>((resolve) => requests.push({ signal: init.signal!, resolve })),
  });
  const host = attachNappletHost({ ...base, frame: napplet.frame, identity: 'verified-napplet' });
  napplet.hello();
  const deliver = napplet.deliver;
  try {
    host.updateIdentity('b'.repeat(64));
    expect(sent).toEqual([{ type: 'identity.changed', pubkey: 'b'.repeat(64) }]);
    deliver({ type: 'identity.getPublicKey', id: 'before-ready' });
    expect(sent.at(-1)).toEqual({
      type: 'identity.getPublicKey.result',
      id: 'before-ready',
      pubkey: 'b'.repeat(64),
    });
    deliver({ type: 'resource.bytes', id: 'reused', url: 'https://assets.example/file' });
    await Bun.sleep(0);
    expect(requests).toHaveLength(1);
    host.updateIdentity('c'.repeat(64));
    expect(requests[0].signal.aborted).toBe(true);
    expect(sent.slice(-2)).toMatchObject([
      { type: 'resource.bytes.error', id: 'reused' },
      { type: 'identity.changed', pubkey: 'c'.repeat(64) },
    ]);
    host.updateIdentity('c'.repeat(64));
    deliver({ type: 'shell.ready' });
    deliver({ type: 'shell.ready' });
    expect(sent.filter((m) => m.type === 'identity.changed')).toHaveLength(2);
    expect(sent.filter((m) => m.type === 'shell.init')).toHaveLength(1);
    deliver({ type: 'resource.bytes', id: 'reused', url: 'https://assets.example/new' });
    await Bun.sleep(0);
    requests[0].resolve(new Response('old account data'));
    await Bun.sleep(0);
    expect(sent.filter((m) => m.type === 'resource.bytes.result')).toHaveLength(0);
    expect(requests[1].signal.aborted).toBe(false);
    requests[1].resolve(new Response('new account data'));
    await Bun.sleep(0);
    const results = sent.filter((m) => m.type === 'resource.bytes.result');
    expect(results).toHaveLength(1);
    expect(await (results[0].blob as Blob).text()).toBe('new account data');
    for (let i = 0; i < 650; i++) deliver({ type: 'theme.get', id: `quota-${i}` });
    deliver({ type: 'identity.getPublicKey', id: 'key-after-quota' });
    expect(sent.at(-1)).toEqual({
      type: 'identity.getPublicKey.result',
      id: 'key-after-quota',
      pubkey: 'c'.repeat(64),
    });
  } finally {
    host.close();
    restore();
  }
});

test('theme requests and notifications work without SHELL and stop on close', async () => {
  const napplet = fakeNappletFrame();
  const sent = napplet.sent;
  const restore = withGlobals({ window: napplet.window, localStorage: {} });
  let changed: () => void = () => {};
  let unsubscribed = 0;
  const theme = {
    title: 'Test host',
    colors: { background: '#171e1a', text: '#f5f1e5', primary: '#9ad4bb' },
  };
  const host = attachNappletHost({
    ...base,
    frame: napplet.frame,
    identity: 'theme-test',
    theme: {
      get: () => theme,
      subscribe(fn) {
        changed = fn;
        return () => {
          unsubscribed++;
        };
      },
    },
  });
  try {
    changed();
    expect(sent).toEqual([]);
    napplet.hello();
    changed();
    expect(sent).toEqual([{ type: 'theme.changed', theme }]);
    napplet.deliver({ type: 'shell.ready' });
    changed();
    expect(sent.at(-1)).toEqual({ type: 'theme.changed', theme });
    napplet.deliver({ type: 'theme.get', id: 'theme' });
    await Bun.sleep(0);
    expect(sent.at(-1)).toEqual({ type: 'theme.get.result', id: 'theme', theme });
    host.updateIdentity('b'.repeat(64));
    changed();
    expect(sent.filter((m) => m.type === 'theme.changed')).toHaveLength(3);
    expect(sent.filter((m) => m.type === 'shell.init')).toHaveLength(1);
    host.close();
    expect(unsubscribed).toBe(1);
    const count = sent.length;
    changed();
    host.close();
    expect(sent).toHaveLength(count);
    expect(unsubscribed).toBe(1);
  } finally {
    host.close();
    restore();
  }
});

test('keyboard actions are port bound without SHELL, survive account switches, and stop with the frame', () => {
  const napplet = fakeNappletFrame();
  const sent = napplet.sent;
  const restore = withGlobals({ window: napplet.window, localStorage: {} });
  const host = attachNappletHost({ ...base, frame: napplet.frame, identity: 'keyboard-test' });
  napplet.hello();
  const data = {
    type: 'keys.registerAction',
    id: 'r1',
    action: { id: 'hop', label: 'Hop', defaultKey: 'ArrowUp' },
  };
  const deliver = napplet.deliver;
  try {
    deliver(data);
    expect(sent.at(-1)).toMatchObject({ type: 'keys.registerAction.result', binding: 'ArrowUp' });
    deliver({ type: 'keys.unregisterAction', actionId: 'hop' });
    deliver({ type: 'shell.ready' });
    expect(sent.find((m) => m.type === 'shell.init')).toMatchObject({
      type: 'shell.init',
      capabilities: { domains: expect.arrayContaining(['keys']) },
    });
    const initial = sent.length;
    napplet.post(data, { source: {} });
    expect(sent).toHaveLength(initial);
    deliver(data);
    expect(sent.at(-1)).toMatchObject({
      type: 'keys.registerAction.result',
      id: 'r1',
      binding: 'ArrowUp',
    });
    host.updateIdentity('b'.repeat(64));
    deliver(data);
    expect(sent.at(-1)).toMatchObject({ error: 'duplicate action ID' });
    deliver({ type: 'keys.unregisterAction', actionId: 'hop' });
    expect(sent.at(-1)).toEqual({ type: 'keys.bindings', bindings: [] });
    host.close();
    const count = sent.length;
    deliver(data);
    expect(sent).toHaveLength(count);
  } finally {
    host.close();
    restore();
  }
});
