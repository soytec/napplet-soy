import { z } from 'zod';
import { resourceUrl } from '../../../client/src/bytes';
import { FIPS_BLOCK_BYTES, type FipsRoot } from './contract';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const provider = z
  .object({
    peerId: z.string().regex(/^(02|03)[a-f0-9]{64}$/),
    seedUrls: z.array(z.string().max(2048)).min(1).max(4),
    servicePort: z.literal(39018).optional(),
    rpcPort: z.literal(39019).optional(),
  })
  .strict();
const root = z
  .object({
    root: hash,
    bytes: z
      .number()
      .int()
      .positive()
      .max(2 ** 40),
    chunkBytes: z.number().int().min(1024).max(FIPS_BLOCK_BYTES),
    providers: z.array(provider).min(1).max(8),
    expires: z.number().int().positive(),
  })
  .strict();
export function parseRoots(
  input: unknown,
  localSeeds: string[] = [],
  now = Date.now(),
): FipsRoot[] {
  const roots = z.array(root).min(1).max(32).parse(input);
  for (const r of roots) {
    if (r.expires * 1000 <= now || r.expires * 1000 > now + 7 * 86400_000)
      throw new Error('The resource grant has expired or exceeds seven days. Refresh discovery.');
    for (const p of r.providers)
      p.seedUrls = [
        ...new Set(
          p.seedUrls.map((seed) => {
            const url = new URL(seed);
            if (!['ws:', 'wss:'].includes(url.protocol) || url.hash)
              throw new Error('Unsupported FIPS seed URL');
            const http = seed.replace(/^ws/, 'http');
            resourceUrl(
              http,
              localSeeds.map((s) => s.replace(/^ws/, 'http')),
            );
            if (url.protocol === 'wss:' && url.port && url.port !== '443')
              throw new Error('Public FIPS seeds require port 443');
            return url.href;
          }),
        ),
      ].sort();
  }
  return roots;
}

/** UI-owned browser setting; a frame can request grants but cannot edit policy. */
const key = 'napplet:fips-resources:v1';
const changed = 'napplet:fips-resources-changed';
let temporary: boolean | undefined;
export function fipsEnabled() {
  if (temporary !== undefined) return temporary;
  try {
    return localStorage.getItem(key) !== 'blocked';
  } catch {
    return true;
  }
}
export function setFipsEnabled(enabled: boolean) {
  try {
    localStorage.setItem(key, enabled ? 'ask' : 'blocked');
    temporary = undefined;
  } catch {
    temporary = enabled;
  }
  window.dispatchEvent(new Event(changed));
}
export function onFipsPolicyChange(callback: () => void) {
  const storage = (e: StorageEvent) => {
    if (e.key === key || e.key === null) {
      temporary = undefined;
      callback();
    }
  };
  window.addEventListener(changed, callback);
  window.addEventListener('storage', storage);
  return () => {
    window.removeEventListener(changed, callback);
    window.removeEventListener('storage', storage);
  };
}
