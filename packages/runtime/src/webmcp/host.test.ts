import { test, expect } from 'bun:test';
import { attachNappletHost } from '../host';
import { fakeNappletFrame, withGlobals } from '../host-test-support';
import { NappletTools } from './session';
import { WEBMCP_PROFILE as profile } from './contract';
const tool = {
  name: 'inspect',
  description: 'Read document',
  inputSchema: { type: 'object' },
  readOnly: true,
};
test('real host binds tools to the private port and revokes on account change and frame replacement', async () => {
  const frame = fakeNappletFrame(),
    restore = withGlobals({ window: frame.window, localStorage: {} });
  let session: NappletTools | null = null;
  const host = attachNappletHost({
    frame: frame.frame,
    manifestId: 'a'.repeat(64),
    identity: 'verified-build',
    relays: [],
    pubkey: null,
    prompt() {},
    files() {},
    agentTools(value) {
      session = value;
    },
  });
  try {
    frame.hello();
    frame.load();
    frame.deliver({ type: 'webmcp.register', profile, id: 'r', tool });
    const first = session as unknown as NappletTools;
    expect(first.snapshot().tools).toHaveLength(1);
    first.grant('shell', true);
    const pending = first.invoke(first.snapshot().tools[0].id, {}, 'shell').catch((e) => e);
    host.updateIdentity('b'.repeat(64));
    expect((await pending).code).toBe('cancelled');
    expect(first.snapshot().closed).toBe(true);
    const second = session as unknown as NappletTools;
    expect(second.instance).not.toBe(first.instance);
    expect(second.snapshot().grants).toEqual([]);
    frame.deliver({ type: 'webmcp.register', profile, id: 'r2', tool });
    expect(second.snapshot().tools).toHaveLength(1);
    frame.load();
    expect(second.snapshot().closed).toBe(true);
    expect(session).toBeNull();
    expect(frame.port.closed).toBe(true);
  } finally {
    host.close();
    restore();
  }
});
test('hosts without the extension reject registration explicitly without exposing tools', () => {
  const frame = fakeNappletFrame(),
    restore = withGlobals({ window: frame.window, localStorage: {} });
  const host = attachNappletHost({
    frame: frame.frame,
    manifestId: 'a'.repeat(64),
    identity: 'unsupported',
    relays: [],
    pubkey: null,
    prompt() {},
    files() {},
  });
  try {
    frame.hello();
    frame.deliver({ type: 'webmcp.register', profile, id: 'r', tool });
    expect(frame.sent.at(-1)).toMatchObject({
      type: 'webmcp.register.result',
      id: 'r',
      error: { code: 'unsupported' },
    });
  } finally {
    host.close();
    restore();
  }
});
