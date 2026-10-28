# Cross-client and standalone release checks

The [2026-10-27 compliance audit](NIP5D-COMPLIANCE-AUDIT-2026-10-27.md) adds live
Paja evidence and an inventory of retained public releases. Funclet's reproduced
radio failure is an unsupported MEDIA owner mode; Naped Snowboarding's Ride
interaction starts in Paja. Neither observation qualifies all features. The
existing legacy-wrapper acceptance below does not establish portability of every
current standalone publication. The bounded current-manifest checks below now
cover the independent host and eight owner-scoped repair candidates; broader inventory
qualification remains open.

## Current-manifest acceptance and repair candidates — 2026-10-28

`bun scripts/current-shell.ts` runs unchanged **Paja 0.24.4** with dependencies
locked in `tests/fixtures/current-shell/bun.lock`. Its four Chromium cases use
current kind-35129 manifests, not the legacy wrapper below: input, storage reload,
MEDIA, denied/absent optional domains, blocked direct fetch and tampered-byte
rejection. Disposable loopback relay/Blossom fixtures supply transport; Paja owns
resolution, verification, bridge injection, CSP and dispatch. The CI service
workflow now includes this gate. No public fixture events are published.

[Owner-scoped repairs](audits/2026-10-28/repairs/README.md) coordinate Web Audio in
Funclet, Napplet Machines V8, GRAV / RIFT, Rail Game, Soybert 3D, Outbreak and the
owner's earlier Studio-built Obsidian Breaker and Truffle Rush. Six projects are repaired in local
Git checkouts; the two Studio releases have exact-source archive patches. Third-party projects
are outside the repair scope. The optional `SOY_REPAIRS_ROOT` runner checks their
built artifacts with MEDIA allowed, absent and denied. Application checks and
source/patch provenance are recorded with the repair bundle.

These are local corrections awaiting author-reviewed publication. Funclet's
shell-owned radio stream remains unsupported by Paja; explicit feedback and safe
degradation are tested. These checks qualify the exercised interactions, not all
gameplay, all NAP operations or real radio availability. Existing intentional
source/app-data extensions are retained.

## Forkless proposals and acceptance

2026-10-12 local source qualification uses native GRASP 3.0.2 at
`cdda4a23fe5dede2411e18aaa8b82c1747c97ddf`, GRASP specifications at
`f35b4f9a4ed2f0aaaf46926e4b1733c79e21b377`, and independent ngit/git-remote-nostr
2.6.1 (source `55f3e3a838dffd03f0fdd996103b8dc8c2cddcd6`). The PR test checks the
installed ngit version against `tests/fixtures/interoperability/pins.json`.
The historical 2.1.0 fetch qualification below remains separate evidence.

`tests/services/forkless-proposals.test.ts` runs a real Soy CLI submission through
an encrypted NIP-46 provider that refuses repository signing. It checks permitted
signing kinds, no new repository events, unchanged upstream branches/tags, and
retry without reconnecting the signer. Independent ngit lists and checks out the
PR, updates the same root, and accepts it with `pr merge` on the target followed
by Git push. Soy continues a mixed-client revision and reads ngit's applied status.

The reverse leg creates and updates a PR with actual `git-remote-nostr` pushes,
without a Soy preview. Soy merges and publishes it, and ngit reads the applied
status. A new ngit root can acquire a Soy journal without another root. Fixtures
also cover an interrupted Git/status publication, real CLI HTTP 403 diagnostics,
legacy journal resume/clone transition, and a real encrypted signer timeout before
journaling. Distinct Nostr timestamps are used for sequential cross-client updates;
this does not qualify simultaneous or equal-timestamp revision conflict behavior.

`tests/services/forkless-acceptance.test.ts` verifies a signed `develop` default,
additional maintainer invitation versus reciprocal confirmation, an exact reviewed
merge, and publication retaining `main`, tags, `HEAD` and the announcement.
`tests/services/grasp.test.ts` independently verifies event-first pending visibility,
exact commit fetch, immutable root/update refs, retry and branch-write refusal.
The existing collaboration test in `tests/services/publish.test.ts` exercises the
shared local-review browser, mobile width, sandbox and revision-selection behavior.

Run with Git 2.38 or newer, ngit 2.6.1, the native-service build prerequisites and
the installed Playwright browsers:

```sh
bun test tests/services/grasp.test.ts tests/services/forkless-proposals.test.ts tests/services/forkless-acceptance.test.ts tests/services/publish.test.ts
```

All keys and services are disposable and confined to loopback. Test-only ngit
credentials live privately outside Git repositories; production proposal transport
does not pass signer secrets to Git/ngit. These are CLI/native-service and Soy UI
checks, not independent Nostr Git browser UI acceptance, public hosting policy
qualification or deployment. Role-based and indirect recursive maintainer state
authority, branch creation and squash/rebase acceptance remain delegated to ngit.

The native/service run records 14 passes and one existing opt-in native credential
test skipped. The final targeted collaboration run passes, and the same PR fixture
also passes against the Nix-built standalone CLI (`SPACE_TEST_CLI`). Its shortened
pre-journal signer-timeout leg uses the source entrypoint to set the test budget.
The full repository check records 616 passes. Nix dependency and CLI force
rebuilds pass with unchanged dependency hashes. The final NixOS regression driver
passes with KVM under the current user. The all-in-one `check:nix` remains blocked
in the daemon's build environment: that build user lacks KVM device access, falls
back to emulation and exceeds the Chromium navigation deadline. This is not
recorded as a passing flake check; the same driver's direct KVM run is separate
verification. [Remaining work](FORKLESS-PROPOSALS-PLAN.md).

