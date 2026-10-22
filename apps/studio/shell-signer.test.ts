import { expect, test } from 'bun:test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { connectShellSigner } from './shell-signer';
import {
  studioChannel,
  studioSignerOrigin,
  studioSignRequest,
} from '../../packages/identity/src/studio-channel';

test('shell signer binds origin, window, channel, account and exact template; disconnect rejects pending work', async () => {
  const key = generateSecretKey(),
    pubkey = getPublicKey(key);
  let receive: (e: any) => void = () => {},
    target = '';
  const sent: any[] = [];
  const popup = {
    closed: false,
    close() {
      this.closed = true;
    },
    postMessage(data: any, origin: string) {
      sent.push({ data, origin });
    },
  };
  const host = {
    location: { origin: 'http://127.0.0.1:4195' },
    open(url: string) {
      target = url;
      return popup;
    },
    addEventListener(_: string, listener: any) {
      receive = listener;
    },
    removeEventListener() {
      receive = () => {};
    },
  } as unknown as Window;
  const connection = connectShellSigner('http://127.0.0.1:4196', host);
  const channel = new URLSearchParams(new URL(target).hash.slice(1)).get('channel');
  const reply = (data: object, origin = 'http://127.0.0.1:4196', source: any = popup) =>
    receive({ source, origin, data: { protocol: studioChannel, channel, ...data } });
  let connected = false;
  void connection.then(() => (connected = true));
  reply({ type: 'connected', pubkey }, 'https://evil.invalid');
  reply({ type: 'connected', pubkey }, undefined, {});
  reply({ type: 'connected', pubkey, channel: crypto.randomUUID() });
  await Promise.resolve();
  expect(connected).toBe(false);
  reply({ type: 'connected', pubkey });
  const signer = await connection;
  try {
    const template = { kind: 30617, created_at: 1, tags: [['d', 'toy']], content: '' };
    const signed = signer.signEvent(template);
    const request = sent.at(-1);
    expect(request.origin).toBe('http://127.0.0.1:4196');
    expect(studioSignRequest.safeParse(request.data).success).toBe(true);
    reply({
      type: 'signed',
      id: crypto.randomUUID(),
      event: finalizeEvent(structuredClone(template), key),
    });
    reply({
      type: 'signed',
      id: request.data.id,
      event: finalizeEvent(structuredClone(template), key),
    });
    expect((await signed).pubkey).toBe(pubkey);
    const changed = signer.signEvent(template);
    reply({
      type: 'signed',
      id: sent.at(-1).data.id,
      event: finalizeEvent({ ...template, content: 'changed' }, key),
    });
    await expect(changed).rejects.toThrow('different event');
    await expect(signer.signEvent({ ...template, kind: 1 })).rejects.toThrow();
    const pending = signer.signEvent(template);
    reply({ type: 'disconnected' });
    await expect(pending).rejects.toThrow('account changed');
    expect(signer.alive()).toBe(false);
    expect(JSON.stringify(sent)).not.toContain(Buffer.from(key).toString('hex'));
  } finally {
    signer.close();
  }
});

test('shell connections refuse remote origins other than the shell itself', () => {
  expect(studioSignerOrigin('http://127.0.0.1:4195', 'https://napplet.soy')).toBe(true);
  expect(studioSignerOrigin('https://napplet.soy', 'https://napplet.soy')).toBe(true);
  for (const value of [
    'https://evil.invalid',
    'http://127.0.0.1.evil.invalid',
    'http://127.1',
    'http://user@127.0.0.1:4195',
    'http://127.0.0.1:4195/path',
    'null',
  ])
    expect(studioSignerOrigin(value, 'https://napplet.soy')).toBe(false);
});
