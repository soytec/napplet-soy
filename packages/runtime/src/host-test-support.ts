/**
 * Test double for one shell-created napplet iframe and its NIP-5D port. Window-level
 * traffic goes through the shell's real `message` listeners; NAP traffic goes over
 * the bound port only. The frame Window throws if the host ever posts to it.
 */
export function fakeNappletFrame(shell = fakeShellWindow()) {
  const sent: Record<string, unknown>[] = [];
  const { window, listeners: messageListeners } = shell;
  const loadListeners = new Set<() => void>();
  const contentWindow = {
    postMessage() {
      throw new Error('NAP messages must not be sent via iframeWindow.postMessage');
    },
  };
  const frame = {
    contentWindow,
    addEventListener(type: string, listener: () => void) {
      if (type === 'load') loadListeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === 'load') loadListeners.delete(listener);
    },
  } as unknown as HTMLIFrameElement;
  const port = {
    closed: false,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onmessageerror: null as (() => void) | null,
    postMessage(message: Record<string, unknown>) {
      if (!port.closed) sent.push(message);
    },
    close() {
      port.closed = true;
    },
    addEventListener() {},
  };
  /** A window-level message, as the shell's `message` listener receives it. */
  const post = (
    data: unknown,
    options: { source?: unknown; origin?: string; ports?: unknown[] } = {},
  ) => {
    for (const listener of [...messageListeners])
      listener({
        data,
        source: 'source' in options ? options.source : contentWindow,
        origin: options.origin ?? 'null',
        ports: options.ports ?? [],
      } as unknown as MessageEvent);
  };
  return {
    sent,
    frame,
    port,
    window,
    contentWindow,
    post,
    /** The injected bootstrap's single handoff. */
    hello: () => post({ type: 'napplet.hello' }, { ports: [port as unknown as MessagePort] }),
    /** A NAP envelope over the bound port. */
    deliver: (data: object) => port.onmessage?.({ data }),
    load: () => [...loadListeners].forEach((listener) => listener()),
    listening: () => messageListeners.size,
  };
}

/** The shell page's window, shared by every frame attached in one test. */
export function fakeShellWindow() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const window = {
    addEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type: string, listener: (event: MessageEvent) => void) {
      if (type === 'message') listeners.delete(listener);
    },
  };
  return { window, listeners };
}

/** Replace globals for one test and return a restore function. */
export function withGlobals(values: Record<string, unknown>) {
  const descriptors = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  return () => {
    for (const [key, descriptor] of descriptors)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
  };
}
