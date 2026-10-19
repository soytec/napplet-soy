import { DiagnosticError } from '../../../packages/diagnostics/src';

/** Short-lived, account-private binary staging. Never published to a relay or Blossom. */
export class StudioTransfers {
  private entries = new Map<
    string,
    { owner: string; bytes: Uint8Array; mime: string; expires: number }
  >();
  constructor(private now = Date.now) {}
  private prune() {
    for (const [id, entry] of this.entries)
      if (entry.expires <= this.now()) this.entries.delete(id);
  }
  put(owner: string, bytes: Uint8Array, mime = 'application/octet-stream') {
    this.prune();
    const entries = [...this.entries.values()];
    if (
      bytes.length > 32 * 1024 * 1024 ||
      entries.length >= 128 ||
      entries.reduce((n, e) => n + e.bytes.length, bytes.length) > 128 * 1024 * 1024 ||
      entries.filter((e) => e.owner === owner).reduce((n, e) => n + e.bytes.length, bytes.length) >
        48 * 1024 * 1024
    )
      throw new DiagnosticError(
        'STUDIO_TRANSFER',
        'Private transfer capacity reached. Wait a minute and retry.',
      );
    const id = crypto.randomUUID();
    this.entries.set(id, { owner, bytes, mime, expires: this.now() + 120000 });
    return id;
  }
  get(owner: string, id: string) {
    this.prune();
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner)
      throw new DiagnosticError(
        'STUDIO_TRANSFER',
        'This private transfer expired or belongs to another account. Request it again.',
      );
    return entry;
  }
  remove(owner: string, id: string) {
    this.get(owner, id);
    this.entries.delete(id);
  }
}
