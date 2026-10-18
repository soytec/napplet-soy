# Studio browser compilation experiment

Status: implemented and tested locally, 2026-10-18. Opt-in on new drafts,
compatible remixes and existing drafts; not enabled as a hosted service or the
default build path. No new Nostr event,
CVM tool or GRASP wrapper is involved.

## Question and result

Can preview iterations move off the Studio execution host without changing
soyLI publication or asking the model to reproduce its project structure?

Yes, for the standard TypeScript starter. A copy of an existing Orbit Pop draft
was compiled in a dedicated browser Web Worker using TypeScript 5.9.3 and esbuild
WASM 0.25.12. The same soyLI sandbox loaded the compiled HTML and its SDK bridge.
Keyboard pop/reset controls worked. The original drafts and repositories were
not edited; the experiment used a separate state store and copied Git workspace.
A 390 × 844 touch-emulated Chromium context also built the draft without horizontal
overflow. Touch activation advanced the score with reduced motion enabled (a stable
target for the automated tap). This is not a physical-phone performance test.

The real OpenCode/DeepSeek run changed the Reset label. An intentionally invalid
TypeScript annotation in a separate source file then failed the browser check.
Studio sent that diagnostic to its existing repair pass, the agent corrected the
annotation, and the browser produced a playable replacement. Installed soyLI
guidance was loaded on both passes. The recorded agent activity contained read,
grep and edit operations; it ran no shell/build tools. Reported inference cost
was approximately $0.01 for the edit and repair.

## Execution boundary

| Work | Browser build mode |
| --- | --- |
| Prepare/install the existing soyLI project | Local Studio service |
| OpenCode file tools and agent session | Local Studio service |
| Model inference | Selected provider, unchanged |
| Source collection and revision hash | Local Studio service |
| Type-check and bundle preview | Browser Web Worker |
| Play the preview | Browser, inside the existing soyLI sandbox |
| Git checkpoints and immutable preview storage/serving | Local Studio service |
| Guidance, soyLI and conformance checks for publication/proposals | Local Studio service, unchanged |
| Screenshots, video and publication | Existing reviewed soyLI flow, unchanged |

The browser receives only selected source/configuration files, the installed
SDK/NAP/core package files and TypeScript declaration libraries. No credentials,
chat history, Git objects or arbitrary project filesystem are included in build
jobs. Standard project files are still checked by the existing source validator.
The SDK versions are restricted to the tested starter versions: SDK 0.24.4,
NAP/core 0.28.0. Custom package installation is outside this experiment.

## Measurements

Observed on one Apple Silicon Mac in Chromium; these are development measurements,
not a cross-device benchmark. Dependencies were already installed.

| Operation | Observed time |
| --- | --- |
| Browser TypeScript plus bundle, successful sampled runs | 579–619 ms |
| Browser build click to new preview URL | 2,063 ms |
| Normal soyLI check sequence to new preview URL | 7,781 ms |

The end-to-end comparison includes coordination and preview promotion. The normal
path does more validation: `soyli run verify`, `soyli check`, and
`soyli run test:conformance`. Browser mode skips those three host commands during
preview iterations and defers their work to publication; these measurements do
not show that the two paths provide equivalent validation or quantify server CPU
savings. The host still reads source, manages Git and serves the preview.

Production packaging emits approximately 3.7 MB of compiler-worker JavaScript and
12.3 MB of WASM before compression; the WASM is about 3.3 MB gzip. These are loaded
on compiler use, not on every shell page. The tab now reuses one worker and its
initialized compiler/WASM. It retains one complete bounded input snapshot in
worker memory. The host retains one acknowledged snapshot for the initiating tab;
subsequent jobs send changed files and explicit removals against that job ID.
Library contents participate in the diff, so changes are not hidden behind a
package version. Missing or reset caches receive complete snapshots. Worker errors,
deadlines and disabling browser builds terminate the worker and discard its cache.
No persistent source cache or provider credential storage is introduced.

The cache/asset follow-up used the same disposable draft in desktop Chromium:

| Build | Input transferred | Files transferred | Compiler workers started |
| --- | --- | --- | --- |
| First build | 3,957,874 bytes | 370 | 1 |
| Source edit plus PNG/audio/JSON assets | 17,739 bytes | 6 | Still 1 |
| Unchanged rebuild | 193 bytes | 0 | Still 1 |

The asset build type-check/bundle took 472 ms in this sample. These transfer
counts cover the private job response, not the compiled HTML returned to the
host. The host still collects and validates the current source/assets and computes
the diff; this is not a claim that all host work is eliminated.

