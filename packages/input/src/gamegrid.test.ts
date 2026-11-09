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
test('Select or Start opens the menu once from browsing and gameplay', () => {
  for (const playing of [false, true]) {
    for (const button of [8, 9]) {
      const f = fixture();
      const scope = playing ? 'game' : 'browse';
      f.poll(0, scope, playing);
      f.press(button);
      expect(f.poll(10, scope, playing)).toEqual(['menu']);
      expect(f.poll(1000, scope, playing)).toEqual([]);
      f.press();
      f.poll(1010, scope, playing);
      f.press(button);
      expect(f.poll(1020, scope, playing)).toEqual(['menu']);
    }
  }
});
test('menu presses cannot cross a newly opened scope or repeat while held', () => {
  const f = fixture();
  f.poll(0);
  f.press(8, 9);
  expect(f.poll(10)).toEqual(['menu']);
  expect(f.poll(20, 'menu')).toEqual([]);
  expect(f.poll(1000, 'menu')).toEqual([]);
  f.press();
  f.poll(1010, 'menu');
  f.press(9);
  expect(f.poll(1020, 'menu')).toEqual(['menu']);
});
test('gameplay retains ordinary controls; unmapped controllers do nothing', () => {
  const f = fixture();
  f.poll(0, 'game', true);
  f.press(0, 1, 15);
  expect(f.poll(10, 'game', true)).toEqual([]);
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
test('down from an account close control reaches the nearby sign-in row before a wide lower action', () => {
  const boxes = [
    { x: 977, y: 263, width: 24, height: 42 },
    { x: 439, y: 375, width: 122, height: 42 },
    { x: 567, y: 375, width: 156, height: 42 },
    { x: 729, y: 375, width: 130, height: 42 },
    { x: 439, y: 543, width: 562, height: 42 },
  ];
  expect(nextGridControl(boxes, 0, 'down')).toBe(3);
});
