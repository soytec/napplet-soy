import { z } from 'zod';

export const requirementsSchema = z
  .object({
    images: z.boolean().optional(),
    json: z.boolean().optional(),
    model: z.string().min(1).max(160).optional(),
  })
  .strict();
export const generationSchema = z
  .object({
    handle: z.string().min(1).max(160),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z
              .array(
                z.discriminatedUnion('type', [
                  z.object({ type: z.literal('text'), text: z.string().max(200000) }).strict(),
                  z
                    .object({
                      type: z.literal('image'),
                      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
                      data: z
                        .string()
                        .max(2000000)
                        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
                        .min(1),
                    })
                    .strict(),
                ]),
              )
              .min(1)
              .max(128),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    format: z.enum(['text', 'json']).default('text'),
  })
  .strict();
export type LlmRequirements = z.infer<typeof requirementsSchema>;
export type GenerationRequest = z.infer<typeof generationSchema>;
export type LlmModel = {
  handle: string;
  name: string;
  model: string;
  route: string;
  images: boolean;
  json: boolean;
};
export type Generation = {
  text: string;
  finish: 'stop' | 'length' | 'refusal';
  usage?: { inputTokens: number; outputTokens: number };
};
export interface LlmService {
  select(requirements: LlmRequirements, signal: AbortSignal): Promise<LlmModel>;
  describe(handle: string): Promise<LlmModel>;
  generate(
    request: GenerationRequest,
    signal: AbortSignal,
    delta: (text: string) => void,
  ): Promise<Generation>;
}

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
    if (message.type === 'llm.cancel') {
      const controller = this.pending.get(z.string().min(1).parse(message.requestId));
      controller?.abort();
      return { cancelled: !!controller };
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
    if (
      (request.format === 'json' && !selected.json) ||
      (request.messages.some((m) => m.content.some((c) => c.type === 'image')) && !selected.images)
    )
      throw new Error(
        'unsupported: This model cannot accept the requested input or output format.',
      );
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
            `Send this request from the current napplet to ${selected.name} / ${selected.model}?\n${selected.route}\n${images} images · ${input.length} text characters. Provider charges may apply.\n\n${input.slice(0, 1200)}${input.length > 1200 ? '\n… (remaining input is included)' : ''}`,
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
        this.service.generate({ ...request, handle: selected.handle }, signal, (text) => {
          if (!signal.aborted && !finished)
            this.send({ type: 'llm.delta', requestId: id, sequence: sequence++, text });
        }),
        signal,
      );
      signal.throwIfAborted();
      return { result };
    } finally {
      finished = true;
      clearTimeout(timer);
      this.pending.delete(id);
    }
  }
}
