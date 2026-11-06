import type { LlmModel, ToolChoiceMode } from './llm-contract';

export type ModelSettings = {
  provider: string;
  model: string;
  images?: boolean;
  json?: boolean;
  tools?: boolean;
  toolChoiceModes?: ToolChoiceMode[];
};
/** User-declared capabilities intersected with what our adapter can represent. */
export function inferenceCapabilities(
  c: ModelSettings,
): Pick<LlmModel, 'images' | 'json' | 'tools' | 'toolChoiceModes'> {
  // Gemini 3 tool continuations need opaque thought signatures, absent from NAP-LLM.
  // Only the non-thinking Gemini 2.0 family has a lossless tool mapping here.
  const tools =
    c.tools === true &&
    !(c.provider === 'deepseek' && /reasoner/i.test(c.model)) &&
    (c.provider !== 'google' ||
      (/^gemini-2\.0-flash(?:-|$)/.test(c.model) && !/thinking/i.test(c.model)));
  return {
    images: c.images === true,
    json: c.json === true && c.provider !== 'anthropic',
    tools,
    toolChoiceModes: tools
      ? [
          'auto',
          'none',
          ...(['required', 'tool'] as const).filter((m) => c.toolChoiceModes?.includes(m)),
        ]
      : [],
  };
}
