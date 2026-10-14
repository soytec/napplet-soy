# Investigation: soyLI proposals unnecessarily create a contributor repository

Date: 2026-10-12\
Affected release: soyLI 0.26.1, linux-x64\
Source inspected: napplet-soy checkout at `607bf1f`\
Status: investigation and implementation handoff; no CLI fix or deployment performed.

## Requested outcome

`soyli propose` should use the normal ngit/NIP-34 pull-request feature against the existing upstream repository. A proposer must not have to create, announce, own, or publish a separate Git repository to contribute. Use upstream PR hosting and immutable proposal refs; preserve the upstream author's branches and repository identity.

This requirement applies to first proposals, revisions, retries, and the workshop UI that calls the same service. Do not silently fall back to creating a fork when hosting fails. Optional alternative PR hosting can use GRASP-06 without a new repository announcement, if supported and deliberately selected.

This is a change to the collaboration adapter. Ordinary author-owned repository publication for `soyli publish` remains a separate, valid feature.

## Incident and reproduction

A Git-backed remix of Big Rig Rush was prepared with tested audio improvements. Its branch is `pr/big-rig-rush-audio-improvements`; upstream `main` and the remix base both pointed to `32ac819c00c7bcafc4cd713475e14ee087b39d3f`. The proposal tip, including refreshed preview media, is `13c3cd8e1712ffeef2642d2b61158adb05e081e3`.

The creator had playtested the audio fix. Type-check, build, guidance, four Web Audio regressions, hosted Firefox gameplay, and `soyli check` passed. Conformance reported five passes, zero failures, and five unmeasured skips. A fresh clip was recorded and committed, resolving an earlier stale-video check failure.

From the remix, the agent ran `soyli propose <multiline description> --json`, with the first line:

> Big Rig Rush: reduce audio clipping while preserving chaotic effects

The selected remote signer passed `soyli account check`. During the proposal operation, the user saw a request to sign a new Git repository and questioned why a PR required that. The command eventually failed with:

```text
code: SIGNER_TIMEOUT
message: Remote signer did not respond. Unlock it and retry.
operation: soyli propose
version: 0.26.1
platform: linux-x64
```

The timeout does not establish why the signer failed or prove a permission denial. The unexpected repository-signing request is explained by the source independently of the timeout.

A read-only `soyli proposals --json` query showed an empty upstream inbox during the attempt. No successful proposal receipt was returned. Frozen preparation files exist under the remix's ignored `.napplet-space/proposals/`; no saved proposal JSON was found by the subsequent file search. Do not assume `--resume` works merely because preparation files exist: the current implementation requires the saved journal. No retry, merge, or napplet release was performed after the user's objection. Some preview uploads may have occurred before failure; an empty inbox does not establish absence of every external side effect.

## Verified cause in the implementation

Relevant paths are relative to the napplet-soy root:

| Location | Current behavior |
| --- | --- |
| `apps/cli/src/share-project.ts`, `proposeFromProject` | Captures the selected account, checks committed history, prepares the sharing identity, builds, then calls the collaboration service. |
| `packages/collaboration/src/service.ts`, `propose` | Requests signing kinds `[5129, 30617, 30618, 24242, 1618, 1619]`. Freezes source and prepares a checked playable preview. |
| Same file, around lines 241–260 | Unconditionally chooses `proposal-${key}` and calls `prepareSource` using the proposer's signer and configured GRASP service. It supplies the upstream repository as a relationship, rather than using it as the source-hosting destination. |
| `packages/grasp/src/client.ts`, `prepareSource`, around lines 219–236 | With no existing announcement supplied, signs a new kind-30617 repository announcement. Also signs kind-30618 repository state with `refs/heads/main`, release tags, and `HEAD`. |
| `packages/collaboration/src/service.ts`, PR event construction | Signs kind 1618, or 1619 for a revision, referencing the existing upstream in `a`, but advertises the contributor repository in `clone`. |
| Same file, submission phase | Calls `publishSource` for the contributor repository, publishes the PR event, then also pushes `${commit}:refs/nostr/${event.id}` to an upstream clone. Requires upstream relay read-back before reporting success. |

Thus the new-repository prompt is expected under the current adapter, but is not required by ngit's PR workflow. It is an architectural dependency on the source-publication helper. The contributor repository carries an upstream `u` relationship; that relationship does not eliminate creation of a separate repository identity.

This is also explicitly documented in `docs/COLLABORATION.md`: the initial adapter uses an ordinary contributor-owned hosted repository and does not use optional GRASP-06 hosting. Update that documented limitation when the implementation changes; do not claim the current code already follows the requested behavior.

## Protocol and ngit evidence

Official sources checked during the investigation:

