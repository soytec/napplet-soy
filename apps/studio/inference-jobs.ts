import { z } from 'zod';
import { generationSchema, type Generation } from '../../packages/runtime/src/llm-contract';
import { infer } from '../../packages/runtime/src/inference-provider';
import type { Connections } from './connections';

/** Short control calls; private inputs stay in this account's credential-owning process. */
export class InferenceJobs {
  private jobs = new Map<
    string,
    { controller: AbortController; result?: Generation; error?: string; expires: number }
  >();
  constructor(private connections: Connections) {}
  async action(action: string, input: unknown) {
    for (const [id, job] of this.jobs)
      if (job.expires < Date.now()) {
        job.controller.abort();
        this.jobs.delete(id);
      }
    if (action === 'llm-start') {
      const request = generationSchema.parse(input),
        connection = this.connections.resolve(request.handle);
      if (!connection) throw new Error('selection-expired: Select the connection again.');
      if (
        (request.format === 'json' && !connection.json) ||
        (request.messages.some((m) => m.content.some((c) => c.type === 'image')) &&
          !connection.images)
      )
        throw new Error('unsupported: The saved model capabilities do not match this request.');
      const id = crypto.randomUUID(),
        job: { controller: AbortController; result?: Generation; error?: string; expires: number } =
          { controller: new AbortController(), expires: Date.now() + 30 * 60_000 };
      this.jobs.set(id, job);
      const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(20 * 60_000)]);
      void infer(connection, request, signal)
        .then((result) => {
          job.result = result;
        })
        .catch((error) => {
          job.error = job.controller.signal.aborted
            ? 'cancelled'
            : signal.aborted
              ? 'timeout: Inference deadline reached; provider charges may still apply.'
              : this.connections.scrub(error instanceof Error ? error.message : 'provider-error');
        });
      return { id };
    }
    const { id } = z.object({ id: z.uuid() }).strict().parse(input),
      job = this.jobs.get(id);
    if (!job)
      throw new Error(
        'selection-expired: The inference job expired; it may have incurred provider charges.',
      );
    if (action === 'llm-cancel') {
      job.controller.abort();
      return { cancelled: true };
    }
    if (action !== 'llm-read') throw new Error('unsupported');
    return job.error
      ? { error: job.error }
      : job.result
        ? { result: job.result }
        : { pending: true };
  }
  close() {
    for (const job of this.jobs.values()) job.controller.abort();
    this.jobs.clear();
  }
}
