import type { Controller, ControllerFrame } from '../../../../packages/input/src/gamepad';

export type GridAction =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'confirm'
  | 'back'
  | 'menu'
  | 'previous-section'
  | 'next-section'
  | 'search';
export const gridBindings = {
  x: [{ axis: 0 }, { button: 14, scale: -1 }, { button: 15 }],
  y: [{ axis: 1 }, { button: 12, scale: -1 }, { button: 13 }],
  scroll: [{ axis: 3 }],
  confirm: [{ button: 0 }],
  back: [{ button: 1 }],
  select: [{ button: 8 }],
  start: [{ button: 9 }],
  previous: [{ button: 4 }],
  next: [{ button: 5 }],
  search: [{ button: 3 }],
} as const;

const scrollDeadZone = 0.25;

/** Raw axes and mapped scroll must both be neutral before entering another surface. */
export function isGridInputNeutral(pad: Pick<Controller, 'buttons' | 'axes' | 'actions'>) {
  return (
    pad.buttons.every((button) => button < 0.5) &&
    pad.axes.every((axis) => Math.abs(axis) < 0.4) &&
    Math.abs(pad.actions.scroll?.value ?? 0) <= scrollDeadZone
  );
}

/** Menu input only. A new focus scope must observe neutral input before it can act. */
export function createGridInput() {
  let scope: unknown,
    controller = '',
    armed = false;
  let direction = '',
    repeatAt = 0;
  let lastPoll: number | undefined,
    scrollPixels = 0;
  let confirm = false,
    back = false,
    menu = false,
    previous = false,
    nextSection = false,
    search = false;
  return {
    get scrollPixels() {
      return scrollPixels;
    },
    poll(frame: ControllerFrame, nextScope: unknown, now: number, playing = false): GridAction[] {
      const elapsed = lastPoll === undefined ? 0 : Math.max(0, Math.min(50, now - lastPoll));
      lastPoll = now;
      scrollPixels = 0;
      const pad = frame.players.find((p) => p.mapped);
      const key = pad ? `${pad.index}:${pad.id}:${pad.mapping}` : '';
      if (scope !== nextScope || key !== controller || frame.status !== 'ready') {
        scope = nextScope;
        controller = key;
        armed = false;
        direction = '';
        confirm = back = false;
        menu = previous = nextSection = search = false;
      }
      if (!pad || frame.status !== 'ready') return [];
      const neutral = isGridInputNeutral(pad);
      if (!armed) {
        armed = neutral;
        return [];
      }
      const down = (name: string) => !!pad.actions[name]?.down;
      const menuDown = down('select') || down('start');
      const menuPressed = menuDown && !menu;
      menu = menuDown;
      if (menuPressed) return ['menu'];
      // Gameplay owns ordinary input. Neither A nor B can navigate the shell behind it.
      if (playing || menuDown) return [];
      const scroll = pad.actions.scroll?.value ?? 0;
      // Continuous motion has the same scope/reconnect neutral gate as clicks.
      // Integrate frame time, with a drift dead zone and no jump after a stalled frame.
      if (Math.abs(scroll) > scrollDeadZone)
        scrollPixels =
          (Math.sign(scroll) *
            Math.pow((Math.abs(scroll) - scrollDeadZone) / (1 - scrollDeadZone), 1.5) *
            900 *
            elapsed) /
          1000;
      const actions: GridAction[] = [];
      if (down('previous') && !previous) actions.push('previous-section');
      if (down('next') && !nextSection) actions.push('next-section');
      if (down('search') && !search) actions.push('search');
      previous = down('previous');
      nextSection = down('next');
      search = down('search');
      if (down('confirm') && !confirm) actions.push('confirm');
      if (down('back') && !back) actions.push('back');
      confirm = down('confirm');
      back = down('back');
      const x = pad.actions.x?.value ?? 0,
        y = pad.actions.y?.value ?? 0;
      const next =
        Math.max(Math.abs(x), Math.abs(y)) < 0.5
          ? ''
          : Math.abs(x) > Math.abs(y)
            ? x < 0
              ? 'left'
              : 'right'
            : y < 0
              ? 'up'
              : 'down';
      if (next && (next !== direction || now >= repeatAt)) {
        actions.push(next);
        repeatAt = now + (next === direction ? 160 : 380);
      }
      direction = next;
      return actions;
    },
  };
}

export type FocusBox = { x: number; y: number; width: number; height: number };
/** Choose the nearest control in the requested half-plane, preferring aligned rows/columns. */
export function nextGridControl(boxes: FocusBox[], current: number, direction: GridAction) {
  if (!boxes.length) return -1;
  if (current < 0 || !boxes[current]) return 0;
  const source = boxes[current];
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'left' || direction === 'up' ? -1 : 1;
  let selected = current,
    best = Infinity;
  boxes.forEach((box, index) => {
    if (index === current) return;
    const dx = box.x + box.width / 2 - source.x - source.width / 2;
    const dy = box.y + box.height / 2 - source.y - source.height / 2;
    const forward = sign * (horizontal ? dx : dy),
      sideways = Math.abs(horizontal ? dy : dx);
    if (forward <= 2) return;
    const aligned =
      sideways < (horizontal ? (box.height + source.height) / 2 : (box.width + source.width) / 2);
    // Alignment is a preference, not an absolute lane. A small corner button
    // must be able to reach the nearby row instead of skipping it for a wide
    // control far down the dialog.
    const score = forward + sideways * (aligned ? 0.25 : 1);
    if (score < best) {
      best = score;
      selected = index;
    }
  });
  return selected;
}
