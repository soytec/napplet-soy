# Shell dialogs and activity feedback

The trusted shell presents approvals, model selection, connection settings and
wallet checkout above the running napplet, including the four-arrow browser
fullscreen mode. The iframe stays in place, with the same sandbox and session.

`packages/runtime/src/shell-ui.ts` owns native top-layer presentation. Runtime
choosers, CVM checkout and React's shared `Dialog` use it. A modal blocks the
background, owns keyboard focus and returns focus when dismissed. The expanded
player's Escape/Tab handling yields while a native modal is open. Entering
fullscreen with an existing prompt re-promotes the prompt above the fullscreen
player. This does not grant the napplet access to shell DOM or credentials.

New shell dialogs should use `components/ui/dialog.tsx`, or register a native
`dialog` with `presentShellDialog` and call its cleanup when closing. Do not use
an ordinary body portal with a larger z-index: it cannot cover native fullscreen.
React native dialogs with an `onClose` callback must ignore queued close events
when `currentTarget.open` is already true, because fullscreen promotion reopens
the same element. Nested choices keep the outer dialog's state; CVM checkout
suspends its invoice dialog during wallet approval and restores it on cancellation.

`shellActivity` provides one changing notice per operation.
It renders through a non-modal top-layer popover and does not steal focus. Pending
notices remain until completion; success dismisses after 4.5 seconds, errors stay
until dismissed. Reduced-motion preferences disable the progress animation.
The notice moves into the active shell dialog so its dismiss button remains
accessible, then returns to the page when the dialog closes.

Current feedback covers:

- Loading AI connections, selecting a model, sending a generation and receiving
  its result or error.
- Shell permission requests for files, network, media and public actions.
- Wallet payment preparation, approval, settlement and uncertain outcomes.
- Slow CVM calls (after 800 ms), service failures, approved public file uploads
  and successful outbox publication.

Fast CVM calls, storage operations and per-token updates stay quiet. A slow CVM
request gets one notice for the whole operation, not for each transport update.
Toasts contain shell-authored status
text, never prompts, medical data, invoice strings, keys or raw provider errors.
Existing operation diagnostics remain available in the requesting UI. No wallet
polling or automatic payment retry is added.

Theme colors and fonts remain in `packages/runtime/src/appearance.css`. Shared
notice geometry and standalone-preview fallbacks live in `shell-ui.ts`; shell
animation and backdrop rules live in `apps/web/src/styles.css`.

## Verification and limits

`bun test tests/services/shell-dialogs.test.ts tests/services/cvm-checkout-browser.test.ts`
exercises real React and runtime components in Chromium: model-to-settings flow,
image-capability discovery/save/select, pending and terminal notices, native and
expanded fullscreen, Escape/focus, viewport bounds, unchanged iframe state,
external invoice fallback and wallet uncertainty with zero status polling.
Fixtures use synthetic providers and invoices, with no real payment or inference.
Browser fullscreen behavior in Safari and Firefox remains a manual acceptance
check. These UI changes do not alter the NAP-LLM or NAP-CVM wire contracts.
