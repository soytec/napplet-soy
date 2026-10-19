# soyLI releases and updates

GitHub Releases distribute the standalone CLI independently of the website/VPS.
The current published version is **0.30.0**.

**0.30.0 — local Studio beta and publication feedback:**

Published **2026-10-19 (Europe/Vienna)** from source
`14e9343dff5eb27815eaa9fe64f50490f01c0ffb`, the squash merge of
[PR #24](https://github.com/zeSchlausKwab/napplet-soy/pull/24).
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.30.0),
[native release CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39249208939),
[Nix package/VM CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39249155519)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39249155484)
passed for the released source. All four native packages and 11 public assets are
present. An isolated macOS ARM64 installation verifies the manifest/source and
installer bytes; version and doctor report 0.30.0 current, with Git and browser ready.

Studio brings chat, playable previews, assets, Git checkpoints and reviewed
publication/proposals into the shared shell. It runs from a local checkout with
the user's inference connection and shell account. Hosted Studio is not enabled;
production entry points link to the local setup. Browser compilation and Git
experiments remain opt-in, with native source and release checks authoritative.
See [Studio setup and limits](QUICK-VIBE.md).

The soyLI capture path focuses keyboard input on the napplet, scales recording
coordinates to the capture viewport, and takes the listing cover during gameplay.
Publication feedback distinguishes relay delivery from website verification;
an unrelated relay outage no longer prevents a fresh, verified creation from
being reported ready. Studio shows publication milestones and checks availability
without republishing. Recording requests return to review after the agent finishes.

Model discovery and a quick model picker, streamed activity, bounded agent repair
and the shared visual theme round out the local beta. Proposal submission uses
ordinary GRASP/NIP-34 and links to the shell's existing review page; diff review
and merging remain in soyLI/Git. Existing local drafts and soyLI workflows remain.

The source passes TypeScript and 812 tests locally. Real GRASP/relay service tests
cover proposal submission and the opt-in browser Git path in separate processes;
gameplay capture has its own browser regression suite. Upgrade with `soyli update`,
restart previews and run `soyli skills update` in existing projects. Application
source is not rewritten. See the [website deployment record](DEPLOYMENT.md).

**0.29.0 — OUTBOX, intent handlers and native maps:**

Published **2026-10-14 (Europe/Vienna)** from source
`6d0d6cc2794b31a221ff7f009a82ec0946087e9a`.
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.29.0),
[native release CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38622887368)
and [Nix CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38619572566)
passed for the exact tagged source. All four native packages and 11 public assets,
checksums, installer bytes and manifest/source match. An isolated fresh installation
reports current through doctor/update; a real 0.28.0 → 0.29.0 update preserves
account/project markers.

Merged PR #20 includes the three INTENT corrections from PR #21: retain deliveries
when reopening the same handler, retire stale contracts after signed catalog
updates, and transport bounded structured-clone payloads through the actual host.
The shared website/preview host now provides account-scoped Applesauce OUTBOX
reads, live subscriptions and viewer-consented publication with NIP-65 routing
and explicit delivery results. Native Black Site map writes retain the specialized
schema, ownership and revision checks; linked map JSON is not validated by the host.
See [OUTBOX limits](OUTBOX.md) and [intent/map contracts](MAP-INTENTS.md).

The combined source passes 731 tests, TypeScript, the production build and four
browser integration suites (107 assertions). [Native candidate CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38617877093)
and [Nix candidate CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38617877084)
passed for `da6b4a2`, the exact source tree merged by `4a5023d`. Compatible shell
readers were deployed and verified in `20261014185651621-64082` before CLI
publication, while the installer remained at 0.28.0. Final website deployment
`20261014193031446-12904` serves the byte-identical 0.29.0 installer; public services,
source fingerprints and a fresh index scan pass. See the
[deployment record](DEPLOYMENT.md) for verification and remaining limits.

The NIP-5D authority and direct-manifest presentation behavior from 0.28.0 remain
unchanged, including legacy readers. The separately proposed relay-discovery
policy change is not included. Existing installations should run `soyli update`,
restart previews and run `soyli skills update` in existing projects;
application source is not rewritten. Existing NIP-46 viewer sessions may need
renewed signer permission for map events (kind 35858).


**0.28.0 — direct-manifest presentation:**

Published **2026-10-14 (Europe/Vienna)** from source
`be8f05a96ab09f7a0b2314d70b35eb443b6f549b`.
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.28.0),
[native CI 38548936478](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38548936478)
and [Nix CI 38546524537](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38546524537)
passed for the exact source. All 11 public assets, checksums, installer bytes and
manifest/source match. An isolated fresh installation reports current through
doctor/update; a real 0.27.0 → 0.28.0 update preserves account/project markers.

Compatible readers were deployed first in `20261014095809139-41654`, with the
website installer still pinned to 0.27.0 until CLI publication. TypeScript and
644 source tests pass locally, in CI and on the VPS, alongside Go race/relay,
18 Blossom, nine GRASP and three Linux backend checks. Desktop/mobile browser
fixtures cover legacy and direct presentation; real local services verify fresh
publication. Live verification confirms legacy gallery covers, sandboxed gameplay
at desktop/390px widths, retained social totals and cached cover/video range routes.
Independent-client rendering of the optional extension remains unverified.

The final website release `20261014103151932-82151` serves the byte-identical
0.28.0 installer. Source fingerprints and shared proxy hashes match; all five PM2
services are online with zero restarts and Caddy/CVM/TURN are active. The index
reports the active release and a fresh scan; the other site returns HTTPS 200.
Persistent state and the reader-first release remain available for rollback. External
`nostr.oxtr.dev` query failures predate this rollout. No public test publications,
invoices or payments were created. See [deployment record](DEPLOYMENT.md).

