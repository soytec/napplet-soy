import { z } from 'zod';

const nonempty = z.string().min(1);
const toolName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const object = z.record(z.string(), z.json());
export const partSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string().max(200000) }).strict(),
  z.object({ type: z.literal('thinking'), text: z.string().max(200000) }).strict(),
  z
    .object({
      type: z.literal('toolCall'),
      toolCallId: nonempty,
      name: nonempty,
      arguments: object,
    })
    .strict(),
  z
    .object({
      type: z.literal('image'),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      data: z
        .string()
        .min(1)
        .max(2000000)
        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
        .refine((value) => {
          try {
            return btoa(atob(value)) === value;
          } catch {
            return false;
          }
        }, 'Use canonical padded base64'),
    })
    .strict(),
]);
export type Part = z.infer<typeof partSchema>;
export type OutputPart = Exclude<Part, { type: 'image' }>;
export const requirementsSchema = z
  .object({
    images: z.boolean().optional(),
    json: z.boolean().optional(),
    tools: z.boolean().optional(),
    model: nonempty.max(160).optional(),
  })
  .strict();
const toolSchema = z
  .object({
    name: toolName,
    description: z.string().optional(),
    parameters: object
      .refine((value) => value.type === 'object', 'Tool parameters need an object root')
      .optional(),
  })
  .strict();
export const generationSchema = z
  .object({
    handle: nonempty.max(160),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant', 'toolResult']),
            content: z.array(partSchema).min(1).max(128),
            toolCallId: nonempty.optional(),
            toolName: nonempty.optional(),
            isError: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    format: z.enum(['text', 'json']).default('text'),
    maxTokens: z.number().int().positive().optional(),
    temperature: z.number().optional(),
    tools: z.array(toolSchema).optional(),
    toolChoice: z
      .union([
        z.enum(['auto', 'none', 'required']),
        z.object({ type: z.literal('tool'), name: nonempty }).strict(),
      ])
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
    const names = new Set(value.tools?.map((t) => t.name));
    if (names.size !== (value.tools?.length ?? 0)) invalid('Tool names must be unique');
    if (value.toolChoice !== undefined && !names.size) invalid('Tool choice requires tools');
    if (typeof value.toolChoice === 'object' && !names.has(value.toolChoice.name))
      invalid('Unknown chosen tool');
    const seen = new Set<string>(),
      pending = new Map<string, string>();
    for (const m of value.messages) {
      if (m.role === 'toolResult') {
        if (!m.toolCallId || !m.toolName || pending.get(m.toolCallId) !== m.toolName)
          invalid('Orphan, duplicate or mismatched tool result');
        else pending.delete(m.toolCallId);
      } else {
        if (pending.size) invalid('Every parallel tool call needs an immediate result');
        if (m.toolCallId !== undefined || m.toolName !== undefined || m.isError !== undefined)
          invalid('Tool result fields require toolResult role');
      }
      for (const part of m.content) {
        if ((part.type === 'thinking' || part.type === 'toolCall') && m.role !== 'assistant')
          invalid('Only assistant messages carry thinking or tool calls');
        if (part.type === 'toolCall') {
          if (seen.has(part.toolCallId)) invalid('Tool call IDs must be unique');
          seen.add(part.toolCallId);
          pending.set(part.toolCallId, part.name);
        }
      }
    }
    if (pending.size) invalid('Missing tool results');
  });
export type LlmRequirements = z.infer<typeof requirementsSchema>;
export type GenerationRequest = z.infer<typeof generationSchema>;
export type ToolChoiceMode = 'auto' | 'none' | 'required' | 'tool';
export type LlmModel = {
  handle: string;
  name: string;
  model: string;
  route: string;
  images: boolean;
  json: boolean;
  tools: boolean;
  toolChoiceModes: ToolChoiceMode[];
};
export type Generation = {
  content: OutputPart[];
  finish: 'stop' | 'length' | 'refusal' | 'toolUse';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
  };
};
export type BlockDelta =
  | { event: 'start'; block: 'text' | 'thinking'; blockIndex: number }
  | { event: 'start'; block: 'toolCall'; blockIndex: number; toolCallId: string; name: string }
  | { event: 'delta'; block: 'text' | 'thinking' | 'toolCall'; blockIndex: number; text: string }
  | { event: 'end'; block: 'text' | 'thinking' | 'toolCall'; blockIndex: number };
