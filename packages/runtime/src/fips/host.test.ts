import { expect, test } from 'bun:test';
import { attachNappletHost, type HostPrompt } from '../host';
import { fakeNappletFrame, withGlobals } from '../host-test-support';
import {
  clearRecentSessions,
  disconnectSession,
  fipsDashboardSnapshot,
  revokeGrant,
} from './dashboard';

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
    clearRecentSessions();
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
    expect(fipsDashboardSnapshot().sessions[0]!.grants[0]!.id).toBe(grant);
    send('pending', 'open', { roots: [descriptor] });
    const stalePrompt = prompt!;
    host.updateIdentity('c'.repeat(64));
    await Bun.sleep(0);
    expect(fipsDashboardSnapshot()).toEqual({ sessions: [], recentSessions: [] });
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
    clearRecentSessions();
    restore();
  }
});

test('dashboard disconnect settles pending approval once and stale approval cannot grant access in the replacement session', async () => {
  clearRecentSessions();
  const frame = fakeNappletFrame(),
    restore = withGlobals({ window: frame.window, localStorage: {} });
  let prompt: HostPrompt | null = null;
  const host = attachNappletHost({
    frame: frame.frame,
    identity: 'fips-disconnect-test',
    title: 'Independent document reader',
    manifestId: 'd'.repeat(64),
    relays: [],
    pubkey: null,
    prompt: (value) => {
      prompt = value;
    },
    files() {},
  });
  const send = (id: string, action: string, fields = {}) =>
    frame.deliver({ type: 'resource.fips', profile: 'soy.fips/1', id, action, ...fields });
  const results = (id: string) =>
    frame.sent.filter((message) => message.type === 'resource.fips.result' && message.id === id);
  try {
    frame.hello();
    frame.load();
    send('open', 'open', { roots: [descriptor] });
    const stalePrompt = prompt!;
    const old = fipsDashboardSnapshot().sessions[0]!;
    expect(old).toMatchObject({
      title: 'Independent document reader',
      address: 'event:' + 'd'.repeat(64),
      state: 'approving',
      pendingRequests: 1,
    });
    disconnectSession(old.id);
    expect(prompt).toBeNull();
    expect(results('open')[0]!.error).toContain('disconnected');
    send('new', 'open', { roots: [descriptor] });
    const currentPrompt = prompt!;
    stalePrompt.answer(true);
    await Bun.sleep(0);
    expect(results('open')).toHaveLength(1);
    expect(results('new')).toHaveLength(0);
    expect(fipsDashboardSnapshot().sessions[0]!.grants).toHaveLength(0);
    currentPrompt.answer(true);
    await Bun.sleep(0);
    expect(results('new')).toHaveLength(1);
    expect(fipsDashboardSnapshot().sessions[0]!.id).not.toBe(old.id);
    expect(fipsDashboardSnapshot().sessions[0]!.grants).toHaveLength(1);
    expect(fipsDashboardSnapshot().recentSessions[0]!).toMatchObject({
      id: old.id,
      state: 'closed',
      grants: [],
      pendingRequests: 0,
      stats: { cancelledRequests: 1 },
    });
    // Host diagnostics stay entirely off the app-facing info/changed messages.
    send('info', 'info');
    await Bun.sleep(0);
    const wire = results('info')[0]!.value as Record<string, unknown>;
    expect(Object.keys(wire).sort()).toEqual(['enabled', 'profile', 'stats', 'timeoutMs']);
    expect(JSON.stringify(wire)).not.toContain('Independent document reader');
    expect(JSON.stringify(wire)).not.toContain('grant');
  } finally {
    host.close();
    clearRecentSessions();
    restore();
  }
});

test('dashboard revocation aborts a pending operation approval and blocks stale success without contacting a provider', async () => {
  clearRecentSessions();
  const frame = fakeNappletFrame(),
    restore = withGlobals({ window: frame.window, localStorage: {} });
  let prompt: HostPrompt | null = null;
  const host = attachNappletHost({
    frame: frame.frame,
    identity: 'fips-revoke-test',
    manifestId: 'e'.repeat(64),
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
    frame.sent.find((message) => message.type === 'resource.fips.result' && message.id === id);
  try {
    frame.hello();
    frame.load();
    send('open', 'open', {
      roots: [{ ...descriptor, providers: [{ ...descriptor.providers[0]!, rpcPort: 39019 }] }],
    });
    prompt!.answer(true);
    await Bun.sleep(0);
    const grant = (result('open')!.value as string[])[0]!;
    send('operation', 'request', { grant, operation: { path: 'capabilities', method: 'GET' } });
    const stalePrompt = prompt!;
    const session = fipsDashboardSnapshot().sessions[0]!;
    expect(session.state).toBe('approving');
    revokeGrant(session.id, grant);
    stalePrompt.answer(true);
    await Bun.sleep(0);
    expect(result('operation')!.error).toBeString();
    expect(
      frame.sent.filter(
        (message) => message.type === 'resource.fips.result' && message.id === 'operation',
      ),
    ).toHaveLength(1);
    expect(prompt).toBeNull();
    expect(fipsDashboardSnapshot().sessions[0]!).toMatchObject({
      grants: [],
      stats: { networkRequests: 0 },
      transport: { seedGroups: 0, connectedPeers: 0 },
    });
    send('old', 'bytes', { grant, hash: descriptor.root });
    await Bun.sleep(0);
    expect(result('old')!.error).toContain('revoked');
  } finally {
    host.close();
    clearRecentSessions();
    restore();
  }
});
