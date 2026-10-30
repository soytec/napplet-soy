import { chooseCapability } from './capability-dialog';
import type { LlmModel, LlmService, Generation } from './llm-contract';
type Connection = {
  id: string;
  revision: string;
  name: string;
  model: string;
  endpoint: string;
  provider: string;
  images?: boolean;
  json?: boolean;
};
type Api = <T>(path: string, body?: unknown) => Promise<T>;
export function inferenceService(
  api: Api,
  configure?: () => void,
  route = 'Shell service',
  capture?: () => Api,
): LlmService {
  const connections = async () =>
    (await api<{ connections: { connections: Connection[] } }>('state')).connections.connections;
  const model = (c: Connection): LlmModel => ({
    handle: `${c.id}:${c.revision}`,
    name: c.name,
    model: c.model,
    route: `${route} → ${new URL(c.endpoint).origin}`,
    images: c.images === true,
    json: c.json === true && c.provider !== 'anthropic',
  });
  return {
    async select(requirements, signal) {
      const list = (await connections()).filter(
        (c) =>
          (!requirements.images || c.images) &&
          (!requirements.json || model(c).json) &&
          (!requirements.model || requirements.model === c.model),
      );
      signal.throwIfAborted();
      const id = await chooseCapability(
        'Choose a model for this napplet',
        list.map((c) => ({
          id: c.id,
          label: `${c.name} · ${c.model} · ${new URL(c.endpoint).hostname}`,
        })),
        signal,
        configure,
      );
      return model(list.find((c) => c.id === id)!);
    },
    async describe(handle) {
      const c = (await connections()).find((c) => `${c.id}:${c.revision}` === handle);
      if (!c) throw new Error('selection-expired');
      return model(c);
    },
    async generate(request, signal, delta) {
      signal.throwIfAborted();
      const boundApi = capture?.() ?? api;
      const { id } = await boundApi<{ id: string }>('connections/llm-start', request);
      const cancel = () => {
        void boundApi('connections/llm-cancel', { id }).catch(() => {});
      };
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      try {
        for (;;) {
          signal.throwIfAborted();
          const state = await boundApi<{ result?: Generation; error?: string }>(
            'connections/llm-read',
            { id },
          );
          signal.throwIfAborted();
          if (state.error) throw new Error(state.error);
          if (state.result) {
            delta(state.result.text);
            return state.result;
          }
          await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        }
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}