export interface LlmService {
  select(requirements: LlmRequirements, signal: AbortSignal): Promise<LlmModel>;
  describe(handle: string): Promise<LlmModel>;
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
    delta: (event: BlockDelta) => void,
  ): Promise<Generation>;
}
export function checkCapabilities(
  request: GenerationRequest,
  model: Pick<LlmModel, 'json' | 'images' | 'tools' | 'toolChoiceModes'>,
) {
  if (
    (request.format === 'json' && !model.json) ||
    (request.messages.some((m) => m.content.some((c) => c.type === 'image')) && !model.images) ||
    ((request.tools?.length ||
      request.messages.some((m) => m.content.some((c) => c.type === 'toolCall'))) &&
      !model.tools)
  )
    throw new Error('unsupported: The selected model cannot represent this request.');
  const mode = typeof request.toolChoice === 'object' ? 'tool' : (request.toolChoice ?? 'auto');
  if (request.tools?.length && !model.toolChoiceModes.includes(mode))
    throw new Error('unsupported: This tool choice is not supported by the selected model.');
}
/** Validate successful tool choice independently of the provider's stop label. */
export function validateGeneration(request: GenerationRequest, result: Generation): Generation {
  const fail = () => {
    throw new Error('provider-error: Invalid generation or tool response from the selected model.');
  };
  if (
    !['stop', 'toolUse', 'length', 'refusal'].includes(result.finish) ||
    !Array.isArray(result.content)
  )
    fail();
  const content = result.content.filter(
    (p) => !(['length', 'refusal'].includes(result.finish) && p.type === 'toolCall'),
  );
  if (content.some((p) => !partSchema.safeParse(p).success || (p as Part).type === 'image')) fail();
  const calls = content.filter((p) => p.type === 'toolCall');
  const ids = new Set(
    request.messages.flatMap((m) =>
      m.content.flatMap((p) => (p.type === 'toolCall' ? [p.toolCallId] : [])),
    ),
  );
  for (const call of calls) {
    if (ids.has(call.toolCallId) || !request.tools?.some((t) => t.name === call.name)) fail();
    ids.add(call.toolCallId);
  }
  if (result.finish === 'stop' || result.finish === 'toolUse') {
    if (!content.length) fail();
    const mode = request.toolChoice ?? 'auto';
    if ((!request.tools?.length || mode === 'none') && calls.length) fail();
    if ((mode === 'required' || typeof mode === 'object') && !calls.length) fail();
    if (typeof mode === 'object' && calls.some((c) => c.name !== mode.name)) fail();
    if (result.finish === 'toolUse' && !calls.length) fail();
    if (request.format === 'json' && !calls.length) {
      try {
        const parsed = JSON.parse(
          content
            .filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join(''),
        );
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail();
      } catch {
        fail();
      }
    }
  }
  if (
    result.usage &&
    [result.usage.inputTokens, result.usage.outputTokens, ...Object.values(result.usage)].some(
      (n) => !Number.isSafeInteger(n) || n < 0,
    )
  )
    fail();
  return { ...result, content, finish: calls.length ? 'toolUse' : result.finish };
}

const wireSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('llm.select'),
      id: nonempty,
      requirements: requirementsSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('llm.describe'), id: nonempty, handle: nonempty }).strict(),
  z.object({ type: z.literal('llm.generate'), id: nonempty, request: generationSchema }).strict(),
  z.object({ type: z.literal('llm.cancel'), id: nonempty, requestId: nonempty }).strict(),
]);

