import { RUNTIME_DOMAINS } from './capabilities';
import { validateConfigSchema } from './config-schema';

/**
 * Interim WebRTC removal from the pending NIP-5D revision (dskvr/nips PR 16/17).
 * Neither the iframe sandbox nor CSP governs WebRTC, and a page cannot disable it
 * for its iframes. NAP-WEBRTC peer connections stay in the shell realm, so the
 * napplet realm has no legitimate use for these constructors. A napplet can still
 * nest a srcdoc frame with its own constructors; this narrows, not closes, the
 * channel.
 */
export const WEBRTC_REMOVAL = `
(() => {
  const names = new Set(Object.getOwnPropertyNames(globalThis).filter(name => name.startsWith('RTC')));
  for (const prefix of ['webkit', 'moz'])
    for (const name of ['RTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate'])
      names.add(prefix + name);
  for (const name of names) {
    try {
      Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false, enumerable: false });
    } catch {}
  }
})();`;

/**
 * The pinned upstream shim plus Soy's static config snapshot. The shim opens the
 * NIP-5D channel before any napplet script runs: it keeps one MessagePort private
 * and hands the other to the shell in the single window-level `napplet.hello`.
 * SHELL, like every other domain, travels only over that port.
 */
export function nappletPrelude(shim: string, declaration?: { schema?: unknown }) {
  let schema = null;
  try {
    if (declaration?.schema !== undefined) schema = validateConfigSchema(declaration.schema);
  } catch {
    /* Host reports the declaration error. */
  }
  // The pinned shim tracks runtime registrations. Supply its missing static schema
  // snapshot before creator scripts, using the same validated, signed build metadata.
  // No additional wire messages or app-owned bootstrap are required.
  const config = `(() => {
    const api = window.napplet.config;
    const declared = ${JSON.stringify(schema)};
    window.napplet.config = Object.freeze({
      ...api,
      registerSchema: (schema, version) => api.registerSchema(structuredClone(schema), version),
      get schema() { return structuredClone(api.schema ?? declared); },
      onSchemaError: callback => {
        const unsubscribe = api.onSchemaError(callback);
        unsubscribe.close = unsubscribe;
        return unsubscribe;
      },
    });
  })();`;
  return `${WEBRTC_REMOVAL}\n${shim}\nglobalThis.NappletShimPrelude.install(${JSON.stringify({ domains: RUNTIME_DOMAINS })});\n${config}`;
}
