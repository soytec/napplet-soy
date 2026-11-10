/** Explicit experimental profile, not a standard NAP-FIPS or HTS URI. */
export const FIPS_PROFILE = 'soy.fips/1';
export const FIPS_TIMEOUT_MS = 20 * 60_000;
export const FIPS_BLOCK_BYTES = 2 * 1024 ** 2;
export const FIPS_CACHE_BYTES = 32 * 1024 ** 2;
export type FipsProvider = {
  peerId: string;
  seedUrls: string[];
  servicePort?: number;
  rpcPort?: number;
};
export type FipsRoot = {
  root: string;
  bytes: number;
  chunkBytes: number;
  providers: FipsProvider[];
  expires: number;
};
export type FipsStats = {
  networkRequests: number;
  fipsBytes: number;
  activeTransfers: number;
  queuedTransfers: number;
  retries: number;
  failovers: number;
  verifiedBlobs: number;
  cacheHits: number;
  errors: number;
  cancelledRequests: number;
};
export type FipsOperation = { path: string; method: 'GET' | 'POST'; body?: unknown };
export type FipsResponse = {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  bytes?: Uint8Array;
};
export interface FipsBinding {
  info(): Promise<{
    profile: typeof FIPS_PROFILE;
    enabled: boolean;
    timeoutMs: number;
    stats: FipsStats;
  }>;
  open(roots: FipsRoot[], options?: { signal?: AbortSignal }): Promise<string[]>;
  bytes(grant: string, hash: string, options?: { signal?: AbortSignal }): Promise<Uint8Array>;
  request(
    grant: string,
    operation: FipsOperation,
    options?: { signal?: AbortSignal },
  ): Promise<FipsResponse>;
  release(grant: string): Promise<void>;
  subscribe(callback: (stats: FipsStats) => void): () => void;
}

/** Application adapter for the explicit soy.fips/1 profile. No networking or bootstrap. */
export function fipsResources(): FipsBinding {
  const api = (globalThis as { napplet?: { resource?: { soyFips?: FipsBinding } } }).napplet
    ?.resource?.soyFips;
  if (!api)
    throw new Error(
      'This shell does not support the experimental soy.fips/1 resource profile. Open this map in an updated soyLI preview or napplet.soy.',
    );
  return api;
}
