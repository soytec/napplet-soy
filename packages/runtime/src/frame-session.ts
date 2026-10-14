import { surfaceDomains } from './capabilities';

/** Trusted shell document binding; never supplied by a napplet or its manifest. */
export type FrameSession = {
  readonly id: string;
  readonly domains: readonly string[];
};
export function createFrameSession(intent = false): FrameSession {
  return Object.freeze({ id: crypto.randomUUID(), domains: Object.freeze(surfaceDomains(intent)) });
}

/** Host-private lifecycle signals. These are not NAP requests or receiver acknowledgements. */
export function frameSessionPrelude(session: FrameSession) {
  return `(() => {
    const post = window.parent.postMessage.bind(window.parent);
    const session = ${JSON.stringify(session.id)};
    const retire = () => post({ type: 'soy.frame.retired', session }, '*');
    window.addEventListener('pagehide', retire, { capture: true });
    window.addEventListener('beforeunload', retire, { capture: true });
    post({ type: 'soy.frame.ready', session }, '*');
  })();`;
}
