import { RUNTIME_DOMAINS } from './capabilities';
import { validateConfigSchema } from './config-schema';

/** NAP-SHELL supplements the pinned upstream domain shim, which does not yet provide it. */
export const SHELL_PRELUDE = `
(() => {
  let environment;
  const listeners = new Set();
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.data?.type !== 'shell.init' || environment) return;
    environment = Object.freeze(event.data);
    resolveReady(environment);
    for (const listener of listeners) { try { listener(environment); } catch {} }
    listeners.clear();
  });
  window.napplet.shell = Object.freeze({
    ready: () => ready,
    supports: domain => !!environment?.capabilities?.domains?.includes(domain),
    get services() { return environment?.services || []; },
    onReady: handler => {
      if (environment) queueMicrotask(() => handler(environment));
      else listeners.add(handler);
      return { close: () => listeners.delete(handler) };
    },
  });
  window.parent.postMessage({type: 'shell.ready'}, '*');
})();`;

/** Empty-slot count of the host browser's own Gamepad API (4 in Chromium, 0 in Firefox). */
export function hostGamepadSlots() {
  try {
    return Math.min(globalThis.navigator?.getGamepads?.().length ?? 0, 8);
  } catch {
    return 0;
  }
}

/**
 * NAP-GAMEPAD binding (merged upstream draft, docs/NAP-GAMEPAD.md). Permissions-Policy
 * leaves the native API in player frames but makes it throw. Only in that case is the
 * one denied operation replaced, with native property attributes, name, length and
 * receiver check. Events and handlers stay native. Frames where the browser lacks the
 * API, or the host allows native access, keep their native surface unchanged.
 * The standard window.napplet.gamepad binding is always installed.
 */
export function gamepadPrelude(slots = hostGamepadSlots()) {
  return `
(() => {
  const native = Navigator.prototype.getGamepads;
  let replaceNative = false;
  if (typeof native === 'function') {
    try { native.call(navigator); }
    catch (error) { replaceNative = error?.name === 'SecurityError'; }
  }
  const PadProto = typeof Gamepad === 'function' ? Gamepad.prototype : Object.prototype;
  const ButtonProto = typeof GamepadButton === 'function' ? GamepadButton.prototype : Object.prototype;
  const EventProto = typeof GamepadEvent === 'function' ? GamepadEvent.prototype : Event.prototype;
  let state = { available: true, focused: false }, raw = [], current = Array(${Math.max(0, Math.min(8, Math.trunc(slots) || 0))}).fill(null);
  const changes = new Set();
  const own = (proto, values) => {
    const object = Object.create(proto);
    for (const key of Object.keys(values))
      Object.defineProperty(object, key, { value: values[key], enumerable: true });
    return object;
  };
  const unit = (value, min) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(1, value)) : 0;
  const list = (value, max) => Array.isArray(value) ? value.slice(0, max) : [];
  const pad = (data, index, connected = true) => own(PadProto, {
    id: String(data.id ?? '').slice(0, 128),
    index,
    mapping: String(data.mapping ?? '').slice(0, 16),
    connected,
    timestamp: typeof data.timestamp === 'number' && Number.isFinite(data.timestamp) ? data.timestamp : 0,
    axes: Object.freeze(list(data.axes, 16).map(value => unit(value, -1))),
    buttons: Object.freeze(list(data.buttons, 32).map(button => own(ButtonProto, {
      pressed: !!button?.pressed, touched: !!button?.touched, value: unit(button?.value, 0),
    }))),
    vibrationActuator: null,
  });
  // GamepadEvent's constructor rejects shim pads. A real Event with GamepadEvent's
  // prototype passes instanceof checks and reaches listeners and native on* handlers.
  const emit = (type, gamepad) => {
    if (!replaceNative) return;
    const event = new Event(type);
    Object.setPrototypeOf(event, EventProto);
    Object.defineProperty(event, 'gamepad', { value: gamepad, enumerable: true });
    window.dispatchEvent(event);
  };
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || data?.type !== 'gamepad.state' || !Array.isArray(data.pads)) return;
    const before = raw;
    raw = data.pads.slice(0, 8).map(value => value && typeof value === 'object' ? value : null);
    current = raw.map((value, index) => value && pad(value, index));
    state = data.available === false
      ? { available: false, reason: data.reason === 'blocked' ? 'blocked' : 'unavailable', focused: false }
      : { available: true, focused: data.focused === true };
    for (let index = 0; index < Math.max(before.length, raw.length); index++) {
      const old = before[index], next = raw[index];
      const same = old && next && old.id === next.id && old.mapping === next.mapping;
      if (old && !same) emit('gamepaddisconnected', pad(old, index, false));
      if (next && !same) emit('gamepadconnected', current[index]);
    }
    for (const listener of changes) { try { listener({ ...state, pads: current.slice() }); } catch {} }
  });
  const replacement = {
    getGamepads() {
      if (!(this instanceof Navigator)) throw new TypeError('Illegal invocation');
      if (state.reason === 'blocked')
        throw new DOMException('This napplet runtime\\'s host policy blocks Gamepad access.', 'SecurityError');
      return current.slice();
    },
  }.getGamepads;
  if (replaceNative) Object.defineProperty(Navigator.prototype, 'getGamepads', {
    ...Object.getOwnPropertyDescriptor(Navigator.prototype, 'getGamepads'),
    value: replacement,
  });
  if (window.napplet && Object.isExtensible(window.napplet))
    window.napplet.gamepad = Object.freeze({
      getGamepads: () => current.slice(),
      get available() { return state.available; },
      get focused() { return state.focused; },
      onChange: callback => {
        changes.add(callback);
        return { close: () => changes.delete(callback) };
      },
    });
  // The standard binding is independent of optional native-API replacement.
  window.parent.postMessage({ type: 'gamepad.subscribe' }, '*');
})();`;
}

/** The same pinned upstream shim and mandatory shell bootstrap in every host. */
export function nappletPrelude(shim: string, declaration?: { schema?: unknown }) {
  let schema = null;
  try {
    if (declaration?.schema !== undefined) schema = validateConfigSchema(declaration.schema);
  } catch {
    /* Host reports the declaration error. */
  }
  // The pinned shim tracks runtime registrations. Supply its missing static schema
  // snapshot before creator scripts, using the same validated, signed build metadata.
  // No additional wire messages or app-owned bootstrap are required.
  const config = `(() => {
    const api = window.napplet.config;
    const declared = ${JSON.stringify(schema)};
    window.napplet.config = Object.freeze({
      ...api,
      registerSchema: (schema, version) => api.registerSchema(structuredClone(schema), version),
      get schema() { return structuredClone(api.schema ?? declared); },
      onSchemaError: callback => {
        const unsubscribe = api.onSchemaError(callback);
        unsubscribe.close = unsubscribe;
        return unsubscribe;
      },
    });
  })();`;
  return `${shim}\nglobalThis.NappletShimPrelude.install(${JSON.stringify({ domains: RUNTIME_DOMAINS.filter((d) => d !== 'shell') })});\n${config}\n${SHELL_PRELUDE}\n${gamepadPrelude()}`;
}
