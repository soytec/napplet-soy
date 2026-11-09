import { expect, test } from 'bun:test';
import { createGamepadInput } from './gamepad';
import {
  createGridInput,
  gridBindings,
  nextGridControl,
} from '../../../apps/web/src/lib/gamegrid-input';

function fixture() {
  const pad = {
    index: 0,
    id: 'test',
    mapping: 'standard' as GamepadMappingType,
    connected: true,
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, () => ({ value: 0, pressed: false, touched: false })),
  };
  let connected = true,
    active = true;
  const source = createGamepadInput(gridBindings, {
    read: () => (connected ? [pad] : []),
    active: () => active,
  });
  const input = createGridInput();
  const press = (...ids: number[]) =>
    pad.buttons.forEach((button, i) => {
      button.value = ids.includes(i) ? 1 : 0;
    });
  return {
    pad,
    press,
    connect: (value: boolean) => (connected = value),
    active: (value: boolean) => (active = value),
    poll: (time: number, scope = 'browse', playing = false) =>
      input.poll(source.poll(), scope, time, playing),
  };
}
test('navigation repeats but activation edges do not; diagonal input chooses one direction', () => {
  const f = fixture();
  f.poll(0);
  f.press(15, 0);
  expect(f.poll(10)).toEqual(['confirm', 'right']);
  expect(f.poll(200)).toEqual([]);
  expect(f.poll(400)).toEqual(['right']);
  f.press(12, 15);
  expect(f.poll(410)).toEqual(['up']);
});
test('held confirmation never crosses dialog, reconnect, or focus boundaries', () => {
  const f = fixture();
  f.poll(0);
  f.press(0);
  expect(f.poll(1)).toEqual(['confirm']);
  expect(f.poll(2, 'permission')).toEqual([]);
  expect(f.poll(50, 'permission')).toEqual([]);
  f.press();
  f.poll(60, 'permission');
  f.press(0);
  expect(f.poll(70, 'permission')).toEqual(['confirm']);
  f.connect(false);
  f.poll(80);
  f.connect(true);
  expect(f.poll(90)).toEqual([]);
  f.press();
  f.poll(100);
  f.active(false);
  f.poll(110);
  f.press(0);
  f.active(true);
  expect(f.poll(120)).toEqual([]);
});
test('gameplay only yields a deliberate menu chord; unmapped controllers do nothing', () => {
  const f = fixture();
  f.poll(0, 'game', true);
  f.press(0, 1, 15);
  expect(f.poll(10, 'game', true)).toEqual([]);
  f.press(8, 9);
  expect(f.poll(20, 'game', true)).toEqual([]);
  expect(f.poll(620, 'game', true)).toEqual(['menu']);
  expect(f.poll(900, 'game', true)).toEqual([]);
  f.pad.mapping = '';
  f.press();
  f.poll(1000);
  f.press(0, 15);
  expect(f.poll(1010)).toEqual([]);
});
test('spatial navigation respects a grid and does not wrap into unrelated controls', () => {
  const boxes = [0, 1, 2, 3, 4, 5].map((i) => ({
    x: (i % 3) * 200,
    y: Math.floor(i / 3) * 120,
    width: 180,
    height: 100,
  }));
  expect(nextGridControl(boxes, 1, 'down')).toBe(4);
  expect(nextGridControl(boxes, 4, 'left')).toBe(3);
  expect(nextGridControl(boxes, 0, 'left')).toBe(0);
  expect(nextGridControl(boxes, -1, 'right')).toBe(0);
});
