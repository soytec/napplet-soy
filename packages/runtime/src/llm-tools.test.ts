import { test, expect } from 'bun:test';
import {
  generationSchema,
  LlmSession,
  type GenerationRequest,
  type LlmModel,
  type LlmService,
} from './llm-contract';
import { infer } from './inference-provider';
import { inferenceCapabilities } from './inference-capabilities';

const base = () =>
  generationSchema.parse({
    handle: 'h',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Calculate.' }] }],
    tools: [{ name: 'sum' }],
  });
const call = (toolCallId = 'a', name = 'sum') => ({
  type: 'toolCall' as const,
  toolCallId,
  name,
  arguments: { a: 2 },
});
const result = (toolCallId = 'a', toolName = 'sum') => ({
  role: 'toolResult' as const,
  toolCallId,
  toolName,
  content: [{ type: 'text' as const, text: '2' }],
});
const history = (): GenerationRequest => ({
  ...base(),
  messages: [
    ...base().messages,
    { role: 'assistant', content: [call(), call('b')] },
    result('b'),
    result(),
  ],
});
const completion = (
  calls: unknown[] = [
    { id: 'fresh', type: 'function', function: { name: 'sum', arguments: '{"a":2}' } },
  ],
  reason = 'stop',
) => ({ choices: [{ finish_reason: reason, message: { content: null, tool_calls: calls } }] });
function provider(provider = 'compatible', model = 'fixture') {
  const requests: any[] = [];
  let response: unknown = completion();
  return {
    requests,
    reply: (r: unknown) => {
      response = r;
    },
    run: (request: GenerationRequest = base()) =>
      infer(
        { provider, model, endpoint: 'https://provider.test/v1', key: 'test-secret' },
        request,
        new AbortController().signal,
        (async (_url: unknown, init: RequestInit) => {
          requests.push(JSON.parse(String(init.body)));
          return Response.json(response);
        }) as typeof fetch,
      ),
  };
}

test('LLM-C12/C20/C21: strict fields, schemas, choice and parallel history fail before provider traffic', async () => {
  const p = provider();
  const bad = [
    { ...history(), messages: history().messages.slice(0, -1) },
    { ...history(), messages: [...history().messages, result()] },
    { ...history(), messages: [result()] },
    { ...history(), messages: [...history().messages.slice(0, -1), result('a', 'other')] },
    {
      ...history(),
      messages: [...history().messages.slice(0, -2), ...base().messages, result('b'), result()],
    },
    { ...base(), messages: [{ role: 'user', content: [{ type: 'thinking', text: 'no' }] }] },
    { ...base(), messages: [{ ...base().messages[0], isError: false }] },
    { ...base(), tools: [{ name: 'bad name' }] },
    { ...base(), tools: [{ name: 'sum' }, { name: 'sum' }] },
    { ...base(), tools: [{ name: 'sum', parameters: { type: 'array' } }] },
    { ...base(), tools: [{ name: 'sum', parameters: { type: 'object', required: 'wrong' } }] },
    { ...base(), tools: [{ name: 'sum', unexpected: true }] },
    { ...base(), toolChoice: { type: 'tool', name: 'missing' } },
    { ...base(), tools: [], toolChoice: 'none' },
    ...[0, -1, 1.5, null].map((maxTokens) => ({ ...base(), maxTokens })),
    { ...base(), temperature: null },
    { ...base(), format: null },
    {
      ...base(),
      messages: [
        { role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'YR==' }] },
      ],
    },
  ];
  for (const request of bad) await expect(p.run(request as GenerationRequest)).rejects.toThrow();
  expect(p.requests).toHaveLength(0);
  await expect(
    p.run({
      ...base(),
      tools: [{ name: 'sum', parameters: { type: 'object', allOf: [{ type: 'object' }] } }],
    }),
  ).rejects.toThrow('unsupported');
  expect(p.requests).toHaveLength(0);
});

