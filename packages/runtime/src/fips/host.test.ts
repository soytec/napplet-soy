import { expect, test } from 'bun:test';
import { attachNappletHost, type HostPrompt } from '../host';
import { fakeNappletFrame, withGlobals } from '../host-test-support';

const descriptor = {
  root: 'a'.repeat(64),
  bytes: 1024,
  chunkBytes: 1024,
  expires: Math.floor(Date.now() / 1000) + 300,
  providers: [{ peerId: '02' + 'b'.repeat(64), seedUrls: ['wss://seed.example/fips'] }],
};

test('experimental requests use the bound port and account replacement retires grants and pending approval', async () => {
  const frame = fakeNappletFrame(),
    restore = withGlobals({ window: frame.window, localStorage: {} });
  let prompt: HostPrompt | null = null;
  const host = attachNappletHost({
    frame: frame.frame,
    identity: 'fips-host-test',
    manifestId: 'a'.repeat(64),
    relays: [],
    pubkey: null,
    prompt: (value) => {
      prompt = value;
    },
    files() {},
  });
  const send = (id: string, action: string, fields = {}) =>
    frame.deliver({ type: 'resource.fips', profile: 'soy.fips/1', id, action, ...fields });
  const result = (id: string) =>
    frame.sent.find((m) => m.type === 'resource.fips.result' && m.id === id);
  try {
    frame.hello();
    frame.load();
    send('malformed', 'open', { roots: [descriptor], endpoint: 'https://not-authorized.example' });
    await Bun.sleep(0);
    expect(result('malformed')?.error).toContain('Invalid');
    expect(prompt).toBeNull();
    send('first', 'open', { roots: [descriptor] });
    expect(prompt!.kind).toBe('network');
    prompt!.answer(true);
    await Bun.sleep(0);
    const grant = (result('first')!.value as string[])[0]!;
    send('pending', 'open', { roots: [descriptor] });
    const stalePrompt = prompt!;
    host.updateIdentity('c'.repeat(64));
    await Bun.sleep(0);
    expect(result('pending')?.error).toContain('closed');
    stalePrompt.answer(true);
    await Bun.sleep(0);
    expect(
      frame.sent.filter((m) => m.type === 'resource.fips.result' && m.id === 'pending'),
    ).toHaveLength(1);
    send('old', 'bytes', { grant, hash: descriptor.root });
    await Bun.sleep(0);
    expect(result('old')?.error).toContain('revoked');
    send('new', 'info');
    await Bun.sleep(0);
    expect((result('new')!.value as any).stats.networkRequests).toBe(0);
    frame.load(); // Replaced document loses the entire bound channel.
    expect(frame.port.closed).toBe(true);
    const count = frame.sent.length;
    send('late', 'info');
    await Bun.sleep(0);
    expect(frame.sent).toHaveLength(count);
  } finally {
    host.close();
    restore();
  }
});
