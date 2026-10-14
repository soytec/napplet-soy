import { test, expect } from 'bun:test';
import { attachNappletHost } from './host';

test('retiring an account aborts resources and suppresses late replies even when request IDs are reused', async () => {
  const globals = ['window', 'localStorage', 'fetch'] as const;
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const sent: Record<string, unknown>[] = [];
  let listener: (event: MessageEvent) => void = () => {};
  const source = { postMessage: (message: Record<string, unknown>) => sent.push(message) };
  const requests: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (_: string, fn: typeof listener) => {
        listener = fn;
      },
      removeEventListener: () => {},
    },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: (_: unknown, init: RequestInit) =>
      new Promise<Response>((resolve) => requests.push({ signal: init.signal!, resolve })),
  });
  const host = attachNappletHost({
    frame: { contentWindow: source } as unknown as HTMLIFrameElement,
    identity: 'verified-napplet',
    manifestId: 'a'.repeat(64),
    relays: [],
    pubkey: null,
    prompt: () => {},
    files: () => {},
  });
  const deliver = (data: Record<string, unknown>) =>
    listener({ data, source, origin: 'null' } as unknown as MessageEvent);
  try {
    host.updateIdentity('b'.repeat(64));
    expect(sent).toEqual([]); // No notifications before the mandatory handshake.
    deliver({ type: 'shell.ready' });
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
    expect(sent.filter((m) => m.type === 'identity.changed')).toHaveLength(1);
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
    globals.forEach((key, i) => {
      if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

test('theme notifications belong to the frame lifetime, wait for handshake, and stop on close', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const sent: Record<string, unknown>[] = [];
  const source = { postMessage: (message: Record<string, unknown>) => sent.push(message) };
  let listener: (event: MessageEvent) => void = () => {};
  let changed: () => void = () => {};
  let unsubscribed = 0;
  const theme = {
    title: 'Test host',
    colors: { background: '#171e1a', text: '#f5f1e5', primary: '#9ad4bb' },
  };
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
  const host = attachNappletHost({
    frame: { contentWindow: source } as unknown as HTMLIFrameElement,
    identity: 'theme-test',
    manifestId: 'a'.repeat(64),
    relays: [],
    pubkey: null,
    prompt() {},
    files() {},
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
    listener({ source, origin: 'null', data: { type: 'shell.ready' } } as unknown as MessageEvent);
    changed();
    expect(sent.at(-1)).toEqual({ type: 'theme.changed', theme });
    listener({
      source,
      origin: 'null',
      data: { type: 'theme.get', id: 'theme' },
    } as unknown as MessageEvent);
    await Bun.sleep(0);
    expect(sent.at(-1)).toEqual({ type: 'theme.get.result', id: 'theme', theme });
    host.updateIdentity('b'.repeat(64));
    changed();
    expect(sent.filter((m) => m.type === 'theme.changed')).toHaveLength(2);
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
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('keyboard actions are handshake/source bound, survive account switches, and stop with the frame', () => {
  const globals = ['window', 'localStorage'] as const;
  const descriptors = globals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
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
  const host = attachNappletHost({
    frame: { contentWindow: source } as unknown as HTMLIFrameElement,
    identity: 'keyboard-test',
    manifestId: 'a'.repeat(64),
    relays: [],
    pubkey: null,
    prompt() {},
    files() {},
  });
  const data = {
    type: 'keys.registerAction',
    id: 'r1',
    action: { id: 'hop', label: 'Hop', defaultKey: 'ArrowUp' },
  };
  const deliver = (data: object, from: unknown = source, origin = 'null') =>
    listener({ data, source: from, origin } as MessageEvent);
  try {
    deliver(data);
    expect(sent).toEqual([]);
    deliver({ type: 'shell.ready' });
    expect(sent[0]).toMatchObject({
      type: 'shell.init',
      capabilities: { domains: expect.arrayContaining(['keys']) },
    });
    const initial = sent.length;
    deliver(data, {});
    deliver(data, source, 'https://evil.example');
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
    globals.forEach((key, i) => {
      if (descriptors[i]) Object.defineProperty(globalThis, key, descriptors[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});
