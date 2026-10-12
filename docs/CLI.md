# napplet soyLI — creator CLI

Source **0.20.0** adds public NIP-78 shared creations with portable helpers and
agent guidance, plus structured CVM score attachments. The same scoped host runs
in the local preview and website. Update the CLI, restart previews and run
`soyli skills update` in existing projects; the public site and CVM provider need
their matching deployment. See [shared data](SHARED-DATA.md),
[score attachments](BACKEND-CREATOR.md) and [release operations](CLI-RELEASES.md).

Version **0.19.0** introduced Rust/WASM build recipes, Bevy guidance, eight-relay
bunker connections, private remote-session files and publication histories per
author. `soyli update` installs the latest stable GitHub release; `soyli doctor`
checks for updates. No background updates occur.

Version **0.17.0** adds [unpublish, republish and confirmed hosted-data deletion](LIFECYCLE.md).
Use `soyli unpublish`, `soyli republish`, `soyli delete`, and `soyli lifecycle`
inside the publishing project. Each modifying operation requires confirmation
and reports progress per service. This release also includes the earlier source
changes described below; release verification is recorded in DEPLOYMENT.md.

The installer at `https://napplet.soy/install.sh` installs **napplet soyLI** as the
standalone `soyli` executable, with its pinned Playwright support files. A separate
Bun, Node, npm, or platform checkout is not required. The executable embeds Bun;
this is not an alternative runtime implementation for users who reject Bun itself.

Source **0.16.3** fixes signer-free `soyli check` for projects whose creator is
stored in the ignored local binding, retains Git conflict details and optional
mirror diagnostics, stops exact-release lookups waiting on slow fallback relays,
and removes Damus from default relay lists. These changes ship in **0.17.0**;
existing installed binaries do not update automatically.

Source **0.16.2** adds [actionable error diagnostics](CLI-ERRORS.md) across wrapped
tools and services, in the terminal, JSON output and local workshop. It includes
the 0.16.1 [public remix transport repair](REMIXING.md).
These changes ship in **0.17.0**.

The 0.15.0 source changes, released in **0.17.0**, add
[runtime file imports, uploads, social actions and public lists](RUNTIME-ACTIONS.md)
to both preview and the shared website host. New-project publication defaults now use **five relays**:
Soy as primary plus four [shared public mirrors](RELAY-DEFAULTS.md). Existing
project lists and saved publication jobs keep their configured destinations.

## Local workshop — 0.14.0

Unreleased source guidance adds a [mobile delivery and promotional media guide](MOBILE.md),
bundled as `docs/napplet-mobile.md` for new projects and `soyli skills update`.
It asks agents to check touch input and portrait/landscape layouts and prepare
representative mobile sharing assets when possible. Current capture tools still use
fixed landscape viewports; portrait recording and social export presets are not
implemented. Existing installed CLIs need a release containing this guide first.

Source **0.16.0** adds a **Controller tester** in the workshop header. It runs in
the napplet sandbox and shows connected controllers, buttons, axes, dead zones
and temporary mappings with a small playable input test. New projects and
`skills update` receive the [controller guide](CONTROLLERS.md) and a native
Gamepad input helper. Games must connect their actions to the helper; no new
NAP domain, server or account is required. Physical device support needs testing
on the intended browsers. These changes ship in **0.17.0**.

`soyli dev` opens Play, Listing and **Manage project**. In **0.17.0**, it prefers
port 4173 and automatically chooses a free port
when that port is occupied. An explicit `--port 4173` keeps that port fixed and
reports an actionable conflict. `soyli dev --port 0` asks the OS for a free port;
this also works in 0.14.1. Existing previews are not stopped or replaced.

The manager edits portable
name/title, description, tags and license in `napplet.json`. Its **Capabilities and
discovery** section edits required/optional domains, archetypes, accepted intent
parameters and the optional local icon. Destinations go into
the existing ignored `.napplet-space/project.json` binding. Identity and upstream
association are preserved. Reload before saving if an agent edited the files.

Import and preview assets, edit attribution, choose embedded or external storage,
select earlier covers/clips and inspect Git changes. Project saves do not commit or publish.
The agent uses the same services with `soyli assets list|add|remove|sync` and
`soyli project show|set <json-file>`; the latter requires a flat JSON object with all
five editable metadata fields (`name`, `title`, `description`, `topics`, `license`), plus optional
`requires`, `optionalDomains`, `archetypes`, `intents` and `icon`. Omitted optional
fields are preserved; empty lists or `icon: null` clear them. Extract the `project`
object from `project show`; do not pass its outer envelope or a partial metadata
excerpt. The command supplies the edit revision. See
[manifest authoring](NIP5D-CREATOR.md) and [assets](ASSETS.md).

Listing's **Play in a capture window first** opens a fresh interactive Chromium
session of the current build. Play until a useful moment, then capture or record.
Closing that window cancels. The required browser/encoder is cached automatically;
there is no separate recorder to install. This does not record the original preview
tab. Timed agent recipes remain supported; GIF export remains unsupported.

The workshop now has **Project / Changes / Proposals / Publish** sections:

- **Changes:** inspect changed file names, staged/unstaged state and bounded text
  diffs; explicitly save all listed changes as a local Git checkpoint. Binary/large
  files remain available in the asset view or your editor. Use ordinary Git for
  selective staging, conflict resolution, rebases and branch management.
