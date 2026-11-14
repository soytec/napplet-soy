import { test, expect } from 'bun:test';
import { NappletTools } from './session';
import { WEBMCP_PROFILE as profile, descriptor, json, ToolError } from './contract';
import { projectBrowserTools } from './native';
const tool = {
  name: 'edit',
  description: 'Edit the document',
  inputSchema: {
    type: 'object',
    properties: { revision: { type: 'integer', minimum: 0 } },
    required: ['revision'],
    additionalProperties: false,
  },
  outputSchema: { type: 'object' },
  readOnly: false,
};
function fixture(timeout = 1000) {
  const sent: any[] = [];
  const session = new NappletTools('Drawing', 'verified-scope', (m) => sent.push(m), timeout);
  const deliver = (type: string, data: object = {}) => session.handle({ type, profile, ...data });
  deliver('webmcp.register', { id: 'r', tool });
  const entry = session.snapshot().tools[0];
  const complete = (result: unknown = { revision: 1 }, extra: object = {}) => {
    const invocation = [...sent].reverse().find((m) => m.type === 'webmcp.invoke');
    deliver('webmcp.complete', {
      callId: invocation.callId,
      registrationId: entry.id,
      result,
      ...extra,
    });
  };
  return { session, sent, deliver, entry, complete };
}
test('tools are withheld; instances have unique namespaces and cannot resolve each other’s calls', async () => {
  const a = fixture(),
    b = fixture();
  expect(a.entry.name).not.toBe(b.entry.name);
  await expect(a.session.invoke(a.entry.id, { revision: 0 }, 'shell')).rejects.toMatchObject({
    code: 'permission-denied',
  });
  a.session.grant('shell', true);
  await expect(a.session.invoke(b.entry.id, { revision: 0 }, 'shell')).rejects.toMatchObject({
    code: 'unknown-tool',
  });
  const p = a.session.invoke(a.entry.id, { revision: 0 }, 'shell');
  a.deliver('webmcp.complete', {
    callId: a.sent.at(-1).callId,
    registrationId: b.entry.id,
    result: { forged: true },
  });
  expect(a.session.snapshot().active).not.toBeNull();
  a.complete();
  expect(await p).toEqual({ revision: 1 });
  a.session.close();
  b.session.close();
});
test('schemas, malformed JSON, size, duplicate registration and results are checked', async () => {
  const f = fixture();
  f.session.grant('shell', true);
  for (const args of [
    {},
    [],
    { revision: 0, extra: true },
    { revision: NaN },
    { revision: 0, padding: 'x'.repeat(300000) },
  ])
    await expect(f.session.invoke(f.entry.id, args, 'shell')).rejects.toBeInstanceOf(ToolError);
  expect(() =>
    descriptor({ ...tool, inputSchema: { type: 'object', $ref: 'https://example.com/schema' } }),
  ).toThrow('Unsupported');
  expect(() =>
    json({
      get secret() {
        return () => {};
      },
    }),
  ).toThrow('Only finite');
  f.deliver('webmcp.register', { id: 'duplicate', tool });
  expect(f.sent.at(-1).error.code).toBe('duplicate-tool');
  const p = f.session.invoke(f.entry.id, { revision: 0 }, 'shell').catch((e) => e);
  f.complete([]);
  expect((await p).code).toBe('invalid-arguments');
  expect(f.session.snapshot().active).toBeNull();
  f.session.close();
});
test('one running plus eight queued calls; revoke/abort stops work without retrying an unknown mutation', async () => {
  const f = fixture();
  f.session.grant('shell', true);
  const calls = Array.from({ length: 9 }, () =>
    f.session.invoke(f.entry.id, { revision: 0 }, 'shell').catch((e) => e),
  );
  await expect(f.session.invoke(f.entry.id, { revision: 0 }, 'shell')).rejects.toMatchObject({
    code: 'busy',
  });
  expect(f.sent.filter((m) => m.type === 'webmcp.invoke')).toHaveLength(1);
  f.session.grant('shell', false);
  expect((await Promise.all(calls)).every((e) => e instanceof Error)).toBe(true);
  f.session.grant('shell', true);
  await expect(f.session.invoke(f.entry.id, { revision: 0 }, 'shell')).rejects.toMatchObject({
    code: 'busy',
  });
  f.complete({ late: true });
  expect(f.sent.filter((m) => m.type === 'webmcp.invoke')).toHaveLength(1);
  const p = f.session.invoke(f.entry.id, { revision: 1 }, 'shell');
  f.complete({ revision: 2 });
  expect(await p).toEqual({ revision: 2 });
  f.session.close();
});
test('timeout is unknown outcome; no automatic retry; withdrawal/account teardown cannot revive calls', async () => {
  const f = fixture(10);
  f.session.grant('shell', true);
  await expect(f.session.invoke(f.entry.id, { revision: 0 }, 'shell')).rejects.toMatchObject({
    code: 'timeout',
  });
  expect(f.sent.filter((m) => m.type === 'webmcp.invoke')).toHaveLength(1);
  expect(f.session.snapshot().active?.cancelled).toBe(true);
  f.complete();
  const p = f.session.invoke(f.entry.id, { revision: 0 }, 'shell').catch((e) => e);
  f.deliver('webmcp.unregister', { id: 'u', registrationId: f.entry.id });
  expect((await p).code).toBe('unknown-tool');
  f.session.close();
  f.complete();
  expect(f.session.snapshot().tools).toEqual([]);
});
test('context reset and new registrations withdraw grants; browser and internal grants are separate', async () => {
  const f = fixture();
  f.session.grant('shell', true);
  await expect(f.session.invoke(f.entry.id, { revision: 0 }, 'browser')).rejects.toMatchObject({
    code: 'permission-denied',
  });
  f.deliver('webmcp.reset', { id: 'reset' });
  expect(f.session.snapshot().grants).toEqual([]);
  f.session.grant('shell', true);
  f.deliver('webmcp.register', { id: 'new', tool: { ...tool, name: 'other' } });
  expect(f.session.snapshot().grants).toEqual([]);
  f.session.close();
});
test('browser adapter uses document API registration abort and no foreign exposed origins; revoke during registration is safe', async () => {
  const f = fixture(),
    registered: any[] = [];
  const stop = projectBrowserTools(f.session, {
    registerTool: async (tool, options) => {
      registered.push({ tool, options });
    },
  });
  f.session.grant('browser', true);
  await Promise.resolve();
  expect(registered).toHaveLength(1);
  expect(registered[0].options.exposedTo).toEqual([]);
  expect(registered[0].tool.annotations.untrustedContentHint).toBe(true);
  const p = registered[0].tool.execute({ revision: 0 }, {});
  f.complete();
  expect(await p).toEqual({ revision: 1 });
  f.session.grant('browser', false);
  expect(registered[0].options.signal.aborted).toBe(true);
  await expect(registered[0].tool.execute({ revision: 0 }, {})).rejects.toMatchObject({
    code: 'permission-denied',
  });
  stop();
  f.session.close();
});

