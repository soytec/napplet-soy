type Kind = 'napplet' | 'media' | 'preview';
/** Shared by every shell surface; automatic decorative previews cannot interrupt explicit play. */
export class PlaybackCoordinator {
  private active = new Map<object, { kind: Kind; stop: () => void; group?: object }>();
  /** A shared group permits simultaneous decorative previews; explicit media remains exclusive. */
  claim(owner: object, kind: Kind, stop: () => void, group?: object) {
    if (this.active.has(owner)) return true;
    const previous = [...this.active.values()];
    if (kind === 'preview' && previous.some((entry) => entry.kind !== 'preview')) return false;
    const shared =
      kind === 'preview' &&
      group !== undefined &&
      previous.every((entry) => entry.kind === 'preview' && entry.group === group);
    if (!shared) this.active.clear();
    this.active.set(owner, { kind, stop, group });
    if (!shared) for (const entry of previous) entry.stop();
    return true;
  }
  release(owner: object) {
    this.active.delete(owner);
  }
}
export const playback = new PlaybackCoordinator();
