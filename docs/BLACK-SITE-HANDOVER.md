# Black Site host integration handover

For the agent maintaining napplet-soy. The Black Site editor required two host capabilities missing from the starting checkout: publishing the game's native map records through NAP-OUTBOX, and opening a map editor through NAP-INTENT. This branch implements both. They are proposed host features that need this project's architectural and policy review before merging or releasing.

The editor could call the official SDK, but could not implement either missing host capability inside its sandbox. The map-specific publication policy is one implementation choice, not a requirement of NAP-OUTBOX. The receiving project may replace that policy with its preferred general publication architecture.

## Branch and ownership

- Feature branch: `feat/black-site-map-intents`.
- Base: `607bf1f0330b1decf7c9aaea0befe0e5c6db3c9b` (the recorded `origin/main`). Local `main` was restored to this base.
- `562119d`: native map publication, intent broker, preview/web wiring, dependency update and regression coverage.
- `66fa6b9`: align examples and tests with the agreed `black-site` archetype and `map-*` actions.
- `9fd0981`: update the integration test to edit metadata through the editor's Settings modal.
- This handover is committed separately on the same feature branch.

No push, PR, release or public deployment has occurred. Existing installed soyLI binaries and the deployed website remain separate from this source branch. An unrelated, untracked `docs/NAP-OUTBOX-PLAN.md` was present during the handover; it was left untouched and is not part of these commits. Reconcile any publication design in that work with this proposal before merging.

The changes were initially committed on local `main` while implementing the editor. That branch handling was corrected. Keep subsequent host work on a feature branch and let the napplet-soy maintainer own policy and release decisions.

## Why host changes were needed

| Requested behavior | Starting host limitation | Proposed change | Review consequence |
| --- | --- | --- | --- |
| Create/update Black Site maps in the connected player's account | `host.ts` sent every `outbox.publish` and `relay.publish` to `NappletAppData`, which accepts scoped kind-30078 records. The game contract uses kind 35858. | Admit a narrowly validated native map template alongside the existing app-data path. | Decide whether app-specific native-kind admission belongs here or should become a general publication policy. |
| Delete a published map | The existing app-data publication path could not admit a native-map NIP-09 deletion. | Admit kind 5 only when it targets the verified current map owned by the viewer. | Review owner/target checks and deletion semantics. |
| Use a NIP-46 viewer to publish maps | `websiteKinds` did not include 35858. | Include 35858 in viewer signer permissions. Creator `publishingKinds` is unchanged. | Existing viewer sessions can require renewed permission; communicate this in release notes. |
| Game EDIT opens another napplet with the requested map | There was no host INTENT request dispatcher, handler catalog, chooser or launch/delivery lifecycle. | Add a reusable host-owned `IntentWorkspace`, connected to preview and web players. | Generic infrastructure: review separately from Black Site map policy. |
| Deliver to an editor that has not finished loading | The source and target iframe lifetimes differ; sending directly before receiver readiness loses the request. | Retain accepted payloads until the target handshake is ready, with cancellation and bounded startup. | Verify cold launch, source closure, cancellation and failure behavior. |
| Use the current official receiver contract | Host shim 0.30.0 pinned core/nap 0.32.0; the editor's SDK 0.29.0 uses core/nap 0.33.0. | Pin shim 0.31.0 and matching core/nap 0.33.0; update the Nix dependency output hash. | Review package compatibility and repeat required packaging gates before pushing further dependency changes. |

Existing OUTBOX reads, RESOURCE byte retrieval and Blossom UPLOAD were reused. No new upload or resource protocol, relay service, signing protocol or app-local NAP was introduced. Normal editor operations use OUTBOX; the host's existing RELAY publication entrypoint shares the admission policy, but the editor does not require RELAY.

Moving maps to scoped kind 30078 would change the game's existing map contract and cross-napplet address identity. That would require a coordinated game/editor/schema migration. It was not used as a workaround. Allowing arbitrary signing or using the creator key would bypass the sandbox authority boundary and was not used.

## Implementation map

