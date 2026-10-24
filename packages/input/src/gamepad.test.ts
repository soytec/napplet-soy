import { expect, test } from 'bun:test';
import { createGamepadInput, type GamepadSample } from './gamepad';

function pad(
  index = 0,
  id = 'Test controller',
  mapping: Gamepad['mapping'] = 'standard',
): GamepadSample {
  return {
    index,
    id,
    mapping,
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false, touched: false })),
  };
}
function rig() {
  let samples: (GamepadSample | null)[] = [],
    active = true;
  const input = createGamepadInput(undefined, { read: () => samples, active: () => active });
  return {
    input,
    set: (pads: (GamepadSample | null)[]) => {
      samples = pads;
    },
    active: (v: boolean) => {
      active = v;
    },
  };
}
function press(pad: GamepadSample, button: number, value: number) {
  (pad.buttons as GamepadButton[])[button] = { value, pressed: value > 0.5, touched: value > 0 };
}

test('sparse slots, two local players and replacements have distinct connection lifecycles', () => {
  const r = rig(),
    first = pad(1),
    second = pad(3);
  expect(r.input.poll()).toMatchObject({ status: 'waiting', players: [], connected: [] });
  r.set([null, first, null, second]);
  expect(r.input.poll()).toMatchObject({
    connected: [1, 3],
    disconnected: [],
    players: [{ index: 1 }, { index: 3 }],
  });
  expect(r.input.poll().connected).toEqual([]);
  r.set([null, null, null, second]);
  expect(r.input.poll().disconnected).toEqual([1]);
  r.set([null, null, null, pad(3, 'Replacement')]);
  expect(r.input.poll()).toMatchObject({ connected: [3], disconnected: [3] });
  r.input.dispose();
});

test('buttons have one-shot edges and analog triggers; result mutation does not corrupt history', () => {
  const r = rig(),
    p = pad();
  r.set([p]);
  r.input.poll();
  press(p, 0, 1);
  press(p, 7, 0.7);
  const frame = r.input.poll();
  expect(frame.players[0].actions.jump).toEqual({
    value: 1,
    down: true,
    pressed: true,
    released: false,
  });
  expect(frame.players[0].actions.fire.value).toBe(0.7);
  frame.players[0].actions.jump.down = false;
  expect(r.input.poll().players[0].actions.jump.pressed).toBe(false);
  press(p, 0, 0);
  expect(r.input.poll().players[0].actions.jump.released).toBe(true);
  expect(r.input.poll().players[0].actions.jump.released).toBe(false);
  r.input.dispose();
});

test('dead zones reject drift, rescale motion, cancel opposing alternatives and sanitize values', () => {
  const r = rig(),
    p = pad();
  r.set([p]);
  (p.axes as number[])[0] = 0.1;
  expect(r.input.poll().players[0].actions.moveX.value).toBe(0);
  (p.axes as number[])[0] = 0.59;
  expect(r.input.poll().players[0].actions.moveX.value).toBeCloseTo(0.5);
  press(p, 14, 1);
  expect(r.input.poll().players[0].actions.moveX.value).toBe(-1);
  press(p, 15, 1);
  expect(r.input.poll().players[0].actions.moveX.value).toBe(0);
  (p.axes as number[]).splice(0, 4, NaN, Infinity, -2, 2);
  expect(r.input.poll().players[0].axes).toEqual([0, 0, -1, 1]);
  r.input.dispose();
});

test('focus loss neutralizes held input and resume, reset and connection never invent button presses', () => {
  const r = rig(),
    p = pad();
  press(p, 0, 1);
  r.set([p]);
  expect(r.input.poll().players[0].actions.jump.pressed).toBe(false);
  r.active(false);
  expect(r.input.poll()).toMatchObject({
    status: 'inactive',
    players: [{ actions: { jump: { value: 0, down: false, pressed: false, released: false } } }],
  });
  r.active(true);
  expect(r.input.poll().players[0].actions.jump).toMatchObject({ down: true, pressed: false });
  press(p, 0, 0);
  r.input.poll();
  press(p, 0, 1);
  r.input.reset();
  expect(r.input.poll().players[0].actions.jump.pressed).toBe(false);
  press(p, 0, 0);
  r.input.poll();
  press(p, 0, 1);
  expect(r.input.poll().players[0].actions.jump.pressed).toBe(true);
  r.input.dispose();
  expect(r.input.poll().status).toBe('closed');
});

test('unknown layouts expose raw input but require explicit mapping; mappings cannot leak into a new device', () => {
  const r = rig(),
    p = pad(2, 'Custom', '');
  press(p, 1, 1);
  r.set([null, null, p]);
  let frame = r.input.poll();
  expect(frame.players[0]).toMatchObject({ mapped: false, actions: { jump: { value: 0 } } });
  expect(frame.players[0].buttons[1]).toBe(1);
  r.input.remap(2, { jump: [{ button: 1 }], moveX: [{ axis: 0, scale: -1 }] });
  frame = r.input.poll();
  expect(frame.players[0]).toMatchObject({
    mapped: true,
    actions: { jump: { down: true, pressed: false } },
  });
  (p.axes as number[])[0] = -1;
  expect(r.input.poll().players[0].actions.moveX.value).toBe(1);
  r.set([]);
  r.input.poll();
  r.set([null, null, p]);
  expect(r.input.poll().players[0].mapped).toBe(false);
  r.input.remap(2, { jump: [{ button: 1 }] });
  r.set([null, null, pad(2, 'Different', '')]);
  expect(r.input.poll().players[0].mapped).toBe(false);
  expect(() => r.input.remap(4, {})).toThrow('Connect');
  r.input.dispose();
});

test('mapping thresholds and invalid options have explicit behavior', () => {
  const p = pad();
  press(p, 3, 0.25);
  const input = createGamepadInput(
    { activate: [{ button: 3 }] },
    { read: () => [p], active: () => true, buttonThreshold: 0.2 },
  );
  expect(input.poll().players[0].actions.activate.down).toBe(true);
  input.dispose();
  for (const deadZone of [-1, 1, NaN]) expect(() => createGamepadInput({}, { deadZone })).toThrow();
  for (const buttonThreshold of [0, 2, NaN])
    expect(() => createGamepadInput({}, { buttonThreshold })).toThrow();
  expect(() => createGamepadInput({ jump: [{ button: -1 }] })).toThrow();
});

test('API denial clears stale controllers and distinguishes policy from unsupported browsers', () => {
  let fail = false;
  const input = createGamepadInput(undefined, {
    active: () => true,
    read: () => {
      if (fail) throw new DOMException('Denied', 'SecurityError');
      return [pad()];
    },
  });
  input.poll();
  fail = true;
  expect(input.poll()).toMatchObject({ status: 'blocked', players: [], disconnected: [0] });
  expect(input.poll().disconnected).toEqual([]);
  input.dispose();
  const unsupported = createGamepadInput(
    {},
    {
      read: () => {
        throw new Error('missing');
      },
    },
  );
  expect(unsupported.poll().status).toBe('unavailable');
  unsupported.dispose();
});
