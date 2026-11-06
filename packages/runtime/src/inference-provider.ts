import Ajv2020 from 'ajv/dist/2020';
import {
  generationSchema,
  validateGeneration,
  type Generation,
  type GenerationRequest,
  type Part,
  type OutputPart,
} from './llm-contract';

export type InferenceConnection = {
  provider: string;
  endpoint: string;
  model: string;
  key?: string;
};
const emptyParameters = { type: 'object', properties: {}, additionalProperties: false };
// Server-only meta-schema validation. Never compile or execute a napplet's schema.
const schemas = new Ajv2020({ strict: false, validateFormats: false, addUsedSchema: false });
const unsupported = (message: string): never => {
  throw new Error(`unsupported: ${message}`);
};
const invalidResponse = (): never => {
  throw new Error('provider-error: Invalid generation or tool response from the selected model.');
};
const object = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const schemaKeywords = new Set([
  '$schema',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'description',
  'title',
  'default',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'minProperties',
  'maxProperties',
]);
function parameters(value: Record<string, unknown> = emptyParameters): Record<string, unknown> {
  let valid = false;
  try {
    valid = schemas.validateSchema(value) === true;
  } catch {
    /* Wrong dialect or malformed schema. */
  }
  if (!valid || value.type !== 'object')
    throw new Error('invalid-request: Malformed JSON Schema tool parameters.');
  const visit = (schema: any): void => {
    if (typeof schema === 'boolean') return;
    if (Object.keys(schema).some((k) => !schemaKeywords.has(k)))
      unsupported('This adapter cannot represent this JSON Schema keyword.');
    if (
      schema.$schema !== undefined &&
      schema.$schema !== 'https://json-schema.org/draft/2020-12/schema'
    )
      unsupported('Use the JSON Schema 2020-12 dialect.');
    for (const child of Object.values(schema.properties ?? {})) visit(child);
    if (schema.items !== undefined) visit(schema.items);
    if (typeof schema.additionalProperties === 'object') visit(schema.additionalProperties);
  };
  visit(value);
  return value;
}
const text = (parts: Part[]) =>
  parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
const withoutThinking = (parts: Part[]) => parts.filter((p) => p.type !== 'thinking');
const image = (p: Extract<Part, { type: 'image' }>) => ({
  type: 'image',
  source: { type: 'base64', media_type: p.mimeType, data: p.data },
});