- [ngit pull requests](https://ngit.dev/pull-requests): the normal workflow uses a `pr/*` branch and a push to the existing repository; updates push the same branch. `ngit send` supports explicit title/description and advanced input. Do not both send and push a PR branch for the same submission, since that can create duplicate proposals.
- [ngit quickstart](https://ngit.dev/quickstart): repository creation and opening a PR are separate operations.
- [NIP-34 overview](https://ngit.dev/protocol/nip-34): repository announcement/state are kinds 30617/30618; PR/update are 1618/1619.
- [GRASP-06](https://ngit.dev/protocol/grasp/specification/06): alternative PR hosting explicitly avoids requiring a fork repository announcement. Its PR endpoint is `/prs/<npub>/<percent-encoded-identifier>.git`, and accepted Git refs use `refs/nostr/<event-id>`.

The local `docs/PROTOCOL.md` collaboration section already identifies GRASP-01 immutable PR refs without updating a maintainer branch. `docs/NAP-REVIEW.md` records the earlier decision not to enable GRASP-06. Check the repo's pinned specifications and actual server capabilities before adopting newer behavior; current online documentation alone does not prove deployed support.

A PR does not grant permission to write the upstream's `main` branch. Also, avoiding repository creation does not guarantee a single signing prompt: preview uploads, the signed playable attachment, transport authentication, and PR updates may still require their own signatures. Explain those separately. The requirement is to remove new repository announcement/state signing from the proposal path, not to remove all signing.

## Implementation guidance

1. Separate proposal Git-object hosting from `prepareSource`/`publishSource`. Those helpers currently implement author-owned repository publication and should not be a prerequisite for PR submission.
2. Keep the existing upstream repository coordinate, maintainer recipients, root ancestry, merge base, exact proposed commit, branch metadata, and supported NIP-34 root/update relationships.
3. Host proposal objects through the upstream's supported PR facility, using immutable `refs/nostr/<signed-event-id>`. Advertise a clone URL that actually serves the proposed commit. Verify the pinned GRASP pending-event/object ordering; do not assume an event acknowledgement means the proposal is visible.
4. Either implement the standard PR transport directly or deliberately integrate ngit's client path. If integrating ngit, preserve the selected identity, avoid copying signer secrets into arguments/environment/config, and attach `soy-preview` to the exact signed root/update. Do not generate a second PR merely to add the attachment.
5. Remove proposal-only 30617/30618 permission requests and automatic creation of `proposal-*` repositories. Retain signatures needed for preview bytes and normal PR submission. Keep the checked, author-bound `soy-preview` extension optional for readers.
6. Persist the signed proposal and immutable preview/commit before delivery steps that need resumability. Retries must reuse the saved event and objects rather than create duplicate roots. Preparation interrupted before any saved event needs clear recovery instructions, not an unconditional `--resume` recommendation.
7. Preserve old saved jobs and existing proposals. Define how legacy jobs with contributor-repository state resume, and how later revisions transition clone locations. Never silently rewrite signed events, delete old repositories, change identities, or discard journals.
8. Keep read-back confirmation and actionable diagnostics. Hosting refusal/unavailability must report the target and useful cause. Use supported forkless alternatives only; otherwise stop without creating a new repository.

## Acceptance checks

- A first proposal by a non-maintainer is discoverable through both ngit and `soyli proposals`; it references the original upstream and can be fetched at its exact `c` commit.
- A recording signer proves that initial submission and revisions request neither kind 30617 nor kind 30618. No `proposal-*` repository announcement/state or new author-owned repository is created.
- Upstream `main`, tags, `HEAD`, and signed repository state remain unchanged. Only permitted proposal refs and collaboration events are written.
- A second tip updates the existing PR with kind 1619 and a newly bound preview; it does not create another root.
- Partial failures after signing, Git push, and relay delivery resume idempotently. The CLI confirms queryable upstream visibility before reporting success. A pre-journal signer timeout has accurate recovery instructions.
- Upstream hosting refusal does not trigger automatic fork creation. If GRASP-06 is implemented, test its actual advertised support, endpoint, event acceptance, and successful fetch without a fork announcement.
- External proposals lacking Soy preview metadata still work. Existing contributor-repository proposals remain reviewable and mergeable; legacy retry handling is tested.
- CLI and workshop UI use the same corrected service. Test remote-signer permissions, attribution, and diagnostics through real entrypoints.
- Run an integration test against the pinned native GRASP service: contributor PR, read-back, independent ngit/Git fetch, update, retry, and refusal. Existing test starting points include `tests/services/grasp.test.ts` and `packages/collaboration/src/{protocol,git}.test.ts`; locate the proposal end-to-end coverage before changing the service.

Update `docs/COLLABORATION.md`, the collaboration sections of `docs/PROTOCOL.md` and `docs/NAP-REVIEW.md`, and shipped creator guidance/CLI descriptions as appropriate. For CLI/shared-package or bundled-guide changes, follow `AGENTS.md` and run the required `bun run check:nix` validation before pushing. Record implementation, verification, and deployment separately.

## Handoff boundary

The game changes and refreshed media remain committed in the Big Rig Rush branch. This report authorizes no new repository creation or signer/account change. The user wants the normal forkless ngit PR feature. Resolve the adapter behavior before retrying the public game proposal through soyLI. This report is local documentation; no public issue, proposal, or message has been posted on its behalf.
