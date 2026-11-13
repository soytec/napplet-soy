import { test, expect } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { nappletPrelude } from '../prelude';
import { WEBMCP_PROFILE as profile } from './contract';
const tick = () => new Promise((r) => setTimeout(r, 0));
async function fixture() {
  const sent: any[] = [];
  let receive: (m: unknown) => void = () => {};
  const lifecycle: Record<string, () => void> = {};
  let hellos = 0;
  class Port {
    onmessage?: (e: MessageEvent) => void;
    postMessage(m: unknown) {
      sent.push(m);
    }
  }
  class Channel {
    port1 = new Port();
    port2 = new Port();
    constructor() {
      receive = (m) => this.port1.onmessage?.(new MessageEvent('message', { data: m }));
    }
  }
  const window: any = {
    parent: { postMessage: () => hellos++ },
    addEventListener: (name: string, fn: () => void) => (lifecycle[name] = fn),
  };
  const shim = await Bun.file(
    Bun.resolveSync('@napplet/shim/prelude.global', import.meta.dir),
  ).text();
  const document = { addEventListener() {}, removeEventListener() {} };
  runInNewContext(nappletPrelude(shim), {
    window,
    document,
    MessagePort: Port,
    MessageChannel: Channel,
    MessageEvent,
    TextEncoder,
    TextDecoder,
    crypto,
    AbortController,
    setTimeout,
    clearTimeout,
    structuredClone,
  });
  return { api: window.napplet.webmcp, sent, receive, lifecycle, hellos };
}
test('actual injected shim exposes typed tools through one private port; duplicate invokes cannot run twice', async () => {
  const f = await fixture();
  expect(f.hellos).toBe(1);
  expect(f.api.profile).toBe(profile);
  let calls = 0;
  const registered = f.api.registerTool(
    { name: 'increment', description: 'Increment', inputSchema: { type: 'object' } },
    () => ++calls,
  );
  const req = f.sent.at(-1);
  expect(req.type).toBe('webmcp.register');
  f.receive({
    type: 'webmcp.register.result',
    profile,
    id: req.id,
    registrationId: 'reg1',
    name: 'qualified',
  });
  const handle = await registered;
  const invocation = {
    type: 'webmcp.invoke',
    profile,
    registrationId: handle.id,
    callId: 'c1',
    sequence: 1,
    arguments: {},
  };
  f.receive(invocation);
  f.receive(invocation);
  await tick();
  expect(calls).toBe(1);
  expect(f.sent.filter((m) => m.type === 'webmcp.complete')).toHaveLength(1);
  expect(f.sent.at(-1).result).toBe(1);
  f.receive(invocation);
  await tick();
  expect(calls).toBe(1);
  const unregister = handle.unregister();
  f.receive({ type: 'webmcp.unregister.result', profile, id: f.sent.at(-1).id, ok: true });
  await unregister;
  f.receive({ ...invocation, callId: 'c2', sequence: 2 });
  await tick();
  expect(calls).toBe(1);
  expect(f.sent.at(-1).error.code).toBe('unknown-tool');
  f.lifecycle.pagehide();
});
test('abort reaches the executor; binding acknowledges settled cancellation and teardown rejects pending registration', async () => {
  const f = await fixture();
  let signal: AbortSignal | undefined;
  let finish!: (v: unknown) => void;
  const register = f.api.registerTool(
    { name: 'wait', description: 'Wait', inputSchema: { type: 'object' } },
    (_: unknown, c: { signal: AbortSignal }) => {
      signal = c.signal;
      return new Promise((r) => (finish = r));
    },
  );
  f.receive({
    type: 'webmcp.register.result',
    profile,
    id: f.sent.at(-1).id,
    registrationId: 'reg',
    name: 'wait',
  });
  await register;
  f.receive({
    type: 'webmcp.invoke',
    profile,
    registrationId: 'reg',
    callId: 'c',
    sequence: 1,
    arguments: {},
  });
  await tick();
  f.receive({ type: 'webmcp.cancel', profile, registrationId: 'reg', callId: 'c' });
  expect(signal?.aborted).toBe(true);
  finish({ late: true });
  await tick();
  expect(f.sent.at(-1).error.code).toBe('cancelled');
  const pending = f.api.registerTool({ name: 'next' }, () => {}).catch((e: Error) => e);
  f.lifecycle.pagehide();
  expect((await pending).message).toContain('Document closed');
});

test('document reset blocks local dispatch before the host acknowledges revocation', async () => {
  const f = await fixture();
  let count = 0;
  const registering = f.api.registerTool(
    { name: 'read', description: 'Read', inputSchema: { type: 'object' } },
    () => ++count,
  );
  f.receive({
    type: 'webmcp.register.result',
    profile,
    id: f.sent.at(-1).id,
    registrationId: 'reg',
    name: 'read',
  });
  await registering;
  const resetting = f.api.reset();
  const request = f.sent.at(-1);
  f.receive({
    type: 'webmcp.invoke',
    profile,
    registrationId: 'reg',
    callId: 'old',
    sequence: 1,
    arguments: {},
  });
  await tick();
  expect(count).toBe(0);
  expect(f.sent.at(-1).error.code).toBe('permission-denied');
  f.receive({ type: 'webmcp.reset.result', profile, id: request.id, ok: true });
  await resetting;
  f.receive({
    type: 'webmcp.invoke',
    profile,
    registrationId: 'reg',
    callId: 'new',
    sequence: 2,
    arguments: {},
  });
  await tick();
  expect(count).toBe(1);
  expect(f.sent.at(-1).result).toBe(1);
  f.lifecycle.pagehide();
});
