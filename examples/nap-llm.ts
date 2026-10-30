/** Optional napplet-side adapter: no provider SDK, key, URL or payment authority. */
import type { Generation, GenerationRequest, LlmModel } from '../packages/runtime/src/llm-contract';
export type DraftLlm = {
  select(requirements: { json: boolean }): Promise<LlmModel>;
  generate(request: GenerationRequest, options: { signal?: AbortSignal }): Promise<Generation>;
};
// Pass window.napplet.llm when present. Keep the rest of the napplet usable when absent.
// A user action invokes this; errors are shown to the user, never auto-retried.
export async function suggestLabel(llm: DraftLlm | undefined, text: string, signal?: AbortSignal) {
  if (!llm) return { available: false as const };
  const model = await llm.select({ json: true });
  const result = await llm.generate(
    {
      handle: model.handle,
      messages: [
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: 'Return a JSON object with a short label string for the supplied text.',
            },
          ],
        },
        { role: 'user', content: [{ type: 'text', text }] },
      ],
      format: 'json',
    },
    { signal },
  );
  if (result.finish !== 'stop') throw new Error(`Generation incomplete: ${result.finish}`);
  const value = JSON.parse(result.text);
  if (!value || typeof value.label !== 'string' || !value.label.trim())
    throw new Error('The model did not return a usable label.');
  // Render as text, never HTML or executable code.
  return { available: true as const, label: value.label };
}
