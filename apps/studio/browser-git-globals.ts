import { Buffer as BrowserBuffer } from 'buffer/';

// Worker-only compatibility for isomorphic-git's Buffer calls and LightningFS's
// text-encoding dependency, which looks for `window` or `global` rather than `self`.
const scope = globalThis as unknown as {
  global?: typeof globalThis;
  Buffer?: typeof BrowserBuffer;
};
scope.global ??= globalThis;
scope.Buffer ??= BrowserBuffer;
