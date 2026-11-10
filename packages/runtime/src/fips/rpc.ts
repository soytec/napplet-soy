import { FipsTcpEndpoint, State, type ConnectionId, type FipsDatagramEndpoint } from '@fips/tcp';

/** Atlas application protocol over authenticated FIPS/TCP, independent of NAP domains. */
export const FIPS_RPC_PORT = 39019;
export const FIPS_RPC_TIMEOUT_MS = 10 * 60_000;
const MAX_REQUEST = 64 * 1024;
const MAX_JSON = 16 * 1024 ** 2;
const MAX_BINARY = 32 * 1024 ** 2;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export interface FipsRpcRequest {
  root: string;
  path: string;
  method: 'GET' | 'POST';
  body?: unknown;
}
export interface FipsRpcResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  bytes?: Uint8Array;
}
export type FipsRpcHandler = (
  request: FipsRpcRequest,
  peerId: string,
  signal: AbortSignal,
) => Promise<FipsRpcResponse>;
export function validateRpcRequest(value: unknown): FipsRpcRequest {
  const v = value as FipsRpcRequest;
  if (
    !v ||
    !/^[a-f0-9]{64}$/.test(v.root) ||
    !['GET', 'POST'].includes(v.method) ||
    typeof v.path !== 'string' ||
    !/^\/?(?:members\/m[0-9]{1,3}\/)?[a-z][a-z0-9_.-]{0,100}$/.test(v.path)
  )
    throw new Error('Invalid Atlas FIPS operation request');
  return {
    root: v.root,
    path: v.path.replace(/^\//, ''),
    method: v.method,
    ...(v.body === undefined ? {} : { body: v.body }),
  };
}
function headers(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid FIPS response headers');
  const result: Record<string, string> = {};
  for (const [name, v] of Object.entries(value)) {
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(name) ||
      typeof v !== 'string' ||
      v.length > 4096 ||
      /[\r\n]/.test(v)
    )
      throw new Error('Invalid FIPS response header');
    result[name] = v;
  }
  return result;
}
function u32(n: number) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n);
  return b;
}
export function abortable<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 10);
    signal.addEventListener('abort', abort, { once: true });
  });
}
/** A bounded, cancellable request per TCP stream. No HTTP is involved. */
export class FipsRpcEndpoint {
  private readonly tcp: FipsTcpEndpoint;
  private readonly lifetime = new AbortController();
  private readonly connections = new Set<ConnectionId>();
  private readonly timer: ReturnType<typeof setInterval>;
  private pumping = false;
  private active = 0;
  private closed?: Promise<void>;
  constructor(
    endpoint: FipsDatagramEndpoint,
    private readonly handler?: FipsRpcHandler,
    port = FIPS_RPC_PORT,
    private readonly timeoutMs = FIPS_RPC_TIMEOUT_MS,
  ) {
    this.tcp = new FipsTcpEndpoint(endpoint, port, {
      sendBuffer: 1024 * 1024,
      receiveBuffer: 0xffff,
      maxConnections: 24,
      maxConnectionsPerPeer: 6,
    });
    this.timer = setInterval(() => void this.pump(), 10);
  }
  private async pump() {
    if (this.pumping || this.lifetime.signal.aborted) return;
    this.pumping = true;
    try {
      await this.tcp.poll();
      for (;;) {
        const id = await this.tcp.accept();
        if (id === undefined) break;
        if (!this.handler || this.active >= 8) {
          await this.tcp.abort(id);
          continue;
        }
        this.active++;
        this.connections.add(id);
        void this.serve(id)
          .catch(() => this.tcp.abort(id).catch(() => {}))
          .finally(() => {
            this.active--;
            this.connections.delete(id);
          });
      }
    } catch {
      /* Closed connections are retried by their caller, never an unhandled pump rejection. */
    } finally {
      this.pumping = false;
    }
  }
  private async read(id: ConnectionId, length: number, signal: AbortSignal) {
    const result = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      signal.throwIfAborted();
      const bytes = await abortable(this.tcp.read(id, Math.min(65536, length - offset)), signal);
      if (bytes.length) {
        result.set(bytes, offset);
        offset += bytes.length;
      } else {
        if (await this.tcp.isReadClosed(id))
          throw new Error('FIPS operation stream closed before its response completed');
        await pause(signal);
      }
    }
    return result;
  }
  private async write(id: ConnectionId, bytes: Uint8Array, signal: AbortSignal) {
    let at = 0;
    while (at < bytes.length) {
      signal.throwIfAborted();
      const n = await abortable(this.tcp.write(id, bytes.subarray(at, at + 65536)), signal);
      at += n;
      if (!n) await pause(signal);
    }
  }
  private async readJson(id: ConnectionId, max: number, signal: AbortSignal) {
    const prefix = await this.read(id, 4, signal),
      length = new DataView(prefix.buffer).getUint32(0);
    if (!length || length > max) throw new Error('Atlas FIPS frame exceeds its size limit');
    return JSON.parse(decoder.decode(await this.read(id, length, signal)));
  }
  private async writeJson(id: ConnectionId, value: unknown, max: number, signal: AbortSignal) {
    const bytes = encoder.encode(JSON.stringify(value));
    if (bytes.length > max) throw new Error('Atlas FIPS frame exceeds its size limit');
    await this.write(id, u32(bytes.length), signal);
    await this.write(id, bytes, signal);
  }
  async request(
    peerId: string,
    request: FipsRpcRequest,
    signal?: AbortSignal,
  ): Promise<FipsRpcResponse> {
    const v = validateRpcRequest(request);
    if (!/^(02|03)[a-f0-9]{64}$/.test(peerId)) throw new Error('Invalid FIPS provider identity');
    if (encoder.encode(JSON.stringify(v)).length > MAX_REQUEST)
      throw new Error('FIPS operation request is too large');
    const combined = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(this.timeoutMs),
      ...(signal ? [signal] : []),
    ]);
    combined.throwIfAborted();
    const id = await this.tcp.connect(peerId);
    this.connections.add(id);
    let complete = false;
    try {
      while ((await this.tcp.state(id)) !== State.Established) {
        combined.throwIfAborted();
        await pause(combined);
      }
      await this.writeJson(id, { version: 1, ...v }, MAX_REQUEST, combined);
      const metadata = await this.readJson(id, MAX_REQUEST, combined);
      if (
        metadata.version !== 1 ||
        !Number.isInteger(metadata.status) ||
        metadata.status < 200 ||
        metadata.status > 599 ||
        !['json', 'bytes'].includes(metadata.kind) ||
        !Number.isSafeInteger(metadata.length) ||
        metadata.length < 0 ||
        metadata.length > (metadata.kind === 'bytes' ? MAX_BINARY : MAX_JSON)
      )
        throw new Error('Invalid Atlas FIPS response');
      const responseHeaders = headers(metadata.headers);
      const payload = await this.read(id, metadata.length, combined);
      const response: FipsRpcResponse = {
        status: metadata.status,
        headers: responseHeaders,
      };
      if (metadata.kind === 'bytes') response.bytes = payload;
      else response.body = JSON.parse(decoder.decode(payload));
      complete = true;
      return response;
    } finally {
      this.connections.delete(id);
      await (complete ? this.tcp.close(id) : this.tcp.abort(id)).catch(() => {});
    }
  }
  private async serve(id: ConnectionId) {
    const disconnected = new AbortController();
    const signal = AbortSignal.any([
      this.lifetime.signal,
      disconnected.signal,
      AbortSignal.timeout(this.timeoutMs),
    ]);
    let checking = false;
    const monitor = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.tcp
        .isReadClosed(id)
        .then(
          (closed) => {
            if (closed) disconnected.abort(new Error('FIPS client disconnected'));
          },
          () => disconnected.abort(),
        )
        .finally(() => {
          checking = false;
        });
    }, 100);
    try {
      const raw = await this.readJson(
        id,
        MAX_REQUEST,
        AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      );
      if (raw.version !== 1) throw new Error('Unsupported Atlas FIPS operation protocol');
      const request = validateRpcRequest(raw),
        peer = await this.tcp.peer(id);
      if (!peer) throw new Error('Missing authenticated FIPS peer');
      let response: FipsRpcResponse;
      try {
        response = await abortable(this.handler!(request, peer, signal), signal);
      } catch (error) {
        signal.throwIfAborted();
        response = {
          status: 500,
          body: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
      let payload = response.bytes ?? encoder.encode(JSON.stringify(response.body ?? null));
      if (payload.length > (response.bytes ? MAX_BINARY : MAX_JSON)) {
        response = {
          status: 413,
          body: {
            error: 'Operation response exceeds the FIPS transfer limit; narrow the selection',
          },
        };
        payload = encoder.encode(JSON.stringify(response.body));
      }
      await this.writeJson(
        id,
        {
          version: 1,
          status: response.status,
          headers: headers(response.headers),
          kind: response.bytes ? 'bytes' : 'json',
          length: payload.length,
        },
        MAX_REQUEST,
        signal,
      );
      await this.write(id, payload, signal);
      await this.tcp.close(id);
    } finally {
      clearInterval(monitor);
    }
  }
  close() {
    if (this.closed) return this.closed;
    this.lifetime.abort(new Error('Atlas FIPS operations closed'));
    clearInterval(this.timer);
    this.closed = Promise.all(
      [...this.connections].map((id) => this.tcp.abort(id).catch(() => {})),
    ).then(() => this.tcp.dispose());
    return this.closed;
  }
}
