# Forkless Nostr Git proposal workflow plan

Date: 2026-10-12

Status: implementation in progress. The core workflow is verified locally; package qualification and remaining scope below are tracked separately. Not released or deployed.

2026-10-12 implementation progress:

| Work | Implemented | Verification | Deployment |
| --- | --- | --- | --- |
| Direct upstream GRASP-01 submission and immutable refs | Yes | Native root/update/fetch/retry proof | Pending |
| Version-2 proposal journals and legacy transition | Yes | Real CLI retry, refusal, signer timeout and legacy fixtures | Pending |
| ngit branch identity and mixed-client revisions | Yes | Independent ngit 2.6.1 creation/update/checkout/accept in both directions | Pending |
| Target branch publication and saved applied status | Yes, owner/direct reciprocal authority profile | Native non-main/additional-maintainer/ref retention and interrupted publication fixtures | Pending |
| CLI guidance and shared review | Yes | Existing Soy browser review/mobile/sandbox test | Pending |
| Full package qualification | Verified with a build-environment limitation | 616 repository tests; final native/ngit checks and Nix-built CLI pass; final dependency/CLI force rebuilds and direct KVM VM driver pass; `check:nix` daemon VM blocked by KVM permissions | Pending |

Remaining scope has stable IDs: FP-01 selects and verifies an independent Nostr Git
browser UI; FP-02 reviews/pins modern role-based and indirect recursive maintainer
authority before extending Soy's state resolver; FP-03 qualifies declared target
selection against a newer ngit version rather than assuming 2.6.1 behavior; FP-04
decides whether the workshop should offer combined merge/publication controls;
FP-05 records release/deployment and any deliberately authorized public proposal
retry. Existing separate local merge, explicit push and napplet release remain
available. These items are not marked complete by the transport foundation.

Validation limitation FP-06: the Nix daemon's build user cannot open `/dev/kvm`.
The required `bun run check:nix` realizes/force-rebuilds the package, but its VM
falls back to software emulation and hits Chromium's navigation timeout. Final
`nodeModules`/`soyli` outputs were separately force-rebuilt successfully. Running
the same final NixOS test driver as the current user uses KVM and passes all
regressions, including packaged Chromium, offline checks and Secret Service keys.
The daemon KVM permission configuration remains an environment prerequisite for
a clean all-in-one check. No host permissions were changed.

## Goal and scope

Contributors should propose changes to a Nostr Git hosted napplet without creating or announcing another repository. Maintainers should review and accept those changes using Soy or compatible ngit tools, while preserving ordinary Git commits, authorship, ancestry and branch operations.

The same proposal must be discoverable across clients. A Soy proposal is an ordinary NIP-34 PR with an optional playable attachment, and an external proposal remains usable without Soy metadata or a Soy account. GitHub and other traditional forge integrations are separate work.

The [hosting investigation](PROPOSAL-HOSTING-ISSUE.md) supplies the incident and submission requirements. This plan expands the scope to the complete contributor and maintainer workflow. It does not authorize retrying the game proposal or publishing any external events.

## Agreed requirements

- First submissions, revisions and retries use the existing upstream identity and a supported forkless hosting facility. Hosting refusal never creates a contributor repository as a fallback.
- Proposal submission requests neither kind 30617 nor 30618. Existing repository publication through `soyli publish` remains valid and separate.
- Submission leaves upstream branches, tags, `HEAD` and signed repository state unchanged. Proposal objects are hosted at permitted immutable refs such as `refs/nostr/<signed-event-id>`.
- Each root and revision identifies the exact commit, ancestry and upstream repository. A revision updates the existing PR rather than opening another root.
- Contributors and maintainers retain their selected Nostr identities. Transport integration must not copy signer secrets into arguments, environment or repository configuration.
- Soy CLI and workshop controls use the same service. External ngit creation, checkout, update and acceptance must interoperate with that service.
- Missing playable previews never prevent discovery, Git review or acceptance. A supplied preview remains bound to its exact author and revision.
- A local merge, a published Git merge, confirmed proposal status and a napplet release are distinct outcomes. The interface must report them accurately.

## Intended user workflow

A contributor remixes or checks out the upstream, makes normal Git commits and submits a proposal. Soy prepares its checked preview and signs one PR root; subsequent commits produce revisions of that root. Submission returns an identifier usable in ngit and a review link. Retrying interrupted delivery reuses the saved signed event and frozen objects.