test('malformed terminal results release the queue; pre-dispatch abort never executes', async () => {
  const f = fixture();
  f.session.grant('shell', true);
  const controller = new AbortController();
  controller.abort();
  await expect(
    f.session.invoke(f.entry.id, { revision: 0 }, 'shell', controller.signal),
  ).rejects.toMatchObject({ code: 'cancelled' });
  expect(f.sent.filter((m) => m.type === 'webmcp.invoke')).toHaveLength(0);
  const p = f.session.invoke(f.entry.id, { revision: 0 }, 'shell').catch((e) => e);
  f.complete({ bad: Infinity });
  expect((await p).code).toBe('invalid-data');
  expect(f.session.snapshot().active).toBeNull();
  expect(() =>
    descriptor({ description: 'Missing name', inputSchema: { type: 'object' } }),
  ).toThrow('descriptor');
  const next = f.session.invoke(f.entry.id, { revision: 0 }, 'shell');
  f.complete({ revision: 1 });
  expect(await next).toEqual({ revision: 1 });
  f.session.close();
});

test('master switch revokes every document and native projection; enabling never restores grants', async () => {
  const { setWebmcpEnabled } = await import('./preference');
  const a = fixture(),
    b = fixture(),
    registered = new Map<string, unknown>();
  const dispose = projectBrowserTools(
    a.session,
    {
      registerTool(t: any, options: any) {
        registered.set(t.name, t);
        options.signal.addEventListener('abort', () => registered.delete(t.name));
      },
    } as any,
    () => {},
  );
  try {
    expect(a.session.snapshot().enabled).toBe(true);
    a.session.grant('shell', true);
    a.session.grant('browser', true);
    b.session.grant('shell', true);
    await Promise.resolve();
    expect(registered.size).toBe(1);
    const active = a.session.invoke(a.entry.id, { revision: 0 }, 'shell').catch((e) => e);
    const queued = a.session.invoke(a.entry.id, { revision: 0 }, 'shell').catch((e) => e);
    setWebmcpEnabled(false);
    expect((await active).code).toBe('permission-denied');
    expect((await queued).code).toBe('permission-denied');
    expect(registered.size).toBe(0);
    expect(b.session.snapshot().grants).toEqual([]);
    a.session.grant('shell', true);
    expect(a.session.snapshot().grants).toEqual([]);
    const later = fixture();
    later.session.grant('shell', true);
    expect(later.session.snapshot().grants).toEqual([]);
    later.session.close();
    setWebmcpEnabled(true);
    expect(a.session.snapshot().grants).toEqual([]);
    a.complete();
    a.session.grant('shell', true);
    const result = a.session.invoke(a.entry.id, { revision: 0 }, 'shell');
    a.complete();
    expect(await result).toEqual({ revision: 1 });
  } finally {
    dispose();
    a.session.close();
    b.session.close();
    setWebmcpEnabled(true);
  }
});
