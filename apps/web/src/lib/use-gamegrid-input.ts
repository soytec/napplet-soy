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
  onSelect: (element: HTMLSelectElement) => void;
  onSection?: (direction: -1 | 1) => void;
  onSearch?: () => void;
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
    let lastTile: HTMLElement | null = null;
    const scope = () =>
      activeShellDialog() ??
      [
        ...document.querySelectorAll<HTMLElement>(
          '[data-slot="popover-content"][data-state="open"]',
        ),
      ].at(-1) ??
      current.current.root.current;
    const act = (action: GridAction, owner: HTMLElement) => {
      const { root, playing, onMenu, onBack, onText, onSelect, onSection, onSearch } =
        current.current;
      const modal = owner !== root.current;
      if (action === 'menu') {
        if (!modal) onMenu();
        else if (owner.matches('.gg-menu-dialog') || owner.querySelector('.gg-menu-dialog'))
          dismissGridScope(owner);
        return;
      }
      if (action === 'back') {
        const back =
          modal &&
          gridControls(owner).find((control) => control.hasAttribute('data-gamegrid-back'));
        if (back) back.click();
        else if (modal) dismissGridScope(owner);
        else onBack();
        return;
      }
      if (playing && !modal) return;
      if (action === 'previous-section' || action === 'next-section' || action === 'search') {
        if (!modal && !playing) {
          if (action === 'search') onSearch?.();
          else onSection?.(action === 'previous-section' ? -1 : 1);
        }
        return;
      }
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
          onSelect(selected);
        } else selected.click();
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
      const nearest = (candidates: HTMLElement[]) => {
        const list = [selected, ...candidates.filter((node) => node !== selected)];
        return list[
          nextGridControl(
            list.map((control) => control.getBoundingClientRect()),
            0,
            action,
          )
        ];
      };
      let target: HTMLElement | undefined;
      const group = !modal && selected.closest<HTMLElement>('[data-gamegrid-nav]');
      if (group) {
        const name = group.dataset.gamegridNav;
        // The toolbar overlays the first row. It must not steal horizontal
        // movement between tiles merely because its centre is closer.
        target = nearest(gridControls(group));
        if (name === 'grid' && target === selected && (action === 'up' || action === 'down')) {
          const bar = owner.querySelector<HTMLElement>(
            `[data-gamegrid-nav="${action === 'up' ? 'toolbar' : 'footer'}"]`,
          );
          if (bar) target = nearest(gridControls(bar));
        } else if (
          (name === 'toolbar' && action === 'down') ||
          (name === 'footer' && action === 'up')
        ) {
          const tiles = owner.querySelector<HTMLElement>('[data-gamegrid-nav="grid"]');
          if (tiles) {
            const candidates = gridControls(tiles);
            target = lastTile && candidates.includes(lastTile) ? lastTile : nearest(candidates);
          }
        }
      } else target = nearest(controls);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
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
            if (document.activeElement === document.body) {
              const controls = gridControls(owner);
              (controls.find((node) => node.hasAttribute('data-game-id')) ?? controls[0])?.focus({
                preventScroll: true,
              });
            }
          } else {
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
      if (event.key === 'F1') {
        event.preventDefault();
        act('menu', owner);
        return;
      }
      if (current.current.playing && owner === current.current.root.current) {
        return;
      }
      if (event.key === 'Escape' && owner === current.current.root.current) {
        event.preventDefault();
        act('back', owner);
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
      if (event.target instanceof HTMLElement && event.target.closest('[data-gamegrid-nav="grid"]'))
        lastTile = event.target;
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