Includes merged [PR #14](https://github.com/zeSchlausKwab/napplet-soy/pull/14).
Fresh publications put screenshot and optional clip hashes/MIME types on the
signed current manifest and an explicitly requested snapshot. No new kind-32267
companion or `app` reference is emitted. The documented `soy.presentation/1`
profile is a Soy extension, not an upstream NIP-5D requirement.

Old manifests and linked companions remain readable. Interrupted publication
jobs retain their exact signatures and format; a subsequent fresh publication
adopts direct presentation without changing the author or napplet address.
Installing the update does not republish existing napplets.

The matching shell verifies direct covers/clips and uses them for gallery,
sharing, OG images and deletion inventories. Optional media never becomes a
playback requirement. Deploy these readers before distributing the new CLI.

Upgrade with `soyli update`, restart previews and run `soyli skills update` in
existing projects. Modified guidance is preserved and reported as a conflict.
The bundled guide explains optional snapshots and links to the public media
contract. `SPEC.md` records the event contracts and collaboration over ordinary
Git, NIP-34 and GRASP; unrelated protocol questions remain open.

**0.27.0 — keyboard actions, upstream proposals and source compatibility:**

Published and deployed **2026-10-13 (Europe/Vienna)** from source
`97bcd01f662c5a1256779b55ed5cb776e954f79e`.
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.27.0),
[native CI 38390155381](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38390155381)
and [Nix CI 38389684968](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38389684968)
all passed. The four native jobs cover installer/updater regressions and fresh
account-free projects; Nix covers realization, forced rebuild and offline VM checks.
All 11 public assets, checksums, installer bytes and manifest/source match. An isolated
fresh install reports current through doctor/update; a real 0.26.1 → 0.27.0 update
preserves account/project markers. The published binary's preview passes keyboard
movement and ordinary text editing without browser errors.

Website release `20261013113411602-54987` is active. Local and VPS TypeScript and
634 source tests pass, plus Go race/relay, 18 Blossom, nine GRASP and three Linux
backend checks, and the production build. Public Puddlehop responds to ArrowUp/W
and P in detail and fullscreen views. Desktop and 390px browser checks pass gallery,
zap-dialog and sandboxed gameplay without overflow or page errors. The older smoke
check's exact heading selector was corrected to include the decorative period;
application code and timeouts were unchanged. No invoice or payment was created.

Public health reports the new release with a fresh, error-free index. Five PM2
services are online with zero restarts; Caddy/CVM/TURN are active. Source fingerprints
and the served installer match; shared proxy hashes are unchanged, the other site
returns HTTPS 200, and `20261013102615716-41516` remains available for rollback.

- The shared website and soyLI preview runtime supports NAP-KEYS registrations,
  default bindings and cleanup. Published games using this API work without a
  rebuild; restart existing previews after upgrading. Reserved/conflicting hints
  remain unbound, and rebinding UI is not implemented. See [runtime limits](PUBLIC-RUNTIME.md).
- Proposals use the upstream repository's GRASP-01 facility instead of creating a
  contributor repository. Signed retries verify the exact remote revision before
  recording an applied status; supported clone hosts remain usable when other
  advertised URLs are unsupported. See [collaboration](COLLABORATION.md).
- Source publication accepts ordinary Git metadata and verifies source symlinks
  while retaining exact archive bytes and credential/path checks. Existing
  author history is not silently rewritten.
- The website caches verified Nostr events in IndexedDB for faster repeat visits.
  Cached events remain subject to signature verification and normal relay refresh.

Upgrade with `soyli update`; restart previews to load the new runtime. Existing
projects can run `soyli skills update` to refresh managed guidance. This release
uses current main, including PRs #15–18; the presentation/SPEC changes in open
PR #14 are not included. No new companion event kind is introduced.

**0.26.1 published and deployed 2026-10-12 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.26.1),
source `d2154818b97cb127f9d0b6516fe479bf5feadb39`.
[Release CI 38220303369](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38220303369)
passed source checks, all four native package jobs and publication of all 11 assets.
[Nix CI 38220303324](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38220303324)
passed at the same source; the candidate also passed Nix CI before promotion.
All four public archives, aggregate checksums, installer bytes and tagged-source
manifest match. A fresh isolated macOS ARM64 installation reports 0.26.1 and
current through both `doctor` and `update`.

Published-artifact readers accept verified HTML up to **100 MiB** from every
publisher, including existing napplets. This covers website indexing/playback,
soyLI preview, remixing, proposal review and existing-artifact migration. New
soyLI builds/publications retain their **25 MiB** limit. Streaming, hash, UTF-8,
network and sandbox checks remain enforced; source and resource budgets are
unchanged. Downloads have more time, and the index rechecks entries rejected
under the former size policy after host rollout. No napplet republish is needed.

The matching website update tracks zap payments after the dialog closes and
resumes pending confirmations after reload. Verified local payments survive
reload and are deduplicated when a public receipt arrives. A provider check,
wallet proof or verified receipt is required; no receipt or payment is invented.
A missing historical invoice cannot be reconstructed by this change. Other
viewers still depend on a public receipt. See [community](COMMUNITY.md).

Upgrade with `soyli update` and restart previews for the larger CLI read budget.
The matching VPS deployment `20261012080150614-26110` is active. Local and VPS
TypeScript checks and 616 source tests pass, alongside Go race/relay, Blossom,
GRASP, production build and three Linux backend isolation/backup/authorization
checks. A 32 MiB fixture passes relay-to-index-to-browser playback; boundary tests
cover 100 MiB acceptance and rejection above it while publishing stays at 25 MiB.
The QR-wallet browser regression verifies confirmation, auto-close, reload
persistence and late-receipt deduplication. It passed unchanged in a fresh process
after a combined browser-suite run exceeded its 30-second test deadline.

Public site/docs, Blossom health and relay/GRASP NIP-11 metadata respond correctly.
The index is fresh and error-free with profile `html-104857600`; the public installer
matches the release. Fresh live desktop and 390px browser checks verify the zap
dialog and sandboxed game canvas without horizontal overflow or browser errors.
No real invoice or payment was created, and physical phones were not tested.
Caddy/CVM/TURN are active; all five PM2 services are online with zero restarts at
verification. Shared proxy checksums are unchanged, persistent state is retained,
and `20261009091435416-91120` remains available for rollback.

**0.26.0 published 2026-10-11 (Europe/Vienna); no host deployment:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.26.0),
source `a91afb159da16304a5f93e3616ae30e7db6cd074`.
[Release CI 38118210471](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38118210471)
passed TypeScript, 609 source tests (4,918 assertions across 137 files), four native
package jobs and publication of all 11 assets.
[Nix CI 38117977397](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38117977397)
passed realization, forced rebuild and offline NixOS VM checks at the same source.
All public archive and aggregate checksums, installer bytes and tagged-source
manifest match. An isolated public macOS ARM64 installation reports current through
`doctor` and `update`; a real 0.25.3 → 0.26.0 upgrade preserves account/project markers.

