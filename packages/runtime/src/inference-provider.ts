import type { Generation, GenerationRequest } from './llm-contract';

export type InferenceConnection = {
  provider: string;
  endpoint: string;
  model: string;
  key?: string;
};
/** Runs only in the credential-owning shell service, never in an iframe bundle. */
export async function infer(
  connection: InferenceConnection,
  request: GenerationRequest,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Generation> {
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
  let url = connection.endpoint.replace(/\/$/, '') + '/chat/completions';
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
  let body: Record<string, unknown> = {
    model,
    stream: false,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content.map((c) =>
        c.type === 'text'
          ? c
          : { type: 'image_url', image_url: { url: `data:${c.mimeType};base64,${c.data}` } },
      ),
    })),
    ...(request.format === 'json' ? { response_format: { type: 'json_object' } } : {}),
    ...(provider === 'openai' ? { store: false } : {}),
  };
  if (provider === 'anthropic') {
    if (
      request.messages.some((m) => m.role === 'system' && m.content.some((c) => c.type === 'image'))
    )
      throw new Error('unsupported: Anthropic system instructions must be text.');
    url = connection.endpoint.replace(/\/$/, '') + '/messages';
    headers = {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    };
    body = {
      model,
      max_tokens: 8192,
      system: request.messages
        .filter((m) => m.role === 'system')
        .flatMap((m) => m.content)
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('\n'),
      messages: request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role,
          content: m.content.map((c) =>
            c.type === 'text'
              ? c
              : { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } },
          ),
        })),
    };
    if (request.format === 'json')
      throw new Error('unsupported: JSON mode is not configured for this Anthropic adapter.');
  } else if (provider === 'google') {
    url =
      connection.endpoint.replace(/\/$/, '') +
      `/models/${encodeURIComponent(model)}:generateContent`;
    headers = { 'Content-Type': 'application/json', 'x-goog-api-key': key };
    const parts = (m: GenerationRequest['messages'][number]) =>
      m.content.map((c) =>
        c.type === 'text'
          ? { text: c.text }
          : { inlineData: { mimeType: c.mimeType, data: c.data } },
      );
    body = {
      contents: request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: parts(m) })),
      systemInstruction: {
        parts: request.messages.filter((m) => m.role === 'system').flatMap(parts),
      },
      ...(request.format === 'json'
        ? { generationConfig: { responseMimeType: 'application/json' } }
        : {}),
    };
  }
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
  // Never forward provider errors/request echoes, which can contain credentials or private input.
  let value: any;
  try {
    value = await response.json();
  } catch {
    throw new Error('provider-error: Invalid JSON from the inference provider.');
  }
  signal.throwIfAborted();
  let text: unknown, finish: Generation['finish'], reason: unknown;
  if (provider === 'anthropic') {
    text = value.content
      ?.filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
    reason = value.stop_reason;
    if (!['end_turn', 'stop_sequence', 'max_tokens', 'refusal'].includes(String(reason)))
      throw new Error('provider-error: The provider did not return a completed text generation.');
    finish =
      reason === 'end_turn' || reason === 'stop_sequence'
        ? 'stop'
        : reason === 'max_tokens'
          ? 'length'
          : 'refusal';
  } else if (provider === 'google') {
    const candidate = value.candidates?.[0];
    text = candidate?.content?.parts?.map((p: any) => p.text ?? '').join('');
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
      ].includes(String(reason))
    )
      throw new Error('provider-error: The provider did not return a completed text generation.');
    finish = reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length' : 'refusal';
  } else {
    const choice = value.choices?.[0];
    text = choice?.message?.content;
    reason = choice?.finish_reason;
    if (!['stop', 'length', 'content_filter'].includes(String(reason)))
      throw new Error('provider-error: The provider did not return a completed text generation.');
    finish = choice?.message?.refusal
      ? 'refusal'
      : reason === 'stop'
        ? 'stop'
        : reason === 'length'
          ? 'length'
          : 'refusal';
  }
  if (finish === 'refusal' && text == null) text = '';
  if (typeof text !== 'string' || !reason)
    throw new Error('provider-error: The provider did not return a completed text generation.');
  if (key && text.includes(key))
    throw new Error('provider-error: Provider response contained a credential and was withheld.');
  if (request.format === 'json' && finish === 'stop') {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 0;
    } catch {
      throw new Error('provider-error: The model did not return a JSON object.');
    }
  }
  const inputTokens =
    value.usage?.prompt_tokens ??
    value.usage?.input_tokens ??
    value.usageMetadata?.promptTokenCount;
  const outputTokens =
    value.usage?.completion_tokens ??
    value.usage?.output_tokens ??
    value.usageMetadata?.candidatesTokenCount;
  return {
    text,
    finish,
    ...([inputTokens, outputTokens].every((n) => Number.isSafeInteger(n) && n >= 0)
      ? { usage: { inputTokens, outputTokens } }
      : {}),
  };
}
