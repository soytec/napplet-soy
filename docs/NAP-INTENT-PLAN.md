# NAP-INTENT full-support implementation plan

Planning baseline: 2026-10-13, `feat/nap-intent` at `aa7f87d`. This document plans implementation and verification; it does not claim conformance, release or deployment. No local AGENDA.md exists. The unrelated OUTBOX plan remains separate.

## Goal and authority

Implement the complete NAP-INTENT API in the shared website and soyLI preview host: `invoke`, `open`, `available`, `handlers`, `onChanged` and `onDelivery`. Ordinary third-party napplets must discover and invoke verified handlers without a SHELL dependency, privileged publisher, Space metadata or application-specific publication policy.

Authority: [PR 106](https://github.com/napplet/naps/pull/106) at [`fc121fc264615482143eda86125863d2e1f741a2`](https://github.com/napplet/naps/blob/fc121fc264615482143eda86125863d2e1f741a2/naps/NAP-INTENT.md), confirmed through the GitHub API on 2026-10-13. The proposal remains a draft. Preserve the selected NIP-5D authority `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51` and both currently accepted standalone/legacy manifest formats. Start with shim 0.31.0 and nap/core 0.33.0; upgrade only if the binding audit establishes a concrete incompatibility.

Full support means every mandatory clause has implementation and evidence, all six API operations work through the real binding, and documented host policies cover optional behaviors. Recommended-handler support is included in this plan, including an explicit installation offer for a verified uninstalled recommendation. Arbitrary signing, native map publication, INC, durable messaging, public handler publication and deployment are separate scope.

Existing foundation and gaps are recorded in [the extraction review](NAP-INTENT-REVIEW.md). Keep that historical evidence intact; append finding resolutions with the implementing commit and new evidence.

## Proposed host policies

These are implementation defaults for this plan, not claims of existing behavior.

| ID     | Policy                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IN-D01 | Selection order: explicit authorized catalog ID or `choose`; applicable user default; permitted compatible recommendation; ordinary installed resolution/chooser. Absent `handler` and `default` share this order. An explicit selection never falls back to a hint.                                                                                   |
| IN-D02 | Consider installed recommendations. Resolve an uninstalled named coordinate through guarded host discovery and offer installation before acceptance. The user sees verified publisher, title, role and requirements. Denial/unavailability falls back to normal resolution; discovery never installs or executes silently and never changes defaults.  |
| IN-D03 | Catalog membership is session-owned, with automatic public handler discovery and explicit preview import. Defaults persist in the browser's existing surface-specific scope. Installation persistence across restarts is not promised. Network failure must not masquerade as confirmed removal.                                                       |
| IN-D04 | INTENT exists only on supported surfaces. Authenticated requests and endpoint readiness are independent of SHELL. Proposal-review surfaces continue to omit INTENT; guest identity alone does not prohibit ordinary invocation on supported surfaces.                                                                                                  |
| IN-D05 | A user authorizes an explicit catalog ID through the host chooser per invocation. `choose` always opens selection. Defaults remain editable only in host controls. Recommendations do not override defaults or grant authority.                                                                                                                        |
| IN-D06 | Retain current bounded, session-only delivery policy: 1 MiB per payload, 64 pending deliveries, 8 MiB total and 30-second startup deadline. Keep payloads opaque; resource accounting may inspect sizes/types but must not choose handlers from content. Binding-side retained delivery is separately audited and qualified.                           |
| IN-D07 | Reuse/focus are hints. The web host may keep one intent overlay and cancel an older pending target when replacing it; preview may retain multiple targets. Every cancelled accepted delivery has a host-visible terminal reason. Neither surface promises a target handled acknowledgement or durable/exactly-once execution.                          |
| IN-D08 | Closing the source cancels pending discovery/choice before acceptance. After acceptance, source closure and viewer account changes do not revoke delivery merely because the source changed; target account permissions remain independently enforced. Host shutdown, target policy revocation and explicit host cancellation terminate affected work. |

## Work sequence

### IN-01 — Contract inventory and faithful catalog parsing

Dependencies: none. Main files: `packages/runtime/src/intent-session.ts`, INTENT tests and compatibility documentation.

1. Inventory every MUST/SHOULD and API/wire field from the pinned specification and relevant selected web binding. Map each to host, published binding or explicit runtime policy. Record package/source-map evidence and supported projection compatibility without changing NIP-5D authority.
2. Preserve each valid manifest `i` contract and every trailing parameter string in original order, including repeated names. Deduplicate candidate actions/conventions only. Match roles against all `z` tags regardless of order; ignore unusable advertisements without invalidating playback.
3. Maintain opaque publisher/kind-qualified IDs: stable named/root IDs; distinct signed snapshot IDs; case-sensitive opaque `d`; reserved `default`/`choose` never become catalog entries. Register a verified source even without advertisements.
4. Add normalized `handlerHint` to the host request type. Validate named kind-35129 coordinate, lowercase 64-hex publisher, nonempty opaque `d`, bounded discovery hints and official field types at the untrusted boundary. Preserve only validated fields; never propagate caller sender fields. Keep hints outside payload and delivery.
5. Audit actual binding `open`, query normalization, percent errors, duplicate decoded names, literal plus, fragment/options conflicts, named-only fragments and buffered delivery. Include fragment rejection in other existing convention-URI APIs when exercised by the installed binding.

Acceptance: close I-03; tests cover repeated `i` tags, repeated/opaque parameters, missing roles, unrelated roles, exact matching, malformed normalized requests, all three manifest kinds, publisher collisions and hint coordinate/catalog-ID distinction. Each mandatory clause has an assigned verification path. Binding discrepancies are resolved or explicitly block full-support claims.

### IN-02 — Surface capability injection and independent readiness

Depends on IN-01. Main files: `prelude.ts`, `host.ts`, `capabilities.ts`, web player and preview client/target loading.

1. Derive one trusted domain set per surface before constructing its prelude. Use the same decision for namespace injection, required-capability admission and optional SHELL capability reporting. Thread the surface set through all normal/review/preview target creation paths.
2. Dispatch authenticated INTENT requests independently of `initialized`; preserve source-window/origin/session checks, request correlation, message budgets and unknown-operation handling. No app-owned bootstrap or additional NAP request/acknowledgement is introduced.
3. Establish readiness from trusted frame/document lifecycle after the binding is installed, independent of `shell.ready`. Evaluate the existing iframe load lifecycle first; prove a cold target can receive its retained delivery through the actual binding. If needed, use a host-private bootstrap/lifecycle mechanism without exposing a new NAP envelope. Define ordering for attaching the endpoint before a cold iframe runs.
4. Retire old document endpoints on replacement/navigation; readiness from an old document cannot activate a new one. Install the binding before creator code; deliveries received before `onDelivery` registration remain buffered by the binding.
5. Keep SHELL behavior compatible for other domains. Review global versus surface-local `missingDomains` checks so an unavailable INTENT surface never launches an app that requires it.

Acceptance: close I-01/I-02. Actual-shim browser tests use INTENT without any SHELL traffic; no-workspace surfaces have no namespace and fail required INTENT admission. Cold and warm deliveries work; spoofed windows, late loads and retired documents receive no privileges or deliveries. Existing SHELL/CONFIG/theme tests remain green.

### IN-03 — Unified verified catalog and recommendation resolution

Depends on IN-01/IN-02. Main files: broker, `apps/web/src/lib/intent-workspace.ts`, existing protocol catalog/network adapters and preview intent client.

1. Replace the separate broker-contract and launch-model authority with a coherent installed entry containing the exact verified manifest and artifact/release data needed to launch. Web source-player installation updates this same entry. Use existing verified manifest/publication-order helpers rather than a second verification implementation.
2. Reconcile refreshes with signed replacement ordering and deterministic ties. Confirm deletions, current site/network/capability policy and disabled entries explicitly. Preserve installed entries during incomplete discovery; prevent a late stale discovery result from replacing a newer release. Re-evaluate default applicability for the exact requested convention.
3. Resolve recommendations by exact named coordinate, including opaque case-sensitive `d`; convert a verified match into its catalog ID. Bound discovery time, relay hints and catalog growth using existing public destination guards and transport. Reuse host Nostr infrastructure; no frame fetch or competing event store.
4. Add a host-owned installation offer for uninstalled recommendations. Verify signature, coordinate and requirements before offering; verify artifacts through the same loader before execution. A successful metadata discovery is not installation or artifact verification. Failed/declined recommendations fall back; explicit handler selection remains authoritative.
5. Use `validateManifest().artifactHash` and the normal playback adapter for legacy and standalone targets. Never assume a legacy `x` is the raw HTML hash. Bind source sender to the actual authenticated verified release/session.
6. Recheck the selected entry/policy after asynchronous choice and before acceptance. Freeze the accepted launch revision or terminally fail if a subsequent policy change revokes it; do not deliver under newer contracts to an older artifact or silently retarget to another handler.

Acceptance: close I-04 and legacy preview gap. Tests cover named/root upgrades, snapshots, older refresh results, deletion/policy changes, incomplete discovery, wrong-coordinate signed events, forged manifests, corrupt artifacts, unsupported requirements, recommendations with/without applicable defaults, explicit selection with an unrelated hint, cancellation/fallback and guarded relay rejection. Same rules apply to all publishers.

### IN-04 — Choice, delivery and workspace lifecycle

Depends on IN-02/IN-03. Main files: broker, shared chooser/default controls, web launcher/workspace and preview client.

1. Give pre-acceptance operations cancellation signals scoped to authenticated source lifetime and bounded discovery/selection work. Closing a source dismisses its chooser, releases temporary data and permits another choice. An account-scope request retirement cannot leave an invisible accepted launch after its result is suppressed; define and test acceptance/result ordering with the host's account cancellation machinery.
2. Transfer accepted responsibility into the workspace independently of the source; send one correlated result before any source closure caused by invocation. Post-acceptance terminal failure produces host UI feedback, never a second result or invented handled notification.
3. Add idempotent workspace shutdown that aborts startup/discovery/choice work, clears queues/timers/listeners and closes owned surfaces. Preserve browser-session workspace lifetime across ordinary source unmounts; preview host abort is workspace shutdown.
4. Preserve ordering and startup deduplication; one cold launch owns queued deliveries for its selected target/revision. Define behavior for target closure, failed sends, expired startup, target replacement and revoked policy. Ensure a queued callback cannot resurrect a cancelled target.
5. Reset chooser UI state between requests; expose editable defaults and host-visible terminal failures accessibly on desktop/mobile. Changed notifications include affected unavailable roles after removal and accurate default changes. Frame callbacks cannot alter host preferences.
6. Preserve safe actionable errors without credential/request dumps. Use project diagnostics at CLI/local-UI boundaries where appropriate; public errors disclose only the context needed for recovery.

Acceptance: source closes during choice/discovery, source closes after acceptance, viewer switches during selection/result delivery, shutdown during startup, repeated close, failed send, default removal, overlapping launches, FIFO delivery and queue limits all have deterministic tests. No stale modal, retained timer or post-close delivery remains. Useful failures/redaction are exercised through a real host process/browser entrypoint.

### IN-05 — Independent specimens and browser conformance

Depends on IN-01 through IN-04. Main files: self-contained service/browser fixtures and expanded INTENT binding/host suites.

Build source/receiver specimens inside this repository with ordinary signed manifests and the pinned binding. They must require neither adjacent Black Site repos nor map publication, and must use the same sandbox, manifest/artifact verification, Nostr discovery and player code as production. Use local relay/Blossom fixtures that verify signatures.

Run the same API scenarios in the production web player and CLI preview:

- All six operations, `open` restricted to the `open` action, result IDs/shapes and change subscriptions.
- No SHELL messages; injected availability with/without support; source without advertisements.
- Named/root/snapshot handlers, legacy/standalone artifact loading, publisher-safe identity and release upgrades.
- Query and structured payloads; naddr and explicit recommendations; selection precedence, installation offer, denial/fallback and default revocation.
- Cold and reused targets, source closure after acceptance, delayed receiver registration, multiple deliveries, target closure, startup failure, quotas and cancellation.
- Foreign-window/caller-sender spoofing, unsupported contracts/capabilities, bad hashes/signatures and guarded discovery destinations.

Add a bounded independent-client check using a pinned compatible external host/binding if available, recording exact versions and supported cases. If no suitable independent host supports this draft, record that limitation; do not block local implementation indefinitely or claim universal interoperability. The self-contained two-surface browser evidence is mandatory.

Acceptance: every required behavior has positive and representative negative actual-binding evidence; browser web/preview tests pass without external app checkout dependencies. Existing Black Site tests remain separate historical evidence. Append closure evidence to the review and audit the clause matrix for uncovered mandatory behavior.

### IN-06 — Packaging, guidance and completion audit

Depends on IN-05. Main files: INTENT/runtime/protocol/compatibility docs and creator examples/guidance.

1. Run typecheck, relevant runtime/protocol/preview suites, web production build, preview asset bundle and the new browser conformance tests. Run distributed CLI build with pinned Bun 1.3.11, preserving explicit Node/Playwright/toolchain pins.
2. Run `bun run check:nix` before pushing shared package/CLI/dependency/embedded asset changes. Require realization, forced rebuild and flake/VM checks on x86_64 Linux with KVM. On dependency-hash mismatch use `bun run update:nix-hashes`; review the exact output-hash diff. Do not reuse the original branch's historical pass as this branch's validation.
3. Publish implemented behavior and policy limits in `INTENTS.md`, `PUBLIC-RUNTIME.md`, `PROTOCOL.md`, `NAP-REVIEW.md` and `COMPATIBILITY.md`. Include minimal invocation/receiver/advertisement examples, recommendation/selection behavior, opaque IDs, error recovery and the absence of handled acknowledgements.
4. Audit bundled creator guidance for stale package/wire examples. Update only affected guidance and exercise its actual example through the same shim. Distinguish declarations, installation and runtime grants.
5. Review the runtime profile against the final supported surface; choose a fresh identifier if cached admission semantics changed. Preserve the extracted profile's historical meaning rather than silently repurposing it.
6. Append implemented/verified status and commit/test evidence for each review finding and plan item. Release readiness, released CLI, deployed website and public handler installation/publication are separate statuses. No public deployment is authorized by this plan.

Acceptance: all mandatory clause rows have passing evidence, I-01–I-04 are resolved, chosen optional policies are implemented/documented, package checks pass, source and bundled preview match, and no stale broad-conformance claims remain.

## Completion checklist

- [x] IN-01: audited contract/binding tuple and faithful catalog/normalized requests.
- [x] IN-02: truthful namespace availability and INTENT independent of SHELL.
- [ ] IN-03: coherent verified launch catalog, recommendations and legacy targets.
- [ ] IN-04: cancellation, independent accepted responsibility and complete shutdown.
- [ ] IN-05: all API operations and failure paths verified in web and preview browsers.
- [ ] IN-06: packaging gates, guidance and evidence audit.

A working handoff or green broker unit suite alone does not complete this plan. Any unresolved mandatory requirement, silent delivery loss, stale catalog/launch mismatch or failed required packaging gate prevents a full-support claim. Optional independent-host availability and cross-restart durability remain explicitly qualified rather than implied.

## Execution evidence — IN-01, 2026-10-13

Implemented and locally verified: each eligible manifest `i` contract preserves its parameter list; candidate actions/conventions deduplicate; reserved catalog identifiers reject; bounded handler hints are validated and retained for future selection without delivery leakage. Real signed named/root/snapshot sources install without advertisements. The installed production shim now has tests for all six API entrypoints and convention-fragment validation.

`bun run typecheck` passed. Runtime/protocol suites passed 118 tests with 864 assertions; preview asset bundling passed. [The clause inventory](NAP-INTENT-CONFORMANCE.md) records compatibility qualifications and the verification destination for remaining requirements. IN-02–IN-06 remain outstanding; no full-support, released or deployed status is claimed. The unrelated OUTBOX draft was untouched. Nix/package validation remains required before any push of the shared-package changes.

## Execution evidence — IN-02, 2026-10-13

Implemented in source: one per-document surface policy for admission/injection, document readiness independent of SHELL, source/origin/session authentication and retirement on navigation. Normal web/preview source and target players share the session; review/demo surfaces omit INTENT. Runtime profile is `space-playback-7`, with unchanged upstream pins.

Typecheck passed; runtime/protocol suites passed 120 tests/880 assertions. Two real Chromium shared-host fixtures passed with 15 assertions, including no-SHELL invocation/cold retention and foreign/unready rejection. Four CLI preview process-lifecycle tests passed with 12 assertions. Web production build and preview asset bundling passed. The fixture uses verified signed manifests/artifacts and the published shim without adjacent app checkouts. Complete production-web/preview UI/discovery conformance remains IN-05; Nix/distributed CLI package checks remain IN-06 and mandatory before push. The OUTBOX draft remains untouched; nothing is released or deployed.

## Deferred launch approval policy

The project owner deferred further cross-napplet launch-prompt decisions on 2026-10-13. Existing chooser/default/explicit-handler authorization remains the implemented behavior; this draft introduces no separate confirmation for automatic single-handler/default launches. Revisit this policy in later product work. This deferral does not mark the remaining INTENT implementation/conformance stages complete.

## Draft publication validation — 2026-10-13

Merged main at `6f2f270`, preserving its browser event cache, NAP-KEYS domain/cleanup and release metadata. The dependency lock retains both the shim upgrade and main's nostr-idb dependency. The exact nodeModules hash was refreshed with `bun run update:nix-hashes`; realization, forced nodeModules/soyli rebuilds and flake checks passed on x86_64 Linux. The daemon build user lacked KVM access and ran its VM in software emulation; the same generated NixOS test driver was then run as the existing KVM-authorized user and passed the complete suite with confirmed KVM acceleration. No device permissions were changed. aarch64 was not checked.

Typecheck and the web production build passed. Runtime/protocol suites passed 125 tests/921 assertions. The combined INTENT-readiness and NAP-KEYS web/preview browser regressions passed three tests/27 assertions. The INTENT browser fixture compiler now runs in a fresh process so preceding server-side imports do not contaminate browser module resolution, matching preview's existing isolation pattern.

These checks qualify publishing this branch as a draft PR. IN-03–IN-06 completion, further launch-approval policy, a released CLI and public deployment remain outstanding; no feature-complete claim is made. The unrelated OUTBOX draft remains local and untracked.
