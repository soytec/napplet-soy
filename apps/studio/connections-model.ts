export const providers = {
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1', native: true },
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1', native: true },
  anthropic: { name: 'Anthropic', url: 'https://api.anthropic.com/v1', native: true },
  google: {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta',
    native: true,
  },
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/v1', native: true },
  groq: { name: 'Groq', url: 'https://api.groq.com/openai/v1', native: false },
  mistral: { name: 'Mistral', url: 'https://api.mistral.ai/v1', native: false },
  xai: { name: 'xAI', url: 'https://api.x.ai/v1', native: false },
  together: { name: 'Together AI', url: 'https://api.together.xyz/v1', native: false },
  fireworks: { name: 'Fireworks AI', url: 'https://api.fireworks.ai/inference/v1', native: false },
  ollama: { name: 'Ollama', url: 'http://127.0.0.1:11434/v1', native: false },
  lmstudio: { name: 'LM Studio', url: 'http://127.0.0.1:1234/v1', native: false },
  llamacpp: { name: 'llama.cpp', url: 'http://127.0.0.1:8080/v1', native: false },
  compatible: { name: 'Custom OpenAI-compatible', url: '', native: false },
} as const;
export type Provider = keyof typeof providers;
export const defaultSteps = 100;
export function validEndpoint(value: string) {
  try {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash &&
      (u.protocol === 'https:' ||
        (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)))
    );
  } catch {
    return false;
  }
}
export type ConnectionInput = {
  id?: string;
  name: string;
  provider: Provider;
  endpoint: string;
  model: string;
  steps: number;
  key?: string;
};
export type Connection = Omit<ConnectionInput, 'id' | 'key'> & {
  id: string;
  revision: string;
  hasKey: boolean;
};
export type ConnectionState = { connections: Connection[]; selected?: string };
export type ModelCatalogueInput = Pick<ConnectionInput, 'id' | 'provider' | 'endpoint' | 'key'>;
export type InferenceModel = { id: string; name: string };
export type ModelCatalogue = { models: InferenceModel[]; truncated: boolean };
