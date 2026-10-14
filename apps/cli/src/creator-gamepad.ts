/**
 * Controller guidance for the installed napplet skills. The pinned upstream skills
 * predate NAP-GAMEPAD (napplet/naps#108), so agents building games would otherwise
 * not know that this runtime brokers the Gamepad API through its prelude.
 */
const GAMEPAD_SKILLS = [
  'napplet-make',
  'napplet-design',
  'napplet-build',
  'napplet-sdk',
  'napplet-port',
  'napplet-test',
];

export const gamepadSkillSection = `
## soyLI controller input (NAP-GAMEPAD)

Read this before adding, porting or testing USB/Bluetooth gamepad support. Read
docs/napplet-controllers.md for the full guide and use docs/examples/gamepad.ts.

**Protocol.** Controllers follow the NAP-GAMEPAD draft,
https://github.com/napplet/naps/pull/108 (open, not merged). The pinned
@napplet/sdk and shim have no \`gamepad\` domain: do not import one from the SDK or
invent other wire messages. Controllers are browser-wide devices, so the soyLI
runtime is their only native reader. It denies the native API to napplet frames
(Permissions-Policy \`gamepad 'none'\`) and pushes \`gamepad.state\` snapshots to
the napplet that holds input focus. Other napplets see connected pads with zero
axes/buttons and \`timestamp\` 0.

**How it is patched in.** The host prelude runs before your scripts. Where the
native \`navigator.getGamepads()\` exists but is denied, it replaces only
\`Navigator.prototype.getGamepads\` with a reader of the latest snapshot and sends
one \`gamepad.subscribe\`. Pads keep native \`Gamepad\`/\`GamepadButton\` prototypes,
in slot order with \`null\` gaps. \`gamepadconnected\`/\`gamepaddisconnected\` arrive
as \`GamepadEvent\`s through listeners and \`on…\` handlers. A host \`blocked\` state
throws \`SecurityError\`; \`unavailable\` returns empty slots. Where native access is
allowed or there is no Gamepad API, nothing is patched. The shim also exposes the
optional \`window.napplet.gamepad\`: \`getGamepads()\`, \`available\`, \`focused\` and
\`onChange(callback) → { close }\`. It exists only where the shim installed.

**Build rules.**
- Write ordinary Gamepad API code: poll \`navigator.getGamepads()\` once per
  \`requestAnimationFrame\`, or use \`createGamepadInput\` from the bundled helper.
  The same code runs on hosts with native access. Feature-detect
  \`window.napplet?.gamepad\` only for its \`focused\`/\`available\` state.
- Gamepad is optional. Do not add \`gamepad\` (or SERIAL) to \`requires\`; keep
  complete keyboard and pointer/touch controls. Use NAP-KEYS (\`keys\`) for named
  keyboard actions when the game has them.
- Treat \`focused: false\` as idle input: pause or freeze controller-driven
  actions; do not treat the neutral snapshot as release events. Do not fire a
  press for a button already held when focus returns; the helper waits for
  \`focused: true\` for you.
- Route players by \`pad.index\`, never array position. Handle disconnect by
  clearing that player's input. Do not use \`pad.id\` as an identity.
- Expect about one host frame of extra latency and no rumble
  (\`vibrationActuator\` is \`null\`). \`event.isTrusted\` is \`false\`; do not gate on it.
  Do not rely on own-property shape, \`JSON.stringify(pad)\` or \`[native code]\`.
- Show players that the napplet must be clicked/focused to receive controller
  input, for example on the title or pause screen.

**Verify.** Use the Controller tester in soyli dev, then click the napplet to give
it input. Check movement, edges (one press per press), pause on focus loss, no
phantom press on refocus, disconnect/reconnect and keyboard/touch fallback.
Synthetic or simulated input and soyli check are not hardware tests: report
physical-controller and Safari/Firefox coverage separately.
`;

export function adaptGamepadSkill(path: string, source: string) {
  if (!GAMEPAD_SKILLS.includes(path.split('/')[1]) || !path.endsWith('/SKILL.md')) return source;
  return source.trimEnd() + '\n' + gamepadSkillSection;
}
