/**
 * NAP-GAMEPAD (merged upstream draft, docs/NAP-GAMEPAD.md). The shell owns the only native
 * Gamepad reader; player frames are denied the browser API by Permissions-Policy and
 * receive snapshots only while their frame has input focus.
 */
const MAX_SLOTS = 8,
  MAX_AXES = 16,
  MAX_BUTTONS = 32;

export type PadState = {
  index: number;
  id: string;
  mapping: string;
  connected: true;
  timestamp: number;
  axes: number[];
  buttons: { value: number; pressed: boolean; touched: boolean }[];
};
export type GamepadState = {
  type: 'gamepad.state';
  available: boolean;
  reason?: 'blocked' | 'unavailable';
  focused: boolean;
  pads: (PadState | null)[];
};
type Sample = Pick<GamepadState, 'available' | 'reason' | 'pads'>;
type NativePad = {
  id?: string;
  mapping?: string;
  connected?: boolean;
  timestamp?: number;
  axes?: ArrayLike<number>;
  buttons?: ArrayLike<{ value?: number; pressed?: boolean; touched?: boolean } | null>;
};
export type GamepadEnvironment = {
  /** Native slots. Throws when the API is missing or denied to the shell itself. */
  read: () => ArrayLike<NativePad | null>;
  focused: (frame: HTMLIFrameElement) => boolean;
  /** Schedule one animation-frame callback; returns its cancellation. */
  schedule: (callback: () => void) => () => void;
  /** Focus/visibility changes that animation frames may not observe; returns removal. */
  watch: (callback: () => void) => () => void;
};

const clamp = (value: unknown, min: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(1, value)) : 0;

function padState(pad: NativePad, index: number): PadState {
  return {
    index,
    id: String(pad.id ?? '').slice(0, 128),
    mapping: String(pad.mapping ?? '').slice(0, 16),
    connected: true,
    timestamp:
      typeof pad.timestamp === 'number' && Number.isFinite(pad.timestamp) && pad.timestamp > 0
        ? pad.timestamp
        : 0,
    axes: Array.from(pad.axes ?? [])
      .slice(0, MAX_AXES)
      .map((value) => clamp(value, -1)),
    buttons: Array.from(pad.buttons ?? [])
      .slice(0, MAX_BUTTONS)
      .map((button) => ({
        value: clamp(button?.value, 0),
        pressed: !!button?.pressed,
        touched: !!button?.touched,
      })),
  };
}

export function sampleGamepads(read: GamepadEnvironment['read']): Sample {
  let slots: ArrayLike<NativePad | null>;
  try {
    slots = read();
  } catch (error) {
    const blocked = (error as { name?: unknown } | null)?.name === 'SecurityError';
    return { available: false, reason: blocked ? 'blocked' : 'unavailable', pads: [] };
  }
  const pads: (PadState | null)[] = [];
  for (let index = 0; index < Math.min(slots?.length ?? 0, MAX_SLOTS); index++) {
    const pad = slots[index];
    pads.push(pad?.connected ? padState(pad, index) : null);
  }
  return { available: true, pads };
}

/** Connection metadata stays visible; values and activity timing do not. */
const neutral = (pad: PadState | null): PadState | null =>
  pad && {
    ...pad,
    timestamp: 0,
    axes: pad.axes.map(() => 0),
    buttons: pad.buttons.map(() => ({ value: 0, pressed: false, touched: false })),
  };

export const browserGamepadEnvironment: GamepadEnvironment = {
  read: () => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function')
      throw new Error('Gamepad API unavailable');
    return navigator.getGamepads();
  },
  focused: (frame) =>
    document.visibilityState === 'visible' &&
    document.hasFocus() &&
    document.activeElement === frame,
  schedule: (callback) => {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  },
  watch: (callback) => {
    window.addEventListener('blur', callback);
    window.addEventListener('focus', callback, true);
    window.addEventListener('blur', callback, true);
    document.addEventListener('visibilitychange', callback);
    return () => {
      window.removeEventListener('blur', callback);
      window.removeEventListener('focus', callback, true);
      window.removeEventListener('blur', callback, true);
      document.removeEventListener('visibilitychange', callback);
    };
  },
};

type Subscriber = {
  frame: HTMLIFrameElement;
  send: (message: GamepadState) => void;
  last?: string;
};

/** One native polling loop for every subscribed frame on the page. */
export class GamepadBroker {
  private subscribers = new Set<Subscriber>();
  private cancel?: () => void;
  private unwatch?: () => void;
  constructor(private environment: GamepadEnvironment = browserGamepadEnvironment) {}
  add(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    subscriber.last = undefined;
    this.unwatch ??= this.environment.watch(this.tick);
    this.tick();
  }
  remove(subscriber: Subscriber) {
    this.subscribers.delete(subscriber);
    if (this.subscribers.size) return;
    this.cancel?.();
    this.unwatch?.();
    this.cancel = this.unwatch = undefined;
  }
  private tick = () => {
    this.cancel?.();
    this.cancel = undefined;
    if (!this.subscribers.size) return;
    const sample = sampleGamepads(this.environment.read);
    for (const subscriber of this.subscribers) {
      const focused = sample.available && this.environment.focused(subscriber.frame);
      const message: GamepadState = {
        type: 'gamepad.state',
        ...sample,
        focused,
        pads: focused ? sample.pads : sample.pads.map(neutral),
      };
      const key = JSON.stringify(message);
      if (key === subscriber.last) continue;
      subscriber.last = key;
      subscriber.send(message);
    }
    this.cancel = this.environment.schedule(this.tick);
  };
}
let pageBroker: GamepadBroker | undefined;

/** NAP-GAMEPAD subscription for one frame session. */
export class NappletGamepad {
  private subscriber?: Subscriber;
  private alive = true;
  private toggles = 0;
  private window = Date.now();
  private broker: GamepadBroker;
  constructor(
    private options: {
      frame: HTMLIFrameElement;
      send: (message: GamepadState) => void;
      broker?: GamepadBroker;
    },
  ) {
    this.broker = options.broker ?? (pageBroker ??= new GamepadBroker());
  }
  handle(message: { type: string }) {
    if (!this.alive) return;
    if (message.type === 'gamepad.unsubscribe') {
      this.stop();
      return;
    }
    if (Date.now() - this.window >= 60000) {
      this.window = Date.now();
      this.toggles = 0;
    }
    if (++this.toggles > 120) return;
    if (message.type === 'gamepad.subscribe') {
      if (this.subscriber) this.broker.remove(this.subscriber);
      this.subscriber = { frame: this.options.frame, send: this.options.send };
      this.broker.add(this.subscriber);
    } else if (message.type === 'gamepad.unsubscribe') this.stop();
  }
  private stop() {
    if (this.subscriber) this.broker.remove(this.subscriber);
    this.subscriber = undefined;
  }
  close() {
    this.alive = false;
    this.stop();
  }
}

/** For frames without a full napplet host, such as the workshop controller tester. */
export function attachGamepadBridge(frame: HTMLIFrameElement, broker?: GamepadBroker) {
  const source = frame.contentWindow;
  const session = new NappletGamepad({
    frame,
    send: (message) => source?.postMessage(message, '*'),
    broker,
  });
  const listener = (event: MessageEvent) => {
    if (event.source !== source || event.origin !== 'null') return;
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type === 'gamepad.subscribe' || type === 'gamepad.unsubscribe') session.handle({ type });
  };
  window.addEventListener('message', listener);
  return () => {
    window.removeEventListener('message', listener);
    session.close();
  };
}
