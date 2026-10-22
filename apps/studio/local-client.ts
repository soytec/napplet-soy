export type StudioClient = {
  mode?: 'local' | 'hosted';
  api: <T>(path: string, body?: unknown) => Promise<T>;
  media: (path: string) => Promise<Blob>;
  url: (path: string) => string;
  token: () => string;
  upload: <T>(
    path: string,
    metadata: unknown,
    file: Blob,
    progress: (percent: number) => void,
    signal: AbortSignal,
  ) => Promise<T>;
};
export function localStudioClient(origin: string): StudioClient {
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
  const upload: StudioClient['upload'] = async (path, metadata, file, progress, signal) => {
    if (!token) await connect();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const abort = () => xhr.abort();
      xhr.open('POST', url(path));
      xhr.timeout = 30000;
      xhr.setRequestHeader('X-Studio-Token', token);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Asset-Info', encodeURIComponent(JSON.stringify(metadata)));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onloadend = () => signal.removeEventListener('abort', abort);
      xhr.onload = () => {
        try {
          const result = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(result);
          else reject(new Error(result.error ?? 'Upload failed.'));
        } catch {
          reject(new Error('Upload failed. Refresh Assets before retrying.'));
        }
      };
      xhr.onerror =
        xhr.ontimeout =
        xhr.onabort =
          () => reject(new Error('Upload interrupted. Refresh Assets before retrying.'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        signal.removeEventListener('abort', abort);
        reject(new Error('Upload cancelled.'));
        return;
      }
      xhr.send(file);
    });
  };
  return { mode: 'local', api, media, upload, url, token: () => token };
}
