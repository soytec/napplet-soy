import { shellActivity } from './shell-ui';
import { inferenceCapabilities } from './inference-capabilities';
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
  tools?: boolean;
  toolChoiceModes?: import('./llm-contract').ToolChoiceMode[];
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
    ...inferenceCapabilities(c),
  });
  return {
    async select(requirements, signal) {
      signal.throwIfAborted();
      const activity = shellActivity(
        'Loading your AI connections… Approve the account request if asked.',
        signal,
      );
      try {
        const list = (await connections()).filter(
          (c) =>
            (!requirements.images || c.images) &&
            (!requirements.json || model(c).json) &&
            (!requirements.tools || model(c).tools) &&
            (!requirements.model || requirements.model === c.model),
        );
        signal.throwIfAborted();
        activity.update('Choose a model in the shell dialog.');
        const id = await chooseCapability(
          'Choose a model for this napplet',
          list.map((c) => ({
            id: c.id,
            label: `${c.name} · ${c.model} · ${new URL(c.endpoint).hostname}`,
          })),
          signal,
          configure,
        );
        activity.success('AI connection ready.');
        return model(list.find((c) => c.id === id)!);
      } catch (error) {
        if (signal.aborted || (error as Error).message === 'user-cancelled') activity.dismiss();
        else
          activity.error(
            'Could not load AI connections. Check your account and connection settings.',
          );
        throw error;
      }
    },
    async describe(handle) {
      const c = (await connections()).find((c) => `${c.id}:${c.revision}` === handle);
      if (!c) throw new Error('selection-expired');
      return model(c);
    },
    async generate(request, signal) {
      signal.throwIfAborted();
      const activity = shellActivity('Sending your approved request to the AI provider…', signal);
      try {
        const boundApi = capture?.() ?? api;
        const { id } = await boundApi<{ id: string }>('connections/llm-start', request);
        activity.update('The AI provider is preparing a response…');
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
              activity.success('AI response received.');
              return state.result;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 1000));
          }
        } finally {
          signal.removeEventListener('abort', cancel);
        }
      } catch (error) {
        if (signal.aborted) activity.dismiss();
        else activity.error('The AI request could not complete. See the napplet for details.');
        throw error;
      }
    },
  };
}