Includes [PR #9](https://github.com/zeSchlausKwab/napplet-soy/pull/9) with bounded
NIP-65 outbox delivery. `soyli publish` reads the creator's verified relay list and
copies the signed release to up to eight additional write relays. Primary success
is saved before optional delivery; the optional phase has an eight-second budget
and four concurrent destinations. Failed optional copies remain visible in status
without undoing a successful primary publication.

Attempted outbox destinations are retained for later unpublish/delete, including
partial and retired destinations. Cleanup inventories all retained publication
jobs and refuses silent truncation. `soyli migrate --resume` retries distribution
of its saved signed conversion without changing the napplet identity or signing
replacement events. Required-delivery cancellation retains an actionable cause.
See [relay delivery](PUBLISHING.md#your-outbox-relays-nip-65) and [lifecycle](LIFECYCLE.md).

Upgrade with `soyli update` and restart previews. Existing project relay settings,
frozen jobs and NIP-5D/NAP pins remain authoritative. No napplet migration or
republish is required. CLI changes are available through this release; the browser
cleanup improvements and website installer pin need a separate host deployment.
Unknown third-party copies cannot be recalled automatically. Forwarding the
creator's kind-10002 relay-list event itself is not part of this release.

**0.25.3 published 2026-10-09 (Europe/Vienna); no host deployment:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.25.3),
source `4fa807dd999b7b8eb5050a1e0dc173bd16403628`.
[Release CI 37920572316](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37920572316)
passed TypeScript, 596 source tests (4,762 assertions), four native packages and
publication of all 11 assets.
[Nix CI 37920564336](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37920564336)
passed realization, forced rebuild and offline NixOS VM checks. Public archive
checksums, aggregate checksums, installer bytes and tagged-source manifest match.
An isolated public macOS ARM64 installation reports current through `doctor` and
`update`; a real 0.25.2 → 0.25.3 upgrade preserves account/project markers.

Includes [PR #8](https://github.com/zeSchlausKwab/napplet-soy/pull/8) and its
HTML parser fixes. Builds and publication prepare deterministic BUD-10
`<link rel="related">` declarations for each external managed asset hash. Clients
can discover resources from verified HTML without running game code. Declarations
stay in the document head, preserve rendering mode and author metadata, and are
idempotent. Embedded assets and frozen publication retries retain their bytes.
See [coverage and limits](ASSETS.md#related-resource-links--soyli-0253).

Existing napplets remain playable. The NIP-5D/NAP-RESOURCE pins and runtime
permissions are unchanged. No website or service deployment is required for this
CLI release; offline saving and backup UI are separate work. The running website's
installer remains pinned to 0.25.2 until the next website deployment. Existing
installations can use `soyli update`; new installations can use the release's
`install.sh` directly. Restart previews after upgrading. `soyli skills update`
refreshes the asset guide in existing projects without rewriting their source.

**0.25.2 published and deployed 2026-10-09 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.25.2),
source `2b5d4f72dbd4b1b9c999babb6f786679de6e5ea0`.
[Release CI 37908614802](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37908614802)
passed all 590 source tests, four native package jobs and publication of 11 assets.
[Nix CI 37908611679](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37908611679)
passed dependency/package realization, force-rebuild and offline NixOS VM checks.
All public checksums and installer bytes match; the manifest identifies the tagged
source and all four native targets. A separate public installation reports 0.25.2
and current through both `doctor` and `update`.

Ordinary `soyli publish` updates the stable named listing. Use
`soyli publish --snapshot` when an additional independent immutable copy is wanted.
Pending jobs retain their frozen choice; older paired jobs keep their exact events
and resume behavior. No existing publication or Git history is rewritten.

The gallery groups historical snapshots when an exact signed pair or the author's
validated release descriptor points to a live newer listing. This grouping affects
presentation only; pinned links, independent identities and their social, storage,
backend and deletion boundaries remain intact. Named-only website confirmation
checks the exact current revision and verified artifact. Hosts need the matching
website/indexer update; a CLI release alone does not update a running host.

After upgrading with `soyli update`, restart previews and use `soyli skills update`
inside existing projects to refresh publishing guidance. No napplet migration,
republish or bulk deletion is required to group the previously reported cards.
Local verification passes TypeScript, 590 source tests (4,725 assertions), the
production build, captured signed-event replay, and eight real-service cases,
including publication/resume, collaboration, linked source, large assets,
production-browser pinned playback, historical grouping and deletion isolation.
Website release `20261009091435416-91120` is active with the existing
shared-Caddy, port 3040 and legacy-CPU profile. The unchanged target helper passes
all 590 source tests, relay race/process checks, 18 Blossom checks, eight GRASP
checks, production build and three Linux backend isolation/authorization/backup
checks before activation. A CPU-loaded Mac exceeded fixture deadlines during the
initial local attempt; clean native CI and target checks passed without changing
application timeouts or test assertions.

Fresh desktop/390px browsers show one card for the affected creator while retaining
the separate creator's same-title napplet, with no page errors or overflow. All
three reported old links return their exact signed snapshot and hash-verified HTML
(about 2 MiB each). Public health and index identify the new release with no stale
or failed destinations. The served installer matches; five PM2 processes are online
with zero restarts, and Caddy/CVM/TURN are active. Both shared proxy hashes are
unchanged, the other site returns HTTPS 200, and previous release
`20261007184250765-95782` remains available for rollback. Persistent state is retained.
This verification does not certify physical phones, a reboot or long-term uptime.

**0.25.1 published and deployed 2026-10-07 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.25.1),
source `fed5a41f0de19aa01afb0e329ca86401c3cb77cf`.
[Release workflow 37659569078](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37659569078)
passed source checks, all four native jobs and publication of all 11 assets.
[Nix workflow 37659563343](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37659563343)
passed dependency/package realization, force-rebuild and offline NixOS VM checks.

The browser lazily loads `nostr-wasm` 0.1.0 for libsecp256k1 signature verification,
with JavaScript retained until initialization succeeds and on initialization failure.
Shared event verification avoids a second cryptographic check at EventStore ingestion.
Both backends reject malformed wire fields before cryptographic verification or
cache reuse, including empty/truncated IDs and signatures. Direct CVM discovery and
WebRTC signaling use the same checks; manifest formats and napplet grants are unchanged.

The Nix dependency tree now normalizes timing-dependent Bun peer links and its
Playwright fallback before applying the refreshed fixed-output hash. Explicit
realize/rebuild/VM checks and a guarded hash-refresh command support maintenance;
the updater works with macOS Bash 3.2 and BSD sed. Ordinary installations keep the
existing installer and `soyli update` workflow. See [Nix packaging](NIX.md).

PR #7 passed all four native jobs and native Nix/VM checks at `e28d0a3`. Local
TypeScript, 578 source tests (4,676 assertions), production build and desktop/390px
browser checks pass. Browser checks confirm the WASM chunk initializes without
fallback warnings, page errors or horizontal overflow. All public archive checksums,
installer and manifest match the tagged source; a separate installation reports
0.25.1/current through both `doctor` and `update`.

Website release `20261007184250765-95782` is live using the existing shared-Caddy,
port 3040 and legacy-CPU profile. The standard deployment passed all 578 source
tests on VPS Bun 1.3.8, Go relay race/process checks, Blossom/GRASP integration,
production build and three Linux backend isolation/authorization/backup tests.
Fresh public desktop/390px sessions confirm WASM initialization, root, napplet and
docs pages without errors or overflow. The installer bytes match; the index is
fresh and error-free, all five PM2 processes are online, and Caddy/CVM/TURN are active.
Both shared proxy hashes are unchanged; the unrelated site returns HTTPS 200.
Persistent state was retained and the prior website release remains for rollback.
This verification does not certify a reboot, physical phones or long-term uptime.

**0.25.0 published 2026-10-07 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.25.0),
source `3bc111c723848edc86e90c4a23240f79f80e246c`.
[Workflow 37582594436](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37582594436)
passed TypeScript, 565 source tests and all four native build, installer/updater,
regression and fresh-project browser jobs before publishing all 11 assets.
[Nix workflow 37582591723](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37582591723)
passed the fresh dependency build, package and offline NixOS VM at the same commit.

