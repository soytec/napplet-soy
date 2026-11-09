import { useEffect, useRef, useState, type RefObject } from 'react';
import { createGamepadInput } from '../../../../packages/input/src/gamepad';
import { activeShellDialog } from '../../../../packages/runtime/src/shell-ui';
import { createGridInput, gridBindings, nextGridControl, type GridAction } from './gamegrid-input';

export function gridControls(scope: HTMLElement) {
  return [
    ...scope.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type=hidden]), textarea, select, summary, [tabindex="0"]',
    ),
  ].filter(
    (node) =>
      !node.matches(':disabled, [aria-disabled=true]') &&
      !node.closest('[inert], [hidden], .shell-notices') &&
      node.getClientRects().length > 0 &&
      getComputedStyle(node).visibility !== 'hidden',
  );
}

export function dismissGridScope(scope: HTMLElement) {
  if (scope instanceof HTMLDialogElement) {
    const event = new Event('cancel', { cancelable: true });
    if (scope.dispatchEvent(event)) scope.close();
  } else {
    // Radix popovers keep their existing dismissal path and account cleanup.
    (scope.querySelector<HTMLElement>('[aria-label="Close"]') ?? scope).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );
  }
}

/** Controller navigation belongs to trusted shell UI; games retain native input. */
export function useGamegridInput(options: {
  root: RefObject<HTMLElement | null>;
  playing: boolean;
  onMenu: () => void;
  onBack: () => void;
  onText: (element: HTMLInputElement | HTMLTextAreaElement) => void;
}) {
  const current = useRef(options);
  current.current = options;
  const pendingFocus = useRef(false);
  const [status, setStatus] = useState('Press a controller button to connect');
  const resumeWhenNeutral = () => {
    pendingFocus.current = true;
  };
  useEffect(() => {
    const native = createGamepadInput(gridBindings);
    const input = createGridInput();
    let raf = 0,
      lastStatus = '',
      lastScope: HTMLElement | null = null;
    const scope = () =>
      activeShellDialog() ??
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-slot="popover-content"][data-state="open"]',
        ),
      ].at(-1) ??
      current.current.root.current;
    const act = (action: GridAction, owner: HTMLElement) => {
      const { root, playing, onMenu, onBack, onText } = current.current;
      const modal = owner !== root.current;
      if (action === 'menu') {
        if (!modal) onMenu();
        return;
      }
      if (action === 'back') {
        if (modal) dismissGridScope(owner);
        else onBack();
        return;
      }
      if (playing && !modal) return;
      const controls = gridControls(owner);
      const selected =
        document.activeElement instanceof HTMLElement && controls.includes(document.activeElement)
          ? document.activeElement
          : controls[0];
      if (!selected) return;
      if (action === 'confirm') {
        if (
          (selected instanceof HTMLInputElement &&
            !selected.readOnly &&
            !['checkbox', 'radio', 'range', 'button', 'submit', 'file'].includes(selected.type)) ||
          (selected instanceof HTMLTextAreaElement && !selected.readOnly)
        )
          onText(selected);
        else if (selected instanceof HTMLSelectElement) {
          // Use directions to change a select without relying on an OS-owned popup.
          selected.focus();
        } else selected.click();
        return;
      }
      if (selected instanceof HTMLSelectElement && (action === 'left' || action === 'right')) {
        const choices = [...selected.options].filter((option) => !option.disabled);
        const index = choices.findIndex((option) => option.selected);
        const next =
          choices[Math.max(0, Math.min(choices.length - 1, index + (action === 'left' ? -1 : 1)))];
        if (next) {
          selected.value = next.value;
          selected.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return;
      }
      if (
        selected instanceof HTMLInputElement &&
        selected.type === 'range' &&
        (action === 'left' || action === 'right')
      ) {
        const minimum = Number(selected.min || 0);
        const maximum = Number(selected.max || 100);
        const step =
          selected.step === 'any' ? (maximum - minimum) / 100 : Number(selected.step || 1);
        const value = Math.max(
          minimum,
          Math.min(maximum, selected.valueAsNumber + (action === 'left' ? -step : step)),
        );
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          selected,
          String(value),
        );
        selected.dispatchEvent(new Event('input', { bubbles: true }));
        selected.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      const next = nextGridControl(
        controls.map((control) => control.getBoundingClientRect()),
        controls.indexOf(selected),
        action,
      );
      controls[next]?.focus({ preventScroll: true });
      controls[next]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    };
    const tick = (now: number) => {
      const frame = native.poll();
      const mapped = frame.players.some((pad) => pad.mapped);
      const label =
        frame.status === 'blocked'
          ? 'Controller access blocked by this browser'
          : frame.status === 'unavailable'
            ? 'Controller unavailable · use arrow keys'
            : frame.players.length && !mapped
              ? 'Use a standard-layout controller or keyboard'
              : mapped
                ? 'Controller connected'
                : 'Press a controller button to connect';
      if (lastStatus !== label) {
        lastStatus = label;
        setStatus(label);
      }
      const owner = scope();
      if (owner) {
        const game = current.current.playing && owner === current.current.root.current;
        if (!game) {
          if (owner === current.current.root.current) {
            // The grid is the primary surface. Wait for its first enabled tile
            // instead of pulling initial focus to account or navigation chrome.
            if (document.activeElement === document.body)
              gridControls(owner)
                .find((node) => node.hasAttribute('data-game-id'))
                ?.focus({ preventScroll: true });
          } else if (owner !== lastScope) {
            const controls = gridControls(owner);
            if (!controls.some((node) => node === document.activeElement))
              controls[0]?.focus({ preventScroll: true });
          }
        }
        const actions = input.poll(frame, game ? 'game' : owner, now, game);
        // A click can open a new scope. Never carry another action into it this frame.
        if (actions[0]) act(actions[0], owner);
        lastScope = owner;
        if (
          game &&
          pendingFocus.current &&
          (frame.status === 'ready' ||
            frame.status === 'waiting' ||
            frame.status === 'unavailable') &&
          frame.players.every(
            (pad) => pad.buttons.every((b) => b < 0.5) && pad.axes.every((a) => Math.abs(a) < 0.4),
          )
        ) {
          const frame =
            current.current.root.current?.querySelector<HTMLIFrameElement>('.player-stage iframe');
          if (frame) {
            pendingFocus.current = false;
            frame.focus();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const owner = scope();
      if (!owner) return;
      if (current.current.playing && owner === current.current.root.current) {
        if (event.key === 'F1') {
          event.preventDefault();
          current.current.onMenu();
        }
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      )
        return;
      const direction = (
        { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' } as const
      )[event.key as 'ArrowLeft'];
      if (direction) {
        event.preventDefault();
        act(direction, owner);
      }
    };
    // Dialog cleanup restores its previous focus synchronously. Keep that restore
    // from sending a still-held confirmation into the game before the next poll.
    const focus = (event: FocusEvent) => {
      if (!current.current.playing || !(event.target instanceof HTMLIFrameElement)) return;
      const root = current.current.root.current;
      // A host permission prompt can open directly from the game, without our
      // menu's Resume callback. Its focus restoration needs the same release gate.
      if (!pendingFocus.current && (!lastScope || lastScope === root)) return;
      pendingFocus.current = true;
      const target = root?.querySelector<HTMLElement>('.player-wrap') ?? root;
      if (target) {
        if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
    };
    raf = requestAnimationFrame(tick);
    document.addEventListener('keydown', keyboard);
    document.addEventListener('focusin', focus, true);
    return () => {
      cancelAnimationFrame(raf);
      native.dispose();
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('focusin', focus, true);
    };
  }, []);
  return { status, resumeWhenNeutral };
}
