import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { naddrEncode } from 'nostr-tools/nip19';

/** Exercise the installed production binding, including its normalization and retention. */
test('published INTENT binding normalizes recommendations and buffers delivery before registration', async () => {
  const messages: any[] = [];
  const listeners = new Set<(event: any) => void>();
  const parent = { postMessage: (message: any) => messages.push(message) };
  const window: any = {
    parent,
    addEventListener: (_: string, listener: (event: any) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: any) => void) => listeners.delete(listener),
  };
  const context: any = {
    window,
    crypto,
    structuredClone,
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    console,
  };
  runInNewContext(
    readFileSync('node_modules/@napplet/shim/dist/prelude.global.js', 'utf8'),
    context,
  );
  context.NappletShimPrelude.install({ domains: ['intent'] });
  const api = window.napplet.intent;
  const address = `35129:${'a'.repeat(64)}:Case:Sensitive`;
  const pointer = naddrEncode({
    kind: 35129,
    pubkey: 'a'.repeat(64),
    identifier: 'Case:Sensitive',
    relays: ['wss://relay.example'],
  });
  const call = api.invoke(`napplet:profile/open#${pointer}`, { payload: { name: 'one' } });
  const posted = messages.at(-1);
  expect(posted.request).toEqual({
    archetype: 'profile',
    action: 'open',
    convention: 'napplet:profile/open',
    payload: { name: 'one' },
    handlerHint: { address, relays: ['wss://relay.example'] },
  });
  const receive = (data: any) => {
    for (const listener of listeners) listener({ source: parent, data });
  };
  receive({
    type: 'intent.invoke.result',
    id: posted.id,
    result: { ok: false, error: 'test complete' },
  });
  expect(await call).toEqual({ ok: false, error: 'test complete' });
  const count = messages.length;
  for (const uri of [
    'napplet:profile/open?x=%ZZ',
    'napplet:profile/open?x=1&%78=2',
    'napplet:profile/open#bad',
  ])
    expect(() => api.invoke(uri)).toThrow();
  expect(() => api.invoke('napplet:profile/open?x=1', { payload: {} })).toThrow();
  expect(() =>
    api.invoke(`napplet:profile/open#${pointer}`, { handlerHint: { address } }),
  ).toThrow();
  expect(messages).toHaveLength(count);
  const query = api.invoke('napplet:profile/open?name=a+b');
  expect(messages.at(-1).request.payload).toEqual({ name: 'a+b' });
  receive({
    type: 'intent.invoke.result',
    id: messages.at(-1).id,
    result: { ok: false, error: 'test complete' },
  });
  await query;
  const delivery = {
    sender: 'opaque-source',
    archetype: 'profile',
    action: 'open',
    convention: 'napplet:profile/open',
    payload: {},
  };
  receive({ type: 'intent.deliver', delivery });
  const received: any[] = [];
  const subscription = api.onDelivery((value: any) => received.push(value));
  expect(received).toEqual([delivery]);
  subscription.close();
});
