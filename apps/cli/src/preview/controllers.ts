import { PLAYER_ALLOW, PLAYER_SANDBOX, verifiedDocument } from '../../../../packages/runtime/src';
import { attachGamepadBridge } from '../../../../packages/runtime/src/gamepad-session';
import { gamepadPrelude } from '../../../../packages/runtime/src/prelude';
import { sha256 } from '../../../../packages/protocol/src/artifact';

declare const SOYLI_CONTROLLER_TESTER: string;
export function setupControllers(signal: AbortSignal) {
  const details = document.querySelector<HTMLDetailsElement>('#controller-details')!;
  const stage = document.querySelector<HTMLElement>('#controller-stage')!;
  let generation = 0;
  let detach: (() => void) | undefined;
  const clear = () => {
    detach?.();
    detach = undefined;
    stage.replaceChildren();
  };
  details.addEventListener(
    'toggle',
    async () => {
      const turn = ++generation;
      clear();
      if (!details.open || signal.aborted) return;
      const bytes = new TextEncoder().encode(SOYLI_CONTROLLER_TESTER);
      // The tester reads controllers exactly as a napplet does: through the shell's broker.
      const doc = await verifiedDocument(
        bytes,
        await sha256(bytes),
        'window.napplet = {};\n' + gamepadPrelude(),
      );
      if (turn !== generation || !details.open || signal.aborted) return;
      const frame = document.createElement('iframe');
      frame.title = 'Controller bench';
      frame.sandbox.value = PLAYER_SANDBOX;
      frame.allow = PLAYER_ALLOW;
      frame.referrerPolicy = 'no-referrer';
      frame.srcdoc = doc;
      frame.style.cssText =
        'display:block;width:100%;height:640px;border:1px solid #c8cbbf;border-radius:12px;margin:12px 0';
      stage.replaceChildren(frame);
      detach = attachGamepadBridge(frame);
    },
    { signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      generation++;
      clear();
    },
    { once: true },
  );
}