Public installer, manifest and macOS ARM64 archive checksums match. The installer
is identical to the tagged source; the manifest identifies that source and all
four native targets. An isolated public installation reports 0.25.0/current from
both `doctor` and `update`. At publication the website's installer was still
0.24.2; the later 0.25.1 deployment is recorded above.

Creators can publish from their existing NIP-34 repository, selected explicitly
or discovered from an owned `nostr://` Git remote. soyLI verifies the release
commit against signed repository state and a serving clone URL without signing
repository state or pushing a duplicate. Proposals, source links and deletion
respect that repository; deleting a napplet keeps the creator's own repository.
See [publishing from your own repository](PUBLISHING.md#publishing-from-your-own-nip-34-repository).
Remote dynamic-backend builds still require soyLI-managed GRASP source; selecting
an existing repository reports `BACKEND_SOURCE_LINKED` before contacting a provider.

Optional Linux Nix/NixOS packaging supplies the pinned project toolchain and
Playwright browsers from the store. Compatible Chromium/FFmpeg are reused without
installer writes; mismatches report `CONFORMANCE_BROWSER` with recovery steps.
Nix-managed installations update through Nix. Ordinary macOS/Linux archives
retain their installer and `soyli update` workflow. See [Nix packaging](NIX.md).

Native CI covers the packaged conformance path, and the offline NixOS VM exercises
the actual upstream conformance command, toolchain, keyring and browser recovery.
Metadata-worker and manager browser tests now synchronize on completed operations.
The Nix dependency build repairs a verified Bun peer-bin-link race while retaining
the locked dependency checksum. No dependency or protocol pin changes accompany
this release. Website deployment is separate from publication.

**0.24.2 published and deployed 2026-10-06 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.24.2),
source `8f809650b2fe4d1fd4f6bf045159d28868a893ae`.
[Workflow 37454517650](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37454517650)
passed the source gate, all four native jobs and publication of all 11 assets.

Fresh projects and remix discovery use seven public relay defaults, including
five additional relays that supplied the affected creator's verified name and
avatar during anonymous checks. Failing older defaults have been replaced.
Existing project destinations, saved browser networks and operator overrides
remain authoritative; no signer or ContextVM relay settings change.
See [relay defaults](RELAY-DEFAULTS.md) for the current set and dated evidence.

The shared server retains up to eight configured profile/social destinations.
A failed relay handshake can no longer terminate the web process when Bun emits
a queued timeout after the request error. Original failures and handshake
deadlines remain intact. NIP-22 comment readers accept additional mentioned
people while still requiring the actual parent author and correct thread.
These server changes require a website deployment in addition to the CLI release.

After updating soyLI, restart previews. Existing projects can edit their Extra
relay copies in the local manager; saved publication jobs retain their original
destinations. Website users with custom networks can choose **Use site defaults**
after deployment. No republish or napplet migration is needed for profile display.

Local verification passes TypeScript, 552 source tests (4,518 assertions), the
production build and six profile/proposal/source browser tests (28 assertions).
Release checksums and an isolated public installation pass; `doctor` reports
0.24.2 as up to date, and a clean account-free project receives the new relay list.

Website release `20261006111729495-77355` is active. The standard deployment
passed all 552 source tests on VPS Bun 1.3.8, including the handshake regressions,
Go race checks, relay/Blossom/GRASP integration, production build and three Linux
backend isolation/backup/authorization tests. Fresh public desktop and 390px
browser sessions show the affected creator's name/avatar in both detail and
account header using the actual site defaults, with no page errors or overflow.
Root/docs, installer bytes, public services and index health pass. Shared proxy
checksums are unchanged; the other site returns 200. Persistent state was retained.

**0.24.1 published 2026-10-05 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.24.1),
source `2a8733af7fe14f6179a6d034db56ece351ac9f2e`.
[Workflow 37292441710](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37292441710)
passed the source gate, all four native jobs and release publication.

A migration preview now creates its private plan parent when no account has ever
been configured. Previously that fresh-install case failed with `ENOENT` before
planning. The correction generates no key, selects no identity and signs/posts
nothing; original-author selection and confirmation remain required for publication.
The real entrypoint regression was red before the correction and passes afterward,
including the compiled macOS ARM64 binary (31 assertions). TypeScript and all 545
source tests pass (4,425 assertions). A checksum-verified public installation reports
0.24.1 as current through `doctor`. With a fresh account directory, it verifies the
actual public napplet's 1,063,318-byte HTML and prepares its conversion without
account setup or signing. All other 0.24.0 migration/compatibility behavior remains.

