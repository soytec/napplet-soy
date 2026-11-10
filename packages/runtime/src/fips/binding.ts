import type { FipsBinding } from './contract';

/** Runs inside the trusted shim closure. No MessagePort or general sender escapes. */
export function createFipsBinding(
  send: (message: Record<string, unknown>) => void,
  listen: (callback: (message: Record<string, any>) => void) => () => void,
): FipsBinding {
  const profile = 'soy.fips/1';
  const pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; cleanup: () => void }
  >();
  const subscribers = new Set<(stats: any) => void>();
  let dead = false;
  const unlisten = listen((message) => {
    if (message.profile !== profile) return;
    if (message.type === 'resource.fips.changed') {
      for (const callback of subscribers) {
        try {
          callback(message.stats);
        } catch {}
      }
      return;
    }
    const request = pending.get(message.id);
    if (message.type !== 'resource.fips.result' || !request) return;
    request.cleanup();
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.value);
  });
  function request(
    action: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    if (dead) return Promise.reject(new Error('Resource binding closed'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (pending.size >= 128)
      return Promise.reject(new Error('Resource queue is full; retry missing reads'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        send({ type: 'resource.fips', profile, id, action: 'cancel' });
        pending.get(id)?.cleanup();
        pending.delete(id);
        reject(signal?.reason ?? new Error('FIPS request timed out; retry missing data'));
      };
      const timer = setTimeout(
        cancel,
        action === 'info' || action === 'release' ? 8000 : 20 * 60_000,
      );
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      };
      pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', cancel, { once: true });
      send({ type: 'resource.fips', profile, id, action, ...data });
    });
  }
  window.addEventListener(
    'pagehide',
    () => {
      dead = true;
      for (const [id, request] of pending) {
        send({ type: 'resource.fips', profile, id, action: 'cancel' });
        request.cleanup();
        request.reject(new Error('Resource binding closed'));
      }
      pending.clear();
      subscribers.clear();
      unlisten();
    },
    { once: true },
  );
  return Object.freeze({
    info: () => request('info', {}),
    open: (roots, options) => request('open', { roots }, options?.signal),
    bytes: async (grant, hash, options) => {
      const value = await request('bytes', { grant, hash }, options?.signal);
      if (!(value instanceof ArrayBuffer)) throw new Error('Invalid verified resource reply');
      return new Uint8Array(value);
    },
    request: (grant, operation, options) =>
      request('request', { grant, operation }, options?.signal),
    release: (grant) => request('release', { grant }),
    subscribe: (callback) => {
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
      };
    },
  } satisfies FipsBinding);
}