## Initial creation and navigation

The create/remix form can opt into the same browser compiler. soyLI still creates
or imports the real Git workspace and installs pinned dependencies on the local
service. The browser-profile check runs before inference; incompatible source
keeps an imported draft with an actionable error rather than silently building
on the host. The agent receives the same browser-mode instructions as later edits.

The shared shell owns the compiler session so the create-to-editor transition
keeps the initiating tab ID, pending job and worker. Navigation between Studio
pages preserves the option/cache. Leaving Studio, reloading or disabling the option
releases the compiler; re-entering starts with browser builds disabled.

A separate Chromium acceptance run used real soyLI `new` and `setup`, followed
by a deterministic source edit (no inference). The first preview compiled in
670 ms, retained the same session through navigation, and its button responded
inside the sandbox. Only `new` and `setup` were invoked on the host. Installed
agent guidance and local Git were present. Studio navigation retained one compiler;
leaving Studio left zero workers. The create form had no horizontal overflow at
390 × 844. Automated HTTP regressions cover new/remix session forwarding,
idempotent create requests, wrong-tab isolation and the ordinary native flow.
The real browser acceptance covered fresh creation; remote remix import was not
retested in that run.

## Managed assets

The existing Assets upload form and soyLI asset lock/helper are reused. Embedded
assets enter the compiler as validated data URLs; the generated `?url` imports
are bundled, and registered embedded HTML/CSS media references are inlined.
External assets keep their hash-based sandbox resource requests and use the
existing immutable preview asset store. Their bytes are not sent to the compiler
or uploaded to Blossom during this preview flow. MIME/hash/source scanning and
regular-file rules remain unchanged, as do the 10 MiB individual / 32 MiB total
managed-asset limits. Complete browser input remains capped at 12 MiB and output
at 8 MiB; embedded base64 bytes count toward those limits even on a delta build.

Verified through the actual Studio upload UI: embedded PNG rendering, embedded
WAV playback, external JSON retrieval through the sandbox bridge, and keyboard
gameplay after compilation. A malformed HTML `pattern` on the asset-name field
was also corrected so the browser applies its existing name rules correctly.
The 390 × 844 viewport also renders these assets without horizontal overflow.
Disabling browser builds leaves zero compiler workers; re-enabling starts from
a complete snapshot. This remains Chromium emulation, not physical-phone testing.

## Failure and release guarantees

- Jobs are bound to the initiating tab, a unique job ID and an exact source hash.
  The controller rechecks the source before promotion. A stale or wrong-tab reply
  cannot replace a preview.
- Browser type/build diagnostics receive one repair pass. Worker startup failure,
  cancellation, disconnect/timeout and stale source do not trigger paid repairs or
  silent host fallback. The prior preview remains available.
- Browser HTML goes into a new immutable preview snapshot, not the workspace's
  `dist/index.html`. Its Git checkpoint and UI explicitly say full checks are pending.
- Publication and proposal preparation have no browser-build bypass. Native soyLI
  verification/build must succeed before a release/proposal can be prepared.
- The local token/origin checks also protect compiler jobs and result submission.
  This is a trusted local runner; browser-reported success is not attestation.

Regression coverage includes the real TypeScript/compiler path, SDK subpath
imports, `.js` imports resolving TypeScript source, stylesheet/schema inlining,
unsupported profiles and symlinks, wrong-tab/stale replies, cancellation/deadlines,
agent repair, worker failure without paid retry, previous-preview retention,
asset/helper validation, file removals and cache resets, worker reuse, and
the native publication verification boundary. The full source gate passes
786 tests and 6,236 assertions, plus type-checking and production packaging.
Physical phones and Safari/Firefox are not yet verified. Nix
validation remains required before pushing dependency changes; Nix is unavailable
on the development Mac, so its dependency hash/package check has not been updated
or validated for this experiment.

## Reproduce

1. Start local Studio and the shell as described in [Quick Vibe](../QUICK-VIBE.md).
2. Enable **Browser builds** on the create form to test a fresh draft. Alternatively,
   use a disposable copy of a standard TypeScript draft, enable the option below
   its preview, then choose **Build in browser**. Play the controls and inspect the
   check details; navigating from create to the editor must preserve the compiler.
3. Introduce a type error in that copy and send a small edit request. Confirm the
   diagnostic reaches the repair pass and only a passing build replaces the preview.
4. Turn the option off and run the normal checks; verify they still execute.
5. Run `bun test apps/studio/browser-build.test.ts`, `bun run check` and
   `bun run build`. Preparing a publication does not require actually posting it.