The 0.24.1 website was activated in deployment `20261005095909023-57511`. Its installer and
all four manual downloads point to 0.24.1. Fresh live desktop/mobile checks pass:
gallery tools follow social rankings, both chronology options are present, the
affected updated napplet shows its existing 10,000 sats, and no page errors or
390px layout overflow occur. Web and persistent index health identify the same
release. Application, relay, Blossom, GRASP and Linux backend sandbox gates passed
before activation; persistent service/index data was retained.

**0.24.0 published 2026-10-05 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.24.0),
source `a85da7dbd3f46f284dd163ba32628e84ddc90996`.
[Workflow 37289773986](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37289773986)
passed the source gate, all four native build/installer/updater/fresh-project jobs
and verified release publication.

Fresh publication uses the standalone NIP-5D manifest at `4d0fb2e`; existing
publications remain supported by the legacy reader. Required/optional domains,
icons, archetypes and intent discovery metadata are available in project metadata
and the manager. The pinned runtime/SDK/plugin remain unchanged. Optional Soy
source and presentation metadata never become playback requirements.

`soyli migrate <napplet-link> --dry-run --json` verifies exact published HTML and
previews an explicit metadata-only conversion. Original-author confirmation is
required; retries reuse a saved signature outside Git. No rebuild, asset upload
or history rewrite occurs. Named/root identity is retained; immutable snapshots
remain unchanged. See [the creator guide](NIP5D-CREATOR.md).

Safe current-tree source aliases such as `CLAUDE.md → AGENTS.md` now retain their
Git links while source archives materialize exact committed contents. Unsafe
links/private files remain blocked. Source limits remain 1,024 files/40 MiB and
50 MiB archives; playable HTML remains 25 MiB.

The compatible website reader was deployed before publishing this CLI. Addressed
likes, comments and verified zaps survive pruned historical revisions. The gallery
separates Newest from Recently updated and places filters below social rankings.
NIP-46 browser connection labels distinguish browser, device format and public
session suffix. Existing projects can run `soyli skills update`; a normal fresh
publication upgrades their manifest, while frozen legacy jobs preserve their
original resume contract. Independent clients need their own new-format reader.

Local verification: TypeScript plus 545 source tests (4,421 assertions), real
relay/Blossom/indexer/production-browser compatibility, compiled CLI migration and
source alias checks (13 tests, 147 assertions), and live desktop/mobile checks.
The affected updated napplet again displays its verified 10,000-sat total. No
public test reaction, comment, invoice request or payment was created.

**0.23.7 published 2026-10-03 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.7),
source `0456c03850570d2c8b8cd9ef41130639624c969d`.
Fixes [issue #3](https://github.com/zeSchlausKwab/napplet-soy/issues/3).
Publication, saved-job resume, remix, source browsing and the local workshop now
share a 1,024-file source budget. The limit bounds local scanning and archive work;
it is not a Nostr limit or a creator quota. `publish.files` remains additive and
errors now explain the actual selection. Source and archive byte budgets remain
40 MiB and 50 MiB, respectively.

Safe internal file aliases such as `CLAUDE.md → AGENTS.md` may remain in older
commits after replacement with regular files in the current tree. Each alias is
validated against its own committed tree. Unsafe links and credentials remain
blocked; no history is rewritten. Current-link and historical-link errors identify
the cause and recovery steps.

Playable HTML now permits 25 MiB across authoring, preview, publication, remix,
indexing and playback. Individual managed assets and runtime resources retain
their separate 10 MiB limits. Use `soyli update` and restart previews; optionally
run `soyli skills update` to refresh existing project guidance. No project migration
or history cleanup is needed for the reported safe historical alias.

The public website/indexer/runtime must also be deployed to admit playable files
above 10 MiB and browse archives above its old 128-file limit. The CLI release does
not update a running host. Blossom already accepts these sizes; no Blossom quota
change is required. Website deployment is pending.

Local verification passes TypeScript and all 450 source tests (3,554 assertions).
The native macOS ARM64 package passes five real-entrypoint tests (103 assertions),
including 1,024/1,025 boundaries and a 12 MiB built artifact. Real local services
verify large-source publication/resume/remix with historical aliases; the production
website indexes and plays a 12 MiB napplet in Chromium and survives an indexer
restart. Exact 25 MiB admission, over-limit rejection, hash/UTF-8 checks and the
unchanged resource cap have regression coverage.

[Workflow 37133743916](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37133743916)
passed the source gate and all four native build, installer/updater, sandbox and
fresh-project checks. The first Intel macOS attempt reported Git unavailable in
an existing onboarding test; retrying that job passed with the same source and
checks. The original probe suppresses its process output, so its precise transient
failure remains unconfirmed.

All 11 release assets are public. Installer and manifest checksums, source revision
and native matrix were verified. An isolated public macOS ARM64 installation reports
0.23.7/current and passes the real CLI source-limit, 12 MiB artifact and historical
alias regression (24 assertions). The user's installation and accounts were
unchanged. No website deployment was performed.

**0.23.6 published 2026-10-03 (Europe/Vienna):**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.6),
source `f71162f9e869c98d3bb2791245c27aa95f928e50`.
[Workflow 37072285190](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37072285190)
passed the source gate and all four native build, installer/updater, sandbox and
fresh-project checks. All 11 release assets are public. Installer and manifest
checksums, source revision and native matrix were verified. An isolated public
macOS ARM64 installation reports 0.23.6/current and passes the real CLI data-pack
import/sync regression (23 assertions). The user's installation and accounts were
unchanged; no website or Blossom deployment was needed or performed.

Managed assets now accept binary data packs (including custom extensions such as
`.ssrcpack`), JSON and plain text. The earlier media-only importer rejected these
before contacting Blossom; the server and hash-addressed resource host already
support them. Generated `assetBlob()` reads both embedded and external data inside
the sandbox without direct fetch. Media keeps the existing `assetUrl()` helper.

