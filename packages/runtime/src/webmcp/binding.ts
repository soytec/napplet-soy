import type { ToolDescriptor, Json } from './contract';
export type ToolExecutor = (
  args: Record<string, Json>,
  context: { signal: AbortSignal; progress: (text: string) => void },
) => unknown | Promise<unknown>;
export interface WebmcpBinding {
  profile: 'soy.webmcp/1';
  registerTool: (
    tool: ToolDescriptor,
    execute: ToolExecutor,
  ) => Promise<{ id: string; name: string; unregister: () => Promise<void> }>;
  reset: () => Promise<void>;
  onExposureChanged: (callback: (exposed: boolean) => void) => () => void;
}
/** Serialized into the pinned shim. This closure never exposes its private transport. */
export function createWebmcpBinding(
  send: (message: Record<string, unknown>) => void,
  listen: (callback: (message: Record<string, unknown>) => void) => () => void,
): WebmcpBinding {
  const profile = 'soy.webmcp/1' as const;
  let dead = false;
  let suspended = false;
  const tools = new Map<string, { execute: ToolExecutor; sequence: number }>();
  const requests = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const calls = new Map<string, AbortController>();
  const subscribers = new Set<(exposed: boolean) => void>();
  function request(type: string, fields: Record<string, unknown>): Promise<any> {
    if (dead) return Promise.reject(new Error('Tool binding closed.'));
    if (requests.size >= 64)
      return Promise.reject(new Error('Too many pending tool registrations.'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        requests.delete(id);
        reject(new Error('Tool registration timed out. Reload before registering again.'));
      }, 15000);
      requests.set(id, { resolve, reject, timer });
      send({ type, id, profile, ...fields });
    });
  }
  const unlisten = listen((message) => {
    if (dead || message.profile !== profile) return;
    const type = message.type;
    if (typeof type !== 'string') return;
    if (type.endsWith('.result')) {
      const id = String(message.id),
        pending = requests.get(id);
      if (!pending) return;
      requests.delete(id);
      clearTimeout(pending.timer);
      if (message.error)
        pending.reject(
          Object.assign(new Error(String((message.error as any).message)), {
            code: (message.error as any).code,
          }),
        );
      else pending.resolve(message);
      return;
    }
    if (type === 'webmcp.changed') {
      for (const callback of subscribers) {
        try {
          callback(message.exposed === true);
        } catch {}
      }
      return;
    }
    if (type === 'webmcp.cancel') {
      calls.get(String(message.callId))?.abort();
      return;
    }
    if (type !== 'webmcp.invoke') return;
    const registrationId = String(message.registrationId),
      callId = String(message.callId),
      tool = tools.get(registrationId),
      sequence = message.sequence;
    const complete = (fields: Record<string, unknown>) => {
      if (!dead) send({ type: 'webmcp.complete', profile, registrationId, callId, ...fields });
    };
    if (!tool) {
      complete({ error: { code: 'unknown-tool', message: 'Tool is no longer registered.' } });
      return;
    }
    // A monotonically increasing per-registration watermark never evicts old IDs.
    if (
      typeof sequence !== 'number' ||
      !Number.isSafeInteger(sequence) ||
      sequence <= tool.sequence
    )
      return;
    tool.sequence = sequence;
    if (suspended) {
      complete({
        error: {
          code: 'permission-denied',
          message: 'Document context is changing; allow access again.',
        },
      });
      return;
    }
    if (calls.size) {
      complete({ error: { code: 'busy', message: 'An earlier operation is still running.' } });
      return;
    }
    const controller = new AbortController();
    calls.set(callId, controller);
    let progressAt = 0;
    Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) throw new Error('Operation cancelled before execution.');
        return tool.execute(message.arguments as Record<string, Json>, {
          signal: controller.signal,
          progress: (text) => {
            if (!controller.signal.aborted && !dead && Date.now() - progressAt >= 100) {
              progressAt = Date.now();
              send({
                type: 'webmcp.progress',
                profile,
                registrationId,
                callId,
                text: String(text).slice(0, 240),
              });
            }
          },
        });
      })
      .then((result) => {
        if (controller.signal.aborted) {
          complete({
            error: {
              code: 'cancelled',
              message: 'Stopped. Completed effects may remain; inspect the document.',
            },
          });
          return;
        }
        let nodes = 0;
        const check = (v: unknown, depth: number): void => {
          if (++nodes > 50000 || depth > 32)
            throw new Error('Tool result exceeds JSON complexity limits.');
          if (
            v === null ||
            typeof v === 'string' ||
            typeof v === 'boolean' ||
            (typeof v === 'number' && Number.isFinite(v))
          )
            return;
          if (Array.isArray(v)) {
            v.forEach((item) => check(item, depth + 1));
            return;
          }
          if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
            for (const [key, item] of Object.entries(v)) {
              if (['__proto__', 'constructor', 'prototype'].includes(key))
                throw new Error('Unsafe result key.');
              check(item, depth + 1);
            }
            return;
          }
          throw new Error('Tool result must contain only finite JSON values.');
        };
        check(result, 0);
        const encoded = JSON.stringify(result);
        if (encoded === undefined || new TextEncoder().encode(encoded).length > 256 * 1024)
          throw new Error('Tool result is not bounded JSON.');
        complete({ result: JSON.parse(encoded) });
      })
      .catch((error) =>
        complete({
          error: {
            code: controller.signal.aborted
              ? 'cancelled'
              : typeof error?.code === 'string'
                ? error.code
                : 'execution-error',
            message: String(error?.message ?? 'Tool execution failed.').slice(0, 800),
          },
        }),
      )
      .finally(() => calls.delete(callId));
  });
  window.addEventListener(
    'pagehide',
    () => {
      dead = true;
      unlisten();
      for (const c of calls.values()) c.abort();
      calls.clear();
      tools.clear();
      subscribers.clear();
      for (const p of requests.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('Document closed.'));
      }
      requests.clear();
    },
    { once: true },
  );
  return Object.freeze({
    profile,
    registerTool: async (tool: ToolDescriptor, execute: ToolExecutor) => {
      if (typeof execute !== 'function') throw new Error('A tool needs an executor.');
      const result = await request('webmcp.register', { tool });
      if (dead) throw new Error('Document closed.');
      const id = String(result.registrationId);
      tools.set(id, { execute, sequence: 0 });
      return {
        id,
        name: String(result.name),
        unregister: async () => {
          tools.delete(id);
          await request('webmcp.unregister', { registrationId: id });
        },
      };
    },
    reset: async () => {
      suspended = true;
      for (const controller of calls.values()) controller.abort();
      await request('webmcp.reset', {});
      suspended = false;
    },
    onExposureChanged: (callback: (exposed: boolean) => void) => {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  });
}