## Current migration scope — 2026-10-04

[NIP-5D PR 7 migration](NIP5D-MIGRATION.md) has a separate real-service/browser fixture in `tests/services/nip5d-migration.test.ts`: directly signed new and legacy manifests, raw artifact verification, saved-state continuity, independent snapshot isolation, icons, required/optional domains and retained pinned revisions. These fixtures are independent of Soy's event builder, but are not an external client implementation.

The pinned Paja 0.16.4 host below consumes the legacy format. The current interoperability runner therefore wraps freshly published Soy HTML in an explicitly legacy manifest built by the pinned upstream builder for that leg, while testing current Soy publication/source/Git separately. Do not infer PR 7 support by Paja or another external client from a passing legacy check. The dated 0.14.1 evidence below remains historical.

Verified locally on **2026-09-20** for soyLI **0.14.1**, then published with website
release `20260920084527457-12824`. The cross-client checks below use disposable
identities and loopback Khatru, Blossom and GRASP services. Separate
[deployment evidence](DEPLOYMENT.md#soyli-0141-and-workshop-release--2026-09-20)
records the public installer, downloads, website and protocol health checks.

## Independent host and publisher

| Component                    | Version / revision                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Independent host             | [`@kehto/paja`](https://github.com/kehto/web) 0.16.4, dependencies pinned in the test fixture lockfile                                |
| Upstream manifest builder    | [`napplet/web` 956135b](https://github.com/napplet/web/tree/956135bfc41a2cff5e45d6c68d9f9a4d68c50531), `packages/cli/src/manifest.ts` |
| Ordinary Nostr Git transport | ngit / git-remote-nostr 2.1.0                                                                                                         |
| Soy host / starter           | Existing shim 0.30.0 and maintained boilerplate pins; see [compatibility](COMPATIBILITY.md)                                           |

`tests/services/interoperability.test.ts` checks:

1. A normal soyLI publication, including its source and external PNG, is discovered
   from its Nostr address by Paja's resolver. Paja verifies and loads it using its
   own unchanged browser host. The sandbox decodes the Blossom image and receives
   configuration defaults from the shipped starter settings code.
2. Independently authored HTML is uploaded with signed BUD-02 authorization.
   Upstream publishing code constructs its aggregate and root, named and snapshot
   manifests. Each resolves, remixes and runs in Soy's shared preview host, including
   runtime schema registration and a working counter. No Soy source archive,
   presentation descriptor, preview image or branded identifier is supplied.
3. A signed manifest with an incorrect aggregate is rejected before preview.
4. A second creator remixes and proposes a real Git commit with soyLI. Ordinary
   `git ls-remote` and `git clone` through the installed `git-remote-nostr` discover
   and fetch the original history and proposed commit. Its ancestry is intact.

The first run exposed a real configuration mismatch: our example only subscribed
after an embedded schema, while Paja returned `config.schemaError: no-schema`.
The 0.14.1 example now registers the same schema when the host's `config.schema`
is absent. It preserves a host-supplied schema and optional CSS defaults. This
uses NAP-CONFIG without changing the manifest, host protocol or upstream SDK.

Run from the repository with Git, ngit, Chromium and the local service build
prerequisites installed:

```sh
bun scripts/interop.ts
# Exercise a locally built standalone publisher instead of the source CLI:
SPACE_TEST_CLI="$PWD/.local/cli/0.14.1/soyli-darwin-arm64/soyli" bun scripts/interop.ts
```

The runner downloads pinned upstream tooling into ignored `.local/interoperability`,
keeps it outside application dependencies, and leaves screenshots under `evidence/`.
An existing upstream checkout must be clean and at the pinned revision. The test
can also use explicit `SOY_INTEROP_PAJA` and `SOY_INTEROP_UPSTREAM` paths; without
both, it is skipped rather than pretending independent acceptance ran.

This is not a full upstream CLI publishing session or a ngit review/merge UI test.
The reverse fixture uses upstream manifest-builder functions and a direct BUD-02
upload. Paja's pointer runner proves address resolution and playback, not inclusion
in a separate public gallery. Paja uses permissive test ACLs; production consent,
all NAP operations, CONFIG schema edge cases and arbitrary game behavior need their
own acceptance. No public relay receives the fixture events.

## Standalone platforms and workshop

`scripts/cli-platform-smoke.sh /absolute/path/to/soyli` creates a disposable project
with fresh managed Node/pnpm and Chromium caches, removes Bun/Node from PATH,
typechecks and builds the maintained starter, runs the host check, lists assets and
destinations, and creates a local Git checkpoint. It creates no signing identity
and publishes nothing. Network access is needed for managed dependency downloads.

Native macOS ARM64 additionally runs the packaged installer, capture, upstream
starter/configuration and fresh-clone asset/workshop checks. The integrated browser
workshop check covers metadata editing, diff/checkpoint, failed publication/retry,
a contributor's playable proposal, Original/Proposed comparison, local merge and
separate release, including a 390 px layout.

Platform evidence must distinguish Linux ARM64 in a VM/container, Linux x64 under
emulation and macOS x64 under Rosetta from native Intel hardware. Rosetta emits a
Bun AVX warning even when the workflow passes. These checks do not qualify the old
Intel Mac's OS, CPU, Keychain or codec behavior. Native Intel Mac acceptance and a
nontechnical human workshop walkthrough remain open. The release evidence file
records exactly which archive/platform combinations passed.