The CLI, local workshop and bundled authoring guidance use the same workflow.
Exact earlier media helpers remain valid when resuming or remixing old publications;
frozen source and Git history are not rewritten. Regenerate helpers explicitly to
use the new Blob API.
Imports remain byte-for-byte, hash-verified and source-scanned, with the existing
10 MiB/file and 32 MiB managed limits. Active-document policy is unchanged; importing
a pack does not certify its decoder or contents. No Blossom or website deployment
is required for these authoring changes. See [data assets](ASSETS.md#data-packs-maps-and-other-non-media-assets).

After installing this release, run `soyli skills update` and `soyli assets sync`
inside existing projects, then rebuild, test and publish. Import with
`soyli assets add ./game.ssrcpack game-pack --storage external --license <license>`.
`assets add` and `assets sync` are local operations; publication/proposals perform
the uploads using the configured creator and destination.

Local verification includes the real CLI entrypoint, sandbox reads of media and
binary/JSON/text, publisher interruption and corruption repair, and a fresh Git
remix. TypeScript and all 436 source tests pass, along with legacy publication
resume and Git/archive remix regressions. A native macOS ARM64 package builds embedded/external data in the upstream
Vite template and reads the exact bytes after a fresh checkout. Native CI requires
the CLI, sandbox and Vite regressions on all four release platforms.

The unpublished 0.23.5 candidate passed source checks and the Linux ARM64 job,
but combining the new asset-browser suite with backend initialization in one Bun
process reproduced a macOS SIGKILL; Linux x64's later signing test also timed out.
Browser/bundler suites now run in separate processes, retaining every assertion
and the shared browser cache. No published artifacts or previous tags were replaced.

**0.23.4 published 2026-09-26:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.4),
source `923e89e3074463484bde98e8b496b5433799dffd`.
[Workflow 36221163275](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36221163275)
passed the source gate and all four native build, installer/updater, delayed-signing
browser and fresh-project checks. All 11 release assets are public. Installer and
manifest checksums, source revision and native matrix were verified; an isolated
public macOS ARM64 installation reports 0.23.4/current. The user's installation
and accounts were unchanged.

The shared shell and local preview validate backend account sessions when signing
completes, so normal extension or
remote-signer approval delays no longer produce `Invalid request`. Invalid provider
challenges/session responses now identify the failing step.

The supplied backend client allows up to two minutes for account-bound calls,
including consent and signing. Provider RPC deadlines, sandbox limits and intent
expiry are unchanged. Native CI includes a real browser regression with a 16-second
extension approval and an idempotent world-creation retry.

The unpublished 0.23.3 candidate passed source checks but its native browser test
looked in Playwright's default cache after the packaged CLI installed Chromium in
its own cache. Release CI now shares an explicit browser cache between both
processes; the regression remains required on all four platforms.

Run `soyli update`, restart previews, and run `soyli skills update`
inside existing projects. Review any preserved helper conflicts, then rebuild and
republish to update copied client code. Hosts must also deploy the shared-host
fix; installing soyLI alone does not update their public player. Existing uncertain
requests retain their original IDs and expiry to avoid duplicate worlds.

napplet.soy deployed the fix in website release `20260926054112843-53639` on
2026-09-26. Live authenticated read-only browser checks pass with both 2.5-second
and 16-second extension signing delays. The latter explicitly uses the updated
approval timeout; previously published napplets still need their copied helper
rebuilt and republished. See [deployment verification](DEPLOYMENT.md).

**0.23.2 published 2026-09-25:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.2),
source `8e4e3557a7528ae7d15f20ac57c263b95e8d9f8f`.
[Workflow 36185275161](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36185275161)
passed the source gate and all four native build, installer/updater, packaged
diagnostic and fresh-project backend preview checks. All 11 release assets are
public. Public installer/manifest checksums and source revision were verified.
An isolated public macOS ARM64 installation reports 0.23.2/current; the affected
project passes dry-run with its historical public context preserved. The user's
installation, project files, website and CVM deployment were unchanged.

This patch fixes publication of projects whose old Git
history contains the former public `.napplet-space/soy-backend.json` context,
removed from the current tree. Only that exact path and bounded, strictly validated
public format are accepted; private bindings, journals, databases and credentials
remain blocked. No Git history is rewritten. See
[Historical source checks](CLI.md#historical-source-checks) for the compatibility
rule and recovery procedure.

`publish --dry-run` now checks reachable Git history. Publication and proposal
preflight reject unsafe history before backend/build preparation; errors identify
the path, blob and containing commit with useful recovery advice. Every historical
path is checked, including private aliases of otherwise permitted blobs. Native CI
also exercises these diagnostics through each packaged CLI's real entrypoint.

Upgrade with `soyli update`, then retry `soyli publish --dry-run`. Existing projects
whose historical context meets the rule need no history cleanup. Optional
`soyli skills update` refreshes the bundled backend guidance; skills alone cannot
fix an older executable's validator. Website and CVM deployment are not required.

**0.23.1 published 2026-09-25:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.1),
source `f4df0c76381d75a2ae992e3873e13f1eda5b4a62`.
[Workflow 36174075409](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36174075409)
passed the source gate and all four native build, installer/updater and fresh-project
backend preview checks. All 11 release assets are public. Installer and manifest
checksums and source revision were verified; a separate macOS ARM64 installation
reports 0.23.1 and doctor reports current. An account-free generated project has
the corrected skills and handler types with one clean initial commit. Local
verification also passed 418 source tests and six browser preview/capture/identity
regressions. The user's installation and website/provider deployment were unchanged.

This patch fixes dynamic-backend authoring and verification discovered
in an independently built multiplayer project. Frozen checks, screenshots, clips
and multiplayer previews include declared backend manifests, handlers and schemas;
missing source reports its path before browser startup. Backend configuration is
portable in `napplet.json`, while generated context and identity bindings stay local.
Fresh setup/build/dev/run regenerates the ignored context.

Multiplayer scenarios gain disposable signed-in viewers and scoped account-consent
helpers. `soyli browser path --json` exposes managed executable paths. Typed handler
context and corrected scaffold/skill guidance preserve existing projects and
clarify ownership, verification and responsive shared editing. Native CI now tests
configured modules through frozen preview paths in addition to compilation.
This patch does not add streams, a new transport or game performance changes.

After updating, restart previews and run `soyli skills update`, reviewing preserved
local edits. Run `soyli backend init` to migrate older locally stored backend
declarations into `napplet.json`, then commit the portable config and module source.
Keep `.napplet-space` ignored. See [backend authoring](DYNAMIC-BACKENDS-CREATOR.md).