- **Proposals:** publish a playable contribution from a remixed checkout, resume
  a saved proposal, or open the same revision-pinned inbox as `soyli review`.
  Compare Original/Proposed, inspect the diff, discuss, close/reopen and merge locally.
  **Push committed Git history** is explicit and separate from a napplet release.
- **Publish:** inspect creator, source checkpoint and destinations; **Build & check**
  tests startup and produces the cover/clip for review. **Publish this revision**
  verifies the source still matches and uses those checked presentation bytes.
  Failed releases can resume their frozen source and original destinations, which
  are displayed separately from the current project settings.

All files and commands use the CLI services and ordinary Git. Choose/change the
creator through `soyli account` in the terminal; NIP-46 authorization remains in
the signer, with any authentication link printed in that terminal. Keys never
enter browser payloads. Shared source/identity changes invalidate a reviewed action;
overlapping workshop edits/capture/review/share actions are rejected. The Vite
watcher pauses around actions and restarts afterwards. Independent editor and Git
processes are not locked: finish an agent's edits before committing or sharing.
Checks cover host startup and posting validity, not full gameplay or multiplayer.

Existing projects gain these panels by updating soyLI and restarting `soyli dev`.
Run `soyli skills update` separately to update the agent's local guidance. The
workshop is available from the live installer in **0.14.1**, published 2026-09-20;
that patch also adds the [cross-client settings fallback](CONFIGURATION.md).

Loopback editing checks Host, Origin and a per-session token. No new public REST
proxy or remote shell endpoint is added. Private keys never enter manager payloads.

## Collaboration — since 0.12.0

One remix supports both your own publication and upstream proposals. Code and pushed
Git history are public by default. Save changes with `soyli checkpoint "Description"`,
then `soyli propose "Description"` and/or `soyli publish`. `soyli review` opens the
proposal inbox with built preview, Git diff and local maintainer actions. Agents can
use `proposals --json` and revision-pinned `merge`; Git push and napplet release stay
separate. See [the complete workflow and limits](COLLABORATION.md).

Creator, identity and service overrides live in the ignored
`.napplet-space/project.json` binding. `soyli config` displays it. Git-backed remix
preserves tracked source unchanged; archive/HTML fallbacks remain supported. Old
synthetic-history publication journals are not silently adopted or rewritten.
This release is prepared locally; the live installer changes only after release
upload and an explicit operator deployment.

## Multiplayer development checks — local 0.11.0

`soyli multiplayer tests/multiplayer.mjs --players 2 --latency 50 --jitter 15`
runs a creator-owned scenario against the frozen build with independent guest
browsers and a disposable local backend. It records explicit timing budgets and
assertions in `.napplet-space/multiplayer/latest.json` and exits nonzero on failure,
empty tests, browser errors or timeout. `--turn-binary /path/to/turnserver` starts an
optional isolated coturn and forces relay candidates; it does not use production
TURN credentials. Normal preview also has Connection diagnostics for route, RTT,
buffering and traffic. No external Bun/Node or Playwright installation is needed.