test('LLM-C13/C15/C16: enforce tool choice, normalize stop labels, discard every truncated call', async () => {
  const p = provider();
  expect((await p.run()).finish).toBe('toolUse');
  for (const reason of ['length', 'content_filter']) {
    p.reply(
      completion(
        [
          { id: 'a', type: 'function', function: { name: 'sum', arguments: '{}' } },
          { type: 'function', function: { name: 'sum', arguments: '{' } },
        ],
        reason,
      ),
    );
    const r = await p.run({ ...base(), toolChoice: 'required' });
    expect(r.finish).toBe(reason === 'length' ? 'length' : 'refusal');
    expect(r.content).toEqual([]);
  }
  for (const args of ['{', '[]', 'null', '1']) {
    p.reply(completion([{ type: 'function', function: { name: 'sum', arguments: args } }]));
    await expect(p.run()).rejects.toThrow('provider-error');
  }
  p.reply(completion([{ type: 'function', function: { name: 'other', arguments: '{}' } }]));
  await expect(p.run()).rejects.toThrow('provider-error');
  p.reply(completion());
  await expect(p.run({ ...base(), toolChoice: 'none' })).rejects.toThrow('provider-error');
  await expect(p.run({ ...base(), tools: [] })).rejects.toThrow('provider-error');
  await expect(
    p.run({
      ...base(),
      tools: [{ name: 'sum' }, { name: 'other' }],
      toolChoice: { type: 'tool', name: 'other' },
    }),
  ).rejects.toThrow('provider-error');
  p.reply({ choices: [{ finish_reason: 'stop', message: { content: 'No tool.' } }] });
  await expect(p.run({ ...base(), toolChoice: 'required' })).rejects.toThrow('provider-error');
});

test('LLM-C14/C17/C21/C22: synthetic IDs roundtrip, thinking is stripped, histories need no new tools', async () => {
  const p = provider();
  p.reply(completion([{ type: 'function', function: { name: 'sum', arguments: '{}' } }]));
  const first = await p.run();
  const called = first.content[0];
  if (called.type !== 'toolCall') throw new Error('expected tool call');
  expect(called.toolCallId).toBeTruthy();
  p.reply({ choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }] });
  await p.run({
    ...base(),
    tools: [],
    messages: [
      ...base().messages,
      { role: 'assistant', content: [{ type: 'thinking', text: 'display only' }, called] },
      { ...result(called.toolCallId), isError: true },
    ],
    maxTokens: 99,
    temperature: 0.5,
  });
  expect(JSON.stringify(p.requests[1])).not.toContain('display only');
  expect(p.requests[1].messages[1].tool_calls[0].id).toBe(called.toolCallId);
  expect(p.requests[1].messages[2]).toMatchObject({
    tool_call_id: called.toolCallId,
    content: 'Tool execution failed.\n2',
  });
  expect(p.requests[1].tools).toBeUndefined();
  expect(p.requests[0].tools[0].function.parameters).toEqual({
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
  expect(p.requests[1]).toMatchObject({ max_tokens: 99, temperature: 0.5 });
  expect(p.requests[0].max_tokens).toBeUndefined();
  const imageHistory = history();
  imageHistory.messages[2].content = [{ type: 'image', mimeType: 'image/png', data: 'AAAA' }];
  const count = p.requests.length;
  await expect(p.run(imageHistory)).rejects.toThrow('unsupported');
  expect(p.requests).toHaveLength(count);
  const claude = provider('anthropic');
  const thinkingHistory = history();
  thinkingHistory.messages[1].content.unshift({ type: 'thinking', text: 'Display-only reasoning' });
  await expect(claude.run(thinkingHistory)).rejects.toThrow('signed state');
  expect(claude.requests).toHaveLength(0);
  const signed = provider('google', 'gemini-3-pro');
  await expect(signed.run(history())).rejects.toThrow('opaque');
  expect(signed.requests).toHaveLength(0);
});

