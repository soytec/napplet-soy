/** Dependency-free so the CLI check can report causes without bundling the browser host. */
/**
 * NIP-5D evidence that the verified document no longer owns the frame, or never
 * performed the injected bootstrap handoff.
 */
export type NappletRevocation =
  'invalid-hello' | 'second-hello' | 'window-message' | 'second-load' | 'port-closed';
export const NAPPLET_HELLO = 'napplet.hello';

/** Viewer-facing explanation; the frame is already gone when this is shown. */
export function revocationMessage(reason: NappletRevocation, audience: 'viewer' | 'creator') {
  const transport = reason === 'window-message' || reason === 'invalid-hello';
  if (audience === 'creator')
    return transport
      ? `Stopped (${reason}): the napplet posted a window-level message outside its NIP-5D port. Remove bundled @napplet/shim copies and direct parent.postMessage calls; use the injected window.napplet.`
      : `Stopped (${reason}): the napplet navigated, reloaded or replaced its verified document. Napplets must stay on their verified page.`;
  return transport
    ? 'This creation was stopped because it used an outdated host connection. Its creator can republish it with a current napplet SDK.'
    : 'This creation was stopped because it tried to leave its verified page.';
}