**0.23.0 published 2026-09-25:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.23.0),
source `f139962e6173c08c30d880d3385ead44f1717553`.
[Workflow 36159756534](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36159756534)
passed the source gate and all four native build, installer/updater, fresh-project
browser and backend compiler checks. All 11 release assets are public. The published
manifest identifies the tagged commit; the downloaded macOS ARM64 archive checksum
was verified and its executable reports 0.23.0.

Creator-defined persistent backends through
`soy.backends.v1`, with provider-built source receipts, schemas, release pinning,
scoped account proofs and transactional state. soyLI adds module authoring/check/
deployment commands, local durable preview, the `soy-backends` skill, a portable
guide and frontend helper. Existing projects can run `soyli skills update` after
upgrading. Hosts must enable isolated execution and grant creator deployment access.
The shell adds administrator-managed deployment grants and an accessible tabbed
administration workspace. See [dynamic backends](DYNAMIC-BACKENDS.md).
Native release checks now compile a backend module on every supported platform.
Production activation and live verification are recorded in [dynamic backends](DYNAMIC-BACKENDS.md).

**0.22.0 published 2026-09-24:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.22.0),
source `6132e5504b68e4534dc93585c227a85172b03796`.
[Workflow 35993373395](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/35993373395)
passed the source gate and all four native build, installer/updater and fresh-project
browser checks. All 11 release assets are public. Public installer bytes match
the tagged source, and installer/manifest checksums and source revision were verified.
An isolated macOS ARM64 install reports 0.22.0; `doctor` and `update` report current.
Its account-free starter contains the visual guide and adapted skills in both agent
directories, keeps host matching disabled, and has one clean initial Git commit.
The user's installed CLI was not changed. Website deployment was not performed.

Version 0.22.0 gives new napplets independent visual direction. The starter keeps
its own palette by default instead of automatically adopting the host's colors;
host matching remains an explicit opt-in. The shipped skills and authoring docs
guide creators through a project-specific look for both the game/content and its
UI/HUD, replacing uniform compact-density and whole-surface theming mandates.
See [Visual design](VISUAL-DESIGN.md) for the design brief and theme policies.

After upgrading, run `soyli skills update` inside existing projects and review
preserved-file conflicts. This updates guidance, not source, settings or published
artwork. Existing creations need an intentional theme-handler/style update and
fresh captures before republishing. Upstream pins, licenses and host protocol
behavior remain unchanged. No website deployment is required to update the CLI.

**0.21.0 published 2026-09-24:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.21.0),
source `382fa2f671b5fd9d99bf7812ce8de876a1836e89`.
[Workflow 35976986196](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/35976986196)
passed the source gate, all four native builds, packaged installer/updater tests
and fresh-project browser checks. All 11 release assets are public. The public
installer matches the tagged source; installer/manifest checksums and source
revision were verified. An isolated macOS ARM64 installation reports 0.21.0, with
`doctor` and `update` reporting current. Account-free creation produces one clean
initial commit containing the lockfile and guidance, with neutral attribution.
The user's installed CLI was not changed. Website deployment was not performed.

Version 0.21.0 automatically saves new projects' complete scaffold, lockfile and
agent guidance in a local Git commit before identity or dependency setup. Neutral
soyLI attribution needs no configured Git identity or signing-key access. Existing
projects are not automatically committed, and Git-backed remixes preserve their
original history. Initial staging/commit failures keep the generated files and
surface the Git cause with recovery instructions. Agent guidance encourages
coherent checkpoints before pausing or handing back work.

The shared local preview also gains light/dark/automatic appearance and NAP-THEME
updates. Accompanying website source adds the same appearance controls, Nostr
share-note composition, featured-clip autoplay and faster gallery navigation.
Website deployment is separate from this CLI release. Existing projects can run
`soyli skills update` after upgrading; review any preserved-file conflicts.

**0.20.0 published 2026-09-23:**
[GitHub release](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.20.0),
source `0f3adcb3910460efe620d9ff9b419bb5555192cd`.
[Workflow 35878743238](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/35878743238)
passed its source gate and all four native builds, installer/updater regressions,
shared-data helper checks and fresh-project browser smoke tests. All 11 release
assets are uploaded; the manifest identifies the exact source and four native
targets. The published installer matches the tagged source and checksums. An
isolated macOS ARM64 installation reports 0.20.0; both `doctor` and `update` report
it as current. Website and CVM deployment were not performed with this release.

Version 0.20.0 adds public structured creations using the documented NIP-78
convention, with scoped viewer-authorized writes, ownership/revision checks,
unpublish tombstones and managed helper/guidance files. See
[SHARED-DATA.md](SHARED-DATA.md) for public relay compatibility and retention limits.
It also adds `soy.boards.v2` score attachments, JSON schema validation and per-entry
reads. The local preview runs the same service as the deployed CVM provider.
Publishing failures retain useful causes; CLI validation catches older providers.

The accompanying website source fixes zap invoice compatibility, confirms payments,
closes successful dialogs and updates counts without double-counting later receipts.
Website and CVM deployment remain separate from this CLI release. Existing projects
should restart previews and run `soyli skills update`, reviewing any local conflicts.
CI verifies the delivered app-data helpers on each native release platform.

Version 0.19.0 adds Rust/WASM build recipes and verified Bevy 2D/3D examples in
the existing single-HTML sandbox. See [WASM.md](WASM.md) for supported targets,
prerequisites and limits. Bunker connections now accept up to eight relay hints;
an unresponsive relay no longer delays a request already acknowledged elsewhere.

New NIP-46 sessions use owner-only files outside Git by default. Local private
keys remain in the OS vault. Existing remote sessions retain their storage until
`soyli account storage file` migrates them without re-pairing; use
`--session-storage keychain` to opt new sessions into native storage instead.

Publication follows your selected account. A running operation keeps its starting
account without resetting the shared selection, and each public key retains its
own releases and pending jobs in the same folder. Backend and local-manager
context follow that author. Switching signing methods for the same public key
keeps its listing; switching public keys creates a separate listing and repository.
The bundled agent guidance forbids switching accounts to bypass a publish error.

After updating, restart previews and run `soyli skills update` in existing projects,
reviewing conflicts with locally edited guidance. New account metadata and
multi-author journals are not readable by older CLI versions; use 0.19.0
consistently after migration. Original keys, sessions, source and releases are kept.