test('LLM-C19/C23: declared modes gate disclosure, sensitive tool inputs need explicit consent', async () => {
  const model: LlmModel = {
    handle: 'private',
    name: 'Fixture',
    model: 'fixture',
    route: 'Shell → provider.test',
    images: false,
    json: false,
    tools: true,
    toolChoiceModes: ['auto', 'none'],
  };
  let calls = 0;
  const prompts: string[] = [];
  const service: LlmService = {
    select: async () => model,
    describe: async () => model,
    generate: async () => {
      calls++;
      return { content: [], finish: 'stop' };
    },
  };
  const session = new LlmSession(
    service,
    new AbortController().signal,
    async (prompt) => {
      prompts.push(prompt);
      return false;
    },
    () => {},
  );
  const handle = (
    (
      await session.handle({
        id: crypto.randomUUID(),
        type: 'llm.select',
        requirements: { tools: true },
      })
    ).model as LlmModel
  ).handle;
  await expect(
    session.handle({
      type: 'llm.generate',
      id: 'forced',
      request: { ...base(), handle, toolChoice: 'required' },
    }),
  ).rejects.toThrow('unsupported');
  expect(prompts).toEqual([]);
  await expect(
    session.handle({
      type: 'llm.generate',
      id: 'sensitive',
      request: {
        ...history(),
        handle,
        tools: [{ name: 'sum', description: 'Private description' }],
      },
    }),
  ).rejects.toThrow('user-cancelled');
  expect(prompts[0]).toContain('1 tool definitions');
  expect(prompts[0]).toContain('2 tool results');
  expect(prompts[0]).toContain('Provider charges');
  expect(calls).toBe(0);
  expect(
    inferenceCapabilities({ provider: 'google', model: 'gemini-3-pro', tools: true })
      .toolChoiceModes,
  ).toEqual([]);
});

test('Anthropic and Google translate tools, parallel results, control fields and expanded usage', async () => {
  const a = provider('anthropic');
  a.reply({
    content: [{ type: 'tool_use', id: 'new', name: 'sum', input: { a: 2 } }],
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 5,
      output_tokens: 6,
      cache_read_input_tokens: 3,
      cache_creation_input_tokens: 4,
    },
  });
  const request = {
    ...history(),
    maxTokens: 123,
    temperature: 0.5,
    toolChoice: { type: 'tool' as const, name: 'sum' },
  };
  const ar = await a.run(request);
  expect(ar.finish).toBe('toolUse');
  expect(ar.usage).toEqual({
    inputTokens: 5,
    outputTokens: 6,
    cacheReadTokens: 3,
    cacheWriteTokens: 4,
  });
  expect(a.requests[0]).toMatchObject({
    max_tokens: 123,
    temperature: 0.5,
    tool_choice: { type: 'tool', name: 'sum' },
  });
  expect(a.requests[0].messages.at(-1).content).toHaveLength(2);
  expect(a.requests[0].messages.at(-1).content[0]).toMatchObject({
    type: 'tool_result',
    tool_use_id: 'b',
  });
  const g = provider('google', 'gemini-2.0-flash');
  g.reply({
    candidates: [
      { finishReason: 'STOP', content: { parts: [{ functionCall: { name: 'sum', args: {} } }] } },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 3,
      thoughtsTokenCount: 2,
      cachedContentTokenCount: 4,
    },
  });
  const gr = await g.run(request);
  expect(gr.finish).toBe('toolUse');
  expect(gr.usage).toEqual({
    inputTokens: 10,
    outputTokens: 3,
    reasoningTokens: 2,
    cacheReadTokens: 4,
  });
  expect(g.requests[0].toolConfig.functionCallingConfig).toEqual({
    mode: 'ANY',
    allowedFunctionNames: ['sum'],
  });
  expect(g.requests[0].contents.at(-1).parts).toHaveLength(2);
  expect(g.requests[0].generationConfig).toEqual({ maxOutputTokens: 123, temperature: 0.5 });
  const o = provider('openai');
  o.reply({
    choices: [{ finish_reason: 'stop', message: { content: 'Done' } }],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 3,
      prompt_tokens_details: { cached_tokens: 5 },
      completion_tokens_details: { reasoning_tokens: 1 },
    },
  });
  expect((await o.run({ ...base(), maxTokens: 42 })).usage).toEqual({
    inputTokens: 10,
    outputTokens: 3,
    cacheReadTokens: 5,
    reasoningTokens: 1,
  });
  expect(o.requests[0].max_completion_tokens).toBe(42);
});

test('LLM-C11/C16: tool arguments containing credentials or malformed structures are not forwarded', async () => {
  const p = provider();
  p.reply(
    completion([{ type: 'function', function: { name: 'sum', arguments: '{"x":"test-secret"}' } }]),
  );
  await expect(p.run()).rejects.toThrow('withheld');
  p.reply(
    completion([
      { id: 'fresh', type: 'function', function: { name: 'sum', arguments: '{}' } },
      { id: 'fresh', type: 'function', function: { name: 'sum', arguments: '{}' } },
    ]),
  );
  await expect(p.run()).rejects.toThrow('provider-error');
});
