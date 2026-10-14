import { expect, test } from 'bun:test';
import { attachNappletHost } from './host';
import { createFrameSession } from './frame-session';
import { IntentWorkspace } from './intent-session';

test('bound host handles intents without SHELL and cold delivery waits for its verified document', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'),
    originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const listeners = new Set<(event: MessageEvent) => void>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener(type: string, handler: (event: MessageEvent) => void) {
        if (type === 'message') listeners.add(handler);
      },
      removeEventListener(type: string, handler: (event: MessageEvent) => void) {
        if (type === 'message') listeners.delete(handler);
      },
    },
  });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {} });
  const workspace = new IntentWorkspace({ choose: async () => null, launch: async () => {} });
  workspace.register({ id: 'attested-source', contracts: [] });
  workspace.register({
    id: 'editor',
    contracts: [{ convention: 'napplet:black-site/map-edit', params: ['address'] }],
  });
  const sentSource: Record<string, unknown>[] = [],
    sentTarget: Record<string, unknown>[] = [];
  const source = { postMessage: (message: Record<string, unknown>) => sentSource.push(message) },
    target = { postMessage: (message: Record<string, unknown>) => sentTarget.push(message) };
  const sessions = new Map<string, ReturnType<typeof createFrameSession>>();
  const frames = new Map<string, EventTarget>();
  const make = (endpoint: typeof source, id: string) => {
    const session = createFrameSession(true);
    sessions.set(id, session);
    const frame = Object.assign(new EventTarget(), { contentWindow: endpoint });
    frames.set(id, frame);
    return attachNappletHost({
      session,
      frame: frame as unknown as HTMLIFrameElement,
      identity: id,
      manifestId: 'a'.repeat(64),
      relays: [],
      pubkey: null,
      prompt: () => {},
      files: () => {},
      intent: { workspace, catalogId: id },
    });
  };
  const deliver = (endpoint: typeof source, data: Record<string, unknown>) => {
    for (const listener of listeners)
      listener({ source: endpoint, origin: 'null', data } as unknown as MessageEvent);
  };
  let sourceHost: ReturnType<typeof attachNappletHost> | undefined,
    targetHost: ReturnType<typeof attachNappletHost> | undefined;
  try {
    sourceHost = make(source, 'attested-source');
    deliver(source, { type: 'soy.frame.ready', session: sessions.get('attested-source')!.id });
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
    expect(sentTarget).toEqual([]);
    deliver(source, { type: 'soy.frame.ready', session: sessions.get('editor')!.id });
    deliver(target, { type: 'soy.frame.ready', session: 'wrong-document' });
    deliver(target, { type: 'shell.ready' });
    expect(sentTarget).toEqual([]);
    deliver(target, { type: 'soy.frame.ready', session: sessions.get('editor')!.id });
    expect(sentTarget.map((m) => m.type)).toEqual(['intent.deliver']);
    const delivered = sentTarget.length;
    deliver(target, { type: 'soy.frame.ready', session: sessions.get('editor')!.id });
    expect(sentTarget).toHaveLength(delivered);
    expect(sentTarget.at(-1)).toEqual({
      type: 'intent.deliver',
      delivery: {
        sender: 'attested-source',
        archetype: 'black-site',
        action: 'map-edit',
        convention: 'napplet:black-site/map-edit',
        payload: { address: 'one' },
      },
    });
    deliver(target, { type: 'soy.frame.retired', session: sessions.get('editor')!.id });
    deliver(target, { type: 'intent.handlers', id: 'retired-document' });
    await Bun.sleep(0);
    expect(sentTarget).toHaveLength(delivered);
    sourceHost = make(source, 'attested-source');
    deliver(source, { type: 'soy.frame.ready', session: sessions.get('attested-source')!.id });
    frames.get('attested-source')!.dispatchEvent(new Event('load'));
    deliver(source, { type: 'intent.handlers', id: 'before-replacement' });
    await Bun.sleep(0);
    expect(sentSource.at(-1)?.id).toBe('before-replacement');
    const beforeReplacement = sentSource.length;
    frames.get('attested-source')!.dispatchEvent(new Event('load'));
    deliver(source, { type: 'soy.frame.ready', session: sessions.get('attested-source')!.id });
    deliver(source, { type: 'intent.handlers', id: 'after-replacement' });
    await Bun.sleep(0);
    expect(sentSource).toHaveLength(beforeReplacement);
    expect(listeners.size).toBe(0);
  } finally {
    sourceHost?.close();
    targetHost?.close();
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
