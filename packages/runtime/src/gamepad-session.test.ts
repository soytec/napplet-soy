import { expect, test } from 'bun:test';
import {
  GamepadBroker,
  NappletGamepad,
  sampleGamepads,
  type GamepadEnvironment,
  type GamepadState,
} from './gamepad-session';

function fakeEnvironment() {
  const frames = { a: {} as HTMLIFrameElement, b: {} as HTMLIFrameElement };
  const state = {
    slots: [] as unknown[],
    focus: null as HTMLIFrameElement | null,
    error: null as Error | null,
    scheduled: [] as (() => void)[],
    watchers: new Set<() => void>(),
  };
  const environment: GamepadEnvironment = {
    read: () => {
      if (state.error) throw state.error;
      return state.slots as ArrayLike<null>;
    },
    focused: (frame) => state.focus === frame,
    schedule: (callback) => {
      state.scheduled.push(callback);
      return () => {
        state.scheduled = state.scheduled.filter((item) => item !== callback);
      };
    },
    watch: (callback) => {
      state.watchers.add(callback);
      return () => state.watchers.delete(callback);
    },
  };
  const frame = () => {
    const next = state.scheduled.splice(0);
    for (const callback of next) callback();
  };
  return { frames, state, environment, frame };
}
const pad = (id: string, x: number, jump = 0, timestamp = 1) => ({
  id,
  mapping: 'standard',
  connected: true,
  timestamp,
  axes: [x, 0],
  buttons: [{ value: jump, pressed: jump > 0.5, touched: false }],
});

test('only the focused frame receives live input; others get one neutral snapshot', () => {
  const { frames, state, environment, frame } = fakeEnvironment();
  const broker = new GamepadBroker(environment);
  const sent = { a: [] as GamepadState[], b: [] as GamepadState[] };
  const a = new NappletGamepad({ frame: frames.a, send: (m) => sent.a.push(m), broker });
  const b = new NappletGamepad({ frame: frames.b, send: (m) => sent.b.push(m), broker });
  state.slots = [pad('Pad', 0.5, 1, 7), null];
  state.focus = frames.a;
  a.handle({ type: 'gamepad.subscribe' });
  b.handle({ type: 'gamepad.subscribe' });
  expect(sent.a.at(-1)).toMatchObject({
    focused: true,
    available: true,
    pads: [{ index: 0, id: 'Pad', timestamp: 7, axes: [0.5, 0], buttons: [{ value: 1 }] }, null],
  });
  expect(sent.b.at(-1)).toMatchObject({
    focused: false,
    pads: [
      { id: 'Pad', timestamp: 0, axes: [0, 0], buttons: [{ value: 0, pressed: false }] },
      null,
    ],
  });
  // Unchanged state is not resent; a neutral frame does not leak activity timing.
  state.slots = [pad('Pad', -1, 0, 8), null];
  frame();
  expect(sent.a).toHaveLength(2);
  expect(sent.b).toHaveLength(1);
  // Focus moves: the old owner is neutralized immediately, the new one goes live.
  state.focus = frames.b;
  for (const watcher of state.watchers) watcher();
  expect(sent.a.at(-1)).toMatchObject({ focused: false, pads: [{ axes: [0, 0] }, null] });
  expect(sent.b.at(-1)).toMatchObject({ focused: true, pads: [{ axes: [-1, 0] }, null] });
  // A connection is visible to unfocused frames without its values.
  state.slots = [pad('Pad', -1, 0, 8), pad('Second', 1)];
  frame();
  expect(sent.a.at(-1)?.pads[1]).toMatchObject({ id: 'Second', axes: [0, 0] });
  a.close();
  b.handle({ type: 'gamepad.unsubscribe' });
  expect(state.scheduled).toHaveLength(0);
  expect(state.watchers.size).toBe(0);
  const count = sent.a.length + sent.b.length;
  a.handle({ type: 'gamepad.subscribe' });
  frame();
  expect(sent.a.length + sent.b.length).toBe(count);
});

test('host samples are bounded and a policy denial on the shell is reported as blocked', () => {
  const huge = {
    id: 'x'.repeat(500),
    mapping: 'standard-but-much-too-long',
    connected: true,
    timestamp: Number.NaN,
    axes: Array.from({ length: 40 }, () => 9),
    buttons: Array.from({ length: 64 }, () => ({ value: -3, pressed: true })),
  };
  const sample = sampleGamepads(() => Array.from({ length: 12 }, () => huge));
  expect(sample.pads).toHaveLength(8);
  expect(sample.pads[0]).toMatchObject({ timestamp: 0, mapping: 'standard-but-muc' });
  expect(sample.pads[0]!.id).toHaveLength(128);
  expect(sample.pads[0]!.axes).toEqual(Array(16).fill(1));
  expect(sample.pads[0]!.buttons).toHaveLength(32);
  expect(sample.pads[0]!.buttons[0]).toEqual({ value: 0, pressed: true, touched: false });
  expect(sampleGamepads(() => [{ ...huge, connected: false }]).pads).toEqual([null]);
  const denied = Object.assign(new Error('denied'), { name: 'SecurityError' });
  expect(
    sampleGamepads(() => {
      throw denied;
    }),
  ).toEqual({ available: false, reason: 'blocked', pads: [] });
  expect(
    sampleGamepads(() => {
      throw new Error('missing');
    }),
  ).toEqual({ available: false, reason: 'unavailable', pads: [] });
});

test('subscription churn from a frame is rate limited', () => {
  const { frames, state, environment } = fakeEnvironment();
  const broker = new GamepadBroker(environment);
  let sent = 0;
  const session = new NappletGamepad({ frame: frames.a, send: () => sent++, broker });
  state.slots = [pad('Pad', 0)];
  for (let i = 0; i < 300; i++) session.handle({ type: 'gamepad.subscribe' });
  expect(sent).toBe(120);
  session.handle({ type: 'gamepad.unsubscribe' });
  expect(state.scheduled).toHaveLength(0);
  expect(state.watchers.size).toBe(0);
  session.close();
});

test('unavailable host never reports live focus', () => {
  const { frames, state, environment } = fakeEnvironment();
  state.focus = frames.a;
  state.error = Object.assign(new Error('denied'), { name: 'SecurityError' });
  const sent: GamepadState[] = [];
  const session = new NappletGamepad({
    frame: frames.a,
    send: (message) => sent.push(message),
    broker: new GamepadBroker(environment),
  });
  session.handle({ type: 'gamepad.subscribe' });
  expect(sent).toEqual([
    { type: 'gamepad.state', available: false, reason: 'blocked', focused: false, pads: [] },
  ]);
  session.close();
});
