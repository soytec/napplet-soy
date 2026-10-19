export function localStudioClient(origin: string) {
  let token = '';
  let pending: Promise<void> | undefined;
  const url = (path: string) => origin + '/api/' + path;
  const connect = () =>
    (pending ??= (async () => {
      const response = await fetch(url('session'), {
        signal: AbortSignal.timeout(5000),
        cache: 'no-store',
      });
      if (!response.ok)
        throw new Error('Start the local Studio worker with this shell origin to connect.');
      token = (await response.json()).token;
    })().finally(() => {
      pending = undefined;
    }));
  const request = async (path: string, body?: unknown, reconnect = true): Promise<Response> => {
    if (!token) await connect();
    const response = await fetch(url(path), {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Studio-Token': token,
        ...(body !== undefined
          ? {
              'Content-Type': 'application/json',
              'X-Request-ID': crypto.randomUUID(),
            }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 403 && body === undefined && reconnect) {
      await connect();
      return request(path, body, false);
    }
    return response;
  };
  const api = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await request(path, body);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Studio could not complete that action.');
    return result;
  };
  const media = async (path: string) => {
    const response = await request(path);
    if (!response.ok) throw new Error('Could not load this project’s media. Reconnect and retry.');
    return response.blob();
  };
  return { api, media, url, token: () => token };
}
export type StudioClient = ReturnType<typeof localStudioClient>;