A maintainer opens the proposal in Soy or ngit, fetches the exact revision and reviews its diff. Soy also offers optional Original and Proposed playback. Acceptance pins both the reviewed revision and the target commit, then performs a normal Git merge. Conflicts provide an ordinary Git resolution path without silently selecting another revision.

Publishing the merged target makes the integration available upstream and records the compatible applied status. Review must reflect acceptance performed through ngit as well as Soy. Releasing the resulting napplet remains a separate deliberate action. A workshop convenience action may coordinate merge and publication, but must expose partial completion and preserve recovery state.

The current [ngit PR guide](https://ngit.dev/pull-requests) describes `pr/*` branch submission, updating the same proposal, and local merge followed by a separate push. Those are interoperability targets to verify against selected versions, not evidence that the existing Soy pins support every documented command.

## Current foundation and gaps

| Area | Existing foundation | Work required |
| --- | --- | --- |
| Submission | Signed 1618/1619, frozen source, optional preview and relay read-back | Remove `prepareSource`/`publishSource` dependency on contributor repositories; establish forkless object delivery |
| Retries | A signed proposal journal reuses events | Version the new journal, preserve legacy jobs, distinguish failures before and after journal creation |
| Review | Shared proposal parser, revision selection, Git diff and playable preview | Prove external creation and revision behavior in both directions |
| Merge | Exact revision/target checks, source validation, ordinary no-ff merge | Resolve declared/default target branches and preserve protection against target movement |
| Publication | Owner-managed source push and applied events | Address owner-only, managed `main`, additional-ref and linked-repository restrictions through a compatible transport |
| Cross-client tests | Independent Git/ngit history fetch | Add real external proposal creation, update, review and acceptance; existing fetch evidence is insufficient |

The source-publishing helper should continue to serve author-owned publication. Proposal hosting and acceptance publication need their own transport responsibilities rather than repurposing repository creation.

## Implementation stages

### 1 Prove the protocol and transport

Build a disposable two-identity fixture against native pinned GRASP. Establish non-maintainer event/object ordering, permitted immutable refs, advertised clone availability and relay read-back. Independently fetch the exact commit and exercise ngit proposal discovery, checkout, revision and acceptance.

Inspect selected NIP-34 target-branch, root/update, status and maintainer semantics. Verify how ngit identifies an existing proposal when switching between client paths; do not assume a branch name alone prevents duplicate roots. Prove how a signed `soy-preview` attachment can remain on the single root/update if ngit is used as the transport.

Compare direct standard transport with deliberate ngit integration. Choose the smallest approach that satisfies interoperability and selected signer behavior. Optional GRASP-06 is a separately justified forkless alternative only when supported and selected; it is not the default assumption.

Deliverable: exact compatible pins, recorded fixture results, selected transport and event/object delivery sequence. Failure to prove support blocks implementation of that transport, rather than triggering a fork fallback.

### 2 Implement submission and recovery

Separate proposal object hosting from repository publication in `packages/collaboration/src/service.ts`. Advertise clone locations that actually serve the frozen commit. Save the signed event and immutable source/preview record before resumable delivery, and confirm both upstream visibility and commit availability before success.

Use an explicit journal version and compatibility dispatch. Legacy signed events retain their IDs, clone locations and journals; define resume behavior that avoids creating a new repository, and provide actionable recovery when an unfinished legacy job cannot meet that constraint. A new revision may use a proven upstream clone location without rewriting old revisions or deleting old repositories.

Report timeout recovery according to whether a signed journal exists. Preserve target, service/tool cause, safe exit/status codes and recovery context through diagnostics. Record signer permissions through a real CLI entrypoint.

### 3 Implement interoperable acceptance

Resolve the proposal's target branch and upstream default using the selected protocol. Keep checks for current revision, clean target, upstream advancement and merged-source validity. Preserve unrelated refs and repository announcement metadata when publishing the merged branch.

Support the authorized maintainer cases proven in stage 1 without requiring ownership or rewriting the repository identity. Align applied status with ngit semantics and the exact revision actually included in the published branch. Do not mark a later unmerged revision applied because an older revision was accepted.

Persist publication/status delivery sufficiently to recover from a successful Git push followed by relay failure. External ngit acceptance must become visible in Soy, and Soy acceptance must become visible in ngit. Ordinary HTTP Git merges without protocol status should retain an accurate distinction between observed ancestry and an authorized applied event.

### 4 Make CLI and workshop flows consistent

Keep commands and workshop controls on the shared service. Show preparation, submission, local merge, Git publication and status confirmation as understandable outcomes. Return identifiers usable by independent tools and precise next actions after partial failures. Avoid additional repository-signing prompts on the contributor path.

Refresh creator guidance and [COLLABORATION.md](COLLABORATION.md), then record actual behavior and pins in [PROTOCOL.md](PROTOCOL.md), [NAP-REVIEW.md](NAP-REVIEW.md), [COMPATIBILITY.md](COMPATIBILITY.md) and [INTEROPERABILITY.md](INTEROPERABILITY.md). Update implemented-behavior claims only after the corresponding implementation and verification.

## Acceptance matrix

| Scenario | Required evidence |
| --- | --- |
| Soy creates, ngit reviews and accepts | Same root/revision/commit, successful checkout and merge, Soy reads published applied status |
| ngit creates, Soy reviews and accepts | Proposal without Soy preview remains usable; ngit reads the published merge/status |
| Revisions from either client | Existing root retained; latest exact commit fetched; stale review cannot merge silently; mixed-client updates do not duplicate roots |
| Non-maintainer submission | Recording signer sees no 30617/30618 request; no new repository announcement/state; upstream branches/tags/HEAD/state unchanged |
| Target and maintainer variations | Default and declared non-main target verified; authorized additional maintainer can publish without dropping unrelated refs |
| Interrupted submission | Fail after signing, object push and relay delivery; resume reuses event ID and immutable objects; pre-journal failure gives accurate recovery |
| Interrupted acceptance | Git publication followed by failed status delivery recovers without repeating the merge or claiming premature confirmation |
| Hosting refusal | Useful target/cause survives CLI JSON and workshop boundaries; no automatic repository creation |
| Legacy proposals and jobs | Existing clones remain fetchable and mergeable; legacy resume/transition policy preserves signed events and journals |
| Conflicts and external changes | Conflict and tool failure remain distinct; changed revision/target requires refreshed review; external acceptance is reflected |

Use disposable local identities and services for the automated matrix. Add actual ngit command coverage rather than merely signing external-looking events with Soy helpers. Record a manual independent Nostr Git UI check separately; select its concrete client/version during stage 1 and do not infer UI compatibility from CLI success.

## Source and verification starting points

- `packages/collaboration/src/{service,protocol,git}.ts` and their protocol/Git tests.
- `packages/grasp/src/client.ts`, `services/grasp/upstream.json` and `scripts/grasp-build.ts`.
- `apps/cli/src/{share-project,index}.ts` and the shared workshop/review callers.
- `tests/services/grasp.test.ts`, `tests/services/interoperability.test.ts`, `scripts/interop.ts` and `tests/fixtures/interoperability/pins.json`.
- [CLI diagnostics contract](CLI-ERRORS.md), [Nix package validation](NIX.md#maintaining-the-package), [protocol contract](PROTOCOL.md) and [reviewed decisions](NAP-REVIEW.md).

Recorded baseline: NIP-34 `6d2979b3f503a8539c983efbcdcf901bbcf9ed23`; GRASP 3.0.2 at `cdda4a23fe5dede2411e18aaa8b82c1747c97ddf`; independently verified ngit/git-remote-nostr 2.1.0. Stage 1 must establish compatible versions for the expanded matrix. The authoritative NIP-5D and NAP contracts remain unchanged.

Run focused protocol/Git tests, real CLI diagnostics and remote-signer tests, native GRASP integration, independent ngit interoperability and workshop checks. Before pushing CLI/shared-package or bundled-guide changes, run the required `bun run check:nix`; record actual results and any environment blockers. Deployment and a public proposal retry require their own authorization and evidence.

## Remaining planning decisions

1. Direct transport or ngit integration, based on the stage 1 fixture and signer/preview requirements.
2. Exact compatible upstream versions and the independent Nostr Git UI used for acceptance.
3. Target/default-branch and additional-maintainer cases supported by those pins.
4. Legacy journal recovery policy and acceptance publication journal design.
5. Whether the workshop offers a combined merge-and-publish action in addition to separate controls; either choice must preserve the distinct outcomes.

These decisions require protocol/code investigation or interface design. They do not reopen the agreed forkless requirement or expand the work to traditional forges.