| Files | Responsibility |
| --- | --- |
| `packages/runtime/src/map-contract.ts` | Bounded map metadata and remix/deletion template validation. |
| `packages/runtime/src/map-publication-session.ts` | Viewer consent, exact signing, configured relay writes, current-revision reads, retries and cancellation. |
| `packages/runtime/src/host.ts` | Publication routing and account lifetime; optional INTENT endpoint and handshake/teardown. |
| `packages/runtime/src/intent-session.ts` | Verified handler catalog, availability, chooser/default selection, attested sender, target lifecycle and retained delivery. |
| `packages/runtime/src/intent-controls.ts` | Host chooser and default-handler controls used by preview. |
| `packages/runtime/src/capabilities.ts` | INTENT requests and runtime profile `space-playback-6`. Review this profile identifier against any parallel host changes. |
| `apps/cli/src/preview/intent-client.ts`, `preview/client.ts`, `preview/server.ts` | Trusted local preview registration, signed manifest import, real target artifact loading, viewer/consent propagation and cleanup. |
| `apps/web/src/lib/intent-workspace.ts`, `components/intent-launcher.tsx`, `components/player.tsx`, `routes/__root.tsx`, `styles.css` | Verified public discovery, default persistence, chooser, target overlay and lifecycle wiring. |
| `packages/identity/src/signer.ts` | Viewer permission for kind 35858. |
| `package.json`, `bun.lock`, `nix/package.nix` | Official shim upgrade and its exact dependency-tree hash. |
| Runtime tests and `tests/services/black-site-editor.test.ts` | Permanent regression coverage for the proposed feature; not temporary production shims. |
| `docs/MAP-INTENTS.md`, `PROTOCOL.md`, `NAP-REVIEW.md`, `PUBLIC-RUNTIME.md` | Implemented source behavior, pinned protocol contract and release boundary. |

## Map publication authority and limits

The host admits native map metadata with bounded tags, declared JSON MIME, SHA-256 and a declared size of at most 256 KiB. It validates ownership and remix references. It does **not** download or validate the referenced map JSON in the current wiring. An optional trusted `validateBlob` callback exists but is not supplied by `host.ts`. Consent discloses this; the game and editor independently verify file hash, size, JSON and schema when reading maps.

Writes use the connected viewer's signer and host-owned consent. Napplet publisher identity, soyLI provenance or artifact hash confers no extra authority. Napplet hints cannot introduce unconfigured write destinations. Account/frame retirement aborts pending work; `signExact` rejects signer responses that change the prepared event.

The session requires complete reads from selected relays and rechecks the current map around consent and signing. Local locks and Web Locks reduce concurrent writes on one browser. These checks detect observed changes; they do not provide atomic cross-device compare-and-swap. Map events contain no prior-revision token. Failed acknowledgements retain bounded signed retry entries tied to their original base revision.

Deletion is a signed request for the viewer's verified current map. It does not erase Blossom files or every historical relay copy. There is no server migration on this branch.

## Intent contract and host behavior

The editor advertises archetype `black-site` with these exact conventions:

| Convention | Editor payload |
| --- | --- |
| `napplet:black-site/map-edit` | `{ address, relays? }` |
| `napplet:black-site/map-open` | `{ address, relays? }` |
| `napplet:black-site/map-remix` | `{ address, relays? }` |
| `napplet:black-site/map-new` | `{ map? }` or no payload |

A published map address is `35858:<author hex>:<map id>`. The editor owns payload validation, login waiting, ownership checks, unsaved-work confirmation and map loading. The host broker routes exact queryless convention identities; it does not interpret map payloads or grant edit/signing authority.

The broker installs public handlers only from verified compatible manifests, uses author-qualified catalog IDs, attests the source identity and provides host-owned chooser/default controls. The preview can also register a trusted local project. An INTENT domain is advertised by `attachNappletHost` only when that surface has an endpoint.

`result.ok` means the runtime accepts delivery responsibility, not that the editor has handled the request or saved a map. There is no invented handled acknowledgement. Cold deliveries survive source closure after acceptance, wait for target readiness and expire/cancel through bounded session lifecycle rules. Payload limits are 1 MiB per request, 64 queued deliveries and 8 MiB total, with a default 30-second startup deadline. Retention is not durable messaging.

The canonical contract pin already recorded by this branch is `e5308ac92cfd49e4fb026812c60886571515e219`. Review the local protocol documents and installed package surfaces if updating this pin; older skill examples can describe obsolete request/result shapes.

## Verification evidence

The following results were recorded during implementation, before later editor tutorial/shortcut changes:

- Runtime suite: 83 passed; native map session tests cover consent denial, incomplete reads, stale revisions, changed signatures/accounts, retries, metadata/remix validation and deletion. INTENT tests cover verified catalogs, sender spoofing, chooser/defaults, cold startup deduplication, retained ordering, cancellation and bounds.
- Source-host integration: one Playwright/Bun test passed with 14 Bun assertions plus browser assertions. It exercised four signed uploads; create, update, reload/discovery, another viewer's remix, game EDIT to a cold editor, publication from that opened editor, game loading/playing the update, and deletion.
- The integration test uses real built editor/game artifacts, the actual host and shim, test NIP-07 viewer signers, and local Bun relay/Blossom fixtures that verify signatures. It does **not** run the production Go relay/Blossom services or use real public accounts. App SDK domains are not mocked.
- Host typecheck and web production build passed. Full Nix dependency-hash regeneration, build, forced rebuild and flake/VM checks passed on x86_64 Linux; aarch64 was not checked.
- Broad `bun run check`: 636 passed and 3 failed because system Git 2.34.1 lacks `merge-tree --write-tree`. The affected six-test collaboration suite passed with packaged Git 2.55.0. The broad command was not rerun in full with the newer Git; do not report it as fully green.

Refreshed on 2026-10-13 for this handover: `bun run typecheck` passed; `bun test packages/runtime/src --timeout 20000` passed 83 tests with 563 assertions and no failures. Public web launch wiring has type/build and broker coverage; the end-to-end joined game/editor launch was demonstrated in CLI preview, not on the deployed website.

The service test depends on adjacent repositories and built artifacts. Its last passing run predates the editor's first-run tutorial and subsequent tabbed settings. It already accounts for the Settings modal, but may need tutorial dismissal and precise selectors before running against the latest UI. Treat its historical pass as evidence for that tested artifact, not every later editor checkout.

## Reproduction

Run host checks from napplet-soy:

```sh
bun run typecheck
bun test packages/runtime/src --timeout 20000
bun run build
```

For the joined workflow, first build the adjacent game and editor with their pinned dependencies, then run:

```sh
cd ../black-site
pnpm type-check
pnpm build
cd ../black-site-editor
pnpm verify
cd ../napplet-soy
bun test tests/services/black-site-editor.test.ts
```

From the editor directory, the updated source CLI is:

```sh
bun ../napplet-soy/apps/cli/src/index.ts dev --port 0
```

Use its printed URL and stop it after testing. Cold target launch requires a handler catalog entry: preview's signed-manifest import or normal verified web discovery. Merely building an editor artifact does not publish or install a public handler.

Before pushing relevant dependencies, CLI or shared-package changes, follow `AGENTS.md` and run `bun run check:nix`. After changing the dependency tree, use `bun run update:nix-hashes` to regenerate only the exact hash and rerun checks.

## Decisions and next work for the project owner

1. Review the native-kind publication architecture first. Accept the narrow map policy, replace it with a general reviewed OUTBOX admission policy, or coordinate a different record contract with the game/editor. Preserve consent, ownership, relay policy, exact signing and cancellation in any replacement.
2. Decide whether metadata-only admission is sufficient. If host validation of linked bytes is required, implement the trusted callback through the existing RESOURCE boundary, with size/hash/time budgets and failure tests; do not claim the current wiring already does this.
3. Review the generic INTENT broker independently. Confirm contract pin, catalog authority, sender identity, chooser/default behavior, cancellation, delivery retention and startup limits. Consider splitting the publication and INTENT changes into separate PRs.
4. Update and rerun the external-artifact integration test for the selected editor/game revisions. Add a public-web browser scenario if deployment readiness requires evidence beyond preview.
5. Reconcile parallel runtime profile and publication planning work, rerun project gates, and review signer permission renewal. No feature-specific temporary bypasses need removing; retained tests and fixtures are regression coverage.
6. Open the PR from this feature branch. Release/deployment and public handler publication require separate decisions. Until then, describe support as implemented in local source only.

Do not migrate creator keys into viewer actions, allow arbitrary signer access, move host networking into the napplet, or change the map contract silently to make tests pass. If this proposal is rejected, coordinate an editor/game fallback or migration rather than advertising a host capability that is absent.
