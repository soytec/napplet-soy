import { expect, test } from 'bun:test';
import { IntentWorkspace, intentCatalogId, intentContracts } from './intent-session';
const contract = 'napplet:black-site-map/edit';
const entry = (id: string) => ({
  id,
  title: id,
  contracts: [{ convention: contract, params: ['address'] }],
});
const invoke = (handler?: string) => ({
  type: 'intent.invoke',
  request: {
    archetype: 'black-site-map',
    action: 'edit',
    convention: contract,
    payload: { map: 'one' },
    sender: 'forged',
    ...(handler ? { handler } : {}),
  },
});

test('catalog contracts match z independently of tag order and preserve parameters', () => {
  expect(
    intentContracts([
      ['i', contract, 'address', 'id'],
      ['z', 'other'],
      ['z', 'black-site-map'],
      ['i', contract + '?map=x'],
      ['i', 'napplet:other/open'],
    ]),
  ).toEqual([
    { convention: contract, params: ['address', 'id'] },
    { convention: 'napplet:other/open', params: [] },
  ]);
  const base = { kind: 35129, pubkey: 'a'.repeat(64), id: 'c'.repeat(64), tags: [['d', 'Map']] };
  expect(intentCatalogId(base)).not.toBe(intentCatalogId({ ...base, pubkey: 'b'.repeat(64) }));
  expect(intentCatalogId(base)).toBe(intentCatalogId({ ...base, id: 'd'.repeat(64) }));
  expect(intentCatalogId({ ...base, kind: 5129 })).not.toBe(
    intentCatalogId({ ...base, kind: 5129, id: 'd'.repeat(64) }),
  );
});
test('accepted cold delivery survives source close, waits for target readiness, and attests sender', async () => {
  let launched = 0;
  const workspace = new IntentWorkspace({
    choose: async () => null,
    launch: async () => {
      launched++;
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('editor'));
  const source = workspace.attach('source', () => {});
  source.ready();
  expect(await source.handle(invoke())).toEqual({
    result: {
      ok: true,
      archetype: 'black-site-map',
      action: 'edit',
      convention: contract,
      handler: 'editor',
    },
  });
  source.close();
  await Bun.sleep(5);
  expect(launched).toBe(1);
  const sent: unknown[] = [];
  const target = workspace.attach('editor', (m) => sent.push(m));
  expect(sent).toEqual([]);
  target.ready();
  expect(sent).toEqual([
    {
      type: 'intent.deliver',
      delivery: {
        sender: 'source',
        archetype: 'black-site-map',
        action: 'edit',
        convention: contract,
        payload: { map: 'one' },
      },
    },
  ]);
  target.ready();
  expect(sent).toHaveLength(1);
});
test('default and explicit chooser obey exact contracts and cancelled invocations are not accepted', async () => {
  let choice: string | null = null;
  const workspace = new IntentWorkspace({ choose: async () => choice, launch: async () => {} });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('first'));
  workspace.register(entry('second'));
  const source = workspace.attach('source', () => {});
  expect((await source.handle(invoke())).result).toEqual({ ok: false, error: 'user cancelled' });
  workspace.setDefault('black-site-map', 'second');
  expect((await source.handle(invoke())).result).toMatchObject({ ok: true, handler: 'second' });
  expect((await source.handle(invoke('choose'))).result).toEqual({
    ok: false,
    error: 'user cancelled',
  });
  choice = 'first';
  expect((await source.handle(invoke('first'))).result).toMatchObject({
    ok: true,
    handler: 'first',
  });
  expect(
    (
      await source.handle({
        ...invoke(),
        request: { ...invoke().request, convention: contract + '?x=y' },
      })
    ).result,
  ).toMatchObject({ ok: false, error: 'invalid convention' });
});
test('reuse sends to a ready target and focus honors hint; close stops future changed notifications', async () => {
  let launched = 0,
    focused = 0;
  const workspace = new IntentWorkspace({
    choose: async () => null,
    launch: async () => {
      launched++;
    },
    focus: () => {
      focused++;
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('editor'));
  const source = workspace.attach('source', () => {}),
    sent: unknown[] = [];
  const target = workspace.attach('editor', (m) => sent.push(m));
  target.ready();
  await source.handle(invoke());
  await Bun.sleep(5);
  expect(launched).toBe(0);
  expect(focused).toBe(1);
  expect(sent).toHaveLength(1);
  await source.handle({
    ...invoke(),
    request: { ...invoke().request, behavior: { focus: false } },
  });
  await Bun.sleep(5);
  expect(focused).toBe(1);
  target.close();
  workspace.setDefault('black-site-map', 'editor');
  expect(sent).toHaveLength(2);
});

test('availability discovers installed targets and removal emits an unavailable role', async () => {
  const seen: string[] = [],
    sent: Record<string, unknown>[] = [];
  const workspace = new IntentWorkspace({
    choose: async () => null,
    launch: async () => {},
    discover: async (role) => {
      seen.push(role);
      if (role) workspace.register(entry('editor'));
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  const source = workspace.attach('source', (message) => sent.push(message));
  source.ready();
  expect(
    await source.handle({ type: 'intent.available', archetype: 'black-site-map' }),
  ).toMatchObject({ availability: { available: true, candidates: [{ id: 'editor' }] } });
  expect(seen).toEqual(['black-site-map']);
  workspace.remove('editor');
  expect(sent.at(-1)).toEqual({
    type: 'intent.changed',
    availability: {
      archetype: 'black-site-map',
      available: false,
      candidates: [],
      hasDefault: false,
    },
  });
});

test('public installation verifies manifest signatures before catalog admission', async () => {
  const workspace = new IntentWorkspace({ choose: async () => null, launch: async () => {} });
  await expect(
    workspace.install({
      kind: 35129,
      pubkey: 'a'.repeat(64),
      id: 'b'.repeat(64),
      sig: 'c'.repeat(128),
      created_at: 1,
      content: '',
      tags: [
        ['d', 'map'],
        ['x', 'd'.repeat(64)],
        ['z', 'black-site-map'],
        ['i', contract],
      ],
    }),
  ).rejects.toThrow();
  expect(workspace.handlers()).toEqual([]);
});

test('closing source during chooser rejects before acceptance; chooser cannot select unoffered catalog ids', async () => {
  let answer: (id: string | null) => void = () => {};
  let launches = 0;
  const workspace = new IntentWorkspace({
    choose: () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
    launch: async () => {
      launches++;
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('first'));
  workspace.register(entry('second'));
  const source = workspace.attach('source', () => {});
  const result = source.handle(invoke('choose'));
  await Bun.sleep(0);
  source.close();
  answer('first');
  expect(await result).toEqual({ result: { ok: false, error: 'source closed' } });
  const second = workspace.attach('source', () => {});
  const invalid = second.handle(invoke('first'));
  await Bun.sleep(0);
  answer('second');
  expect(await invalid).toEqual({ result: { ok: false, error: 'invoke rejected' } });
  await Bun.sleep(5);
  expect(launches).toBe(0);
});

test('multiple cold deliveries share one startup and retain arrival order until newly attached target is ready', async () => {
  let launches = 0;
  const workspace = new IntentWorkspace({
    choose: async () => null,
    launch: async () => {
      launches++;
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('editor'));
  const source = workspace.attach('source', () => {});
  for (const number of [1, 2, 3])
    expect(
      (await source.handle({ ...invoke(), request: { ...invoke().request, payload: { number } } }))
        .result,
    ).toMatchObject({ ok: true });
  source.close();
  await Bun.sleep(5);
  expect(launches).toBe(1);
  const sent: Record<string, unknown>[] = [];
  const target = workspace.attach('editor', (message) => sent.push(message));
  expect(sent).toHaveLength(0);
  target.ready();
  expect(sent.map((message) => (message.delivery as { payload: unknown }).payload)).toEqual([
    { number: 1 },
    { number: 2 },
    { number: 3 },
  ]);
  expect(workspace.dropPending('editor')).toBe(0);
});

test('terminal startup timeout drops payload and reports once; cancelled launch cannot poison a later invocation', async () => {
  const failed: unknown[] = [];
  const rejectLaunch: ((error: unknown) => void)[] = [];
  const signals: AbortSignal[] = [];
  const workspace = new IntentWorkspace({
    choose: async () => null,
    startupTimeoutMs: 15,
    failed: (_entry, error) => failed.push(error),
    launch: (_entry, _behavior, signal) => {
      signals.push(signal!);
      return new Promise((_resolve, reject) => rejectLaunch.push(reject));
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('editor'));
  const source = workspace.attach('source', () => {});
  await source.handle(invoke());
  await Bun.sleep(5);
  expect(workspace.dropPending('editor')).toBe(1);
  expect(signals[0].aborted).toBe(true);
  await source.handle(invoke());
  await Bun.sleep(5);
  rejectLaunch[0](new Error('old launch failed'));
  await Bun.sleep(0);
  expect(failed).toHaveLength(0);
  expect(signals[1].aborted).toBe(false);
  await Bun.sleep(25);
  expect(failed).toHaveLength(1);
  expect(signals[1].aborted).toBe(true);
  const sent: unknown[] = [];
  workspace.attach('editor', (message) => sent.push(message)).ready();
  expect(sent).toHaveLength(0);
});

test('opaque structured payloads remain supported while large backing buffers, sparse arrays and uncloneable values reject', async () => {
  const workspace = new IntentWorkspace({ choose: async () => null, launch: async () => {} });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('editor'));
  const source = workspace.attach('source', () => {});
  const payload = (value: unknown) => ({
    ...invoke(),
    request: { ...invoke().request, payload: value },
  });
  for (const value of [
    'x'.repeat(1024 * 1024 + 1),
    new Uint8Array(new ArrayBuffer(2 * 1024 * 1024), 0, 1),
    new Array(1000000),
  ])
    expect((await source.handle(payload(value))).result).toEqual({
      ok: false,
      error: 'intent payload too large',
    });
  expect((await source.handle(payload(() => {}))).result).toEqual({
    ok: false,
    error: 'invalid intent payload',
  });
  const circular: { self?: unknown; values: Map<string, unknown> } = {
    values: new Map([['blob', new Blob(['one'])]]),
  };
  circular.self = circular;
  expect((await source.handle(payload(circular))).result).toMatchObject({ ok: true });
  workspace.dropPending('editor');
});

test('cancelling responsibility before scheduled startup never opens a ghost target', async () => {
  let launches = 0;
  const workspace = new IntentWorkspace({
    choose: async () => null,
    launch: async () => {
      launches++;
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('editor'));
  await workspace.attach('source', () => {}).handle(invoke());
  expect(workspace.dropPending('editor')).toBe(1);
  await Bun.sleep(5);
  expect(launches).toBe(0);
});

test('a target send failure reports terminal delivery failure rather than losing responsibility silently', async () => {
  let failed = 0;
  const workspace = new IntentWorkspace({
    choose: async () => null,
    launch: async () => {},
    failed: () => {
      failed++;
    },
  });
  workspace.register({ id: 'source', contracts: [] });
  workspace.register(entry('editor'));
  await workspace.attach('source', () => {}).handle(invoke());
  await Bun.sleep(5);
  workspace
    .attach('editor', () => {
      throw new Error('endpoint gone');
    })
    .ready();
  expect(failed).toBe(1);
  expect(workspace.dropPending('editor')).toBe(0);
});
