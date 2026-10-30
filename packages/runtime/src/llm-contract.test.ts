import { expect, test } from 'bun:test';
import { LlmSession, type LlmService } from './llm-contract';
import { infer } from './inference-provider';
const model = {
  handle: 'private-connection:1',
  name: 'Fixture',
  model: 'test-model',
  route: 'Local fixture',
  images: true,
  json: true,
};
const request = (handle: string) => ({
  handle,
  messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'private case' }] }],
  format: 'json' as const,
});
function setup() {
  const lifetime = new AbortController(),
    sent: unknown[] = [];
  let calls = 0,
    allowed = true;
  const service: LlmService = {
    select: async () => model,
    describe: async () => model,
    generate: async (r, s, d) => {
      calls++;
      s.throwIfAborted();
      d('{"ok":true}');
      return { text: '{"ok":true}', finish: 'stop' };
    },
  };
  const session = new LlmSession(
    service,
    lifetime.signal,
    async () => allowed,
    (d) => sent.push(d),
  );
  return {
    session,
    service,
    lifetime,
    sent,
    deny: () => {
      allowed = false;
    },
    calls: () => calls,
  };
}
test('model handles are scoped to a napplet lifetime and consent gates provider traffic', async () => {
  const a = setup(),
    b = setup();
  const selected = await a.session.handle({ type: 'llm.select', requirements: { json: true } });
  const handle = (selected.model as typeof model).handle;
  expect(handle).not.toBe(model.handle);
  await expect(
    b.session.handle({ type: 'llm.generate', id: 'b', request: request(handle) }),
  ).rejects.toThrow('selection-expired');
  a.deny();
  await expect(
    a.session.handle({ type: 'llm.generate', id: 'a', request: request(handle) }),
  ).rejects.toThrow('user-cancelled');
  expect(a.calls()).toBe(0);
});
test('connection changes invalidate handles; cancellation suppresses late output', async () => {
  const a = setup();
  const selected = await a.session.handle({ type: 'llm.select' }),
    handle = (selected.model as typeof model).handle;
  a.service.describe = async () => ({ ...model, model: 'changed' });
  await expect(
    a.session.handle({ type: 'llm.generate', id: 'one', request: request(handle) }),
  ).rejects.toThrow('selection-expired');
  a.service.describe = async () => model;
  let entered!: () => void, release!: () => void;
  const ready = new Promise<void>((r) => (entered = r)),
    waiting = new Promise<void>((r) => (release = r));
  a.service.generate = async (r, s, d) => {
    entered();
    await waiting;
    d('late secret');
    return { text: 'late', finish: 'stop' };
  };
  const pending = a.session.handle({
    type: 'llm.generate',
    id: 'cancel-me',
    request: request(handle),
  });
  await ready;
  await a.session.handle({ type: 'llm.cancel', requestId: 'cancel-me' });
  release();
  await expect(pending).rejects.toThrow();
  expect(a.sent).toEqual([]);
  a.lifetime.abort();
  await expect(a.session.handle({ type: 'llm.select' })).rejects.toThrow();
});
test('provider adapter never forwards HTTP errors, credential echoes or incomplete output', async () => {
  const c = {
    provider: 'openai',
    endpoint: 'https://provider.test/v1',
    model: 'test',
    key: 'private-key',
  };
  const run = (data: unknown, status = 200) =>
    infer(
      c,
      request('h'),
      new AbortController().signal,
      (async () =>
        new Response(JSON.stringify(data), { status })) as unknown as unknown as typeof fetch,
    );
  await expect(run({ error: 'private-key private case' }, 401)).rejects.toThrow('HTTP 401');
  await expect(
    run({ choices: [{ message: { content: 'private-key' }, finish_reason: 'stop' }] }),
  ).rejects.toThrow('withheld');
  await expect(run({ choices: [{ message: { content: '{"ok":true}' } }] })).rejects.toThrow(
    'completed',
  );
  expect(
    (await run({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] })).finish,
  ).toBe('length');
});
test('provider adapters preserve image payloads and roles; unsupported system images fail before network', async () => {
  let body: any;
  const fetcher = (async (url: unknown, options: RequestInit) => {
    body = JSON.parse(options.body as string);
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: 'STOP' }],
      }),
    );
  }) as unknown as typeof fetch;
  const r = {
    ...request('h'),
    messages: [
      { role: 'system' as const, content: [{ type: 'text' as const, text: 'instructions' }] },
      {
        role: 'user' as const,
        content: [{ type: 'image' as const, mimeType: 'image/png' as const, data: 'AAAA' }],
      },
    ],
  };
  await infer(
    { provider: 'google', endpoint: 'https://example.test/v1beta', model: 'gemini' },
    r,
    new AbortController().signal,
    fetcher,
  );
  expect(body.contents[0].parts[0].inlineData.data).toBe('AAAA');
  expect(body.systemInstruction.parts[0].text).toBe('instructions');
  await expect(
    infer(
      { provider: 'anthropic', endpoint: 'https://example.test/v1', model: 'claude' },
      { ...r, format: 'text', messages: [{ ...r.messages[1], role: 'system' }] },
      new AbortController().signal,
      fetcher,
    ),
  ).rejects.toThrow('system instructions');
});

test('cancellation during connection revalidation cannot start a paid provider request', async () => {
  const a = setup(),
    selected = await a.session.handle({ type: 'llm.select' });
  let resume!: (m: typeof model) => void;
  a.service.describe = () => new Promise((r) => (resume = r));
  const generation = a.session.handle({
    type: 'llm.generate',
    id: 'early',
    request: request((selected.model as typeof model).handle),
  });
  expect(await a.session.handle({ type: 'llm.cancel', requestId: 'early' })).toEqual({
    cancelled: true,
  });
  resume(model);
  await expect(generation).rejects.toThrow();
  expect(a.calls()).toBe(0);
});

test('LLM-C10: JSON object validation, refusal and provider tool calls cannot masquerade as completion', async () => {
  const c = { provider: 'compatible', endpoint: 'https://provider.test/v1', model: 'fixture' };
  const run = (content: unknown, finish_reason: string, refusal?: string) =>
    infer(c, request('h'), new AbortController().signal, (async () =>
      Response.json({
        choices: [{ message: { content, refusal }, finish_reason }],
      })) as unknown as typeof fetch);
  for (const value of ['[]', 'null', '42', 'broken'])
    await expect(run(value, 'stop')).rejects.toThrow('JSON object');
  expect(await run(null, 'stop', 'declined')).toMatchObject({ text: '', finish: 'refusal' });
  await expect(run('call a tool', 'tool_calls')).rejects.toThrow('completed text');
});
