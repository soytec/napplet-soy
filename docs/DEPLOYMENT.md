# VPS deployment with Caddy and PM2

Deployment is operator-run. Routine changes are verified and committed locally;
do not deploy or upload releases unless the user explicitly requests deployment.

Updated 2026-10-24. **[napplet.soy](https://napplet.soy) is live**, using the temporary legacy CPU profile on the existing Namecheap VPS. Caddy issued valid Let's Encrypt certificates for the website, www, Blossom and Git; the other site remains available. The deploy script includes Caddy and PM2. Local production builds exercise the same web, relay, Blossom and GRASP implementations and PM2 definitions. Dedicated hosts use the pinned local Caddy version; shared hosts retain their existing Caddy. See the deployment record below for verification and the compatibility workaround.

### Most recent application deployment — Update publishing, 2026-10-24

Website release **`20261024054808804-1`** runs source
`408ee86d3e7d858961e8d1a48e83984be64e126f`. [PR #41](https://github.com/soytec/napplet-soy/pull/41)
merged as `2928f3e`; the follow-up isolates an ordinary test from browser installation.
Existing and merged publications now open as **Publish update** with their prior
metadata and media. Creators can retain reviewed covers/clips, edit metadata or
re-record. Capture uses a fixed viewport instead of waiting for iframe stability;
errors preserve their browser cause. No user napplet was republished during rollout.

[soyLI 0.31.3](https://github.com/soytec/napplet-soy/releases/tag/soyli-v0.31.3)
was published and verified before activation. Its optional reviewed-media field
binds unchanged clip bytes to the updated executable, preserving the original
recorded-build hash. Four native release builds, Nix package/VM checks and Studio
integration CI passed. See the [CLI release evidence](CLI-RELEASES.md).
The [test-only follow-up](https://github.com/soytec/napplet-soy/actions/runs/40067658768)
also passed Studio CI. On the VPS, all 908 application tests, 5 relay, 18 Blossom,
9 GRASP and 3 backend isolation checks passed, followed by the production build.

The additive worker image is
`sha256:6000d26beb55030bffb7f70fdfcbc265b13e04ae46187f06e698348974250eed`.
It preserves both installed dependency profiles and the legacy CPU runtime.
Disposable copies of the affected merged Funclet draft passed both retained-media
and fresh-screenshot checks; changed clip bytes were rejected. Scripted server and
browser-build repair, desktop/portrait capture, timeout/crash recovery, cancellation
and subsequent job reuse passed without paid inference or public events.

An initial candidate stopped before activation because a new ordinary test attempted
to download Chromium on the controller. The correction verifies saved media bytes in
that test; real browser startup and stale-media regressions remain in the browser
integration suite. The empty-browser-cache VPS regression passed in 2.4 seconds.
No runtime timeout was relaxed, and the published CLI runtime is unchanged.

Public HTTPS routes and the completed catalog scan identify the new release. The
served installer matches the verified 0.31.3 release asset. External relay query
timeouts remain visible; they did not prevent completion through healthy relays.

Deployed source hashes match. All five application processes have zero restarts;
Studio, CVM, TURN and Caddy are active. All 11 existing draft records and Git
workspaces are preserved. Unrelated private configuration and Studio egress policy
are unchanged. No active creator jobs were present at activation.

Rollback retains application release `20261023204030207-1`, worker image
`sha256:1c61376651dfdb8dd0eeffe4ae7ffc501ca83a214d7722b38418a7d2cb633128`
and a protected copy of the previous Studio configuration. Local evidence is in
`.local/update-publication/` and `.local/release-0.31.3/`.

### Previous application deployment — Proposal reviews, 2026-10-23

Verified website release: **`20261023204030207-1`**, application source
`9618fbf7664a99728eda6c2de68e07d7ea99a7fd`. [PR #40](https://github.com/soytec/napplet-soy/pull/40)
merged as `978f7c6`; `9618fbf` corrects the operator-image test's expectations on
the legacy runtime without relaxing its pinned compiler requirement.

Proposal cards now show the contributor, and private Studio merge reviews show
their purpose, author and source proposal. The hosted worker accepts exact,
operator-installed dependency profiles. The deployed additive image is
`sha256:1c61376651dfdb8dd0eeffe4ae7ffc501ca83a214d7722b38418a7d2cb633128`.
It retains the starter profile and adds Funclet's reviewed lockfile, including
`three@0.177.0` and `@types/three@0.177.0`. Creator jobs still cannot install packages.

[Nix package/VM checks](https://github.com/soytec/napplet-soy/actions/runs/40018419961),
[four native builds and installer/updater regressions](https://github.com/soytec/napplet-soy/actions/runs/40018419985),
and [Studio integration checks](https://github.com/soytec/napplet-soy/actions/runs/40018419864)
passed before merge. The test-only follow-up also passed Studio CI. On the VPS,
all 902 application tests, 5 relay, 18 Blossom, 9 GRASP and 3 backend isolation
checks passed, followed by the production build and activation checks. An earlier
candidate stopped before activation because its test expected the Bun 1.3.11-only
operator tool to run under Bun 1.3.8; the corrected test verifies that refusal.

The actual Funclet merge candidate passed isolated setup, 24 guidance/application
tests, typecheck, build and sandbox checks against the new image. Conformance
reported 5 passed, 0 failed and 5 skipped; the skipped manifest, wire and lifecycle
checks remain unverified. The contributor proposal itself was not merged or published.

Public HTTPS and the completed catalog scan identify the new release. The live
Funclet listing shows **Proposed by hzrd149**. Studio, CVM, TURN, Caddy and all five
application processes are healthy; deployed source hashes match. All eight
pre-existing draft records and Git workspaces are unchanged, with one additional
draft present after rollout. Unrelated private configuration and Studio egress
policy are preserved. The installer remains **soyLI 0.31.2**.

The previous release `20261023152532295-30964`, worker image
`sha256:78a1530841e748abf8229ccad04a6077e8c9e24dbeb8c0887138e4d00a730eb8`
and protected configuration backup are retained for rollback. Local evidence is in
`.local/proposal-deploy/`. Older failed reviews need a **fresh Review & merge in
Studio** from their proposal because they do not have the newly pinned candidate.

### Previous application deployment — Wallet and Manage, 2026-10-23

Verified website release: **`20261023152532295-30964`**, source
`d09bd762f18007e31f0fa505ae9adbcea7c2045b` from
[PR #39](https://github.com/soytec/napplet-soy/pull/39).
The shell now includes the [NIP-60/61 wallet](WALLET.md) and
[unified Manage tabs](MANAGE.md). Wallet loading starts with the selected account;
trusted Cashu tokens received by paste or QR go directly to receipt and balance
feedback. Outgoing payments retain their amount/fee review.

TypeScript, all 897 application tests, 5 relay, 18 Blossom and 9 GRASP checks, and
the production build passed on the VPS. Local application/service checks also
passed. [Nix package/rebuild/VM validation](https://github.com/soytec/napplet-soy/actions/runs/39976631223),
[all four native builds and installer/updater checks](https://github.com/soytec/napplet-soy/actions/runs/39976631132),
and [Studio integration/browser CI](https://github.com/soytec/napplet-soy/actions/runs/39976631309)
passed before merge. Nix's dependency output hash was updated to the exact value
verified by CI for the added wallet libraries; runtime pins were unchanged.

A fresh browser on public HTTPS passed direct paste receipt, simulated camera
receipt and track shutdown, duplicate handling, explicit outgoing-payment review,
automatic saved-wallet restoration, all Manage tabs and popover transaction history.
These checks used intercepted fake mint/relay services, including a silent relay;
no real funds or public test events were used. Physical-camera scanning and a real
payment between independently operated wallets remain unverified.

Public health and the completed catalog scan identify the new release. Studio,
CVM, TURN, Caddy and all five application processes are healthy; source hashes match.
All five saved draft records and Git workspaces, private configuration and Studio
egress policy are preserved. No active or queued creator jobs were present at
activation. Read-only relay/GRASP subscriptions, protected admin/metrics endpoints,
Blossom and the other hosted site passed. External query timeouts from
`relay.nostr.net` and `nostr.oxtr.dev` remain visible; the scan completed through
other relays. The previous release `20261023105030380-26978` remains available for
rollback. Local evidence is retained in `.local/wallet-deploy/`.

The installer still serves the published **soyLI 0.31.2**, verified against source
bytes. No new CLI release or Studio worker image was introduced.

### Previous application deployment — Preserve running sessions, 2026-10-23

Verified website release: **`20261023105030380-26978`**, source
`cea49d9107e9da2434cff668c1c186b49288a2e5`.
[PR #38](https://github.com/soytec/napplet-soy/pull/38) merged as `d991b76`:
switching tabs/windows or scrolling an active compact napplet offscreen retains
its iframe and host session. Explicit Stop/Restart, navigation/unmount and another
explicit player still end the session; decorative media retains visibility cleanup.
The follow-up `cea49d9` isolates a Studio publication test's proposal reads from
public relays; it changes no production behavior.

TypeScript, all 858 application tests, 5 relay, 18 Blossom and 9 GRASP checks, and
the production build passed on the VPS. The same local application/service gates
passed. [Nix validation](https://github.com/soytec/napplet-soy/actions/runs/39940933232)
and [Studio/browser CI](https://github.com/soytec/napplet-soy/actions/runs/39941488513)
passed. A guest browser on public HTTPS played Obsidian Breaker through three
deterministic hidden/visible cycles without losing its frame, JavaScript marker or
instance storage, then verified Restart resets and Stop closes the session. Studio
hydrated without page errors. Native OS tab switching was not automated; browsers
may still throttle or discard background pages.

Public health and the completed catalog scan identify this release. Studio, CVM,
TURN, Caddy and all five application processes are healthy; source hashes match.
All five saved drafts and Git workspaces, private configuration and Studio egress
policy are preserved. No active or queued Studio jobs were present at activation.
The previous release `20261022145224492-95376` remains available for rollback.
Read-only relay/GRASP subscriptions, Blossom health, protected admin/metrics routes
and the other hosted site passed. The pre-existing `nostr.oxtr.dev` query failures
remain visible; catalog refresh completes through the other relays.

The website now serves the already-published **soyLI 0.31.2** installer, verified
against the source bytes. No new CLI release, worker image, paid inference or public
test publication was needed.

### Previous application deployment — Remix preview and relay counts, 2026-10-22

Verified website release: **`20261022145224492-95376`**, source
`bca22941e22ea4ac8cbebf06f29a09f7a49d4fd0`, with the installer still pinned to
**soyLI 0.31.1**. [PR #30](https://github.com/soytec/napplet-soy/pull/30) lets
Studio play the original published napplet before the first remix build, retaining
its exact revision and switching to the draft after successful checks. This works
with both browser and server builds. [PR #34](https://github.com/soytec/napplet-soy/pull/34)
updates Applesauce and relay COUNT/negentropy support; COUNT refusals preserve their
cause, and multiple filters count a deduplicated union. [PR #36](https://github.com/soytec/napplet-soy/pull/36)
makes the installer transfer test independent of the host CPU while explicitly
verifying that the real installer still refuses unsupported CPUs.

TypeScript, all 854 application tests, 5 relay, 18 Blossom and 9 GRASP checks, and
the production build passed on the VPS. Original-preview browser checks passed in
both build modes (30 assertions), with shell/account and private-preview regressions.
[Studio CI](https://github.com/soytec/napplet-soy/actions/runs/39794596139),
[Nix/VM validation](https://github.com/soytec/napplet-soy/actions/runs/39799493653)
and [all four native platforms](https://github.com/soytec/napplet-soy/actions/runs/39799493351)
passed before activation.

HTTPS health and the fresh catalog identify this release. Live read-only relay
checks verify NIP-45/77 advertisement, deduplicated multi-filter counts, ignored
COUNT limits, explicit invalid-filter refusal, and a genuine empty count. Studio,
CVM, TURN, Caddy and all five application processes are healthy. Source fingerprints
match; all five saved draft records and Git workspaces, private configuration and
Studio egress policy are preserved. The worker image remains
`sha256:78a1530841e748abf8229ccad04a6077e8c9e24dbeb8c0887138e4d00a730eb8`.
The other hosted site remains available. The catalog still reports pre-existing
query timeouts from `nostr.oxtr.dev`; its refresh completes through the other relays.
The production Studio page hydrates and opens account settings without browser
console errors. No paid inference, public test events or new soyLI release were needed.

### Installer-only refresh — Soytec transfer, 2026-10-22

The hosted `/install.sh` now serves **soyLI 0.31.1**, verified byte-for-byte against
the [published release asset](https://github.com/soytec/napplet-soy/releases/tag/soyli-v0.31.1).
SHA-256: `00fdc18b4b46b9f4a089681ae470b8a38a6aebc0c19ee650de85fd988c99ae78`.
Both the public source copy and built client copy in the active release were
updated atomically after checking their previous hashes; original files are backed
up outside the web root. No application process was restarted. At that point the application
release remained `20261021141802851-42000`; this was not a full website deployment.

The installer was activated after the real 0.31.0 → 0.31.1 upgrade passed, before
the native GitHub repository transfer to `soytec/napplet-soy`. Post-transfer tests
verify release discovery, fresh installation and recovery for an old updater that
missed the transition. See [release verification and recovery](CLI-RELEASES.md).
Existing Studio workspaces and the worker compatibility profile were not changed.

### Previous application deployment — My work and signing, 2026-10-21

Website release: **`20261021141802851-42000`**, source
`af50f3c36d3413c6181fa00bbf1baa085415d707`, originally shipped with **soyLI 0.31.0**
before the installer-only refresh above.
[PR #33](https://github.com/zeSchlausKwab/napplet-soy/pull/33) fixes missing My work
proposals by retaining repository relay hints from manifest source links. It also
fixes browser merge signing: the shell now shares Studio's event-kind policy,
including standard NIP-34 kind 1631. Merge starts with an immediate spinner and
**Merging…** label, with live delivery and signer status until completion or failure.

TypeScript and all 848 application tests passed locally and on the VPS, followed
by 5 relay, 18 Blossom and 9 GRASP checks and the production build.
[All four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39614132445),
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39614132534)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39614132480)
passed before merge. The real-service regression now signs through the shell's
account adapter and verifies retry after a refused merge-status signature, source
merge and separate publication (48 assertions). Desktop/mobile browser checks
verify immediate progress, disabled repeat submission, retry and completion states.

HTTPS health and the refreshed catalog identify the deployed release. Studio,
CVM, TURN, Caddy and all five application processes are healthy. Live read-only
queries find the reported Obsidian Breaker proposal in both its page and My work,
without repository warnings. The anonymous production page hydrates and opens
account settings without browser console errors. Source fingerprints match.
All four saved draft records, Git workspaces, private configuration and active
Studio egress policy are unchanged. The worker image remains
`sha256:78a1530841e748abf8229ccad04a6077e8c9e24dbeb8c0887138e4d00a730eb8`.
The other hosted site remains available. No user proposal was merged, no paid
inference was run, and no public test event was published. No soyLI update is needed.
Refresh the shell and retry the existing reviewed merge.

### Previous verified rollout — My work and author merges, 2026-10-21

Website release: **`20261021121512046-56636`**, source
`30d5e957e00f8dfb17e6784ba735a9f755edf68e`, installer still pinned to **soyLI 0.31.0**.
[PR #32](https://github.com/zeSchlausKwab/napplet-soy/pull/32) adds proposal delivery
progress, reviewed author merges in Studio, and **My work** with drafts, publications,
incoming/submitted proposals and recent activity. Account and navigation dots use
explicit, browser-local read markers. Merging source and publishing the updated
original listing remain separate reviewed actions.

TypeScript and all 843 application tests passed locally and on the VPS, followed
by 5 relay, 18 Blossom and 9 GRASP checks and the production build.
[All four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39596350763),
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39596350495)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39596350566)
passed before merge. Studio CI passed on retry after an upstream service connection
timeout; no source changes were needed. Independent ngit 2.6.1 interoperability
also passed locally. The merged tree matches the tested PR head.

HTTPS health and the fresh catalog index both identify the deployed release.
Studio, CVM, TURN, Caddy and all five application processes are healthy, with zero
application restarts. The live My work page initializes and opens account settings
without browser console errors. Deployed source fingerprints match the merged code.
The three saved draft records, Git worktrees and private configuration are unchanged;
active Studio egress rules match the configured policy. Raw firewall hashes include
changing Docker traffic counters and are not used as a preservation assertion.
The other hosted site remains available.

The accepted worker image remains
`sha256:78a1530841e748abf8229ccad04a6077e8c9e24dbeb8c0887138e4d00a730eb8`.
No paid inference, real-account proposal merge or public test publication was
performed during deployment. No soyLI release was needed. Refresh the site and
open [My work](https://napplet.soy/manage); supported incoming proposals can be
reviewed in Studio before an explicit merge and subsequent Publish.

### Previous verified rollout — hosted worker recovery, 2026-10-21

Website release: **`20261021091028374-54156`**, source
`e59f66710d14bcebef9310a5f568c5cd8cae9a17`, installer still pinned to **soyLI 0.31.0**.
[PR #31](https://github.com/zeSchlausKwab/napplet-soy/pull/31) fixes hosted worker
crashes under thread pressure. The old 128-slot process/thread limit triggered
Bun's allocator failure during parallel browser checks. Node now supervises source
recovery independently of the child runtime; Docker init and private-namespace
cleanup release orphaned processes before export. The allowance is 512 slots and
agent guidance requests sequential checks. CPU, memory and network isolation remain.

TypeScript and all 839 application tests passed locally and on the VPS, followed by
relay, Blossom and GRASP integration checks and the production build.
[All four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39573298364),
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39573298377)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39573298577)
passed before merge. The merged tree matches the tested PR head.

The deployed offline recovery regression passed thread exhaustion with 12 MiB of
source export, Git exclusions, child signal exit 132 and subsequent job reuse.
The unchanged pinned worker image,
`sha256:78a1530841e748abf8229ccad04a6077e8c9e24dbeb8c0887138e4d00a730eb8`,
also passed scripted OpenCode build repair, browser-check handoff, timeout recovery,
media capture and cancellation acceptance before deployment. No paid inference,
public test publication or edits to live drafts were performed.

HTTPS health identifies the new release, the catalog index is fresh, and Studio,
CVM, TURN, Caddy and all five application processes are healthy. Deployed source
fingerprints match the merged code. The three reported draft records, existing Git
repositories, private configuration and firewall fingerprints are unchanged; the
other hosted site remains available. The temporary legacy CPU profile is retained.
Refresh Studio and retry the failed turn; no CPU upgrade or soyLI release is needed.

### Previous verified rollout — hosted remix networking, 2026-10-21

Website release: **`20261021070722753-55473`**, source
`d57f87421b6b3ab193bf6ff118f95eccc9e2535d`, installer still pinned to **soyLI 0.31.0**.
[PR #29](https://github.com/zeSchlausKwab/napplet-soy/pull/29), squash-merged as
`01e0ec989cf973f952e8f197a021ab943af64ab4` with an identical tree, fixes hosted
remix imports failing before either build path. Credential-free Node workers use
the existing public DNS/TLS guards without Bun's loopback tunnel, which Studio's
egress firewall rejects. Worker code resolves from the trusted installation even
when soyLI runs inside a private draft directory.

TypeScript and 837 application tests passed locally and on the VPS, along with
native service and production build checks. The deployed source passed
[all four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39559747945),
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39559747947)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39559747910).
The new network-namespace regression exercises the real CLI under Studio's
generated firewall, including private IP/DNS, redirect and certificate refusals.

Live imports of both reported source releases completed under the Studio UID in
5.7 and 5.4 seconds, preserving their exact upstream manifest and Git revisions.
HTTPS health and the fresh catalog index identify the new release. Deployed source
fingerprints match; Studio, CVM, TURN, Caddy and all five application processes
are healthy. Existing draft/Git, private configuration and firewall fingerprints
are unchanged, as is the worker image. Disposable import workspaces were removed.
No paid inference or public test publication was performed. Refresh Studio and
retry existing failed remix drafts; no republishing or soyLI update is needed.

### Previous verified rollout — Studio timeout recovery, 2026-10-20

Website release: **`20261020133734312-91324`**, source
`fe512144ba1dcbe30da8379da37cd5ea1faef31f`, installer still pinned to **soyLI 0.31.0**.
[PR #28](https://github.com/zeSchlausKwab/napplet-soy/pull/28) fixes hosted Studio
timeouts and unreadable recovery diagnostics. The worker now receives the
controller's ten-minute execution budget instead of stopping at a hidden 550
seconds. A further 30 seconds allows source export. `STUDIO_TIMEOUT` survives the
worker boundary so Studio checks recovered edits without another inference turn.
Internal source-transfer and agent frames are filtered before output truncation.

TypeScript and 836 application tests passed locally and on the VPS, along with
native service and production build checks.
[All four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39431423671)
passed before merge; the merged source passed
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39432923518)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39432923612).

The accepted worker image is
`sha256:78a1530841e748abf8229ccad04a6077e8c9e24dbeb8c0887138e4d00a730eb8`.
Real OpenCode scripted acceptance covers server builds and repair, browser check
bridging, response truncation, timeout/edit recovery, both capture orientations,
failed-edit export and cancellation/reuse. No paid inference or public test
publication was performed.

Live HTTPS health and a fresh catalog index identify the new release. Deployed
source and worker fingerprints match the tested artifacts. The reported published
draft retains its Git revision, clean worktree and preview. Private configuration
changed only its worker image, with the original preserved for rollback. Studio,
CVM, TURN, Caddy and all five application processes are healthy; the shared parent
Caddy configuration and other site are unchanged. Disposable Rust compiler
intermediates from this deployment were removed; the installed executable and
rollback releases remain. No soyLI release was needed.

### Previous verified rollout — incomplete Studio turns, 2026-10-20

Website release: **`20261020122308291-6231`**, source
`ce2aeabf5331c6b45f40cfe17f9b1edf82a00ce1`, installer still pinned to **soyLI 0.31.0**.
[PR #27](https://github.com/zeSchlausKwab/napplet-soy/pull/27) fixes incomplete
Studio turns being reported as ready creations. Model cutoffs and unfinished tool
turns now retain edits and report an actionable error; an unchanged starter cannot
be promoted as a completed creation. The inference broker no longer imposes its
own output-token cap, total-call ceiling or per-response timeout. Connection step
budgets, overall deadlines and resource/isolation bounds remain.

TypeScript and 833 application tests passed locally and on the VPS compatibility
runtime. Deployment also passed native service checks and production rendering
gates. [All four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39421156522)
passed before merge; merged source passed
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39422762424)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39422762320).

The accepted worker image is
`sha256:23719cca357781e2b9fa48981b7eddfcff9750379e3fecce0cf377d2a553e81b`,
updating the agent entrypoint over the previous pinned image. Scripted acceptance
with real OpenCode covers server builds, browser compiler bridging, build repair,
response truncation, both capture orientations, failure recovery and cancellation.
The original cutoff reproduction now reports an incomplete turn and preserves
OpenCode's requested token allowance.

Live HTTPS/CVM acceptance confirms that checking an untouched starter produces
`STUDIO_NO_CHANGES` without promoting a preview. Its disposable owner was removed
after revocation. Existing user drafts and repositories were preserved; no paid
inference or public test publication was performed. Public health and the fresh
index match the release; deployed source and worker fingerprints are verified.
The image switch preserves unrelated private configuration and has a paired
rollback backup. Shared Caddy configuration and the other hosted site are unchanged.
No soyLI release was needed.

### Previous verified rollout — private preview downloads, 2026-10-20

Website release: **`20261020111402553-16211`**, source
`028c1447f7400e8116a7bc9d7ba61193c8d18bd6`, installer still pinned to **soyLI 0.31.0**.
[PR #26](https://github.com/zeSchlausKwab/napplet-soy/pull/26) fixes private Studio
previews showing “Download unavailable” after successful builds. The trusted player
now includes its same-origin access cookie when downloading the immutable artifact.
Public downloads still omit credentials, and integrity checks and sandbox isolation
remain enforced. Existing drafts need a page refresh, not another inference run.

The fix passed 828 application tests locally and during the standard VPS deployment,
plus native service checks and production build/rendering gates.
[All four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39412989782)
passed before merge; the merged source passed
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39414166759)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39414163984).
The new HTTPS browser regression reproduces the original 403 through the actual
player download path, then verifies playback, input, opaque-origin isolation,
anonymous denial and session revocation after the fix.

Live Chromium acceptance on a disposable private draft confirmed artifact HTTP 200,
game rendering and input, opaque origin, and HTTP 403 after session revocation.
The disposable workspace was removed; existing user drafts were preserved.
Deployed source fingerprints and public health match the release. Services are
healthy, the shared Caddy configuration is unchanged, and the other hosted site
remains available. The worker image and CLI release are unchanged. No paid
inference or public test publication was performed.

### Previous verified rollout — hosted Studio, 2026-10-19

Website release: **`20261019161500000-2714`**, source
`bb271c4aa15980a36a8d825d126defc62691dc7e`, installer pinned to **soyLI 0.31.0**.
[PR #25](https://github.com/zeSchlausKwab/napplet-soy/pull/25) adds hosted BYOK Studio,
with browser compilation and isolated server builds under the shared shell account.
Provider keys are encrypted outside projects. Native Git remains authoritative;
existing local drafts, repositories and the local soyLI flow are preserved.
See [hosted setup, architecture and limits](STUDIO-HOSTING.md).

The tagged source passed [all four native platforms](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39275681961),
[Nix/VM checks](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39275671629)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39275672088).
An initial candidate was refused before activation: Studio's new identity consumer
was outside the identity provider, so server rendering failed despite API health.
Correction `904b6f4` passed a real production HTTP regression, then
[Nix CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39280022578) and
[service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39280022575).
The regression is now part of CI, and deployment explicitly checks the landing and
Studio pages before activation. The final follow-up only corrects the dashboard's
local-only storage wording and passed [service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39283306368).
Both full deployments passed 827 application tests,
relay/Go race checks, 18 Blossom tests, nine GRASP tests, three Linux backend checks,
production builds, candidate rendering and service activation checks.

The accepted legacy worker image is
`sha256:8f07b5e4eb34a29eef982889dc799f66eddf0dcd2a2bac6fde1c7e3b1d514bae`.
Its scripted OpenCode acceptance covers guidance loading, build failure/repair,
the agent-to-browser compiler bridge, landscape/portrait captures, recoverable
failures and cancellation. A dedicated Linux controller under the service
restrictions passes private credentials, scaffold/setup, server checks, a real
browser compiler round trip, private previews and logout revocation. This caught a
0077-umask input-permission bug; the subprocess regression fails before the fix and
passes after explicit child modes while the private parent stays 0700.

Public HTTPS acceptance repeats owner authorization, encrypted connection storage,
private draft setup, server checks, actual Chromium compilation, private preview
and artifact access, and logout revocation. The test's file-copy handoff was made
atomic after a partial gzip read; application code and timeouts were unchanged.
Live UI checks cover extension sign-in, My creations, AI connections, cloud provider
choices, the browser-build switch, a 390px create layout without horizontal overflow,
and sign-out. Existing Blockfall playback reaches a verified canvas at mobile and
desktop sizes. The three disposable private workspaces were removed. No paid
inference or public napplet/proposal test publication was performed.

The website installer matches the tagged source. All 11 release assets have
verified checksums; a fresh isolated macOS ARM64 install reports 0.31.0.
GitHub rate-limited the local
unauthenticated doctor/update lookup; the authenticated release API independently
confirmed the latest tag. Deployed source fingerprints, public service endpoints,
fresh index heartbeat, all five PM2 services, Caddy/CVM/TURN and Studio are checked.
The parent Caddy configuration is unchanged, and the other hosted site remains
available. Studio uses its dedicated one-GiB volume and UID-scoped egress policy;
the controller has zero restarts. The previous working releases are retained.

Platform-paid inference, broader storage retention/recovery, authoritative browser
Git and an aggregate proposal inbox/browser merge remain deferred. Physical phones,
long-term uptime and reboot recovery were not verified in this rollout.

### Previous verified rollout — local Studio beta, 2026-10-19

Website release: **`20261019120616384-43901`**, source
`14e9343dff5eb27815eaa9fe64f50490f01c0ffb`, installer pinned to **soyLI 0.30.0**.
Merged [PR #24](https://github.com/zeSchlausKwab/napplet-soy/pull/24) adds the local
Studio beta, reliable publication feedback, gameplay capture and the shared theme.
The production shell labels Studio as a local beta and links to checkout/setup
instructions. Hosted Studio remains disabled; production does not contact a
visitor's localhost. Browser Git remains opt-in and native Git remains authoritative
for publication and proposals. Storage/recovery work is deferred.

[Native release CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39249208939),
[Nix package/VM CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39249155519)
and [Studio service CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/39249155484)
passed for the exact released source. The standard deployment checks passed on the
VPS compatibility runtime: TypeScript, 812 application tests, Go race/relay checks,
18 Blossom tests, nine GRASP tests, three Linux backend checks and the production
build. The archive checksum was verified before extraction; all public CLI assets
and their source manifest were available before the website installer was activated.

Live desktop/390px browser checks pass the production entry points, local-beta
explanation and Blockfall sandbox startup without page errors or localhost requests.
The smoke script's play selector was corrected to the existing accessible name
(`Start blockfall`); application code was unchanged. Blockfall's exact current
publication now reports `ready`, where the previous website returned `pending`
despite its verified artifact and fresh index. Unrelated relay failures remain
visible in health and no longer veto that publication's confirmation.

The public installer matches the released/local installer bytes. Deployed source
fingerprints match; all five PM2 services are online with zero restarts, and
Caddy/CVM/TURN are active. A fresh index scan reports the new release. The shared
proxy hash is unchanged and schlaustronics.com returns HTTPS 200. Persistent state,
port 3040, legacy CPU settings and previous release `20261014193031446-12904` are
retained. No public test events, invoices, payments or paid inference were created.
Physical phones, reboot recovery and long-term uptime were not verified here.

### Previous verified rollout — 2026-10-15

Website release: **`20261014193031446-12904`**, source
`6d0d6cc2794b31a221ff7f009a82ec0946087e9a`, installer pinned to **soyLI 0.29.0**.
[Release CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38622887368)
and [Nix package/VM CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38619572566)
passed for the exact tag. All four native packages and 11 public assets are verified;
fresh installation, doctor/update and a real 0.28.0 upgrade pass with account/project
markers preserved.

Merged PR #20 includes the three PR #21 INTENT fixes, account-scoped Applesauce
OUTBOX routing and consented publication, and native map metadata writes. The
separate relay-discovery policy proposal remains open. NIP-5D authority, direct
manifest presentation and legacy readers remain unchanged. Compatible readers
were deployed first in `20261014185651621-64082`, with installer 0.28.0, before
CLI publication. The final installer deployment completed on **2026-10-15
(Europe/Vienna)** after an interrupted upload was resumed and its checksum verified;
no partial archive was activated.

Both deployments passed TypeScript and 731 source tests locally and on the VPS,
Go race/relay checks, 18 Blossom tests, nine GRASP tests, the production build and
three Linux backend isolation/authorization/backup checks. Four local browser
integration suites pass 107 assertions through the actual shim and host. Live
Black Site desktop startup and Sickman Survival gameplay at 390px pass; author
profiles and existing likes/comments/zap totals remain visible. The final gallery
also passes desktop/mobile smoke checks with no horizontal overflow or console
errors. Black Site itself asks for a wider window on mobile and its public version
did not expose the editor handoff; local browser regressions cover that flow.

The public installer is byte-identical to the released asset. Deployed source
fingerprints match; all five PM2 services are online with zero restarts and
Caddy/CVM/TURN are active. The index reports the final release with a fresh scan.
Root/docs, Blossom, relay and Git endpoints pass public checks, as does the other
hosted site, schlaustronics.com. Shared proxy hashes are unchanged; the backup timer
is active and both `20261014185651621-64082` and `20261014103151932-82151` remain
available for rollback. Persistent state, port 3040, shared-Caddy and legacy-CPU
settings are retained.

External `nostr.oxtr.dev` query failures predate the rollout and remain visible.
Earlier live checks also observed an optional external media 404 handled by fallback
and a relay connection warning. No public test events, invoices or payments were
created. Independent-client conformance, physical phones, reboot recovery and
long-term uptime were not verified in this release window.

### Previous verified rollout — 2026-10-14

Website release: **`20261014103151932-82151`**, source
`be8f05a96ab09f7a0b2314d70b35eb443b6f549b`, installer pinned to **soyLI 0.28.0**.
[Release CI 38548936478](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38548936478)
and [Nix CI 38546524537](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38546524537)
passed for that source. All four native packages and 11 public assets are verified;
fresh installation, doctor/update and a real 0.27.0 upgrade pass.

Merged PR #14 adds direct screenshot/clip references on signed manifests and
retains legacy readers and frozen publication jobs. Compatible readers were
first deployed in `20261014095809139-41654` while the installer stayed at 0.27.0.
Only after live verification was 0.28.0 published; this final rollout updates the
installer to the published version. New publications emit no companion event.
The optional `soy.presentation/1` extension remains distinct from upstream NIP-5D.

Both deployments passed TypeScript and 644 source tests locally and on the VPS,
Go race/relay checks, 18 Blossom tests, nine GRASP tests, the production build and
three Linux backend isolation/authorization/backup checks. Local browser fixtures
cover direct and legacy media on desktop/mobile; real local services verify fresh
publication. Live legacy gallery covers, retained social totals and desktop/390px
sandboxed gameplay pass without browser errors or horizontal overflow. The new
cached cover and byte-range clip routes also serve an existing legacy publication.

The public installer is byte-identical to the released asset. Source fingerprints
match, five PM2 services are online with zero restarts, and Caddy/CVM/TURN are active.
The index reports the active release with a fresh completed scan, the direct/legacy
presentation profile and the 100 MiB read policy. The other hosted site,
schlaustronics.com, still returns HTTPS 200.
Shared proxy hashes are unchanged; persistent state and both the reader-first
release and `20261013113411602-54987` are retained for rollback. Port 3040,
shared-Caddy and legacy-CPU settings remain unchanged. External `nostr.oxtr.dev`
query failures were present before rollout and remain visible in health.

No public test events, invoices or payments were created. Independent-client
rendering of the optional presentation extension, physical phones, reboot recovery
and long-term uptime were not verified in this release window.

### Previous verified rollout — 2026-10-13

Website release: **`20261013113411602-54987`**, source
`97bcd01f662c5a1256779b55ed5cb776e954f79e`, installer pinned to **soyLI 0.27.0**.
[Release CI 38390155381](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38390155381)
and [Nix CI 38389684968](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/38389684968)
passed for the tagged source. All four native packages and 11 public release assets
are verified; fresh installation, doctor/update and a 0.26.1 upgrade pass.

This current-main rollout includes NAP-KEYS keyboard actions, upstream GRASP-01
proposals, Git metadata/source-link fixes and the verified browser Nostr event
cache. Presentation/SPEC PR #14 remains outside this release. The normal deployment
passed TypeScript and 634 source tests locally and on the VPS, Go relay race/process
checks, 18 Blossom tests, nine GRASP tests, the production build and three Linux
backend isolation/authorization/backup tests. Port 3040, shared-Caddy and legacy-CPU
settings remain unchanged.

Live Puddlehop responds to ArrowUp/W and pause in both detail and fullscreen views.
Fresh desktop/390px sessions verify the gallery, zap dialog and sandboxed game canvas
without browser errors or horizontal overflow. The public installer is byte-identical
to the release asset; health/index identify the exact release with no stale or failed
destinations. Five PM2 services are online with zero restarts; Caddy/CVM/TURN are active.
Both shared proxy configuration hashes are unchanged, and schlaustronics.com returns
HTTPS 200. Persistent state is retained; previous release `20261013102615716-41516`
remains available for rollback. No public test events, invoices or payments were
created. Physical phones, reboot recovery and long-term uptime were not tested.

### Previous verified rollout — 2026-10-09

Website release: **`20261009091435416-91120`**, source
`2b5d4f72dbd4b1b9c999babb6f786679de6e5ea0`, installer pinned to **soyLI 0.25.2**.
[Release CI 37908614802](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37908614802)
passed 590 source tests, all four native package jobs and publication of 11 assets.
[Nix CI 37908611679](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37908611679)
passed realization, force-rebuild and offline NixOS VM checks. Public checksums,
installer bytes, manifest/source and a separate installation/doctor/update pass.

Ordinary publication updates one stable named listing; an independent immutable
copy requires `publish --snapshot`. Older frozen paired jobs retain their original
resume contract. The deployed gallery groups historical snapshots through exact
signed pairs or strictly validated own-author presentation hints; pinned identity,
playback, social, storage, backend and deletion boundaries remain unchanged.

The unchanged VPS helper passed TypeScript and all 590 source tests on Bun 1.3.8,
Go relay race/process checks, 18 Blossom tests, eight GRASP tests, the production
build and three Linux backend isolation/authorization/backup tests before activation.
The initial local attempt hit fixture deadlines on a CPU-loaded Mac and stopped
before upload. Source qualification used clean native CI; all source/service gates
still ran on the target. Application deadlines and test assertions were unchanged.

Fresh desktop/390px browsers show one card for the affected creator and preserve
a separate creator's same-title napplet, without page errors or overflow. All three
reported historical URLs return their original signed snapshots and verified HTML
(about 2 MiB each). Public health/index report the exact new release and a fresh,
error-free heartbeat; the served installer matches the tagged source. All five
PM2 processes are online with zero restarts; Caddy, CVM and TURN are active. Both
shared proxy hashes are unchanged and schlaustronics.com returns HTTPS 200.
Persistent state is retained and previous release `20261007184250765-95782` remains
available for rollback. Port 3040, shared-Caddy and legacy-CPU settings remain.
Physical phones, reboot recovery and long-term uptime were not tested in this window.

### Previous verified rollout — 2026-10-07

Website release: **`20261007184250765-95782`**, source
`fed5a41f0de19aa01afb0e329ca86401c3cb77cf`, installer pinned to **soyLI 0.25.1**.
[Native release CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37659569078)
passed source checks, all four platform jobs and publication. All public asset
checksums, the manifest source revision and an isolated installer/doctor/updater
installation pass. [Nix CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37659563343)
passed dependency/package realization, force-rebuild and offline NixOS VM checks.

The normal deployment passed TypeScript and 578 source tests locally and on VPS
Bun 1.3.8, Go relay race/process checks, Blossom/GRASP integration, production build
and three Linux backend isolation/authorization/backup regressions before activation.
Fresh public desktop/390px browsers load the WASM verification chunk and instantiate
it without fallback warnings or page errors. Root, a public napplet detail page and
docs work without horizontal overflow. Public health reports the active release
and a fresh, error-free index; the installer exactly matches the tagged source.
All five PM2 processes are online with zero restarts at verification, and Caddy,
CVM and TURN are active. Both shared proxy hashes are unchanged; schlaustronics.com
returns HTTPS 200. Persistent state was retained; observed prior release
`20261006135415572-54810` remains available for rollback. The port 3040/shared-Caddy/
legacy-CPU profile is unchanged. No reboot, physical phone or long-term uptime
qualification was performed in this verification window.

### Previous verified rollout — 2026-10-06

Website release `20261006111729495-77355`, source `8f80965`, pinned the installer
to 0.24.2. TypeScript, all 552 source tests, native release CI, service integration
and Linux backend checks passed. Fresh public desktop/mobile sessions resolved
the affected creator's name/avatar in both napplet heading and account header.
Shared proxy hashes were unchanged and the other site returned 200. The later
observed production release `20261006135415572-54810` preceded today's deployment.

### Previous verified rollout — 2026-09-26

Website release: **`20260926054112843-53639`**, from source `923e89e`,
with the installer pinned to **soyLI 0.23.4**. GitHub
[release CI](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/36221163275)
passed source checks, all four native builds, installer/updater, delayed-signing
browser and fresh-project checks before publishing all 11 CLI release assets.

The normal shared-Caddy deployment passed all 430 application tests locally and
on VPS Bun 1.3.8, Go race checks, relay/Blossom/GRASP integration checks, the
production build and Linux backend sandbox/backup/authorization regressions.
Candidate and activation checks passed. Public HTTPS confirms the new release,
a fresh error-free index, root/docs and exact 0.23.4 installer bytes. Caddy, CVM
and TURN are active. Both shared proxy configuration checksums remain unchanged,
and the other site returns HTTP 200.

Live browser checks using disposable extension identities and authenticated
read-only backend calls pass after both 2.5-second and 16-second signing delays.
The longer test explicitly sets the new helper timeout. No public world was
created; the real browser world-creation/idempotent-retry regression ran locally
and in native CI. Existing napplets need a rebuild and republish to include the
updated helper. The prior website release `20260925162308197-37378` remains for
rollback. Actual reboot, physical phones and third-party extension implementations
were not tested as part of this deployment.

## One command

Website deployment uses `bun run deploy` on its own. Remove the old
`bun run cli:release --host … &&` prefix: CLI packages now come from GitHub Releases,
so deploying the website does not require locally built CLI archives. Publish the
matching GitHub release before deploying an updated installer; see
[CLI release operations](CLI-RELEASES.md).

```sh
bun run deploy --host your-vps --domain napplet.soy --preflight
bun run deploy --host root@your-vps --domain napplet.example --admin-pubkey <npub-or-hex>
# On an inspected stock Caddy host:
bun run deploy --host root@your-vps --domain napplet.soy --shared-caddy --web-port 3040 --admin-pubkey <npub-or-hex>
# Temporary compatibility profile for the existing Namecheap VPS:
bun run deploy --host root@your-vps --domain napplet.soy --shared-caddy --web-port 3040 --legacy-cpu --admin-pubkey <npub-or-hex>
```

`--preflight` is read-only: it reports OS, CPU compatibility, capacity, listening ports, proxy services and container names/images/ports without installing software or exposing environment values. Inventory continues when the CPU requirement fails so other diagnostics remain available. Actual deployment checks unattended access and CPU compatibility before local checks or uploads, and checks the CPU again before remote changes. SSH and SCP use batch mode and strict saved-host-key verification. Establish key access first; an SSH config alias can select a different login, port or identity. An existing proxy on ports 80/443 or occupied application ports stops a first dedicated-host deployment before package/service changes. Shared mode supports the stock `/usr/bin/caddy` systemd service with `/etc/caddy/Caddyfile`. It keeps the existing binary and service, validates the combined configuration, adds one import of Napplet’s fragment, then reloads gracefully. Custom unit overrides, conflicting hostnames and other proxies require explicit integration.

The first live target is `napplet.soy` at `159.198.46.2`, alongside another existing site. The app's public publication defaults and visible hostname now use `napplet.soy`; its DNS names are `napplet.soy`, `www.napplet.soy`, `blossom.napplet.soy` and `git.napplet.soy`. Inventory confirmed the existing Caddy 2.6.2 supports the required directives; port 3000 is occupied, so Napplet uses 3040 (candidate 3041).

Use a Debian/Ubuntu host with systemd, x86_64 with a modern baseline CPU profile (x86-64-v2, including SSE4.2) or arm64, DNS pointing to it, and inbound TCP 80/443 available. Bun's documented x86_64 support requires SSE4.2 even with its baseline build; Sharp's prebuilt Linux image-processing library also requires SSE4.2 and reports a v2 microarchitecture requirement when its CPU check fails. AVX is not required by this deployment. A legacy virtual CPU can hide the required instructions even when the physical host supports them. Ask the provider to expose an appropriate CPU model or host passthrough; this cannot be enabled by installing a package inside Ubuntu. See [Bun CPU requirements](https://bun.com/docs/installation#cpu-requirements) and [Sharp prebuilt requirements](https://sharp.pixelplumbing.com/install/#prebuilt-binaries). The deployment's early SSE4.2 guard catches this known incompatible profile; it does not replace execution checks for the complete runtime and native dependencies.

All three hostnames—`napplet.example`, `blossom.napplet.example`, and `git.napplet.example`—must resolve to the VPS. Override the service names with `--blossom-domain files.example` and `--git-domain source.example`; all three must be different. An SSH config alias works for `--host`, including its key/port settings. The SSH account must be root or have passwordless sudo. The script installs missing build dependencies without upgrading existing packages, uses a separate PM2 home, and never replaces another site’s proxy binary or service. `--shared-caddy` must be explicit.

The command runs local checks, uploads an allowlisted archive of the working source tree, and invokes [deploy-remote.sh](../scripts/deploy-remote.sh). Uncommitted source changes are included; `.git`, dependencies, builds, local state, and `.env` files are excluded. The remote build uses `bun.lock` and does not reuse macOS native dependencies on Linux.

The archive also includes `docs/BACKEND-CREATOR.md`, which the source CLI imports
to bundle its creator guide. Local checks extract the actual deployment archive
and exercise CLI account lookup and boilerplate scaffolding before upload. This
catches missing bundled files that tests in the full checkout cannot detect. If a
candidate failed with `Cannot find module '../../../docs/BACKEND-CREATOR.md'`, rerun
the normal deploy command from the corrected checkout; the failure occurs before
service activation and does not require a state restore.

## Installed layout and service ownership

| Location                                        | Purpose                                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/opt/napplet-space/releases/<id>`              | Source and production build for one release                                                                           |
| `/opt/napplet-space/current`                    | Active release symlink                                                                                                |
| `/opt/napplet-space/bin`                        | Caddy 2.10.2 in dedicated mode only, verified against upstream checksums; may retain an unused Bun from older deploys |
| `/opt/napplet-space/tools`                      | PM2 7.0.4 and checksum-pinned Go 1.25.0 and Rust 1.97.1                                                               |
| `/opt/napplet-space/tools/bun<version>/bin/bun` | Checksum-verified runtime; each release's `bin/bun` symlink retains its selected version for rollback                 |
| `/opt/napplet-space/tools/legacy-images`        | Compatibility libvips builds, stored by version and build-script fingerprint                                          |
| `/var/lib/napplet-space/relay`                  | Durable signed relay events and rebuildable Bleve index                                                               |
| `/var/lib/napplet-space/blossom`                | Content-addressed blob bytes and SQLite descriptors/ownership                                                         |
| `/var/lib/napplet-space/grasp`                  | Git objects, repository relay LMDB, private operator identity and migration state                                     |
| `/var/lib/napplet-space/moderation/policy.json` | Durable admin rules, replay receipts and audit trail                                                                  |
| `/var/lib/napplet-space/index`                  | SQLite website projections, cursors/deletions, verified artifacts and normalized previews                             |
| `/opt/napplet-space/shared/server.env`          | Optional operator-maintained runtime/public build configuration; never uploaded                                       |
| `/var/lib/napplet-space/pm2`                    | Dedicated PM2 process list, logs, and PID state                                                                       |
| `/var/lib/napplet-space/caddy`                  | Dedicated-mode Caddy certificate/account data; shared mode keeps the existing service's storage                       |
| `/etc/napplet-space/Caddyfile`                  | This site's HTTPS/reverse-proxy configuration                                                                         |

The `napplet` system account runs the application and, in dedicated mode, Caddy. Shared mode retains the existing Caddy account/service. The web server listens on the selected loopback port (3000 dedicated, 3040 shared by default); the native Khatru relay listens on loopback 19347 and Caddy exposes it at `wss://<domain>/relay`. A separate Bun Blossom process listens on loopback 19348; Caddy exposes its root endpoints at `https://<blossom-domain>`. Native ngit-grasp listens on loopback 19349; Caddy exposes both its repository relay and Git smart HTTP endpoints at `https://<git-domain>`. Git HTTP bodies and receive-pack input are limited to 50 MiB; this does not bound total disk use. Public `/metrics` access is blocked. PM2 uses one fork process per service; Node runs PM2 itself and the short-lived linked-preview metadata worker when a catalog refresh contains supported app references. The ordinary deployed profile still disables publicdev imports. systemd units `napplet-space` and `napplet-space-caddy` persist the services across reboots. Caddy receives only the capability needed to bind low ports. Existing global PM2 state is not used.

## Activation and recovery

1. Require a supported CPU and take an exclusive deployment lock.
2. Install missing pinned tools, extract into a new release directory, install locked dependencies, typecheck/test, run Go race, relay/Blossom/GRASP process tests, and build web, relay, Blossom and GRASP. The GRASP build uses the pinned standalone Rust distribution and system Git/OpenSSL, with two Cargo build jobs. The remote build runs at lower scheduling priority in a systemd scope limited to 3 GiB memory and two CPU cores. Allow several GiB of disk for toolchains and per-release build caches.
3. Start the candidate on the next port after the selected web port and verify `/api/health` reports the expected release ID.
4. Validate the proposed Caddy configuration.
5. Switch the active symlink, recreate the dedicated PM2 services, and verify relay/Blossom/GRASP build fingerprints and the web release ID on the selected port.
6. Save PM2 state, activate the Caddy configuration, and enable service startup on reboot. Deployment does not reboot the host.

Services may have a brief interruption during activation. This does not promise zero-downtime deployment. On activation failure, the error handler returns the active symlink and PM2 web/relay/Blossom/GRASP processes to the previous release where available, and restores the prior Caddy configuration if it was changed. Shared mode checks that the parent config has not changed before replacing it and preserves detected concurrent operator edits. Persistent relay, blob and Git data stay outside release directories. Code rollback does not roll back data. A persistent `grasp/upstream.commit` guard rejects automatic upstream GRASP pin changes, including downgrades. Rehearse a separate full-state migration/restore procedure before changing this guard; see [GRASP operations](GRASP.md). Candidate build failures leave the current processes alone. Old releases remain on disk for inspection; automated retention is deferred.

First-deploy HTTPS issuance depends on public DNS and network reachability. The script validates configuration and checks local application health; it does not certify external DNS, certificate issuance, reboot recovery, or provider firewalls. DNS is not modified automatically. Managed TURN may add the explicit UFW rules described below.

## Operator commands

```sh
sudo systemctl status caddy # shared mode; napplet-space-caddy on a dedicated host
sudo journalctl -u caddy -n 100
sudo -u napplet env PM2_HOME=/var/lib/napplet-space/pm2 \
  node /opt/napplet-space/tools/node_modules/pm2/bin/pm2 list
```

Protect `shared/server.env` as operator configuration. It is sourced by the deploy script; only administrators should be able to edit it. Values beginning with `VITE_` are compiled into the browser and must be public. Deployment defaults `VITE_NOSTR_RELAYS` to this instance’s managed relay. `SPACE_ADMIN_PUBKEYS` in `shared/server.env` overrides the deploy flag; otherwise the supplied public key is used. Admin setup and scope are documented in [MODERATION.md](MODERATION.md). The web server has no creator private keys. The separate ContextVM starter stores its service key outside source; see [CONTEXTVM.md](CONTEXTVM.md).

## Temporary legacy CPU profile

`--legacy-cpu` is an explicit Linux x86_64 deployment profile. It selects the verified Bun 1.3.8 baseline runtime and builds the current Sharp 0.35.4 against checksum-pinned libvips 8.18.6 using generic x86_64 compiler flags. It does not downgrade image-library source versions, remove screenshots or bypass image byte/pixel limits. The documented upstream Bun CPU support requirement still exceeds this VPS's advertised flags, so the profile is a tested workaround for this host rather than an upstream support guarantee.

The build enables PNG, JPEG, WebP and GIF decoding plus EXIF/color support. Optional libvips integrations are disabled; the app still rejects non-raster input before invoking the decoder. libvips and Sharp are installed in Napplet's own directories, without changing system library paths or another application's runtime. Builds stay within the existing 3 GiB/two-CPU deployment scope. Expect slower first-time builds and potentially slower image normalization; normalized previews are cached.

Bun 1.3.8 also loses the original TLS hostname when `node:https` uses a custom DNS lookup. On that pinned runtime, guarded public HTTPS downloads run in a short-lived Node worker using the same DNS, certificate, redirect and byte-limit checks. This applies to artifacts, resources and preview images; SHA-256 verification remains in the caller. Newer Bun and the standalone CLI keep their existing transport. No TLS verification is disabled.

Server-side relay handshakes also clear their owned request's timeout listener
after a request error. A queued timeout after failure otherwise makes the pinned
`ws` implementation dereference its cleared request and terminate the web process,
causing intermittent proxy 502s during PM2 restart. The adapter preserves the
original relay error and ordinary handshake deadlines; DNS, TLS, redirect and
payload checks remain enforced. Child-process HTTP regressions cover failed
queries and publication with a healthy relay fallback, cleanup and timeout errors.
This correction passed on both local Bun 1.3.11 and VPS Bun 1.3.8 and was deployed
on 2026-10-06 in `20261006111729495-77355`. The web process is online with zero
restarts at initial live verification; longer-term observation remains separate.

All ordinary checks still run, plus libvips's own test suite and a codec smoke check. Bun executes a small JavaScript program under a separate 768 MiB/15-second limit before further toolchain installation or builds. A release retains its own runtime symlink, so selecting the normal profile later does not change the runtime used by a rollback release. To return to the standard profile after the CPU is fixed, rerun deployment without `--legacy-cpu`; keep the prior release and its compatibility library directory while it remains a rollback candidate.

## Local parity and remaining services

`bun run dev:prod` uses the same PM2 ecosystem and Bun production entry as the VPS deployment and a checksum-verified Caddy 2.10.2. Its PM2 state and downloaded tools stay under `.local`. Default local HTTP avoids changing the OS trust store; local HTTPS can use Caddy's internal CA, which needs separate trust setup. Local PM2 starts both app and proxy; on the VPS systemd owns Caddy and PM2 owns Bun. The same actual server implementations handle requests in both environments.

Deployment includes the [managed relay](RELAY.md), [Blossom storage](BLOSSOM.md), [GRASP source hosting](GRASP.md), and [persistent index/preview worker](INDEXING.md), using the same implementations and PM2 definitions as local development. Managed service stores start empty; deployment does not publish the bundled development examples to Nostr. The index reads the managed relay internally plus the [shared public discovery defaults](RELAY-DEFAULTS.md), while portable hints advertise the managed relay’s public WSS address. Override `SPACE_INDEX_RELAYS` and optionally `SPACE_INDEX_HINTS` in `shared/server.env`; see [indexing configuration](INDEXING.md). Production discovery stays enabled with `publicdev` disabled. The worker's release heartbeat is checked during activation and its process is included in rollback. Services run natively. Application execution and public HTTPS/service access are verified on the VPS. Startup registration is enabled; an actual whole-VPS reboot has not been performed because the host also runs another site.

## Deployment record: napplet.soy, 2026-09-13

### Live deployment

- Active release: `20260913181640977-29742`, application source through commit `b776b76`. Runtime: isolated Bun 1.3.8, Sharp 0.35.4 and source-built libvips 8.18.6. Previous release `20260913175521306-89539` remains available for code rollback.
- Website: [napplet.soy](https://napplet.soy). Administration: [/admin](https://napplet.soy/admin), using the operator's configured NIP-07 public key. No personal private key is installed. Unauthenticated admin API requests return 401; policy permissions and active process configuration were verified. The operator's own extension-signing session remains a manual check.
- Public relay: `wss://napplet.soy/relay`. Blossom: [blossom.napplet.soy](https://blossom.napplet.soy). Git/GRASP: [git.napplet.soy](https://git.napplet.soy), with its repository relay at `wss://git.napplet.soy/`. Both relays answered read-only subscriptions with EOSE. Public Git metrics return 404.
- Caddy automatically obtained Let's Encrypt certificates for all four HTTPS hostnames, valid until 2026-12-12, and is configured to renew them. `www` permanently redirects to the apex. External HTTPS checks use normal certificate verification. No DNS or firewall changes were needed during activation.
- Five isolated PM2 processes run the web server, indexer, relay, Blossom and GRASP. PM2 state is saved and `napplet-space.service` is enabled for boot. Persistent service data and moderation state are outside the release. The existing Caddy configuration was preserved byte-for-byte with only Napplet's managed comment/import appended, and `schlaustronics.com` still returns HTTP 200.
- The Linux build passed typechecking, 114 application tests (including the two deployment regressions added during activation), Go race tests, relay/Blossom/GRASP process tests, upstream libvips tests and PNG/JPEG/WebP/GIF checks. Native services were retained for the final web-only stylesheet correction after source checksums/build fingerprints were verified.
- All seven Chromium checks passed against public HTTPS: desktop navigation/filtering/history, sandbox playback, tampered artifact rejection, portable/pinned/source routes, styled responsive rendering without JavaScript, mobile layout and signer guidance, and server-rendered OG metadata with 1200×630 PNG previews. No test publications or moderation writes were sent to the public instance.

### Initial attempts, before compatibility activation

- Passwordless SSH with strict host-key verification works. The website, www, Blossom and Git DNS names resolve to `159.198.46.2` from the VPS. The additional `relay.napplet.soy` DNS record is reserved; the configured relay endpoint remains `wss://napplet.soy/relay`.
- Gitea was stopped and its Docker restart policy disabled with operator authorization. Its data remains intact. A resource-heavy process inside that container exited with it. Stopping the container does not establish that the VPS is free of compromise.
- At this stage, the existing `schlaustronics.com` site still returned HTTP 200, stock Caddy remained active, and `/etc/caddy/Caddyfile` retained its original checksum. No Napplet proxy import, release symlink or runtime services had been activated.
- The deployment created Napplet's dedicated system account/state directories and installed missing build dependencies plus isolated pinned toolchains. Failed release directories remain for inspection. The initial administrator's public key is saved for deployment; no personal private key was requested or installed.
- Locked dependency installation succeeded, but Bun's JavaScript runtime was killed by the deployment scope's memory limit before tests ran. The failure reproduced with only `bun -e 'console.log(...)'`, with no application imports, under a separate 768 MiB/20-second diagnostic limit. Disabling JIT did not resolve it. `bun --version` alone succeeds and is insufficient as a runtime check.
- `/proc/cpuinfo` reports `QEMU Virtual CPU version 2.5+` without `sse4_2`, below Bun's documented minimum. The new CPU guard was verified on this VPS: the deploy command now exits before builds, uploads or remote writes.

### Follow-up: comparison with the existing applications

The operator identified the provider as Namecheap and noted that similar apps already run there. A controlled comparison confirmed that the original blanket conclusion, "this VPS cannot run Bun", was too broad:

| Probe on the same VPS                                                           | Observed result                                                                                                               |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Existing `/root/.bun/bin/bun`, version 1.3.8, minimal JavaScript                | Pass                                                                                                                          |
| Napplet's isolated Bun 1.3.11, identical JavaScript/environment/resource limits | OOM kill at 768 MiB, before output                                                                                            |
| Fresh upstream checksum-verified Bun 1.3.8 baseline, as the `napplet` user      | Pass; binary hash matches the existing runtime                                                                                |
| Inactive release checks using the isolated 1.3.8 copy                           | Typecheck passes; 97 tests pass, 5 fail and one module-load error is reported, with Sharp failing its CPU compatibility check |

The side-by-side probes used clean environments and separate systemd services limited to 768 MiB, one CPU, 12 seconds and no core dumps. The project check used 1536 MiB, two CPUs and a 90-second ceiling. The minimal command was `bun -e 'console.log("NAPPLET RUNTIME OK")'`. No active runtime was replaced and no existing application was restarted. The temporary diagnostic binary and PATH symlink were removed after the comparison.

This establishes a version-specific Bun startup failure on this host, but does not isolate its internal cause. Separately, Sharp explicitly reports `Unsupported CPU: Prebuilt binaries for Linux x64 require v2 microarchitecture`. Therefore, downgrading Bun alone does not make this release deployable. A successful older Bun process is not evidence that the full pinned dependency set supports the same CPU profile. The CPU guard remains justified for the current deployment; it should not be described as proof that every Bun version fails.

Namecheap documents KVM/QEMU virtualization and its customer-facing SolusVM controls, but the published panel guide does not list CPU-model selection. Ask hosting support about availability rather than promising a self-service setting: [virtualization](https://www.namecheap.com/support/knowledgebase/article.aspx/909/48/what-virtualization-technology-is-set-up-on-vps/), [VPS panel guide](https://www.namecheap.com/support/knowledgebase/article.aspx/9974/48/how-to-manage-your-vps-with-solusvm-for-kvm/).

Suggested support request (prepared only; not sent):

> My VPS at 159.198.46.2 exposes "QEMU Virtual CPU version 2.5+" and lacks SSE4.2, SSE4.1, SSSE3 and POPCNT in /proc/cpuinfo. Our current Sharp image-processing library rejects this CPU profile. Can you expose an x86-64-v2-capable CPU model or host passthrough, or migrate the VPS to a host/profile that provides these features? Please confirm availability and any downtime before making changes; existing sites and all server data must be preserved.

Once the provider offers an appropriate CPU profile, coordinate any required stop/start with the existing site's operator, run standard preflight again and redeploy without `--legacy-cpu`. The runtime execution check and full build/tests must pass before activation. The compatibility profile below allows deployment while that support request is pending. External HTTPS and service checks follow activation; personal administrator signing and an actual VPS reboot remain separate operator checks.

### Compatibility build and launcher diagnosis

The explicit legacy profile subsequently passed the complete 112-test application suite, Go race tests and relay/Blossom/GRASP process tests on the VPS. Sharp's WebAssembly alternative was tested first but could not run with either this Bun runtime or the host's Node WebAssembly SIMD support. The deployed compatibility approach therefore builds current native image-library sources with generic x86_64 compiler flags.

The first successful compatibility build stopped at candidate startup, before service activation. Bun 1.3.8 exposed an empty `process.env` when `runuser` inherited `/root`, which the `napplet` account cannot traverse. Consequently the web process ignored `PORT=3041` and tried its default 3000. Controlled launches of the identical production entry and environment reproduced the failure from `/root` and succeeded from the service-owned release directory. The remote helper now changes into that directory immediately after extraction, before any application command. This protects all runtime configuration, including moderation settings, rather than merely overriding the web port. Existing applications stayed available during the failed candidate check.

Activation then exposed two deployment-check defects: GRASP returns formatted NIP-11 JSON, so compact-string matching rejected the correct name/version; and GNU `readlink -f` returned a nonexistent `current` path, incorrectly making first-deploy rollback create a self-referencing link. `deploy-state.ts` now parses JSON and resolves only an actual directory symlink, treating a missing current release as no rollback candidate and rejecting malformed existing links. Regression tests cover both cases. Recovery removed only Napplet's self-referencing link, verified 201 source checksums and the retained native build fingerprints, reran application checks, and used the corrected deployment's activation/rollback section without repeating native compilation.

The first live browser run also caught an SSR stylesheet URL that returned 404 until hydration replaced it. The source archive excludes `.gitignore`; automatic Tailwind discovery could therefore scan the generated client bundle during the subsequent SSR build and produce a different stylesheet hash. `styles.css` now explicitly scopes discovery to `apps/web/src`, following [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files). The Linux rebuild verified that the SSR stylesheet exists in the client output. A JavaScript-disabled browser regression covers stylesheet availability and responsive gallery layout.

## Share previews and optional ContextVM

Deployment sets `SPACE_SITE_ORIGIN=https://<domain>` for canonical and OG URLs and disables `publicdev`. Public dev caches remain outside the archive. The native resvg renderer and its bundled DM Sans font are installed/built for the VPS architecture with the rest of the locked dependencies.

The separate `infra/cvm.ecosystem.config.cjs` can run the ContextVM starter under PM2 with explicit relay URLs and a persistent key path. Automated activation of that optional service and provisioning its relay remain part of the next operator-services slice; the web deployment does not silently start or announce it.

## Creator CLI downloads

The standalone installer and `/cli` guide are served by the web application.
Build and test the creator packages with `bun run cli:build`, then upload them
with `bun run cli:release --host root@your-vps` before deploying a website version
that advertises that CLI version. The upload script verifies all four archives
locally and remotely, preserves immutable prior versions, and requires no web
service restart. The same HTTP download handler serves `.local/cli` in local dev
and `/opt/napplet-space/downloads/cli` in production. Set
`SPACE_CLI_DOWNLOAD_DIR` to override the store. It contains only public versioned
archives/checksums and remains outside application release/rollback directories.
See [CLI guide](CLI.md) for native platform checks and requirements.

### Standalone CLI launch — 2026-09-13

Active release: `20260913190543119-13840`. Rollback release:
`20260913181640977-29742`. Application and release-tool source through `7db71ed`.
Unchanged native services, dependencies and image codecs were reused in an
isolated copy; all 218 deployed source files were checked against local SHA-256
values, the web build was rebuilt with the existing private Bun 1.3.8 runtime,
and all 116 application tests passed on the VPS before activation. Candidate
checks verified the installer and all four download/checksum routes before the
existing rollback-capable Caddy/PM2 activation procedure switched the site.

CLI 0.1.0 archives live in `/opt/napplet-space/downloads/cli/0.1.0`. Their sizes
and SHA-256 values are recorded in `apps/cli/distribution/release-0.1.0.json`.
The release uploader now transfers small verified chunks over four SSH streams,
retries interrupted connections and reuses completed chunks on another invocation.
This was needed after a slow SSH transfer dropped; the old site remained active
throughout transfer and staging.

Post-deploy verification passed:

- Eight live Chromium checks, including mobile layout, SSR styles, OG metadata,
  sandbox restrictions, onboarding and all download links.
- Actual public HTTPS installer into a temporary prefix with no Bun or Node on
  PATH: verified archive → new Git project → frozen browser check → CLI preview.
- Main/admin endpoints, unauthorized administration rejection, www redirect,
  Blossom health, relay/GRASP NIP-11 and WebSocket EOSE, Git metrics protection,
  and the existing `schlaustronics.com` site.
- Native Apple Silicon checks included identity reuse, encrypted recovery,
  publication against isolated local services, idempotent retries and crash
  recovery. Linux ARM64 and x86-64 packages passed fresh browser downloads,
  Secret Service identity checks and sandbox startup in isolated Ubuntu 24.04
  containers. Intel macOS startup and sandbox checks passed under Rosetta;
  the Intel package requires AVX2 on physical Intel Macs.

Temporary test identities were removed. No test creations were published to
public relays. Windows and musl Linux distributions remain unsupported.

## Public relay discovery — 2026-09-13

Active release: `20260913202705982-26454`, application source through `2d2ec24`.
Rollback release: `20260913200901614-97707`; the earlier CLI release remains on disk.

The original deployment read only its managed relay. It now queries that relay plus
Damus, nos.lol and Primal through the persistent indexer; `publicdev` remains disabled.
The first catch-up admitted 114 signed records, producing 91 distinct creations after
validation, replacement/deletion handling and snapshot deduplication (97 gallery cards
including the six examples). This is a current observation, not a fixed catalog size.

Deployment exposed two related compatibility issues: deletion batches exceeded the
managed relay's 64-value tag-filter limit, and Bun 1.3.8's custom DNS path lost the
TLS hostname. The initial activation rolled back; the corrected release uses bounded
deletion batches and the same guarded HTTPS transport in short-lived Node workers.
A valid 9,246,415-byte napplet also exceeded the old three-second mirror deadline;
mirror attempts now have eight seconds within the worker's twelve-second deadline.
Signature, SHA-256, UTF-8, certificate, private-network and size checks remain enforced.

The release reused verified unchanged native binaries and locked dependencies, then
rebuilt the web application. Both Caddy configuration checksums stayed unchanged;
the other VPS site, HTTPS, relay, Blossom and Git endpoints remained healthy.

Verification: 119 application tests and typechecking passed on the VPS; the local
native relay → worker → production SSR → sandbox integration passed. Both opt-in
HTTPS tests passed on Bun 1.3.8, including the 9.2 MB artifact and rejection of
invalid certificates, private addresses and oversized responses. The eight existing
app/onboarding browser checks passed with dynamic-catalog fixture assertions.
Live Rubik Cube playback, OG metadata and responsive rendering passed, followed by
Random Sticker loading/changing/exporting images through the production resource
endpoint. All 225 deployed source checksums matched; PM2 saved the four-relay
configuration for reboot recovery. No test events were published to public relays.

### Installer terminal hotfix, 2026-09-14

Commit `806c6d6` fixes macOS creator prompts that froze after the user paused to
read them. The installer now reopens the actual terminal device instead of the
`/dev/tty` alias. CLI 0.1.0 binaries and their immutable archives are unchanged.

Only `apps/web/public/install.sh` and its served `apps/web/dist/client/install.sh`
copy were atomically updated in active release `20260913202705982-26454`, under the
deployment lock, with automatic rollback on verification failure. Their new
SHA-256 is `69c91010027c6e3416f2c0fd748ecf316bef37a994e71591e2c9227261e6ce58`.
Original copies and the activation record are retained at
`/opt/napplet-space/shared/hotfixes/806c6d6`. This is an explicitly recorded static
hotfix to that release; no services were restarted or proxy configuration changed.

Typechecking, shell syntax, and five installer/distribution integration tests
passed, including delayed input, hidden input cancellation, terminal restoration,
and noninteractive setup. A fresh macOS pseudo-terminal then fetched the actual
HTTPS installer and archive, waited at the creator prompt, and completed setup
with `3` followed by Return. Both hosted websites remained reachable. No creator
keys or public events were created by verification.

## Upstream starter release — 2026-09-14

Active release: `20260914071744622-83832`. Rollback release:
`20260913202705982-26454`. Source: `7f8618d` (CLI/upstream integration) plus
`aba78dd` (indexer readiness). CLI 0.2.0's immutable archives and exact upstream /
toolchain pins are recorded in `apps/cli/distribution/release-0.2.0.json`.
The public installer SHA-256 is
`e6527867fba73f705134adb93ef7ea38e59f93edcd240f89b09e0833c0c8ad7e`.
Older CLI 0.1.0 archives remain available.

The release reuses unchanged native service binaries and dependencies, builds the
website with the existing Bun 1.3.8 legacy CPU profile, and passes all 124 checks
on the VPS before activation. The Caddy parent and Napplet fragment hashes remain
`be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f` and
`e5da7681ad68641e0e6d18c77463cb94a403615b5bcfe4b8ca01e3858736bfba`.

An initial activation rolled back because the old readiness script demanded zero
errors from every discovery relay. Readiness now requires an enabled, fresh
indexer report bearing the candidate release ID; unavailable public relays remain
visible in health reporting and do not prevent website deployment. Missing, stale
or previous-release reports still fail. Native services retain their own readiness
checks. Damus query timeouts were present during verification; other discovery
relays remained configured and the index report was fresh.

Verified the public HTTPS installer end to end with isolated account/install paths
and global runtimes removed from PATH: checksum-verified CLI 0.2.0, default upstream
scaffold, embedded skills, dependency install/build, sandbox check and preview.
The packaged Mac CLI also passed delayed terminal input/cancellation and corrupt
archive tests, upstream verification/conformance, storage and live rebuild checks.
Linux ARM64/x64 created and verified the upstream starter in disposable Ubuntu
containers without global runtimes; the macOS Intel binary started under Rosetta.
Upstream conformance reported 5 pass / 0 fail / 5 documented skips.

Live checks covered the default create command and CLI guide, HTTP/HTTPS and www
redirects, admin authentication, both relay WebSockets/NIP-11 endpoints, Blossom,
blocked Git metrics, and the existing `schlaustronics.com` site. No test creations
were published to public relays.

## Prepared locally: community features and CLI 0.3.0

This checkout adds signed permanent `/@handle/slug` claims, pinned-source remixes,
Nostr comments/replies, likes/unlikes and the LNURL zap flow. Community state lives
in the persistent `community` directory; it must survive application rollbacks.

CLI 0.3.0 archives have been built locally for macOS/Linux on ARM64 and x64. Their
source revision, sizes and checksums are in
`apps/cli/distribution/release-0.3.0.json`. The archives remain in `.local/cli/0.3.0`.
The native macOS package and piped installer passed their local tests. Linux and
Intel macOS targets were built but were not executed on those operating systems.

No artifacts have been uploaded and no VPS deployment was performed for this
change. This recorded 0.3.0 preparation is superseded by the 0.3.1 preparation below.
For a version whose archives are built, release the CLI first:

```sh
bun run cli:release --host root@159.198.46.2
```

Then run your normal website deployment command. Existing installed CLI users
rerun the website installer to receive 0.3.0. See [community behavior and limits](COMMUNITY.md)
and [remix provenance](REMIXING.md) before rollout. Zap invoice validation uses
signed fixtures, and the browser wallet was simulated; no Lightning payment was
sent during these checks.

## Prepared locally: preview authoring and CLI 0.3.1

The current source fixes generated player covers, adds automatic sandbox PNG
capture and linked app descriptors, and exposes editable publishing profiles.
The creator integration note now covers destinations and visual preview review.
Impact Yard's saved published build was captured locally for inspection; its
project and signed live listing were not modified.

Version 0.3.1 archives are built locally for macOS/Linux ARM64 and x64 at
`.local/cli/0.3.1`; checksums and source revision are recorded in
`apps/cli/distribution/release-0.3.1.json`. Do not replace older version archives
with new bytes. Release these downloads before deploying the site:

```sh
bun run cli:release --host root@159.198.46.2
# Then use the usual website deployment command.
```

The existing public installer stays unchanged until you deploy. Local checks do
not publish creator events, upload downloads, or change the VPS. Creators using
an older binary must rerun the deployed installer before using the new config
fields. A subsequent napplet publish supplies the preview; existing publications
are never rewritten merely by deploying this site or installing the CLI.

Validation: 142 main tests and type checking, two gallery/player browser checks,
and three local capture/service tests passed. The macOS ARM64 packaged binary
also passed scaffold/config/screenshot/check with Bun and Node removed from PATH.
Other platform binaries were built, not executed on this machine. The optional
native-keychain publication test was skipped; local service tests used a temporary
creator and verified signed descriptor readback independently.

### Creator listing preview and community update — CLI 0.4.0

The CLI archives are prepared locally under `.local/cli/0.4.0`. This update includes
Play/Listing views and screenshot capture in local dev. The website adds
install-and-remix commands, comment likes and zaps, and administrator Featured
selections. Newest is the default; examples enter the gallery through ordinary
discovery rather than being automatically prepended. Local dev seeding still works.

Release the new CLI downloads **before** deploying the website's updated installer:

```sh
bun run cli:release --host root@159.198.46.2
# Then run the usual website deployment command with your existing VPS options.
```

After deployment, creators rerun the installer, restart `napplet-space dev`, and
run `napplet-space skills update` in existing projects. No account migration is
needed. The existing administrator pubkey controls Featured through `/admin`;
there are no default selections and no new private key or environment variable.
Old moderation policies load with an empty Featured collection. Existing naddr
routes remain valid; readable aliases are claimed once by their author on the site.

Verification covers the unit suite, local website/browser flows, local screenshot
capture and native macOS CLI/installer flows. Invoices and wallets used signed
fixtures or mocks. No live payment, creator publication, CLI upload or deployment
was performed by these checks.

## Live community and listing-preview release — 2026-09-14

Deployed at the operator's explicit request. Active release:
`20260914110729417-3123`, source through `ede7985`; previous release
`20260914094917291-67355` remains available for rollback. The deployment used the
existing shared-Caddy profile, web port 3040, legacy CPU runtime and administrator
public key. No DNS changes or VPS reboot were performed.

CLI 0.4.0 archives were uploaded and verified before website activation. All four
platforms have public HTTPS downloads with the recorded sizes and SHA-256 checksums
in `apps/cli/distribution/release-0.4.0.json`. Older versions remain available.

The full deployment script passed typechecking, all 144 application tests, Go race
checks and the relay, Blossom and GRASP process suites both locally and on the VPS.
It built a fresh candidate, checked service fingerprints and the index heartbeat,
then activated the release and saved all five PM2 processes. Caddy is active and
Napplet's startup unit is enabled. All five processes were online with zero restarts
when verified. This confirms startup registration; it is not a whole-VPS reboot test.

Both Caddy configuration hashes are unchanged from before deployment:

- Parent: `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`.
- Napplet fragment: `e5da7681ad68641e0e6d18c77463cb94a403615b5bcfe4b8ca01e3858736bfba`.

Public HTTPS verification passed for all eight browser rollout checks, including
ordinary gallery navigation, desktop/mobile rendering, SSR styling and OG previews,
sandbox restrictions, pinned/named routes, and onboarding/download links. The new
gallery showed 26 playable entries at the time of checking, with an empty Featured
collection and no automatically prepended examples. This count can change as relay
content and download availability change.

Impact Yard remix loaded its screenshot and ran in the opaque sandbox. Its Remix
this dialog offered both CLI commands. An actual curl-piped public installer,
using temporary install/account paths and no global Bun or Node on PATH, installed
0.4.0 and remixed that exact published creation locally with provenance intact.
Identity setup and dependency installation were disabled for this check, and the
temporary project/installation was removed afterward.

The main health endpoint reports the new release and a fresh index heartbeat;
Blossom health, both relay NIP-11/WebSocket read subscriptions, unauthenticated admin
rejection, www permanent redirect and Git metrics protection passed. The other site,
`schlaustronics.com`, still returns HTTPS 200. Damus query timeouts existed before
this deployment and remain visible in index diagnostics; managed-relay, nos.lol and
Primal discovery remain configured. No test comments, payments, name claims or
creator publications were sent to the public instance.

## Relay subdomain and discovery rollout

New deployments default to `wss://relay.<domain>`; override with `--relay-domain`.
Point its A/AAAA records at the VPS. Caddy serves the same relay process at the
subdomain root and obtains its TLS certificate. The original `/relay` endpoint
remains a compatibility alias for signed historical hints and older CLI projects.
New CLI 0.4.1 projects/remixes and unconfigured projects use `wss://relay.napplet.soy`.
Explicit project destinations and signed events are preserved. To change an existing
project's pinned destination, edit `napplet.json` → `publish.networks.public.relay`.

Index transport can use the internal loopback relay while portable hints and the
browser default use the public subdomain. Custom operator relay lists remain
configurable. Shared-Caddy preflight checks hostname ownership even when adding a
hostname to an existing Napplet deployment.

The same rollout adds [paged/inline discovery and cold-link OG](DISCOVERY.md), plus
[daily state backups and an offline restore command](RECOVERY.md).

## Live relay and discovery release — 2026-09-14

Active release: `20260914121312140-13099`, source through `045269f`. Previous release
`20260914110729417-3123` remains available. The operator requested this deployment;
it used the existing shared-Caddy, port 3040, legacy CPU and administrator profile.
CLI 0.4.1 downloads were uploaded and verified before website activation; all four
platform artifacts are recorded in `apps/cli/distribution/release-0.4.1.json`.

Caddy obtained a certificate for `relay.napplet.soy`. HTTPS NIP-11 and WSS read
subscriptions pass at both `wss://relay.napplet.soy` and the historical
`wss://napplet.soy/relay`, as well as the GRASP relay. Internal loopback relay reads
also retain their `/relay` route. Each allowlisted alias has its own NIP-42 URL
binding. Release markers preserve the appropriate relay origins and index hints
during rollback to versions predating the subdomain.

The shared parent Caddyfile is unchanged:
`be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`.
Napplet's fragment changed to add its new hostname:
`ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`.
The other site, `schlaustronics.com`, still returns HTTPS 200. No DNS changes or
VPS reboot were required. All five Napplet PM2 services and Caddy are healthy.

Validation passed typechecking and 151 application tests, Go race/relay checks,
the native relay/Blossom/GRASP deployment suites, the index and cold-discovery
service tests, five packaged macOS CLI/installer tests, and eight browser checks
against the public deployment. The cold-discovery fixture proves exact Nostr
lookup from an empty catalog, signed SSR OG metadata and PNG delivery, delayed
download navigation, single inline playback, fullscreen session continuity and
mobile offscreen cleanup. It does not publish test events to public relays.

Public rollout checks additionally exercised pagination (24 entries on page one,
26 playable matches at verification), empty Featured selection, the user's Impact
Yard remix screenshot and sandbox, fullscreen continuity, both remix commands,
admin rejection, redirects and download availability. The standalone rollout
probe initially clicked a stale page-two card during page-one navigation; waiting
for page-one pagination content corrected the probe, with no application change.
Managed-relay hints now use the subdomain. Existing Damus query timeout diagnostics
remain visible; the index heartbeat is fresh and the other relays remain configured.
No comments, payments, name claims or creator publications were sent by these checks.

The first production backup is
`/var/backups/napplet-space/napplet-20260914T122749Z.tar.gz` with its adjacent checksum.
All 264 file hashes passed. A separate root-only restore directory on the VPS passed
four SQLite `quick_check` checks and four Git `fsck --full` checks; the rehearsal
directory was removed afterward. Production state was not replaced. The five
services restarted successfully after the backup's brief copy pause, and public
health checks passed again. The enabled timer next runs on September 15 around
03:22 UTC, then daily with its configured jitter; fourteen verified archives are
retained. This verifies archive restoration, not a complete rebuild onto a new VPS.

Backups currently remain on the VPS. Automatic approval review declined the proposed
copy to this laptop because the archive includes production service keys and that
sensitive destination was not explicitly authorized. No off-VPS copy or automatic
offsite replication was performed. See [recovery](RECOVERY.md) for operator copy and
restore instructions.

## Identity, configuration and social release — 2026-09-14

Release: `20260914142718446-76864`, source through `dd75e01` (superseded by the source-browser release below).
The previous release `20260914121312140-13099` remains available for rollback.
The user explicitly authorized this deployment after completing A03/A04. It also
releases the previously verified A11 configuration and A17 gallery/social work.

CLI **0.5.0** artifacts were uploaded and checksum-verified before the website
installer was activated. [Release metadata](../apps/cli/distribution/release-0.5.0.json)
records all four platform archives and their source revision. Existing installations
can update with `curl -fsSL https://napplet.soy/install.sh | sh`; no Bun installation
is required. `napplet-space account pair` provides a client-generated NIP-46 link
and terminal QR; the existing hidden bunker flow remains available.

The browser chooser supports extensions, both NIP-46 directions and private-key
import after an explicit warning. Sessions are memory-only and clear on refresh or
disconnect. The selected identity signs social, naming and administration requests.
Signer transport defaults to `wss://relay.napplet.soy` and remains separate from
publication targets. [Identity and recovery](IDENTITY.md) records permissions,
reconnect behavior and remaining external-signer compatibility work.

Validation: 177 repository tests and typechecking; Go race/relay, native Blossom
and GRASP suites on the development machine and VPS; production browser checks
for both NIP-46 flows, canceled pairing, key import, refresh and switching; encrypted
relay tests for forged acknowledgements, signer substitution, exact signatures,
permissions, timeouts and reconnect; and six packaged macOS installer/terminal
checks, including QR generation and Ctrl+C cancellation. Existing gallery and
detail-page social integration tests also pass. No personal credentials, social
posts or Lightning payments were used for deployment validation.

After activation, **12 public browser checks passed**: gallery/SSR/navigation,
opaque sandbox playback, tamper rejection, portable/pinned/source routes, mobile
layout and signer guidance, OG previews, config forms/fullscreen/reload, runtime
storage/files, and identity changes in an existing frame. Public service checks
confirmed installer version, all four download checksums/sizes, NIP-11, read-only
WSS subscriptions on the relay subdomain and compatibility alias, Blossom health,
unauthenticated admin 401, and a fresh indexer report with our relay plus external
discovery relays and no reported errors.

All five Napplet PM2 processes are online and Caddy is active. The deployment
starts PM2 directly; `napplet-space.service` is enabled for boot and currently
inactive, matching the existing startup arrangement. The shared Caddy hashes are
unchanged:

- Parent: `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`.
- Napplet fragment: `ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`.

`schlaustronics.com` continues to return HTTPS 200. The deployment retained the
shared-Caddy, web-port 3040 and legacy CPU profile; no DNS changes or reboot were
needed. Local verification records are under `.local/identity-check/`.

## Source-browser release — 2026-09-14

Release: **`20260914151021458-42270`** (superseded below), application changes through `5b27d36`
and updated deployment smoke check `483b406`. Previous release:
`20260914142718446-76864`. The user explicitly requested this deployment after
locally verifying the source browser and gallery layout fix.

Deployed the removal of the gallery’s “Liked.” / “Like removed.” success lines;
filled hearts and counts provide success feedback, while errors/retry remain. Every
napplet detail page now offers **Browse source**: a pinned file tree, highlighted
read-only text, license, author-recorded commit, file permalinks, download and remix
links. The existing optional signed archive convention enables original files;
**Built HTML** remains an explicit fallback. Current-manifest event IDs now resolve
consistently on pinned routes, and source inspection is available while playable
artifact discovery is pending. See [source inspection](REMIXING.md#browsing-a-releases-original-files).

CLI **0.5.0** remains the deployed CLI; this release required no new native archives.
The larger-media creator workflow is still planned in A19, with the current supported
asset path documented in [ASSETS.md](ASSETS.md).

Deployment reran 181 repository tests and typechecking on both the development
machine and VPS, plus Go race/relay checks, 16 Blossom checks and eight GRASP checks.
The script built and tested its candidate before activation and completed successfully
with the established shared-Caddy, port 3040 and legacy-CPU settings.

After activation, **12 public browser checks passed** for gallery/SSR/navigation,
opaque sandbox playback, tamper rejection, portable/pinned/source routes, mobile
layout, signer guidance, OG previews, configuration/fullscreen/reload, runtime
storage/files and identity changes in an existing frame. A separate read-only check
opened the author’s **Impact Yard remix** at exact event
`5b31a37bbd0726a41cd92a07953ba31d3b584fc822f5499d9bfe1b6e180484ab`:
47 original files were browsable, highlighted text and file downloads matched,
archive SHA-256 matched the signed reference, and the built-HTML fallback stayed
inert. Desktop and mobile views passed without horizontal page overflow.
[Live source page](https://napplet.soy/r/5b31a37bbd0726a41cd92a07953ba31d3b584fc822f5499d9bfe1b6e180484ab/source).

Public checks also passed for HTTPS health with the new release ID, fresh indexer
state using the managed and external relays without errors, relay NIP-11/read-only
WSS subscriptions (including the old compatibility alias), Blossom health,
unauthenticated admin 401, installer version and all four CLI archive sizes/checksum
files. No real social events, personal credentials or payments were used.

All five Napplet PM2 processes are online; Caddy is active. Both configuration hashes
match the pre-deploy values:

- Parent: `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`.
- Napplet fragment: `ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`.

The other site, `schlaustronics.com`, returns HTTPS 200. No DNS or proxy changes or
reboot were needed. Local deployment logs, service results, browser results and
source screenshots are retained in `.local/source-deploy/`.

## Immersive player and social controls release — 2026-09-14

Active release: **`20260914171728494-21459`**, source through `105dd2f`.
Application changes are `bb631ac`, `a43a92b` and `74faff9`; `105dd2f` stabilizes
an existing admin-auth test. Previous release `20260914151021458-42270` remains
available for rollback. The user explicitly requested this deployment. It used
the existing shared-Caddy, web-port 3040, legacy CPU and administrator profile.

This release adds `/play` to named, portable and pinned napplet routes, retaining
the running iframe and host session across fullscreen/detail changes and browser
Back/Forward. Gallery and ranking cards now have a share icon; detail pages show
like/count, share and zap icons beneath the creator. Header and discussion controls
share one conversation and retry state. Likes require sign-in; sharing and anonymous
zaps remain available to guests. See [playback](PUBLIC-RUNTIME.md#immersive-links)
and [community controls](COMMUNITY.md#social-actions). CLI **0.5.0** is unchanged;
no native CLI archives were replaced.

The first attempt stopped during local validation, before uploading or changing
the VPS. An auth test created a request 31 seconds in the future; crossing a clock
second before verification made it valid at the allowed 30-second boundary. A
controlled-clock reproduction confirmed the cause. Freezing the test clock fixed
the race and passed 20 consecutive runs without changing server authorization.
The successful deployment reran typechecking and all **181 repository tests** on
both machines, Go race/relay checks, **16 Blossom tests** and **eight GRASP tests**.
It built the production web/native services and validated the candidate before
activation.

After activation, all **12 public app/runtime browser tests passed**, including
SSR/navigation, sandbox and hash enforcement, source routes, OG previews, mobile
layout, identity changes, settings, storage and file exports. Additional live checks
verified gallery/header sharing while signed out, disabled guest likes, enabled
zap controls, portable/pinned/named detail routes, and playback of the published
**Impact Yard remix** at event
`5b31a37bbd0726a41cd92a07953ba31d3b584fc822f5499d9bfe1b6e180484ab`.
Back to details retained its iframe. A controlled ordinary example also verified
native-to-CSS fullscreen exit, Back/Forward, play-link copying and retained instance
storage. Portrait/landscape screenshots were inspected with no horizontal overflow.
The temporary sharing check needed to await hydration before clicking the SSR button.
Real-device Safari/iOS coverage remains a follow-up. No social events, personal
credentials or Lightning payments were submitted during live validation.

Public checks passed for the expected HTTPS release, relay NIP-11 and read-only WSS
subscriptions on both relay URLs, Blossom health, GRASP identity, unauthenticated
admin 401, installer version and all four CLI archive sizes/checksum files. An
initial Damus discovery error cleared on the next observed refresh; the final
indexer report was fresh, non-stale and error-free, using managed and external relays.

All five Napplet PM2 processes are online with zero restarts; Caddy is active. Both
configuration hashes match the pre-deploy values:

- Parent: `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`.
- Napplet fragment: `ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`.

`schlaustronics.com` returned HTTPS 200 during the build and after activation.
No DNS changes or reboot were needed. Logs, the focused live browser script and
screenshots are retained in `.local/immersive-deploy/`. AGENDA A02/A17 and their
feature documents now record this deployment; A05 remains the next planned slice.

## Onboarding, About and key recovery release — 2026-09-14

Active release: **`20260914192251320-98168`**, source through **`45e09c1`**.
Previous release `20260914171728494-21459` remains available for rollback. The user
explicitly requested deployment. The existing shared-Caddy, web-port 3040, legacy
CPU and administrator configuration was used; no DNS changes or reboot occurred.

This release includes the account-free onboarding hero and 30-second Remotion film
(A06), About/resources route (A05), and browser key generation with encrypted NIP-49
backup/recovery (A04). Repository links remain deferred until the user creates those
repositories. The website uses checked-in video assets; deployment does not render
Remotion. CLI **0.5.0** and all four native archives are unchanged.

Deployment passed typechecking and **185 repository tests** on both machines,
Go race checks, **four relay**, **16 Blossom** and **eight GRASP** service tests.
It built the production services and website, checked the candidate, then activated
it. The legacy host's GRASP dependency build took about four minutes, followed by
its production build; both websites remained reachable during that work.

Public verification passed:

- The exact HTTPS release ID, managed and legacy relay NIP-11/read subscriptions,
  GRASP NIP-11, Blossom health, unauthenticated admin 401, installer version,
  and all four CLI artifact sizes and checksum files.
- Hero command visibility at 320×568, 390×844, 768×1024 and 1365×900; no horizontal
  overflow; no-JavaScript route/transcript; clipboard success/fallback; no video
  request until Play; five caption cues, 30-second duration and seeking through
  Caddy; Escape cleanup and focus return. The video is 2,711,233 bytes and its poster
  22,336 bytes, matching the verified local assets.
- About SSR, mobile layout and resources; browser identity generation, backup
  acknowledgement, encrypted downloads, repeat export, same-key recovery, wrong
  passphrase rejection, cancellation, refresh and disconnect. This used a temporary
  browser identity; no personal credentials, social events or payments were submitted.
- **All 13 public app/runtime/installer browser regression tests**, including gallery
  navigation, sandbox/hash enforcement, source routes, OG previews, fullscreen
  settings, scoped storage, exports and identity changes.

The final discovery report was fresh, non-stale and error-free. Pre-deploy Damus
query errors were absent in this report. All five Napplet PM2 processes were online
with zero restarts; Caddy was active and Napplet startup registration remained enabled.
Both shared proxy configuration hashes match the pre-deploy values:

- Parent: `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`.
- Napplet fragment: `ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`.

`schlaustronics.com` returned HTTPS 200 during the build and after activation.
Live screenshots were inspected. Logs, focused live browser scripts and captures
are retained under `.local/onboarding-deploy/`. A04/A05/A06 and their feature docs
now record this deployment; A07's featured hero rotation is next.

## Preview video release preparation — 2026-09-15

Source now includes immersive link choices and optional signed WebM previews.
soyLI **0.7.0** packages are built locally; the
[release record](../apps/cli/distribution/release-0.7.0.json) contains their hashes,
source commit and verification coverage. macOS arm64 executed the packaged capture
flow without Bun/Node on PATH; the other three targets have build-only evidence.

No CLI upload or VPS deployment was performed for this slice. Upload the versioned
CLI downloads with `bun run cli:release --host <ssh-target>` before deploying the
website/installer with the normal deploy command. Existing 0.6.0 artifacts remain
unchanged. The index worker's `app-descriptors-2` cache profile refreshes optional
media after deployment. Creators add clips by recording and republishing; existing
napplets retain their static covers and playback behavior.

## Rich comments and soyLI 0.7.0 release — 2026-09-15

Active release **`20260915084016730-23084`**, source **`1220634`**, serves napplet.soy,
relay.napplet.soy, blossom.napplet.soy and git.napplet.soy. soyLI **0.7.0** is
published for macOS/Linux arm64/x64. The unchanged built artifacts' hashes and
native-vs-build-only coverage are recorded in
[release-0.7.0.json](../apps/cli/distribution/release-0.7.0.json).

The user authorized rich comments followed by this upload/deploy checkpoint.
Preflight found the operator-deployed release `20260915065532698-61224` and CLI
downloads through 0.6.0. All four 0.7.0 archives were uploaded with chunk retries
and complete remote hash checks before activating the new installer.

Rich comments first activated in `20260915082613203-96523` from `2e303e8`.
Broad browser verification then exposed a pending file prompt that stole focus
and cancelled account connection. Commit `1220634` makes its focus callback
stable; the same execution context now survives sign-in/out while scoped storage,
exports and pending prompts are correctly retired. This follow-up went through
the same full deployment script. Older browser fixture assumptions were corrected
for explicit legacy single-file editing, inline gallery play and the combined guide.

The source includes rich comments, optional short video previews, immersive sharing,
reactive administration/entity search, managed admins/Featured order, remembered
Applesauce accounts, profiles/genealogy, README excerpts, button feedback, the
anchored identity popup, combined creator guide and the GitHub About link.
Rich-comment behavior and bounds are documented in [COMMUNITY.md](COMMUNITY.md#rich-comment-presentation--2026-09-15).

Verification:

- **227 repository tests**, typecheck, Go race checks, **4 relay**, **16 Blossom**
  and **8 GRASP** service tests passed locally and on the legacy Linux VPS. The
  candidate production build and health checks passed before activation.
- Four focused local browser flows passed for rich comments, social writes,
  immersive sessions and gallery clips. The pending-prompt sign-in regression
  also passed against the corrected local production build.
- **17 browser regressions passed**, including 13 against production and four
  self-contained local fixtures. Four opt-in catalog/service checks were skipped.
  These cover gallery/navigation, sandbox/hash rules, installer/downloads, source,
  OG, configuration, storage/files and account changes.
- A separate live mobile/desktop rich-comment check exercised click-to-play,
  verified canvas, opaque sandbox, Stop and responsive width. Its signed comment
  was a browser-only fixture; no production test comments or payments were posted.
- HTTPS health matched the exact release; discovery was fresh and error-free.
  Managed/legacy relay NIP-11 and WebSocket reads, GRASP NIP-11, Blossom health,
  unauthenticated admin rejection, unknown comment-media rejection, installer
  version and all four CLI download sizes/checksum files passed.

All five PM2 services are online with zero restarts. Caddy is active and Napplet
startup is enabled. Shared proxy hashes stayed unchanged:

- Parent: `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`.
- Napplet fragment: `ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`.

schlaustronics.com returned HTTPS 200 during builds and after activation. The release
archive includes the WebM test fixture and excludes private planning, credentials,
Git metadata and local artifacts. Logs and inspected screenshots remain under
`.local/rich-comments/` and `.local/rich-comments-*.log`.

## Shared audio and soyLI 0.8.0 preparation — 2026-09-15

Source commits `32ee2c0` and `bb12568` add the [NAP-MEDIA audio subset](MEDIA.md)
to the shared website/creator-preview host, including live HTTPS MP3 streams.
The runtime profile is now `space-playback-2`, causing discovery to reconsider
napplets previously excluded for missing media support. The iframe sandbox and
existing resource-download bounds remain unchanged.

All four soyLI **0.8.0** archives are prepared locally. Their source commit, hashes
and verification coverage are recorded in
[release-0.8.0.json](../apps/cli/distribution/release-0.8.0.json). Native execution is
verified on macOS arm64; the other targets have build-only evidence. The final native
CLI plays the unchanged Drone Zone build's live stream without Bun/Node on PATH.
The production web build also streams the real MP3, including fullscreen controls
and teardown. Verification passed: 234 repository tests/typecheck, production build,
three media/publication service tests, five runtime browser regressions and seven
native CLI distribution/terminal/preview tests. The real Node fallback transport
delivered successive stream chunks and cancelled on this development machine;
the VPS still needs deployment and a post-deploy playback check.

**No archives were uploaded and no VPS deployment was performed for this change.**
The operator owns deployment. Upload the archives before activating the 0.8.0
installer with the website:

```sh
bun run cli:release --host <ssh-target> && bun run deploy --host <ssh-target> --domain napplet.soy --shared-caddy --web-port 3040 --legacy-cpu --admin-pubkey <admin-pubkey>
```

Installed creators must separately rerun the installer without new/remix arguments,
verify `soyli --version` reports 0.8.0, stop the old dev server, run `soyli skills update`
and restart `soyli dev` in their existing project. No identity, dependency or source
migration is required. Review managed-file conflicts without overwriting local edits.

## Blossom timeout correction and soyLI 0.8.1 — 2026-09-15

Operator deployment of 0.8.0 was observed read-only: public health reports
`20260915113546965-84858`, the installer selects 0.8.0, and all four public checksum
files match the prepared release record. This observation does not constitute a
new VPS deployment, process audit or production audio acceptance check.

Commit `949fc97` replaces Blossom's fixed 20-second upload-body deadline with
30-second inactivity and five-minute overall limits. The shared client allows six
minutes for upload and independently gives verification five minutes with a 30-second
idle timeout. Publication resume uses that same verification policy. The 50 MiB
blob limit, signature/hash checks, ownership quotas and frozen release identity remain
unchanged. See [the policy and retry procedure](BLOSSOM.md#upload-timeout-correction--soyli-081).

The paced 11 MiB regression first failed with HTTP 408, then passed while taking
over 24 seconds. Raw HTTP idle/trickle tests verify explicit 408 responses, removal
of partial files and release of upload slots. Client tests cover independent phase
budgets, idle/overall/caller cancellation, changed hashes, oversized responses and
redirect refusal. Repository checks, the complete Blossom service/process suite,
publication/retry integration and the production web build passed.

soyLI **0.8.1** archives are prepared locally; their hashes and exact verification
coverage are in [release-0.8.1.json](../apps/cli/distribution/release-0.8.1.json).
**No CLI upload or VPS deployment was performed for this correction.** Use the same
CLI-upload-then-deploy command above. Both the service and creator CLI need updating.
After installation, verify `soyli --version` reports 0.8.1, then retry the existing
project with `soyli publish --resume`. Incomplete blobs restart with their existing
frozen bytes; completed, owned and hash-verified blobs are reused.

### Legacy-runtime test framing correction

Operator candidate `20260915140419482-99477` stopped during the Blossom checks,
before activation. The previous release `20260915113546965-84858` remained active.
The paced-upload test reproduced HTTP 411 under the VPS's Bun 1.3.8. A synthetic
raw-header capture confirmed that its `node:http` adapter replaced streamed writes
with `Transfer-Encoding: chunked` and omitted the explicitly supplied Content-Length.
The Blossom service correctly rejected that request; the product uploader uses native
fetch with a byte array and does not use this test transport.

The timeout tests now share a bounded raw HTTP helper that sends literal
Content-Length framing, handles early failures and preserves incremental body writes.
The same 11 MiB upload still takes over 23 seconds; the test is neither skipped nor
weakened. This is test-only: service source, deadlines and soyLI 0.8.1 archives are
unchanged. Re-run the normal deployment command from the corrected checkout;
already uploaded, verified 0.8.1 artifacts do not need rebuilding or re-uploading.

Verification passed: typecheck and all 18 local Blossom service/process tests on
Bun 1.3.11; all 21 Blossom service/process and uploader tests on the VPS's Bun 1.3.8.
The remote checks used a disposable directory, loopback ports, temporary blob data
and the deployment's pinned Go PATH. No candidate activation or CLI upload occurred.

## Blossom timeout rollout and HTTPS host verification — 2026-09-15

Release `20260915142033151-25517` activated source `27d7ba5`, including the upload
correction and literal HTTP framing for the Bun 1.3.8 regression tests. The standard
deployment checks passed locally and on the VPS: 236 repository tests, typecheck,
Go race tests, four relay tests, 18 Blossom tests and eight GRASP tests. The website
and discovery index, relay subdomain/compatibility path, Blossom and Git NIP-11
endpoints passed public HTTPS checks. `schlaustronics.com` continued returning 200.

All four existing public soyLI 0.8.1 archives were SHA-256 checked on the VPS against
the local release record; no archive was replaced. The live installer selects 0.8.1.
A fresh temporary macOS arm64 installation verified the served installer, downloaded
and verified the archive and ran `soyli --version` with Bun/Node absent from PATH.
The user's installed CLI, accounts and unfinished project were untouched.

A temporary, independently signed 11 MiB upload to the production Blossom service
took 78,816 ms and returned 201. The downloaded bytes matched the original SHA-256;
signed deletion returned 204 and subsequent HEAD returned 404. No napplet was
published. Three live Chromium checks passed: gallery filtering/navigation, no-JS
responsive SSR and mobile onboarding with all four download links.

Playback verification found an additional production-only origin mismatch: browser
Origin was HTTPS while Caddy's internal request URL was HTTP. Invalid-body probes
returned 403 for the correct HTTPS origin and 400 for the HTTP origin, isolating the
fault before source/DNS validation. Source `f2ffa08` makes the web audio/resource
responders use `SPACE_SITE_ORIGIN`, preserving loopback defaults in soyLI and rejecting
opaque/foreign origins and spoofed forwarded headers. All 238 repository tests and
typecheck pass, including ten audio/resource tests with the production origin set.
The deployment now checks this origin behavior on the candidate before activation.

Follow-up release `20260915143300255-41346` activated `f2ffa08` successfully. The full
checks passed again locally and on Bun 1.3.8 (238 repository tests plus the same
service suites), and the new candidate-origin probes passed. Production Chromium
created an audio session through HTTPS, streamed the real MP3 beyond four seconds,
retained its controls in fullscreen, paused, and removed the iframe/audio source on
teardown. A host resource request returned its expected bytes. The VPS's actual Node
compatibility worker also independently streamed successive MP3 chunks and cancelled.
This verifies the supported audio subset on production; physical iOS/Safari acceptance
and the other unsupported media modes remain as documented in [MEDIA.md](MEDIA.md).

Final checks confirmed the expected release and fresh discovery index, all five PM2
processes online with zero restarts, Caddy active and service startup enabled. Both
`/etc/caddy/Caddyfile` and `/etc/napplet-space/Caddyfile` retained their exact pre-rollout
SHA-256 values. `schlaustronics.com` still returns HTTPS 200. CLI 0.8.1 archives remain
unchanged; the follow-up corrects website origin configuration only.

## Runtime relay-read correction — 2026-09-15

Release `20260915153437840-89080` is active from website source `9116077`.
The public installer serves soyLI **0.8.2**; all four archives were uploaded and
verified before activation. The [release record](../apps/cli/distribution/release-0.8.2.json)
contains CLI source, SHA-256 values, sizes and execution coverage. Previous archives
were preserved. A fresh isolated macOS arm64 install passed without Bun/Node on PATH.

The repair separates public runtime reads from discovery relay selection. Explicit
relay hints and NIP-65 read plans go through a shared, bounded, guarded host transport.
The exact published Drone Zone immersive route now finds its station, decodes the
MP3 and pauses through the napplet's own controls in desktop and touch/mobile
Chromium. These checks use no query override, and the napplet was not edited or
republished. See [runtime policy](PUBLIC-RUNTIME.md#runtime-relay-routing--soyli-082).

Deployment checks passed locally and on VPS Bun 1.3.8: typecheck, 244 repository tests,
Go race checks, 4 relay, 18 Blossom and 8 GRASP tests. Candidate probes verified HTTPS
Origin handling for media, resources and relay-read before activation. All five PM2
services are online with zero restarts; the catalog and public service checks pass.
Both Caddy configuration hashes are unchanged, and schlaustronics.com returns HTTPS 200. The existing 50 MiB Blossom limit and prior upload-timeout correction are retained.

## Linked asset list — 2026-09-15

Release `20260915171125013-66174` activated website source `af069d2`. Detail pages
now expose linked images, video clips and source archives beneath the player;
see [preview delivery and limits](PREVIEWS.md#linked-assets-on-detail-pages).
The current-listing source lookup also works in the public-dev catalog.

The normal deployment completed all checks locally and on VPS Bun 1.3.8:
typecheck, 250 repository tests, Go race tests, four relay tests, 18 Blossom tests
and eight GRASP tests, followed by production builds and candidate activation
checks. Two focused Chromium fixtures verify actual image/clip responses, source
archive byte equality, existing gallery/playback/OG behavior, responsive layout,
SSR links and immersive hiding. No test events were published.

On the unchanged published Drone Zone page, the live list contains its image,
9-second WebM and source archive. The image endpoint returns PNG, the clip endpoint
returns a valid partial WebM response, and links render without JavaScript. The
390px layout fits without horizontal overflow. All five PM2 processes are online
with zero restarts, the new release's worker heartbeat is ready, and its first
completed discovery scan is fresh. External Damus query timeouts remain reported;
owned relay endpoints pass. Both Caddy configuration hashes match the pre-rollout
values, and schlaustronics.com still returns HTTPS 200.

The public installer remains on soyLI 0.8.3. Existing archive sizes/checksums were
verified and no CLI artifacts were replaced. The prior runtime deadline and
indexer-readiness corrections remain included in this release.

## Direct protocol access and soyLI 0.9.0 — 2026-09-15

Active release: **`20260915191931258-56634`**, website source **`9e17ae3`**.
Rollback release: `20260915171125013-66174`. The standard shared-Caddy deployment
ran with web port 3040 and the existing legacy CPU profile. No provider CPU changes
or VPS reboot were needed. All five PM2 processes are online with zero restarts.

This release removes the sixteen protocol REST proxy routes and generated protocol
RPC counterparts. SSR remains server-only; browser data, media and playback use
Nostr and original Blossom URLs. Public `SPACE_INDEX_HINTS` are forwarded to the
browser instead of the indexer's loopback URLs, and the configured public Blossom
origin is retained. Candidate probes now verify removed proxies return 404 and
unauthenticated administration returns 401. [Transport inventory](PROTOCOL-ACCESS.md).

soyLI **0.9.0** includes the shared direct preview and remix transports. All four
immutable archives were uploaded in verified chunks before installer activation.
Their hashes and execution coverage are in
[the release record](../apps/cli/distribution/release-0.9.0.json). Apple Silicon ran
seven packaged CLI/terminal/preview checks with 77 assertions. The other three
platforms have build/archive verification for this release, not new execution tests.

Validation and live verification:

- Typecheck and **256 repository tests** (1676 assertions) pass locally and on the
  Bun 1.3.8 VPS, followed by Go race tests and **4 relay, 18 Blossom and 8 GRASP tests**.
  Candidate and final native/web builds passed before activation.
- Original image, clip and source links resolve to `blossom.napplet.soy`. The clip
  advances in a native video tab; responsive asset layout and no-JavaScript SSR/OG
  remain available. The browser observes direct relay WebSockets and no removed
  protocol proxy requests.
- The unchanged published Drone Zone resolves its station directly from Wavefunc's
  relay, decodes the native MP3 stream and pauses through its own controls on
  desktop and touch/mobile Chrome profiles.
- The public installer downloads and verifies a fresh **soyli 0.9.0** into isolated
  directories, creates a project and passes its sandbox check without Bun/Node on
  PATH. Existing local installations, accounts and creator projects are untouched.
  All four public download sizes/checksums match the release record.
- Relay/GRASP NIP-11, Blossom health, administration rejection and removed endpoint
  checks pass. The active index reports a fresh completed scan without relay errors.
  `schlaustronics.com` returns HTTPS 200.

The first audio automation probe received HTTP 403 from the stream provider for
its `HeadlessChrome` user-agent. A plain native Audio comparison reproduced that
response outside the napplet; changing only to a standard Chrome user-agent returned
HTTP 200 and decoded audio. Live checks use standard desktop/Android profiles, with
no stream proxy or response substitution. The current napplet starts automatically
after station resolution, so the check waits for that start before using Pause;
an extra Play command during startup races the napplet's own state.

Both shared Caddy hashes are unchanged:

- `/etc/caddy/Caddyfile`: `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`
- `/etc/napplet-space/Caddyfile`: `ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`

No test events, payments or creator assets were published during live verification.

## CVM and TURN deployment

Prepared in source on 2026-09-17; **production service health verified 2026-09-20**.
The deployment manages a sixth PM2 process, `napplet-cvm`, and a
separate `napplet-turn` systemd service. The public encrypted CVM health round trip
passes; real-network TURN/gameplay qualification remains separate. Caddy and the other site's configuration
retain their existing ownership. No new REST gameplay endpoints are introduced.

The CVM identity, SQLite/WAL boards and TURN shared secret live under
`/var/lib/napplet-space/cvm`, outside releases. Backup now stops CVM along with
this installation's writers and includes this directory. Treat its identity and
TURN secret as private. Old backup archives still verify; they have no CVM data.
Restore this directory before starting the provider, or its key and board state
will change. Deployments keep board rules/data; code rollback does not undo them.

The service connects to an additional **loopback-only** Khatru listener at
`127.0.0.1:19351`; this is never exposed by Caddy. It rejects browser Origin headers
and has a bounded aggregate reply budget (6,000 events/12,000 requests per minute
per connection; 16 connections). Public relay limits remain unchanged. The same
relay instance routes messages between the public socket and private ingress.
`SPACE_CVM_PUBLIC_RELAYS` advertises `wss://relay.<domain>`; the private socket is
not a discovery hint. Activation checks a real encrypted `soy_session` roundtrip,
and the web bootstrap exposes only the resulting public provider key/relays.

Managed coturn is enabled by default (`SPACE_MANAGED_TURN=1`). The script installs
the distro package if absent, uses its own `/etc/napplet-turn/turnserver.conf`, and
refuses an occupied port 3478 belonging to another service. It does not replace
another site's coturn config. Required inbound connectivity:

- TCP **and** UDP 3478 (TURN requests).
- UDP 49160–49200 (relay allocations).

The setup adds these rules only if UFW is already active. Provider-level firewall
rules still need operator configuration; DNS/port reachability is not proven by
a local health check. On a NATed VPS set `SPACE_TURN_EXTERNAL_IP` to its public IPv4
(or coturn public/private IPv4 mapping) in `shared/server.env`. A directly attached
public IPv4 usually needs no mapping. This profile does not configure IPv6 relay
sockets or TURN-over-TLS 443. HTTPS/Caddy continues to own 443.

Default coturn budgets: 128 concurrent allocations, 8 per temporary username,
256 KiB/s per allocation, 8 MiB/s aggregate, 256 MiB memory. Allocations refresh
with a 600-second maximum lifetime; CVM issues ten-minute HMAC credentials.
Private/link-local/multicast relay destinations are denied. Per-key quotas are
not Sybil resistance or a billing system. This initial free profile needs usage
observation before large promotion; it does not promise a concurrent-user count.

To use operator-managed connectivity, set `SPACE_MANAGED_TURN=0`,
`SPACE_TURN_URLS` (comma-separated turn/turns URLs), and `SPACE_TURN_SECRET_PATH`
(a mode-0600 file readable by `napplet`, shared with that TURN server).
`SPACE_TURN_RELAY_ONLY=1` forces relaying for a connectivity test; normal operation
uses ICE's direct/fallback selection. Never embed the shared secret in a project,
public discovery response or PM2 environment value. Disabling managed setup on an
existing installation does not stop/delete its prior TURN service automatically.

`SPACE_CVM_MAX_PEERS` controls named-room admission (default 8; host remote-peer
limit remains 8). Fixed queue capacity is 2–8. Larger capacities need deliberate
host/provider policy work and load qualification, not just a promise in game UI.

`bun run dev` / `dev:prod` start the same CVM under PM2, with isolated local paths
and the private relay listener. `soyli dev` embeds the same backend with a smaller
loopback-only Nostr fixture and isolated project data. Neither dev command installs
coturn or changes system firewall rules.

An actual encrypted service health check gates production activation. TURN setup
is persistent infrastructure prepared before activation; application rollback
leaves that service/configuration in place and restores previous PM2 processes
where present. Test across two real networks, both direct and forced TURN, after
deployment. Engineering coverage so far is described in [ContextVM](CONTEXTVM.md);
long sessions and cross-network reachability are still unverified.

## soyLI 0.14.1 and workshop release — 2026-09-20

The user authorized finalization and deployment. Source `58c7ccb` (including the
`10a475f` starter fix and independent-client acceptance) is running as website
release **`20260920084527457-12824`**. Previous release
`20260920070006760-46483` remains available for rollback. The existing shared-Caddy,
port 3040 and legacy-CPU profile were retained.

All four immutable **soyLI 0.14.1** archives were uploaded and hash-verified before
the installer changed. The CLI includes the project/asset manager, Git checkpoints,
playable proposal review and explicit publication/recovery from 0.14.0, plus the
cross-client CONFIG registration fallback. [Release evidence](../apps/cli/distribution/release-0.14.1.json)
records exact hashes and qualified platform coverage.

The standard deployment passed typechecking and **292 repository tests** on both
the workstation and VPS Bun 1.3.8, plus the Go relay tests and the Bun relay,
Blossom and GRASP service suites (4, 18 and 8 tests respectively). This includes
the progressing 11 MiB upload regression. Candidate origin/admin checks and the
encrypted CVM activation check passed before completion.

Post-deployment verification:

- Public health reports the new release and a fresh, error-free Nostr index.
  All six Napplet PM2 services are online; Caddy, coturn and the backup timer are active.
- Every CLI download returns the recorded size/checksum. A fresh temporary macOS
  ARM64 installation from the public installer runs 0.14.1, reports ready Git,
  scaffolds the maintained starter with skills and the new schema fallback, and
  leaves the user's existing installed CLI and identities unchanged.
- Chromium opens the gallery, docs, create/about pages and a real Impact Yard
  detail route, fetches its OG image, and runs its fullscreen sandbox. No page
  errors were observed. A separate readiness check confirms landing hydration
  and loaded mascot/featured imagery; screenshots were inspected.
- Public relay/Git NIP-11 and a WebSocket manifest query pass. A fresh anonymous
  client completes an encrypted `soy_session` round trip over the public relay.
  The client logged two publish-retry messages during shutdown after that response;
  this check does not certify gameplay, long sessions or TURN packet delivery.
- `schlaustronics.com` still returns HTTPS 200. Shared proxy files retain their
  exact pre-deployment hashes:
  `/etc/caddy/Caddyfile` = `be5d9515021819dcfab9e4dd4dc1e08ceacdcbdc1d620d5ee4b0c97682b7699f`;
  `/etc/napplet-space/Caddyfile` = `ef99cf551dca7c36d7ab82b6075c36bd537034f19e402d63648784b9d65e3c5e`.

Local logs and screenshots are retained in `.local/release-0.14.1/`. Native older
Intel Mac/Keychain acceptance, a nontechnical workshop walkthrough and broader NAP
conformance remain separate from this completed release. No billing functionality
was introduced.

Existing users can update with:

```sh
curl -fsSL https://napplet.soy/install.sh | sh
```

Restart `soyli dev` for the workshop. Run `soyli skills update` in an existing
project to refresh guidance; project source is preserved, so adopting the settings
fallback in an existing napplet requires editing its settings module.

## soyLI 0.17.0 — author lifecycle, 2026-09-21

Prepared from source `b4da13c`: confirmed [unpublish, republish and hosted-data
deletion](LIFECYCLE.md) in the CLI and shell. Four standalone archives are built;
checksums and execution coverage are in
[the release record](../apps/cli/distribution/release-0.17.0.json).
Typecheck and 344 repository tests pass (2,480 assertions), production build
passes, and temporary real-service and mobile browser lifecycle checks pass.
Deletion testing uses isolated fixtures, not real user publications.

This release also ships the earlier source improvements since 0.14.1, including
controller tools, runtime actions, relay defaults and diagnostics. The website
includes the integrated collaboration story and branded OG cards. CLI downloads
were published before the new installer was activated.

Website release **`20260921154858567-22461`** is live at https://napplet.soy.
The deployment passed the full repository check on VPS Bun 1.3.8, Go relay
checks, Blossom and GRASP service suites, candidate checks and activation health
checks. The shared Caddy configuration, web port 3040 and legacy-CPU profile
were retained. Source through `655a7c5` was pushed to the public GitHub repository.

Read-only live verification confirms healthy services with a fresh, error-free
index, installer version 0.17.0, and matching checksums for all four public CLI
archives. `/`, `/about`, `/docs`, `/create`, `/manage` and a published napplet
return working pages and OG images. A fresh temporary installation from the
public installer runs 0.17.0 and exposes the lifecycle commands; the user's real
installed CLI and identities were left unchanged.

The standalone macOS ARM64 binary passed the full isolated lifecycle round trip.
Other archives are build-verified only. The production VPS lacks SSE4.2 and its
standalone Linux x64 CLI probe was OOM-killed, matching its previously documented
unsupported Bun 1.3.11 CPU profile. This is not counted as successful CLI execution
coverage; the website uses the verified Bun 1.3.8 compatibility runtime. Logs are
retained locally in `.local/lifecycle-*.log`.