`soyli skills update` delivers the guide and adaptable scenario/synchronization
examples in `docs/examples/`, preserving creator edits. Read
[the complete testing contract](BACKEND-CREATOR.md#repeatable-multiplayer-scenarios)
before adapting a scenario; local test scripts execute trusted project code.
The 0.11.0 changes are local until release publication and operator deployment.

## Rename and upgrade — 2026-09-15

CLI **0.8.2 is published and deployed** with shared public runtime relay reads. Explicit relay
hints no longer have to appear in the site's discovery list. The website installer serves this version. It retains 0.8.1's
shared audio host and transfer timeout fixes. See [runtime routing](PUBLIC-RUNTIME.md#runtime-relay-routing--soyli-082).

On soyLI 0.18.0 or newer, upgrade in place:

```sh
soyli update
soyli doctor
soyli --version
# Inside an existing project:
soyli skills update
```

For an older CLI without `update`, run the installer attached to the latest
GitHub release once (after the first CI release is published):

```sh
curl -fsSL https://github.com/zeSchlausKwab/napplet-soy/releases/latest/download/install.sh | sh
```

Updates keep the old release directory, validate SHA-256 and the new executable's
version before switching the managed command, and never downgrade automatically.
Custom installer directories are retained. Source checkouts and manually unpacked
binaries need Git/manual updates; soyLI will not replace Bun or an unrelated command.
Restart any running `soyli dev` sessions after updating. Doctor makes a bounded
five-second GitHub check and reports current/newer/development/unavailable states;
offline or rate-limited checks don't fail its other diagnostics. JSON includes a
structured `release` result. No signing key is needed to check or update.

The installer creates `~/.local/bin/soyli` and keeps a managed `napplet-space`
compatibility alias so old project scripts continue working. Archives also include
that alias. An unrelated existing `soyli` blocks installation; an unrelated
`napplet-space` is left alone while installing `soyli`. Checksums are verified before
switching commands, and old release directories remain available.

Accounts, OS vault service names, private backups, toolchain/browser caches,
`.napplet-space` journals and `docs/napplet-space.md` stay at their existing paths.
There is no identity migration or regenerated key. As with previous executable
updates, macOS may ask for Keychain authorization. New projects receive `soyli`
commands; skills update refreshes unedited managed guidance in existing projects.
Upstream boilerplate/skill pins are unchanged; visual-authoring adaptations are
documented under [Updating the upstream pins](#updating-the-upstream-pins).

## Create and publish

```sh
curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet
# Follow the printed PATH instruction if ~/.local/bin is not already on PATH.
cd my-napplet
soyli dev
# After editing (or stopping dev):
soyli build
soyli run verify
soyli check
soyli publish
```

`new` starts from the pinned creator-maintained `napplet/boilerplate`, initializes
Git, installs its locked dependencies with a private Node/pnpm toolchain, and builds
`dist/index.html`. TypeScript source, upstream scripts, the SDK, Vite plugin,
lockfile and documentation remain intact. It installs the eight upstream Napplet
skills in `.agents/skills` and `.claude/skills`; AGENTS.md and CLAUDE.md point to the
integration notes in `docs/napplet-space.md`. These are ordinary project files, not
background global installations. `napplet.upstream.json` records the exact commits.
Explicit `--template soft-orbit` (and the other five examples) still creates a
single-file project and includes the same skills.

`new` reuses the chosen creator or asks to create/connect/set up later. The installer
reconnects stdin to the terminal's actual device so identity prompts also work
through `curl | sh`. Opening the `/dev/tty` alias stalls delayed input in the macOS
bundled runtime. Redirecting stderr makes installation noninteractive; users can
also explicitly pass `--identity later`. `--no-install` writes the complete scaffold
and skills without downloading dependencies; follow with `setup` and `build`.

For a local creator, onboarding also saves a private-key backup and prints its
absolute path before dependency installation. By default this is
`~/.config/napplet-space/accounts/public/<public-key>.nsec`, outside the project
and Git. It is an **unencrypted nsec**, mode 0600 inside the private account
directory; preserve a private copy. The same creator reuses the same file.
`soyli account backup` creates or locates it for an existing local identity.
`soyli account create` also reuses the selected identity. Use
`soyli account create --new` to generate and select a different private key with
its own backup. Previous identities and backups remain available through
`soyli account list` and `soyli account use <account-id>`. The next publication
uses your selected account, even in an existing project. Running publications
keep the account they started with and never reset your selection. The same
public key keeps its listing when changing signing methods. A different public
key gets its own listing, Git repository and backend board namespace; previous
authors' releases and pending jobs remain available in the same folder. Status,
resume and lifecycle commands show the selected author's history. Agents must
not switch back to a saved project creator merely to bypass an error.
Restore with `soyli account import --stdin < /path/to/key.nsec`.
For an encrypted copy, use `soyli account export /path/to/new.ncryptsec`.
Remote identities are backed up in the remote signer instead.

`dev` runs the upstream Vite build watcher and opens the loopback sandbox preview.
It reloads after each build. Legacy HTML examples reload on save without a build.
`--no-open`, `--port` and `--project` support existing workflows. `build` builds
once, `setup` installs with the frozen lockfile, and `run <script>` / `exec <tool>`
use the private toolchain from the current project. `dev`, `build`, and `run` execute
your project's tools. **Publish and propose build dist/index.html projects** before
checking the artifact. `check` inspects and runs the finished HTML without building.
Opening a proposal never runs its source build unless you explicitly use `review --rebuild`.

`backend init` writes public provider/board/module configuration to `napplet.json`;
the selected creator remains in the ignored local binding. Commit the portable
configuration and module files. Generated `.napplet-space/soy-backend.json` stays
ignored and is regenerated by setup/build/dev/run (including fresh checkouts).
Never force-add the private directory to fix a missing import.

`soyli browser path --json` reports the bundled browser profile, executable paths
and installation status without downloading. Prefer these paths over assuming
system Chrome or hardcoding a Playwright cache revision. `soyli browser install`
prepares the headless check browser.

For dependency changes use the same pinned toolchain, e.g.
`soyli exec pnpm add -D <package>`; the nested pnpm resolves from soyLI's managed
PATH. Mixing a global pnpm can select a different store and trigger
`ERR_PNPM_UNEXPECTED_STORE`. Inspect the selected store with
`soyli exec pnpm store path`; do not change the lockfile/toolchain pin to work
around an agent sandbox. A cached executable no longer receives a redundant
chmod on each command. Missing downloads or cache repairs still require write
and network access; normal agent sandbox approval remains necessary then.

Preview cleanup in **0.18.2**: Ctrl+C, SIGTERM and terminal
hangup stop the preview and its detached build watcher. A foreground `dev` session
also stops when its known launching process exits. Keep an agent's terminal/tool
session alive while using the preview; closed stdin alone does not stop it. Reuse
one preview per project and its printed URL, then stop that owned session after
testing. Browser-tab closure does not stop a server. Forced kills or a surviving
background launcher can still leave processes needing manual cleanup; this does
not remove already-running previews from an older CLI. Never kill unrelated
Bun/Node processes to reclaim a port. Use `--port 0` for independent test sessions.

`soyli run verify` uses the upstream guidance tests, TypeScript check and
build. `soyli run test:conformance` runs the reference harness and downloads
its own pinned Playwright browser on first use. This complements the Space host
check; skipped reference cases are reported by the upstream harness. The pinned
0.2.15 reference host exposes empty objects for most domains and can misreport an
app startup exception as missing injection. Inspect the original error and test
real interactions in `soyli dev`; a partial pass does not verify skipped manifest,
wire or lifecycle cases. See [compatibility evidence](COMPATIBILITY.md).
Keep product-specific tests in the project's normal verification workflow too.

After upgrading the CLI, `soyli skills update [--project folder]` adds its
bundled skills to existing projects. It replaces only unchanged managed files,
leaves edited or foreign files alone, and reports conflicts. It does not migrate
source code, update dependencies, or fetch unreviewed skill changes from the web.

### Local history, pausing and upgrading

`new` initializes Git and commits the complete generated scaffold, lockfile and
bundled agent guidance as **Initialize napplet with soyLI**. The local commit uses
neutral `napplet soyLI <scaffold@napplet.invalid>` attribution, needs no Git identity
configuration or Nostr signer, and does not change global Git settings. It happens
before optional identity/dependency setup, so the starting point survives an
interrupted setup. Dependencies, build outputs and ignored local state stay out of
Git. Nothing is uploaded by creating this checkpoint.

Git-backed remixes preserve the published revision and ancestry without an extra
initial commit. Existing projects, archive/HTML remixes, `setup` and skill updates
are not automatically committed; inspect their history and save a first checkpoint
if needed. A failed initial commit preserves the generated files and reports the
Git cause and recovery command.

The developer or coding agent should commit coherent changes after relevant checks
and checkpoint unfinished work before pausing or handing it back, recording known
failures honestly. The managed `docs/napplet-space.md` gives agents this workflow;
subsequent commits remain explicit. Inspect status, diffs and new files before
staging; keep private notes ignored and credentials outside the project.

Publishing and proposing require a clean committed working tree. Use ordinary Git
or `soyli checkpoint "Describe the change"`; checkpoint explicitly stages all source
changes after credential checks. Inspect `git diff` and `soyli publish --dry-run` first.
The actual Git tip and reachable history are public when pushed to GRASP, including
older/deleted source. `publish.files` cannot conceal tracked history. Local-only
changes stay local until `propose`, `push`, or `publish`. Source archives reflect the
committed tree; built HTML and screenshots are separate Blossom artifacts.
See [collaboration](COLLABORATION.md) for proposing, reviewing and merging.

Ordinary `soyli publish` updates the stable listing. Use `soyli publish --snapshot`
to also create an independent immutable publication. A pinned `/r/` link already
selects the exact signed named revision. `--resume` preserves the frozen job's
original choice, including older paired jobs. See [publishing](PUBLISHING.md).

#### Your own NIP-34 repository

If the project has a `nostr://` Git remote owned by the publishing account (for
example from ngit), or sets `publish.repository`, `soyli publish` releases against
that repository instead of creating a hosted copy. Push the commit first; soyLI
verifies it and never writes to that repository. See
[publishing from your own NIP-34 repository](PUBLISHING.md#publishing-from-your-own-nip-34-repository).

#### Historical source checks

`SOURCE_PATH` identifies a source packaging restriction, not a detected credential. History diagnostics name the rejected entry (with credential redaction), its containing commit and the specific restriction: submodule/type, path length, traversal, or whitespace/backslash/control characters. Historical submodule commit references are allowed: they do not embed the referenced repository or cause soyLI to fetch it. Submodules in the release tree remain unsupported because the source archive cannot materialize them.

soyLI **0.23.2** checks reachable Git history during `publish --dry-run`, as
well as before publication/proposal preparation and again when freezing source.
Dry-run opens no signer, runs no project scripts and publishes nothing. Its JSON
`sourceHistory` reports the checked commit and any accepted legacy public contexts.
For a project without a commit it reports `uncommitted` and leaves the history check
pending; a clean checkpoint is still required for actual publication.

Ordinary `.gitmodules` and `.gitattributes` files are allowed in selected source, the release tree, reachable history and portable remix archives. Their contents still undergo the normal credential scan during source selection and history inspection. An empty or public Git metadata file does not require history cleanup. Historical Git submodule references are allowed; release-tree submodules remain unsupported. soyLI does not fetch or embed submodule repositories.

Older backend guidance sometimes caused `.napplet-space/soy-backend.json` to be
committed. This exact root-relative path may remain in **ancestry only**, provided
every historical version is at most 16 KiB and matches the former version-1 public
context: a napplet address, optional provider public key and relay URLs, board
names and optional module names. Unknown fields, duplicate JSON keys, malformed
addresses, authenticated/query-bearing relay URLs and detected credentials are
rejected. The normal content scanner still runs. The exception does not permit
this file in the release tree, selected source, or another `.napplet-space` file.

For affected projects, keep `.napplet-space/` ignored and retain portable backend
declarations in `napplet.json` plus module source in Git. If the context is still
tracked, `git rm --cached -- .napplet-space/soy-backend.json` preserves the local
generated file; review and commit that removal and the ignored-path/config changes.
Then run `soyli publish --dry-run`. If it was already removed, no project edit or
history rewrite is necessary. Existing binaries need a release containing this fix;
updating skills alone cannot change an installed CLI's history validator.

Other rejected history produces `SOURCE_SECRET` (or the specific source code),
with the path, blob ID and a containing commit, without printing file contents.
Removing a file from HEAD or `publish.files` does not remove its ancestry. Inspect
it locally; rotate exposed credentials if applicable. If cleanup is necessary,
make a private backup of the complete repository first, agree the affected refs
and collaboration/publication consequences, and explicitly approve the rewrite
before using Git history-filtering tools in a separate copy. Recheck the result
with dry-run. soyLI never silently rewrites history or force-pushes it; existing
public copies cannot be recalled by a local rewrite.

Safe relative source-file symlinks (also called aliases), such as `CLAUDE.md -> AGENTS.md` or `src/alias.ts -> shared.ts`, can remain in both current and historical Git trees. Source symlinks may also point to selected public `.gitmodules` and `.gitattributes` files. Git itself rejects tracking `.gitmodules` as a symlink. Each link must resolve to a public regular file inside that same tree; working files must also stay within the selected source. Chains and relative parent paths are supported when they stay inside the project. Absolute, escaping, dangling, cyclic, directory, private and unselected targets still fail. Target contents pass the same credential checks as ordinary source.

`soyli checkpoint` preserves the link. Publishing and Git-based remixes preserve
Git history and symlinks; the downloadable source archive stores each alias as a
regular copy of its exact committed target bytes. Archive-based remixes receive
those regular copies. Alias copies count toward the source size and file limits.
No replacement at HEAD or history rewrite is needed for a safe alias. Project
configuration, playable artifacts, managed assets, presentation files and backend
build inputs still require regular files.

Inspection is bounded to 10,000 reachable objects, 10,000 distinct historical
blob/path pairs and 40 MiB of unique blob content. Each historical path is checked,
including aliases of a blob also stored under a permitted path.

To pause, preserve the whole project folder including `.git`, `napplet.json` and
`.napplet-space`, plus the creator's separate identity backup. A private, ignored
`.napplet-space/RESUME.md` can record goals, pending work, checks, host limitations
and next steps for a new AI session. Do not include secrets.

After a new CLI release, stop the old preview process and use the upgrade command
above. In the **existing** project, run `soyli skills update`, review any conflicts,
then `soyli dev`. This uses the newly installed host without scaffolding a new
project or changing the creator/napplet identifier. Source/dependency migrations,
if any, need their own explicit release instructions. `publish --resume` is unrelated
to authoring: it continues uploading a frozen release, even when newer edits exist.

Runtime capability support comes from the host, not from the presence of an SDK
export. **0.8.0 and later** add NAP-MEDIA shell-owned audio; 0.7.0 does not include
it. The website needs the matching deployment.
Embedded audio is distinct from host-owned radio streaming; see
[audio and media sessions](MEDIA.md) for the supported subset and verification.

`check` validates the source selection and runs frozen HTML in the same restricted
sandbox as publication. It needs no identity and publishes nothing. The first
check/publication downloads a pinned Chromium headless shell. `browser install`
prepares it in advance. `doctor` reports Git/browser readiness and credential-store
requirements; `account check` verifies the selected signer.

From **0.15.1**, macOS 12 (Monterey) and 13 (Ventura) automatically use a separate,
pinned Playwright 1.61.1 / Chromium 149 compatibility pair. Installation, readiness,
screenshots, interactive capture, WebM recording and the multiplayer lab all select
the same pair. macOS 14+ and Linux keep Playwright 1.63.0. No system Chrome or
global Node installation is needed, and existing accounts/projects are preserved.
`soyli browser install` prepares the headless browser; interactive capture downloads
the matching full browser when needed. `soyli doctor` identifies compatibility mode.

This is a **frozen development browser**, not an ongoing security-support promise.
[Chrome ended macOS 12 updates after version 150](https://support.google.com/chrome/thread/404150391).
Our current Playwright registry also omits macOS 13. Upgrading to macOS 14+ selects
the current bundled browser automatically. OSes without a supported download get
`BROWSER_OS` with an OS explanation instead of a network-retry message. Browser
checks/captures require macOS 12+ even though project editing can use the older
Node toolchain. Upstream `test:conformance` retains its own pinned Playwright 1.61.0.

Regression checks exercise the real registries for Intel/ARM Monterey and Ventura,
plus modern Mac/Linux selection. `SPACE_TEST_MAC_BROWSER_COMPAT=1 bun test
tests/services/browser-compat.test.ts` downloads a fresh compatibility browser and
tests PNG capture, WebM recording/decoding, doctor and a headed window on a Mac.
Running that on a newer Mac does not qualify native Monterey hardware.

**0.15.2** fixes browser-package resolution in Bun 1.3.8's Linux dependency layout.
The current driver is resolved through `@playwright/test` → `playwright` →
`playwright-core`, so a hoisted macOS compatibility package cannot replace it.
The same real-registry tests run in deployment; no version assertion is relaxed.

## Requirements and storage

- macOS: Apple Silicon or modern Intel with AVX2; Git/Apple Command Line Tools;
  login Keychain for local private keys or optional remote-session vault storage.
  New remote sessions use private files without Keychain access.
  The installer selects native ARM64 even in a Rosetta terminal.
  Keychain access belongs to the executable; macOS may request authorization when
  changing executables. The explicit dangerous plaintext development fallback is
  described in the identity section above; it is not needed for remote file sessions.
- Linux: glibc, ARM64 or x86-64 with SSE4.2; Git; an unlocked Secret Service keyring
  and D-Bus session for local private keys or optional remote-session vault storage.
  New remote file sessions need no desktop keyring. Ubuntu 24.04 is the tested desktop baseline.
  Chromium system libraries are listed at `/create#platforms` (`/cli` redirects to the same guide). The CLI never installs OS
  packages or invokes sudo. Alpine/musl and native Windows are not supported.
- Installer: curl, tar, tty, SHA-256 utilities; HTTPS downloads with checksum verification.
- Nix/NixOS (Linux): the flake package and `programs.soyli` module provide the
  toolchain, Chromium and Git from the store and leave updates to Nix; see
  [soyLI with Nix](NIX.md).
- Binary/support files: `~/.local/share/napplet-space/releases/<version-platform-hash>`.
  Command symlinks: `~/.local/bin/soyli` and managed legacy `~/.local/bin/napplet-space`. `NAPPLET_INSTALL_DIR` and
  `NAPPLET_BIN_DIR` override these paths. Foreign existing commands are preserved.
  Shell profiles are left unchanged; a copyable PATH export is printed if needed.
- Credentials: OS store; public account index and private nsec backups:
  `~/.config/napplet-space/accounts/<network>`.
  Existing `SPACE_ACCOUNT_HOME` / `XDG_CONFIG_HOME` configuration remains supported.
- Browser cache: `~/Library/Caches/napplet-space/browsers` on macOS or
  `~/.cache/napplet-space/browsers` on Linux; honors `PLAYWRIGHT_BROWSERS_PATH`.
  A browser download uses a reduced environment with no signing material.
- Project recovery state: `.napplet-space`, ignored by Git and excluded from
  published source. Preserve this directory for interrupted-publication recovery.

The private Node 24.21.0 (Node 22.23.2 on macOS 11–13.4) and pnpm 10.8.0 toolchain is verified against pinned release
checksums and reused across projects. Its cache is
`~/Library/Caches/napplet-space/toolchains` (macOS) or
`~/.cache/napplet-space/toolchains` (Linux); `SPACE_TOOLCHAIN_CACHE` overrides it.
Packagers can set both `SOYLI_NODE` (Node binary) and `SOYLI_PNPM` (`pnpm.cjs`)
instead; soyLI then skips the downloads but still requires the pinned Node version.
No global runtime or package manager is installed. Dependency installation uses
`--frozen-lockfile --ignore-scripts`. Creators can explicitly run their own package
manager if additional dependencies need installation scripts.

Publishing accepts a finished self-contained `index.html` or `dist/index.html`.
For the upstream profile it selects Git-visible source files plus the built HTML,
excluding ignored dependencies and private state. The selected budget is **1,024
files / 40 MiB**, including built HTML and preview files; the source tar stays capped
at 50 MiB. The file count is a tooling safety budget, not a Nostr quota. Playable
HTML is limited to **25 MiB**; managed assets and host resources retain their
separate 10 MiB limits. Source files and safe relative file aliases must pass credential checks.
`publish.files` adds release inputs; it cannot exclude tracked files or committed
history. Do not enumerate tracked files to reduce the selection: Git already finds
them, and the complete `napplet.json` remains capped at 16 KiB.
The source repository contains the real committed source; ignored build output is
uploaded separately as the playable Blossom artifact.
Required domains combine `napplet.json` with standard `napplet-requires` build
metadata. The artifact and NIP-5D publication format are the same for both profiles.

The public website, indexer and runtime need the updated 25 MiB artifact limit
before admitting larger playable HTML. Updating the CLI alone is insufficient;
older deployments also need the updated parser to browse source above 128 files.

## Building and releasing

The primary distribution channel is now **GitHub Releases**. Push a version tag
such as `soyli-v0.20.0` matching `apps/cli/distribution/version.json` and the installer.
CI checks the source, builds and smoke-tests all four platforms on native runners,
then publishes their archives/checksums and the pinned installer. PRs and manual
branch runs validate without publishing. Only the release job has write permission;
no VPS credentials are needed. See [release operations](CLI-RELEASES.md).

Use the pinned Bun 1.3.11 toolchain for builds:

```sh
bun run cli:build                         # four macOS/Linux archives
bun run cli:build --target darwin-arm64   # one local target
SPACE_TEST_CLI="$PWD/.local/cli/0.20.0/soyli-darwin-arm64/soyli" \
  SPACE_TEST_NATIVE_KEYSTORE=1 bun test tests/services/cli-distribution.test.ts \
  tests/services/cli-terminal.test.ts tests/services/native-identity.test.ts \
  tests/services/publish.test.ts
```

Archives are named `soyli-<platform>.tar.gz` with matching SHA-256 files. Old
`napplet-space-<platform>.tar.gz` URLs remain served for immutable earlier releases.
The build embeds the shared preview and disables project `.env`/bunfig autoload.
It packages the exact locked Playwright core (including its dynamic worker files)
and dependency notices alongside the executable. Keep the `lib` directory with
manual downloads. Chromium remains a separate, cached official Playwright download.

Website deployment only needs `bun run deploy` with the usual host/domain options;
do not prefix it with `cli:release`. GitHub CI publishes the CLI separately.

Only for an explicit legacy VPS mirror, build **all four** local packages first:

```sh
bun run cli:build
bun run cli:release --host root@your-vps
```

The optional legacy `cli:release --host` command checks all four archives, uploads them over SSH, verifies
checksums on the VPS and atomically installs the version under
`/opt/napplet-space/downloads/cli`. Existing versions are immutable; different
bytes require a version bump. Archives live outside application releases so a
website rollback does not break existing download links. The server exposes only
versioned archives/checksums, never build directories. `SPACE_CLI_DOWNLOAD_DIR`
selects another download store; local dev uses `.local/cli` through the same route.

For a new CLI release, bump `apps/cli/distribution/version.json` and the installer
version together, commit and push the matching `soyli-vX.Y.Z` tag. The workflow
publishes independently of website deployment. The website's pinned installer and
download links move to that version on its next deployment; publish the GitHub
release first. The GitHub `latest/download/install.sh` URL always follows the newest
release. `NAPPLET_DOWNLOAD_BASE` keeps the existing `<base>/<version>/<archive>`
layout for explicit mirrors, local tests or the optional VPS channel. Keep older
archives for reproducibility and rollback.

The terminal regression runs the real piped installer and packaged CLI under a
pseudo-terminal, pauses before choosing an identity option, and checks hidden
input, cancellation and terminal restoration. It uses temporary projects and
does not create creator keys or publish events.

If an older installer stopped at the identity prompt, open a fresh terminal if
Ctrl+C does not respond. The CLI is already installed and the project was created:
enter that project directory and run `~/.local/bin/soyli dev` after upgrading. Creator
setup can follow with `soyli account create` or `soyli account connect`.

## Updating the upstream pins

The scaffold and skill bodies are embedded snapshots, so creation does not depend
on GitHub availability. Maintainers review clean checkouts and run:

```sh
bun scripts/creator-sync.ts --boilerplate /path/to/boilerplate --skills /path/to/napplet
```

This records tracked files at the exact HEAD commits. Never run a fetched installer
as part of this update. The snapshot preserves the upstream MIT license; skills
include their own license copy. Boilerplate adaptations are package name,
Space configuration/provenance, agent-entry-point preambles, ignored private state,
excluding bundled skill directories/private state from the guidance scanner, and
the static NAP-CONFIG example with one main.ts import, opt-in host theme colors,
and visual-authoring guidance. The former schema-free-starter
assertion now checks that example is an object; all other guidance assertions remain.
`creator-visuals.ts` adapts the generated visual docs and seven skill bodies;
`napplet-ui` is replaced with a project-specific design workflow. It removes
mandatory host color matching and universal compact density, while retaining
sandbox/SDK boundaries and responsive/accessibility checks. Vendored snapshots,
upstream pins, package dependencies and licenses remain intact. See `creator-kit.ts`,
`creator-visuals.ts` and the fidelity tests for the complete adaptation surface.

[Visual design](VISUAL-DESIGN.md) is installed as `docs/napplet-visual-design.md`.
The starter is a replaceable capability demo; its palette stays local unless
`FOLLOW_HOST_THEME` is explicitly enabled. Agents choose the game/content and UI
direction together. `soyli skills update` updates unedited managed guidance in both
agent directories and preserves conflicts; it never restyles source or existing
published napplets. Older source and `AGENTS.md` need an intentional migration.

Source regressions run the upstream documentation checks on the assembled starter,
including soyLI's managed guides. Native release smoke runs its complete `verify`
script with the starter's pinned dependencies before the host/browser check.

Review toolchain pins separately against Node's official release checksums and
pnpm's npm integrity value. Then validate a fresh scaffold, upstream verify and
conformance, the Space sandbox, source/artifact publication, live rebuilds and the
standalone installer before shipping a new immutable CLI version.

### Project destinations and screenshots (CLI 0.3.1)

`soyli config` prints the effective public targets without reading a key
or contacting services. `config init` writes those values into older projects.
New projects include editable `publish.networks.public` and `.local` profiles.
Use `--network local` to inspect the dev stack. CLI publication flags override
project settings. See [configuration precedence and destinations](PUBLISHING.md#visible-project-destinations-and-previews).

`soyli screenshot` captures the current built app, writes `preview.png`
and selects it in `napplet.json`. Inspect that PNG before publishing. A named
capture (`screenshot preview-2.png`) preserves an existing file. Set
`preview.delayMs` for startup timing, or select a different PNG with
`preview.image`. Without an explicit image, publication captures one automatically
and publishes linked standard metadata. Existing projects need not be re-scaffolded:
update the CLI, run `skills update`, then `config init` and `screenshot` as needed.

CLI 0.3.1 is required for these configuration fields and commands. Deploy the
versioned CLI downloads before deploying the installer that advertises them;
older installed binaries remain unchanged until the creator reruns the installer.

## Local listing preview (CLI 0.4.0)

Run `soyli dev` in a project, then select **Listing** beside **Play**. This draft
shows the title, description, tags, creator public key, selected screenshot, license,
identifier, built artifact and effective destinations for the selected network. Use
`--network local` for local services; the default is public. Publication flags can
still override these destinations.

**Capture screenshot** runs the existing sandboxed build check and saves a new PNG,
then selects it as `preview.image` in `napplet.json`. It preserves previous images and
does not publish or sign anything. First use may download the cached Chromium browser.
Review the image after the final build; it may need an interactive scene or custom PNG
for a representative state. Configuration and image changes refresh in Listing.

Missing metadata or a build appears as a draft warning. The listing preview complements
`soyli check`; it does not assert that the artifact passed all publication checks.
Only public configuration and selected, bounded preview media are served by loopback.
Capturing requires an explicit same-origin action.

Existing projects get this view by updating the CLI and restarting `soyli dev`.
Run `soyli skills update` to refresh the separate Space integration guidance;
upstream pins stay unchanged; the visual-authoring adaptations above still apply.

Readable links require a one-time claim on the website: connect the publishing account,
choose **Named link**, and claim `/@your-handle/your-slug`. Existing releases can do this
now. Republish does not claim a name; a claimed name follows later releases automatically.

## Napplet settings (CLI 0.5.0)

New boilerplates include `config.schema.json` and an optional SDK settings example.
The maintained Vite plugin embeds the schema in the built HTML. **Settings** in
the preview opens the same live form used on the website; Listing also reports
the schema's property count/version. These are user preferences, separate from
publication targets in `napplet.json`. See [CONFIGURATION.md](CONFIGURATION.md) for
the authoring flow, supported subset, storage behavior and verification.

These settings are included in CLI 0.5.0. Existing projects are
not modified by updating skills. They can adopt the documented schema/SDK pattern
after updating to a CLI release that contains this host. The upstream conformance
runner currently checks boot/degradation only; it does not exercise configuration.

In 0.14.1, new projects register the same `config.schema.json` through
`config.registerSchema` when `config.schema` is absent, before subscribing. This
makes the optional example work in hosts that do not read the embedded declaration.
For an existing project, update soyLI, run `soyli skills update`, and ask your agent
to apply that fallback to your settings module; source files are not overwritten.
See [cross-client evidence](INTEROPERABILITY.md) for the tested hosts and limits.

## Connect a remote creator (CLI 0.5.0)

Use `soyli account pair` to display a connection link and QR for your
NIP-46 signer. `--open` also opens the link in a registered signer app. Use
`account connect` instead to paste a signer-provided `bunker://` link at a hidden
prompt. Pairing defaults to our relay and supports a separate `--signer-relay`
override; publishing targets in `napplet.json` are unchanged. In the updated source,
both flows default to a private session file outside projects. Pass
`--session-storage keychain` to opt into the OS vault. Existing accounts retain
their old storage; `soyli account storage file` moves the selected remote account
without pairing again. `account show` / `account list` report the storage choice.
The file holds the approved client credential, never the remote creator's private
key. See [identity](IDENTITY.md#remote-session-storage-choices) for migration,
permissions, file protection and the separate website sign-in choices.

## Preview clips (soyLI 0.7.0)

`soyli record [preview.webm]` records and selects a short silent clip from the current
build. The local **Listing** view offers **Record clip**, start-delay and duration
controls, and playback beside the cover image. Existing files are preserved.
Edit `preview.recording.actions` for a timed click/key recipe; see the
[capture example and limits](PREVIEWS.md#short-video-previews--soyli-070).
A later build invalidates the selected clip for publishing until you record again
or remove `preview.video`. The static screenshot remains available for ordinary
clients and OG. Run `soyli skills update` to bring this guidance into an existing
project without replacing upstream skills or re-scaffolding.

## Backend configuration (soyLI 0.10.0)

From soyLI 0.10.1, the preview remembers the host's multiplayer Allow / Block
choice across visits on the same browser origin. Change it in the preview's
Network settings. Not now and dismissal leave the choice unset. See
[multiplayer permission](CONTEXTVM.md#remembered-multiplayer-permission-soyli-0101).

`soyli backend init` adds editable provider/board configuration and a generated
runtime `.napplet-space/soy-backend.json` for importing into the artifact. The file is
ignored locally; the public provider settings become part of the built HTML. Existing
projects importing `../soy-backend.json` must update that import to
`../.napplet-space/soy-backend.json`. `backend status`
probes the provider over CVM; `backend sync` registers configured boards with
creator authorization. Publishing repeats the idempotent registration; it does
not reset scores. `dev` starts an isolated instance of the same service using
`.napplet-space/backend`, separate from public data. Read the bundled
[creator guide](BACKEND-CREATOR.md) for the complete authoring and testing flow.
New projects and `skills update` include this guide without changing upstream
skill bodies. Existing projects need an updated executable and restarted preview.

The [0.10.0 release record](../apps/cli/distribution/release-0.10.0.json) records
locally built archives and native execution coverage. This release has not been
uploaded or deployed. Upload its immutable downloads before activating the updated
installer; the public site continues to serve the previous version until then.

## Older Macs and unavailable credential stores

Bootstrap supports older Git versions such as 2.23 without requiring the newer
`git init --initial-branch` option. Existing destinations and filesystem permission
failures now have specific errors. Installation does not require administrator
rights. A partial project should be inspected and resumed with `soyli setup`, not
overwritten by rerunning `new`.

For an unavailable OS vault, `SOYLI_DANGEROUS_PLAINTEXT_KEYS=1` explicitly selects a
separate unencrypted, owner-only account store outside Git. See
[the development file vault instructions](IDENTITY.md#explicit-dangerous-development-file-vault)
for setup, restoring an existing identity and returning to Keychain. This requires
a CLI release containing the option; 0.12.0 does not support it.

### Manifest-only migration (0.24.0)

```sh
soyli migrate 'https://napplet.soy/n/<naddr>' --dry-run --json
soyli migrate 'https://napplet.soy/n/<naddr>' --confirm '<confirmation>'
# If delivery was interrupted, reuse the saved event:
soyli migrate 'https://napplet.soy/n/<naddr>' --resume --confirm '<confirmation>'
```

Select the original author with `account use` before confirming. No original
project, build tools or uploads are needed; dry run does not open the signer.
Use `--relay` for a different primary relay and repeated `--mirror` options for
additional copies. Plans and receipts live outside Git beside account state.
Named/root addresses and exact HTML are preserved. Snapshots remain unchanged.
See [creator migration contract](NIP5D-CREATOR.md#upgrade-an-existing-publication-without-rebuilding-it)
for concurrency, unavailable history, retries and optional metadata behavior.