/** Settle even when an adapter ignores abort; observe its eventual rejection. */
export function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    const clean = () => signal.removeEventListener('abort', abort);
    work.then(
      (value) => {
        clean();
        resolve(value);
      },
      (error) => {
        clean();
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

/** One account/iframe lifetime; even a shared shell service cannot transfer handles. */
export class LlmSession {
  private models = new Map<string, LlmModel>();
  private pending = new Map<string, AbortController>();
  constructor(
    private service: LlmService | undefined,
    private signal: AbortSignal,
    private consent: (text: string, signal: AbortSignal) => Promise<boolean>,
    private send: (data: Record<string, unknown>) => void,
    private timeoutMs = 20 * 60_000,
  ) {}
  async handle(message: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.signal.throwIfAborted();
    wireSchema.parse(message);
    if (message.type === 'llm.cancel') {
      const controller = this.pending.get(z.string().min(1).parse(message.requestId));
      const cancelled = !!controller && !controller.signal.aborted;
      controller?.abort();
      return { cancelled };
    }
    if (!this.service)
      throw new Error('unsupported: Configure an inference connection in the shell.');
    if (message.type === 'llm.select') {
      const requirements = requirementsSchema.parse(
        message.requirements === undefined ? {} : message.requirements,
      );
      const selected = await untilAborted(
        this.service.select(requirements, this.signal),
        this.signal,
      );
      this.signal.throwIfAborted();
      if (
        (requirements.images && !selected.images) ||
        (requirements.json && !selected.json) ||
        (requirements.tools && !selected.tools) ||
        (requirements.model && requirements.model !== selected.model)
      )
        throw new Error(
          'unsupported: The selected model does not meet the requested capabilities.',
        );
      const handle = crypto.randomUUID();
      this.models.set(handle, selected);
      return { model: { ...selected, handle } };
    }
    const request =
      message.type === 'llm.generate' ? generationSchema.parse(message.request) : undefined;
    const handle = request?.handle ?? z.string().min(1).parse(message.handle);
    const selected = this.models.get(handle);
    if (!selected) throw new Error('selection-expired: Select a model again.');
    const validateSelection = async (signal = this.signal) => {
      const current = await untilAborted(this.service!.describe(selected.handle), signal);
      signal.throwIfAborted();
      if (JSON.stringify(current) !== JSON.stringify(selected))
        throw new Error('selection-expired: The connection changed.');
    };
    if (message.type === 'llm.describe') {
      await validateSelection();
      return { model: { ...selected, handle } };
    }
    if (!request) throw new Error('unsupported: Unknown inference operation.');
    checkCapabilities(request, selected);
    const id = z.string().min(1).parse(message.id);
    if (this.pending.has(id)) throw new Error('invalid-request: Duplicate active request ID.');
    const controller = new AbortController();
    this.pending.set(id, controller);
    const signal = AbortSignal.any([this.signal, controller.signal]);
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error('timeout: Inference deadline reached; provider charges may still apply.'),
        ),
      this.timeoutMs,
    );
    let finished = false;
    try {
      await validateSelection(signal);
      signal.throwIfAborted();
      const images = request.messages
        .flatMap((m) => m.content)
        .filter((c) => c.type === 'image').length;
      const input = request.messages
        .flatMap((m) => m.content)
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      if (
        !(await untilAborted(
          this.consent(
            `Send this request from the current napplet to ${selected.name} / ${selected.model}?\n${selected.route}\n${images} images · ${input.length} text characters · ${request.tools?.length ?? 0} tool definitions · ${request.messages.filter((m) => m.role === 'toolResult').length} tool results. These definitions, arguments and results are included. Tools are data, never executed by the runtime. Provider charges may apply.\n\n${input.slice(0, 1200)}${input.length > 1200 ? '\n… (remaining input is included)' : ''}`,
            signal,
          ),
          signal,
        ))
      )
        throw new Error('user-cancelled');
      signal.throwIfAborted();
      await validateSelection(signal);
      let sequence = 0;
      const result = await untilAborted(
        this.service.generate({ ...request, handle: selected.handle }, signal, (event) => {
          if (!signal.aborted && !finished)
            this.send({ type: 'llm.delta', requestId: id, sequence: sequence++, ...event });
        }),
        signal,
      );
      signal.throwIfAborted();
      return { result: validateGeneration(request, result) };
    } finally {
      finished = true;
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }
}
