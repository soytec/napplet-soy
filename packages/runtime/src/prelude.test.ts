import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createFrameSession } from './frame-session';
import { nappletPrelude } from './prelude';
import { preparePlayback } from './playback';
import { finalizeEvent, generateSecretKey } from 'nostr-tools';

const shim = readFileSync('node_modules/@napplet/shim/dist/prelude.global.js', 'utf8');
test('injected INTENT presence agrees with surface policy and private readiness follows installation', () => {
  for (const supported of [false, true]) {
    const session = createFrameSession(supported);
    const listeners = new Map<string, (() => void)[]>();
    const sent: Record<string, unknown>[] = [];
    const window: any = {
      parent: {
        postMessage: (message: Record<string, unknown>) => {
          if (message.type === 'soy.frame.ready') expect(!!window.napplet.intent).toBe(supported);
          sent.push(message);
        },
      },
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    };
    runInNewContext(nappletPrelude(shim, undefined, session), {
      window,
      crypto,
      structuredClone,
      setTimeout,
      clearTimeout,
      TextEncoder,
      TextDecoder,
      queueMicrotask,
    });
    expect(!!window.napplet.intent).toBe(supported);
    expect(sent.map((m) => m.type)).toEqual(['soy.frame.ready', 'shell.ready']);
    window.parent.postMessage = () => {
      throw new Error('creator replaced transport');
    };
    listeners.get('pagehide')![0]();
    listeners.get('beforeunload')![0]();
    expect(sent.slice(-2)).toEqual([
      { type: 'soy.frame.retired', session: session.id },
      { type: 'soy.frame.retired', session: session.id },
    ]);
  }
});

test('a surface without an INTENT endpoint rejects required INTENT before playback', async () => {
  const event = finalizeEvent(
    {
      kind: 35129,
      created_at: 1,
      content: 'Required intent specimen',
      tags: [
        ['d', 'required-intent'],
        ['x', 'a'.repeat(64)],
        ['R', 'intent'],
      ],
    },
    generateSecretKey(),
  );
  await expect(
    preparePlayback(event, 'a'.repeat(64), createFrameSession().domains),
  ).rejects.toThrow('intent');
  expect(
    (await preparePlayback(event, 'a'.repeat(64), createFrameSession(true).domains)).manifest.id,
  ).toBe(event.id);
});
