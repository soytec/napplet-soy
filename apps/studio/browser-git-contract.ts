/** Local experiment contract, not a Nostr event or a replacement for GRASP. */
export const gitLimits = {
  files: 1024,
  bytes: 40 * 1024 * 1024,
  packBytes: 40 * 1024 * 1024,
  editBytes: 256 * 1024,
};
export type GitSnapshot = {
  head: string;
  revision: string;
  pack: string;
  files: { path: string; data: string }[];
};
export type GitView = {
  head: string;
  base: string;
  revision: string;
  files: string[];
  changes: { path: string; status: string }[];
  log: { oid: string; message: string }[];
};
export type GitDiff = { path: string; before: string; after: string };
export type GitCommand =
  | { type: 'status' }
  | { type: 'import'; snapshot: GitSnapshot }
  | { type: 'clone'; url: string; commit: string }
  | { type: 'read'; path: string }
  | { type: 'diff'; path: string }
  | { type: 'write'; path: string; text: string; expected: string }
  | { type: 'commit'; message: string; expected: string }
  | { type: 'export' };
export function gitPath(path: string) {
  if (
    !path ||
    path.length > 200 ||
    /[\\\s\x00-\x1f\x7f]/.test(path) ||
    path
      .split('/')
      .some(
        (p) =>
          !p ||
          p === '.' ||
          p === '..' ||
          /^(\.git|\.env(?:\..*)?|\.napplet-space|node_modules|.*\.(pem|key|p12|pfx|ncryptsec))$/i.test(
            p,
          ),
      )
  )
    throw new Error(
      'Choose a relative public source path without links, private files or traversal.',
    );
  return path;
}
export function gitOid(oid: string) {
  if (!/^[a-f0-9]{40}$/.test(oid)) throw new Error('An exact SHA-1 Git commit is required.');
  return oid;
}
export function gitUrl(input: string) {
  const u = new URL(input);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !u.pathname.endsWith('.git') ||
    (u.protocol !== 'https:' &&
      !(
        u.protocol === 'http:' &&
        u.hostname === '127.0.0.1' &&
        (typeof location === 'undefined' || ['localhost', '127.0.0.1'].includes(location.hostname))
      ))
  )
    throw new Error('Use an HTTPS Git URL, or a loopback GRASP URL in local Studio.');
  return u.href;
}
export const toBase64 = (bytes: Uint8Array) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
export function fromBase64(value: string, limit: number) {
  if (value.length > Math.ceil(limit / 3) * 4)
    throw new Error('Browser Git transfer exceeds its size limit.');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (bytes.length > limit) throw new Error('Browser Git transfer exceeds its size limit.');
  return bytes;
}
export async function gitDigest(value: string | Uint8Array) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
