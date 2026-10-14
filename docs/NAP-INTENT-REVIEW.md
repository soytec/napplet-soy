# NAP-INTENT extraction and specification review

Reviewed 2026-10-13. Branch `feat/nap-intent` starts at `607bf1f0330b1decf7c9aaea0befe0e5c6db3c9b` and extracts INTENT from `feat/black-site-map-intents` at `ff31d0b`. The original branch is retained unchanged. No push, release or deployment is included.

## Authority and package baseline

Review authority: [NAP-INTENT PR 106](https://github.com/napplet/naps/pull/106), current API-reported head [`fc121fc264615482143eda86125863d2e1f741a2`](https://github.com/napplet/naps/blob/fc121fc264615482143eda86125863d2e1f741a2/naps/NAP-INTENT.md), fetched 2026-10-13. This remains a draft. The selected NIP-5D authority stays `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`; upstream links do not replace it.

Extracted package tuple: shim 0.31.0, nap/core 0.33.0. Its installed `prelude.global.js` source map contains `intent/normalize.ts`, `intent/shim.ts` and the shared convention normalizer. The original implementation recorded `e5308ac` as its INTENT baseline. This review does not certify full PR-106 conformance.

## Extraction boundary

Included: broker and controls, host dispatcher/endpoint lifetime, capability inventory and original profile `space-playback-6`, preview local registration/signed-manifest installation/target loading, web discovery/chooser/defaults/target player, shim upgrade and corresponding lockfile/Nix dependency hash, INTENT unit/host tests.

Excluded: native map contracts/publication sessions/tests, kind-35858 signer permission, mixed map/editor service test, map publication docs and Black Site handover. OUTBOX/RELAY retain the base branch's scoped kind-30078 app-data policy. The unrelated untracked OUTBOX plan is left untouched and is not part of this branch.

The profile identifier is retained to avoid reusing a compatibility cache identity from the original implementation; it is not a protocol version or a claim of map publication support. Black Site convention names in broker fixtures are opaque sample data, not production map admission.

## Findings requiring resolution

### I-01 — High: namespace presence overstates availability

`nappletPrelude()` installs every runtime domain except `shell`, including `intent`, on every surface. `attachNappletHost()` only removes INTENT from the SHELL capability list when there is no workspace. Proposal-review players deliberately omit the workspace but still receive the injected API.

PR 106 uses injected domain presence as the availability signal. An app checking `window.napplet.intent` sees support, then receives a workspace error. SHELL's domain list cannot correct this signal. Fix by passing the actual surface domain set into prelude creation and installing INTENT only when the endpoint exists. Test ordinary web, preview and guest review surfaces with the actual binding.

### I-02 — High: INTENT requires the SHELL handshake

The host listener drops recognized requests until `initialized`; only `shell.ready` initializes the frame and marks the intent endpoint ready. PR 106 explicitly makes discovery and invocation independent of SHELL or its handshake.

The supplied host-owned prelude automatically posts readiness, so normal Soy artifacts generally work. This does not satisfy the independent protocol requirement. Separate authenticated INTENT endpoint readiness/request dispatch from optional SHELL initialization, preserving target readiness and delivery buffering. Test an authenticated frame using the installed INTENT binding without SHELL traffic.

### I-03 — Medium: manifest contracts lose advertised parameter data

`intentContracts()` merges repeated conventions, deduplicates parameters and rejects names containing whitespace or `/`, among other characters. PR 106 requires a contract for each valid `i` tag with its trailing elements preserved in order; only candidate actions/conventions are deduplicated. It supplies no corresponding parameter-name syntax restriction.

Reproduction: `[['z','profile'], ['i','napplet:profile/open','x','x'], ['i','napplet:profile/edit','kind:1','a/b']]` currently returns only `open` with `params: ['x']`. Preserve each tag's parameter list and contract while deriving unique actions/conventions separately. Add duplicate-name, repeated-tag and opaque-name fixtures.

### I-04 — Medium: installed catalog and launch model can drift

`webIntentWorkspace().discover` only adds/replaces entries; unavailable or removed models are skipped without removing earlier installations. `installPlayerIntent()` also changes broker entries without updating the separate launch-model map. After discovery of revision A and playback of revision B at the same named/root identity, broker contracts can describe B while cold launch still uses model A.

Reconcile the verified manifest and the actual launch artifact as one catalog entry. Apply current removal/capability/site policy before acceptance and launch, with deliberate refresh semantics for incomplete discovery. Test release upgrades that change contracts, deletions, policy changes and late discovery results. This is a lifecycle/policy finding; absence from one bounded query alone is not proof of deletion.

## Recommendation policy decision

The installed binding validates explicit hints, decodes bare naddr fragments, preserves case-sensitive coordinates and emits `handlerHint`. The broker request type has no hint field and copies it away. Therefore compatible installed recommendations do not influence selection.

PR 106 permits a shell to ignore recommendations under its policy; this is not automatically a MUST-precedence violation. The implementation needs an explicit policy and documentation. If recommendations are supported, validate bounded hints at the host boundary and select explicit authorized handler/choose first, then applicable default, then verified compatible recommendation, then ordinary resolution. Never use a coordinate as an explicit catalog identifier or let relay hints bypass network policy. Discovery/installation of uninstalled recommendations is optional.

## Additional limits and missing evidence

- Preview installation admits legacy manifests, but cold launch takes `x` directly as the HTML hash. For legacy manifests that value is an aggregate identity, unlike `validateManifest().artifactHash`. Use the validated release hash or declare/reject this preview limitation before acceptance.
- Pre-acceptance choosers have no source-lifetime cancellation hook. Closing a source rejects eventual acceptance, but can leave its chooser visible and block another web choice. Accepted deliveries must remain source-independent; pending choices should be cancelled separately.
- Workspace shutdown has no single close operation. Preview abort closes frames and controls but does not explicitly retire broker startup timers/queues or a chooser. Browser-wide web workspace lifetime is a separate policy.
- Callback/UI lifetime behavior, changed notifications after catalog refresh, all three manifest kinds in real browser launch and a public-web joined launch require targeted evidence.
- Existing app-data publication and viewer signer permissions remain outside this extraction. INTENT grants no signing authority.

## Conformance evidence

| Requirement                                                           | Evidence or status                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Stable exact convention matching; role/tag order independence         | Broker fixtures pass; parameter preservation gap I-03                    |
| Publisher/kind-qualified IDs; stable named IDs and distinct snapshots | Broker fixtures pass; encoding remains runtime-local and opaque          |
| Verified public manifest admission and capability requirements        | Installation signature/capability checks; refresh/launch gap I-04        |
| Source without advertisements; attested sender; forged sender ignored | Broker/host fixtures pass                                                |
| Defaults, explicit authorized selection, chooser cancellation         | Broker fixtures pass; recommendation policy unresolved                   |
| Acceptance/result correlation; no handled acknowledgement             | Host fixture passes                                                      |
| Cold retention independent of source; ordering; startup bounds        | Broker fixtures pass                                                     |
| Delivery only after readiness; retained binding delivery              | Broker/host and actual published-binding tests pass; SHELL coupling I-02 |
| Query decoding, literal plus, invalid/duplicate query rejection       | Actual published-binding test passes                                     |
| Bare naddr plus structured payload; invalid/conflicting hints         | Actual published-binding test passes                                     |
| Domain availability without SHELL                                     | Gap I-01/I-02                                                            |

The new `intent-binding.test.ts` evaluates the installed production prelude in an isolated VM, invokes its actual API and sends correlated host responses. It verifies emitted recommendation coordinates, malformed-query/fragment rejection before traffic and delivery retention before listener registration. It is not a real browser or cross-client acceptance test.

See INTENTS.md for implemented behavior and current limits. Passing the existing tests does not close these findings. Full conformance and release readiness remain pending.

## Verification on the extracted branch

- `bun run typecheck`: passed, including the added binding test.
- `bun test packages/runtime/src --timeout 20000`: 74 passed, 472 assertions, no failures.
- `bun test apps/cli/src/preview --timeout 20000`: 4 preview process-lifecycle tests passed, 12 assertions.
- `bun run build`: web production client/server build passed.
- Source preview `previewAssets()`: bundled successfully (1,539,611 client characters; 21,930 HTML characters).
- `git diff --check`: passed.
- `bun run cli:build`: stopped at the existing pinned-Bun guard; installed Bun is 1.4.3, release builds require 1.3.11. No distributed CLI build is claimed.
- Full `check:nix` was not rerun for this extraction. The dependency hash is copied from the original feature branch, not independently certified here. The required realization/forced rebuild/flake/VM gate remains mandatory before pushing relevant changes.
- No new joined game/editor or public-web browser run was performed. The mixed map integration test remains on the original branch and its historical results are not counted as verification of this extraction.

## Finding resolution — IN-01, 2026-10-13

I-03 is resolved in the runtime dispatch catalog: each eligible `i` tag is retained with its complete ordered parameter list; candidate actions/conventions alone deduplicate. New tests exercise repeated tags, duplicate and opaque parameter names, empty names, unrelated roles and reserved catalog selection IDs. The broker now validates and retains bounded `handlerHint` fields while excluding them from target delivery; recommendation selection remains IN-03 work.

The installed shim audit and expanded API tests are recorded in [the clause inventory](NAP-INTENT-CONFORMANCE.md). Typecheck passed; runtime/protocol suites passed 118 tests/864 assertions; preview bundling passed. I-01, I-02 and I-04 remain open. Full browser conformance, Nix/package validation, release and deployment remain separate outstanding gates.
