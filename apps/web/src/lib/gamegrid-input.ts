import type { ControllerFrame } from '../../../../packages/input/src/gamepad';

export type GridAction = 'left' | 'right' | 'up' | 'down' | 'confirm' | 'back' | 'menu';
export const gridBindings = {
  x: [{ axis: 0 }, { button: 14, scale: -1 }, { button: 15 }],
  y: [{ axis: 1 }, { button: 12, scale: -1 }, { button: 13 }],
  confirm: [{ button: 0 }],
  back: [{ button: 1 }],
  select: [{ button: 8 }],
  start: [{ button: 9 }],
} as const;

/** Menu input only. A new focus scope must observe neutral input before it can act. */
export function createGridInput() {
  let scope: unknown,
    controller = '',
    armed = false;
  let direction = '',
    repeatAt = 0,
    chordAt: number | null = null,
    chordSent = false;
  let confirm = false,
    back = false;
  return {
    poll(frame: ControllerFrame, nextScope: unknown, now: number, playing = false): GridAction[] {
      const pad = frame.players.find((p) => p.mapped);
      const key = pad ? `${pad.index}:${pad.id}:${pad.mapping}` : '';
      if (scope !== nextScope || key !== controller || frame.status !== 'ready') {
        scope = nextScope;
        controller = key;
        armed = false;
        direction = '';
        chordAt = null;
        chordSent = false;
        confirm = back = false;
      }
      if (!pad || frame.status !== 'ready') return [];
      const neutral = pad.buttons.every((b) => b < 0.5) && pad.axes.every((a) => Math.abs(a) < 0.4);
      if (!armed) {
        armed = neutral;
        return [];
      }
      const down = (name: string) => !!pad.actions[name]?.down;
      const chord = down('select') && down('start');
      if (chord) {
        chordAt ??= now;
        if (!chordSent && now - chordAt >= 600) {
          chordSent = true;
          return ['menu'];
        }
      } else {
        chordAt = null;
        chordSent = false;
      }
      // Gameplay owns ordinary input. Neither A nor B can navigate the shell behind it.
      if (playing || chord) return [];
      const actions: GridAction[] = [];
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
    const score = forward + sideways * (aligned ? 0.25 : 4) + (aligned ? 0 : 1000);
    if (score < best) {
      best = score;
      selected = index;
    }
  });
  return selected;
}