Version 0.18.2 fixes preview cleanup on terminal hangup and launcher exit, corrects
the bundled action guide's retired bootstrap instructions, and clarifies agent
preview ownership, mobile checks and reference-harness limitations. Release CI now
checks packaged preview cleanup and runs the assembled starter's complete `verify`
command. After updating, restart previews and run `soyli skills update` in existing
projects; review any reported conflicts without discarding your local edits.

For website deployment, use `bun run deploy` with the usual options, without the
old `bun run cli:release --host … &&` prefix. The optional legacy `cli:release`
uploads four locally built archives to a VPS mirror; it neither triggers GitHub CI
nor downloads CI artifacts. Missing local archives do not block website deployment.

The 0.18.1 installer resolves macOS CPU probes by their system path, including in
minimal environments without `/usr/sbin` on PATH. A failed probe reports the
system error separately from an unsupported processor. Packaged creation and
recording test failures include the CLI diagnostic, and artifact actions use
Node 24. The failed `soyli-v0.18.0` tag is retained; fixes use a new version.
Chromium/FFmpeg installation uses soyLI's checksum-verified managed Node runtime
instead of Bun's Node compatibility layer, which stalled downloads intermittently
on native CI. No separately installed Node is required. Browser availability and
playback still use the same pinned Playwright driver and browser cache.

## For creators

```sh
soyli doctor          # local prerequisites plus latest stable version
soyli update          # download, verify and switch the managed installation
soyli --version
# Restart running preview sessions, then inside an existing project:
soyli skills update
```

An older CLI needs the new installer once, after the first GitHub release exists:

```sh
curl -fsSL https://github.com/zeSchlausKwab/napplet-soy/releases/latest/download/install.sh | sh
```

The same script accepts `new my-napplet` or `remix <link> my-remix`. Inspect it before
executing it if preferred. `https://napplet.soy/install.sh` remains a version-pinned
copy which changes on website deployment; the GitHub URL follows the latest release.

Updates only use stable `soyli-vX.Y.Z` releases from
[zeSchlausKwab/napplet-soy](https://github.com/zeSchlausKwab/napplet-soy/releases).
Prereleases, incomplete platform assets and downgrades are refused. Doctor checks
GitHub with a five-second deadline; no release, offline, malformed or rate-limited
responses are reported as unavailable alongside the working local diagnostics.
`--json` returns the structured release status and sanitized failure context.
There is no background updater, account requirement or credential-store access.

The updater executes the installer already bundled in the installed CLI. Downloads
use HTTPS, SHA-256 verification and an executable-version check before the command
symlink is switched. The whole distribution, including Playwright support files,
is updated together. A failed download/check keeps the working command. Old release
directories, accounts, recovery keys, caches, source and unfinished work are retained.
Checksums detect corrupt downloads; they do not provide an independent publisher
signature. Distribution trust is the GitHub repository/release and HTTPS.

Installer-managed custom paths are remembered. A source checkout should be updated
with Git; manually unpacked distributions must be replaced as a whole or migrated
through the installer. Unrelated commands are never overwritten. The legacy
`napplet-space` alias follows the upgrade only if it belongs to the same installation.
Updates take an installation lock; after an interrupted/killed installer, confirm no
installer is running before removing the reported `.install-lock` directory.

## Cut a release

1. Update `apps/cli/distribution/version.json` and the `version=` line in
   `apps/web/public/install.sh` together. Update relevant feature/release notes.
   If dependencies or pins changed, refresh the Nix hashes too
   ([maintaining the package](NIX.md#maintaining-the-package)).
2. Commit the change and push the commit, then its matching tag:

   ```sh
   git tag -a soyli-v0.23.4 -m 'napplet soyLI 0.23.4'
   git push origin main
   git push origin soyli-v0.23.4
   ```

3. Watch **soyLI releases** in Actions. Publish only after all four native jobs pass.
   The workflow handles publication; no manual asset upload or VPS login is required.
4. Try the published installer and `soyli doctor` on a separate installation. Deploy
   the website separately when its pinned installer/docs should change.

[Workflow](../.github/workflows/soyli-release.yml) triggers on matching tags,
relevant pull requests and manual runs. PRs and manual branch runs only validate;
a manual run on a matching tag may publish/retry that tag. A different tag or
installer version fails before publication. No website deployment is triggered.

The read-only check job typechecks and runs repository tests. A matrix uses native
macOS ARM64/Intel and Ubuntu ARM64/x64 runners with pinned Bun 1.3.11. Each builds
one archive, exercises the real installer/updater, and runs account-free scaffold,
build and browser checks with fresh caches and no global Node/Bun on PATH.
Linux x64 keeps the SSE4.2 baseline runtime. CI does not certify older physical
Macs, mobile gameplay or interactive OS credential-store authorization.

Only the final job has `contents: write`, using the job's automatic `GITHUB_TOKEN`.
No custom token or server secret is needed. Actions are pinned to commit hashes;
checkout does not persist its token. The selected standard runner labels follow
[GitHub's runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

The publisher verifies all four checksums before creating a draft. It uploads:

- Four `soyli-<platform>.tar.gz` archives and their `.sha256` files.
- `install.sh`, pinned to that release.
- `release-manifest.json` with source commit and native smoke-test matrix.
- `SHA256SUMS` covering archives, installer and manifest.

Only after the uploads succeed does it publish the draft and mark it latest.
A failed upload leaves a draft that the updater cannot discover; rerunning can
replace draft assets. Published versions cannot be overwritten by this workflow;
corrections need a new version. Release jobs are serialized and refuse to replace
a newer stable version with an older one. Protect release tags and repository write
access as appropriate for the maintainers.

## Local checks and alternate hosting

```sh
bun run check
bun run cli:build --target darwin-arm64
SPACE_TEST_CLI="$PWD/.local/cli/0.23.4/soyli-darwin-arm64/soyli" \
  bun test tests/services/cli-update.test.ts tests/services/cli-distribution.test.ts
```

Choose the matching native target on Linux/Intel. Full build and legacy VPS upload
instructions remain in [CLI.md](CLI.md#building-and-releasing). Existing immutable
VPS download URLs remain valid. An explicitly configured `NAPPLET_DOWNLOAD_BASE`
uses `<base>/<version>/<archive>`; it does not silently fall back to another host.
`NAPPLET_RELEASE_VERSION` pins the bundled installer for the updater; it is not a
CLI downgrade option. `SOYLI_RELEASE_API` is a loopback-only test hook, not an
alternate production update channel.