/** Runs only in the credential-owning shell service, never in an iframe bundle. */
export async function infer(
  connection: InferenceConnection,
  input: GenerationRequest,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Generation> {
  const request = generationSchema.parse(input);
  const { provider, model, key = '' } = connection;
  const base = new URL(connection.endpoint);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== 'https:' &&
      !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
  )
    throw new Error('invalid-request: Invalid shell inference endpoint.');
  const tools = request.tools?.map((t) => ({ ...t, parameters: parameters(t.parameters) })) ?? [];
  const historical = request.messages.some((m) => m.content.some((p) => p.type === 'toolCall'));
  const choice = request.toolChoice ?? 'auto';
  if (
    request.temperature !== undefined &&
    (request.temperature < 0 || request.temperature > (provider === 'anthropic' ? 1 : 2))
  )
    unsupported('Temperature is outside this provider adapter’s supported range.');
  if (
    provider === 'anthropic' &&
    request.messages.some(
      (m) =>
        m.role === 'assistant' &&
        m.content.some((p) => p.type === 'thinking') &&
        m.content.some((p) => p.type === 'toolCall'),
    )
  )
    unsupported(
      'Anthropic thinking/tool continuations require signed state that this contract cannot represent.',
    );
  const messages = request.messages.map((m) => ({ ...m, content: withoutThinking(m.content) }));
  // Do not silently drop a message whose only content was display-only thinking.
  if (messages.some((m) => !m.content.length))
    unsupported('A thinking-only message has no replayable content.');
  if (
    provider === 'google' &&
    (tools.length || historical) &&
    (!/^gemini-2\.0-flash(?:-|$)/.test(model) || /thinking/i.test(model))
  )
    unsupported(
      'This Gemini model needs an opaque tool continuation that this adapter cannot preserve.',
    );
  if (provider === 'deepseek' && /reasoner/i.test(model) && (tools.length || historical))
    unsupported(
      'This reasoning model needs provider-specific continuation state. Select a non-thinking model.',
    );
  if (
    request.temperature !== undefined &&
    provider === 'openai' &&
    /^(o[134](?:-|$)|gpt-5)/.test(model)
  )
    unsupported('Temperature is not configurable for this reasoning model adapter.');
  // System images are not supported by these provider dialects; never move roles.
  if (messages.some((m) => m.role === 'system' && m.content.some((p) => p.type === 'image')))
    unsupported('System-message images are not supported by this adapter.');
  let url = connection.endpoint.replace(/\/$/, '') + '/chat/completions';
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  let body: Record<string, unknown>;
  if (provider === 'anthropic') {
    if (request.format === 'json')
      unsupported('JSON-object mode is not configured for this Anthropic adapter.');
    url = connection.endpoint.replace(/\/$/, '') + '/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    };
    const converted: { role: string; content: any[] }[] = [];
    for (const m of messages.filter((m) => m.role !== 'system')) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content =
        m.role === 'toolResult'
          ? [
              {
                type: 'tool_result',
                tool_use_id: m.toolCallId,
                is_error: m.isError ?? false,
                content: m.content.map((p) => (p.type === 'image' ? image(p) : p)),
              },
            ]
          : m.content.map((p) =>
              p.type === 'image'
                ? image(p)
                : p.type === 'toolCall'
                  ? { type: 'tool_use', id: p.toolCallId, name: p.name, input: p.arguments }
                  : p,
            );
      // Parallel tool results must share one user turn.
      const previous = converted.at(-1);
      if (previous?.role === role) previous.content.push(...content);
      else converted.push({ role, content });
    }
    body = {
      model,
      max_tokens: request.maxTokens ?? 8192,
      system: text(messages.filter((m) => m.role === 'system').flatMap((m) => m.content)),
      messages: converted,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
            tool_choice:
              typeof choice === 'object'
                ? choice
                : { type: choice === 'required' ? 'any' : choice },
          }
        : {}),
    };
  } else if (provider === 'google') {
    if (messages.some((m) => m.role === 'toolResult' && m.content.some((p) => p.type === 'image')))
      unsupported('This Gemini tool-result adapter supports text only.');
    url =
      connection.endpoint.replace(/\/$/, '') +
      `/models/${encodeURIComponent(model)}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
    const contents: { role: string; parts: any[] }[] = [];
    for (const m of messages.filter((m) => m.role !== 'system')) {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts =
        m.role === 'toolResult'
          ? [
              {
                functionResponse: {
                  id: m.toolCallId,
                  name: m.toolName,
                  response: m.isError ? { error: text(m.content) } : { output: text(m.content) },
                },
              },
            ]
          : m.content.map((p) =>
              p.type === 'image'
                ? { inlineData: { mimeType: p.mimeType, data: p.data } }
                : p.type === 'toolCall'
                  ? { functionCall: { id: p.toolCallId, name: p.name, args: p.arguments } }
                  : { text: p.type === 'text' ? p.text : '' },
            );
      const previous = contents.at(-1);
      if (previous?.role === role) previous.parts.push(...parts);
      else contents.push({ role, parts });
    }
    body = {
      contents,
      systemInstruction: {
        parts: [
          { text: text(messages.filter((m) => m.role === 'system').flatMap((m) => m.content)) },
        ],
      },
      generationConfig: {
        ...(request.format === 'json' ? { responseMimeType: 'application/json' } : {}),
        ...(request.maxTokens !== undefined ? { maxOutputTokens: request.maxTokens } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      },
      ...(tools.length
        ? {
            tools: [
              {
                functionDeclarations: tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.parameters,
                })),
              },
            ],
            toolConfig: {
              functionCallingConfig: {
                mode: choice === 'none' ? 'NONE' : choice === 'auto' ? 'AUTO' : 'ANY',
                ...(typeof choice === 'object' ? { allowedFunctionNames: [choice.name] } : {}),
              },
            },
          }
        : {}),
    };
  } else {
    if (
      messages.some(
        (m) =>
          (m.role === 'toolResult' || m.role === 'assistant') &&
          m.content.some((p) => p.type === 'image'),
      )
    )
      unsupported('This OpenAI-compatible adapter supports images in user messages only.');
    body = {
      model,
      stream: false,
      messages: messages.map((m) => {
        if (m.role === 'toolResult')
          return {
            role: 'tool',
            tool_call_id: m.toolCallId,
            content: (m.isError ? 'Tool execution failed.\n' : '') + text(m.content),
          };
        const calls = m.content.filter((p) => p.type === 'toolCall');
        return {
          role: m.role,
          content:
            m.role === 'assistant'
              ? text(m.content) || null
              : m.content.map((p) =>
                  p.type === 'image'
                    ? {
                        type: 'image_url',
                        image_url: { url: `data:${p.mimeType};base64,${p.data}` },
                      }
                    : p,
                ),
          ...(calls.length
            ? {
                tool_calls: calls.map((p) => ({
                  id: p.toolCallId,
                  type: 'function',
                  function: { name: p.name, arguments: JSON.stringify(p.arguments) },
                })),
              }
            : {}),
        };
      }),
      ...(provider === 'openai' ? { store: false } : {}),
      ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
      ...(request.format === 'json' ? { response_format: { type: 'json_object' } } : {}),
      ...(request.maxTokens !== undefined
        ? { [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: request.maxTokens }
        : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({ type: 'function', function: t })),
            tool_choice:
              typeof choice === 'object'
                ? { type: 'function', function: { name: choice.name } }
                : choice,
          }
        : {}),
    };
  }
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    });
  } catch {
    signal.throwIfAborted();
    throw new Error('provider-error: Could not reach the selected inference provider.');
  }
  if (!response.ok)
    throw new Error(
      `provider-error: Inference provider returned HTTP ${response.status}. Check the selected connection and balance.`,
    );
  let value: any;
  try {
    value = await response.json();
  } catch {
    throw new Error('provider-error: Invalid JSON from the inference provider.');
  }
  signal.throwIfAborted();
  // Check the whole response: credentials can be echoed inside tool arguments or thinking too.
  if (key && JSON.stringify(value).includes(key))
    throw new Error('provider-error: Provider response contained a credential and was withheld.');
  try {
    const content: OutputPart[] = [];
    let finish: Generation['finish'];
    const addText = (type: 'text' | 'thinking', value: unknown) => {
      if (value === undefined || value === null) return;
      if (typeof value !== 'string') invalidResponse();
      content.push({ type, text: value as string });
    };
    const addCall = (id: unknown, name: unknown, args: unknown, encoded = false) => {
      // No partial call is executable, even if some parallel arguments are complete.
      if (finish === 'length' || finish === 'refusal') return;
      let argumentsValue = args;
      try {
        if (encoded) argumentsValue = JSON.parse(String(args));
      } catch {
        invalidResponse();
      }
      if (
        !object(argumentsValue) ||
        typeof name !== 'string' ||
        (id !== undefined && (typeof id !== 'string' || !id))
      )
        invalidResponse();
      content.push({
        type: 'toolCall',
        toolCallId: (id as string | undefined) ?? `call_${crypto.randomUUID()}`,
        name: name as string,
        arguments: argumentsValue as any,
      });
    };
    if (!object(value)) invalidResponse();
    if (provider === 'anthropic') {
      const reason = value.stop_reason;
      if (
        !['end_turn', 'stop_sequence', 'tool_use', 'max_tokens', 'refusal'].includes(reason) ||
        !Array.isArray(value.content)
      )
        invalidResponse();
      finish =
        reason === 'max_tokens'
          ? 'length'
          : reason === 'refusal'
            ? 'refusal'
            : reason === 'tool_use'
              ? 'toolUse'
              : 'stop';
      for (const p of value.content) {
        if (p.type === 'text') addText('text', p.text);
        else if (p.type === 'thinking') addText('thinking', p.thinking);
        else if (p.type === 'tool_use') addCall(p.id, p.name, p.input);
        else if (p.type !== 'redacted_thinking') invalidResponse();
      }
    } else if (provider === 'google') {
      const candidate = value.candidates?.[0],
        reason = candidate?.finishReason;
      if (
        ![
          'STOP',
          'MAX_TOKENS',
          'SAFETY',
          'RECITATION',
          'BLOCKLIST',
          'PROHIBITED_CONTENT',
          'SPII',
        ].includes(reason)
      )
        invalidResponse();
      finish = reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length' : 'refusal';
      for (const p of candidate.content?.parts ?? []) {
        if (p.text !== undefined) addText(p.thought ? 'thinking' : 'text', p.text);
        if (p.functionCall) addCall(p.functionCall.id, p.functionCall.name, p.functionCall.args);
        if (p.thoughtSignature && p.functionCall && finish === 'stop')
          unsupported(
            'This provider returned a signed tool continuation that this adapter cannot preserve.',
          );
      }
    } else {
      const choice = value.choices?.[0],
        reason = choice?.finish_reason,
        message = choice?.message;
      if (!['stop', 'tool_calls', 'length', 'content_filter'].includes(reason) || !object(message))
        invalidResponse();
      finish = message.refusal
        ? 'refusal'
        : reason === 'length'
          ? 'length'
          : reason === 'content_filter'
            ? 'refusal'
            : reason === 'tool_calls'
              ? 'toolUse'
              : 'stop';
      addText('thinking', message.reasoning_content);
      addText('text', message.content);
      if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) invalidResponse();
      for (const call of message.tool_calls ?? []) {
        if (call.type !== 'function') invalidResponse();
        addCall(call.id, call.function?.name, call.function?.arguments, true);
      }
    }
    const rawUsage =
      provider === 'google'
        ? {
            inputTokens: value.usageMetadata?.promptTokenCount,
            outputTokens: value.usageMetadata?.candidatesTokenCount,
            cacheReadTokens: value.usageMetadata?.cachedContentTokenCount,
            reasoningTokens: value.usageMetadata?.thoughtsTokenCount,
          }
        : provider === 'anthropic'
          ? {
              inputTokens: value.usage?.input_tokens,
              outputTokens: value.usage?.output_tokens,
              cacheReadTokens: value.usage?.cache_read_input_tokens,
              cacheWriteTokens: value.usage?.cache_creation_input_tokens,
            }
          : {
              inputTokens: value.usage?.prompt_tokens,
              outputTokens: value.usage?.completion_tokens,
              cacheReadTokens:
                value.usage?.prompt_tokens_details?.cached_tokens ??
                value.usage?.prompt_cache_hit_tokens,
              reasoningTokens: value.usage?.completion_tokens_details?.reasoning_tokens,
            };
    const usage = [rawUsage.inputTokens, rawUsage.outputTokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    )
      ? (Object.fromEntries(
          Object.entries(rawUsage).filter(([, n]) => n !== undefined),
        ) as Generation['usage'])
      : undefined;
    return validateGeneration(request, { content, finish, ...(usage ? { usage } : {}) });
  } catch (error) {
    if (error instanceof Error && /^(provider-error|unsupported):/.test(error.message)) throw error;
    return invalidResponse();
  }
}
