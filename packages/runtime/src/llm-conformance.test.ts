import { expect, test } from 'bun:test';
import { LlmSession, type LlmService, type Generation } from './llm-contract';

const model = {
  handle: 'private',
  name: 'Fixture',
  model: 'fixture',
  route: 'Local test',
  images: false,
  json: true,
};
const input = (handle: string) => ({
  handle,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'private input' }] }],
});
function fixture(
  timeoutMs = 1000,
  consent: (text: string, signal: AbortSignal) => Promise<boolean> = async () => true,
) {
  const lifetime = new AbortController();
  const sent: unknown[] = [];
  let calls = 0;
  const service: LlmService = {
    select: async () => model,
    describe: async () => model,
    generate: async () => {
      calls++;
      return { text: 'ok', finish: 'stop' };
    },
  };
  const session = new LlmSession(service, lifetime.signal, consent, (m) => sent.push(m), timeoutMs);
  return {
    session,
    service,
    lifetime,
    sent,
    calls: () => calls,
    select: async () =>
      ((await session.handle({ type: 'llm.select' })).model as typeof model).handle,
  };
}

test('LLM-C02/C03: unsupported requirements and malformed requests have no provider effects', async () => {
  const f = fixture();
  for (const request of [null, undefined, {}, { handle: '' }])
    await expect(
      f.session.handle({ type: 'llm.generate', id: 'invalid', request }),
    ).rejects.toMatchObject({ name: 'ZodError' });
  for (const requirements of [{ images: true }, { model: 'different' }])
    await expect(f.session.handle({ type: 'llm.select', requirements })).rejects.toThrow(
      'unsupported',
    );
  const handle = await f.select();
  for (const request of [
    { ...input(handle), endpoint: 'https://evil.test' },
    {
      ...input(handle),
      messages: [
        { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'abc' }] },
      ],
    },
    { ...input(handle), format: null },
  ])
    await expect(
      f.session.handle({ type: 'llm.generate', id: crypto.randomUUID(), request }),
    ).rejects.toThrow();
  await expect(
    f.session.handle({
      type: 'llm.generate',
      id: 'image',
      request: {
        ...input(handle),
        messages: [
          { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }] },
        ],
      },
    }),
  ).rejects.toThrow('unsupported');
  expect(f.calls()).toBe(0);
});

test('LLM-C05/C06: endpoint-local cancel and duplicate IDs cannot start a second generation', async () => {
  const a = fixture(),
    b = fixture();
  const handle = await a.select();
  let enter!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  let starts = 0;
  a.service.generate = async () => {
    starts++;
    enter();
    return new Promise(() => {});
  };
  const pending = a.session.handle({ type: 'llm.generate', id: 'same', request: input(handle) });
  const rejected = pending.catch((error) => error);
  await entered;
  expect(await b.session.handle({ type: 'llm.cancel', requestId: 'same' })).toEqual({
    cancelled: false,
  });
  await expect(
    a.session.handle({ type: 'llm.generate', id: 'same', request: input(handle) }),
  ).rejects.toThrow('Duplicate');
  expect(starts).toBe(1);
  expect(await a.session.handle({ type: 'llm.cancel', requestId: 'same' })).toEqual({
    cancelled: true,
  });
  expect(await rejected).toBeInstanceOf(Error);
  expect(await a.session.handle({ type: 'llm.cancel', requestId: 'same' })).toEqual({
    cancelled: false,
  });
});

test('LLM-C07: cancel while consent is pending settles without waiting for the dialog', async () => {
  let approve!: (allowed: boolean) => void, enter!: () => void;
  const entered = new Promise<void>((r) => (enter = r));
  const f = fixture(1000, async () => {
    enter();
    return new Promise((r) => (approve = r));
  });
  const pending = f.session.handle({
    type: 'llm.generate',
    id: 'waiting',
    request: input(await f.select()),
  });
  const rejected = pending.catch((error) => error);
  await entered;
  await f.session.handle({ type: 'llm.cancel', requestId: 'waiting' });
  expect(await rejected).toBeInstanceOf(Error);
  approve(true);
  await Bun.sleep(0);
  expect(f.calls()).toBe(0);
});

test('LLM-C07/C08: timeout and account revocation settle stalled providers, suppressing late results', async () => {
  for (const reason of ['timeout', 'revoke']) {
    const f = fixture(reason === 'timeout' ? 20 : 1000);
    let release!: (value: Generation) => void, delta!: (text: string) => void, enter!: () => void;
    const entered = new Promise<void>((r) => (enter = r));
    f.service.generate = async (_r, _s, d) => {
      delta = d;
      enter();
      return new Promise((r) => (release = r));
    };
    const pending = f.session.handle({
      type: 'llm.generate',
      id: 'slow',
      request: input(await f.select()),
    });
    const rejected = pending.catch((error) => error);
    await entered;
    if (reason === 'revoke') f.lifetime.abort();
    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    if (reason === 'timeout') expect(error.message).toContain('timeout:');
    delta('late private output');
    release({ text: 'late', finish: 'stop' });
    await Bun.sleep(0);
    expect(f.sent).toEqual([]);
  }
});

test('LLM-C08: changing the model during consent requires a new selection', async () => {
  const f = fixture(1000, async () => {
    f.service.describe = async () => ({ ...model, model: 'changed' });
    return true;
  });
  await expect(
    f.session.handle({ type: 'llm.generate', id: 'changed', request: input(await f.select()) }),
  ).rejects.toThrow('selection-expired');
  expect(f.calls()).toBe(0);
});

test('LLM-C09/C10: ordered deltas end at the authoritative final result, preserving partial completion', async () => {
  const f = fixture();
  let delta!: (text: string) => void;
  f.service.generate = async (_r, _s, d) => {
    delta = d;
    d('a');
    d('b');
    return { text: 'complete partial', finish: 'length' };
  };
  const result = await f.session.handle({
    type: 'llm.generate',
    id: 'stream',
    request: input(await f.select()),
  });
  expect(result).toEqual({ result: { text: 'complete partial', finish: 'length' } });
  delta('after final');
  expect(f.sent).toEqual([
    { type: 'llm.delta', requestId: 'stream', sequence: 0, text: 'a' },
    { type: 'llm.delta', requestId: 'stream', sequence: 1, text: 'b' },
  ]);
  expect(await f.session.handle({ type: 'llm.cancel', requestId: 'stream' })).toEqual({
    cancelled: false,
  });
});

test('LLM-C01/C10: optional consumer keeps fallback, validates application output and never retries partial answers', async () => {
  const { suggestLabel } = await import('../../../examples/nap-llm');
  expect(await suggestLabel(undefined, 'example')).toEqual({ available: false });
  let calls = 0;
  const api = {
    select: async () => model,
    generate: async (): Promise<Generation> => {
      calls++;
      return { text: '{"label":"Example"}', finish: 'stop' };
    },
  };
  expect(await suggestLabel(api, 'example')).toEqual({ available: true, label: 'Example' });
  api.generate = async () => {
    calls++;
    return { text: '{"label":"partial"}', finish: 'length' };
  };
  await expect(suggestLabel(api, 'example')).rejects.toThrow('incomplete');
  expect(calls).toBe(2);
  api.generate = async () => ({ text: '{"different":true}', finish: 'stop' });
  await expect(suggestLabel(api, 'example')).rejects.toThrow('usable label');
});
