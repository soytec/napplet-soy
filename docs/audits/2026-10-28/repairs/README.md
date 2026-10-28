# Owner-scoped source repairs — 2026-10-28

Six repaired napplets were **republished and verified on 2026-10-28**, under their
original authors and stable identifiers, after the compatible shell and Studio
worker were deployed. [publications.json](publications.json) records old/new event
IDs, release commits, executable hashes, verified source archives and live links.
Funclet, Napplet Machines V8, GRAV / RIFT, Rail Game, Soybert 3D and Outbreak all have
matching signed relay events and website-ready receipts. Downloaded HTML, source
archives and media match their advertised SHA-256 hashes.

**Obsidian Breaker and Truffle Rush remain unpublished repair candidates**, deferred
by the user for a dedicated earthly.city session. Their exact-source patches are
preserved. No third-party project was modified.

The original signed events and historical audit results remain unchanged.
[repairs.json](repairs.json) records the original published inputs, repair commits,
patch hashes and tested HTML hashes; the separate publication ledger records the
subsequent source commits, including five freshly recorded clips. Machines retains
its screenshot-only presentation. Dependencies, licenses, intentional `nostr://`
source metadata and `soy.app-data/1` are preserved.

Funclet's local publication journal predated its merged Studio release. The guard
correctly refused a stale update; the exact current Studio journal was restored
locally with a backup of the old index, then the normal frozen-byte and ancestry
checks passed. The published merge remains an ancestor. Existing Studio drafts
were not overwritten. Outbreak's newer local branch and Soybert's unrelated
artwork edit were preserved; isolated release worktrees supplied their repairs.

Catalog verification initially lagged the relay acknowledgements. Normal targeted
discovery jobs verified the six releases through the existing worker; no signature,
artifact or deletion check was bypassed. Optional relay/outbox copies still include
policy refusals and connectivity failures; required primary publications and the
website are confirmed. A live Rail Game smoke test starts gameplay and exposes a
napplet-owned MEDIA session whose host Pause control changes to Play, with no
browser errors. This complements, but does not expand, the bounded acceptance below.

| Project                | Source preparation                                                   | Repair                                                                                                     |
| ---------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Funclet                | Local branch from the exact published revision; older main preserved | Coordinate decorative effects and yield to the radio; explain unsupported shell-owned streams.             |
| Napplet Machines V8    | Local branch from published source                                   | Coordinate engine audio; respect host pause/stop/volume and local mute.                                    |
| GRAV / RIFT            | Local branch from published source                                   | Coordinate both noise and oscillator effects.                                                              |
| Rail Game              | Local branch from published source                                   | Coordinate effects and settings-driven mute.                                                               |
| Soybert 3D             | Local branch from published source; unrelated art edit preserved     | Coordinate generated noise and pitched effects.                                                            |
| Outbreak: Soycoon City | Separate repairs for exact published source and newer local main     | Coordinate decoded embedded audio, stop voices on host pause, and retain decoding/retry/gameplay behavior. |
| Obsidian Breaker       | Verified published source archive                                    | Coordinate synthesized effects and preserve local mute.                                                    |
| Truffle Rush           | Verified published source archive                                    | Coordinate effects; game ticks cannot resume host-paused audio.                                            |

All output passes through a gain that remains silent until the shell grants a
napplet-owned MEDIA session. Missing or denied optional MEDIA leaves games silent.
Host pause and stop survive subsequent game inputs; host play can resume output.
Local mute and host volume compose. Teardown closes the context and session,
including a grant arriving after disposal. The reusable implementation is
[coordinated-audio.ts](../../../examples/coordinated-audio.ts), also embedded in
new soyLI projects. Existing local guidance is corrected alongside the code.

## Apply a repair

Use a clean checkout at the recorded `sourceCommit`, or extract `sourceArchive`
after verifying its SHA-256. Every patch was applied to a fresh extraction of its
hash-verified archive; changed files match the tested project byte for byte. Do
not apply blindly to a newer branch or Studio draft. No full source archive,
signing key or built application is bundled here.

```sh
# From the clean project, substituting its matching patch:
git apply --check /path/to/napplet-space/docs/audits/2026-10-28/repairs/funclet.patch
git apply /path/to/napplet-space/docs/audits/2026-10-28/repairs/funclet.patch
pnpm install --frozen-lockfile --ignore-scripts
pnpm verify
pnpm test:conformance
```

Funclet also passes its existing `pnpm test:ui` suite. Outbreak adds engine
regressions for a delayed grant, host pause/stop and absent/denied MEDIA. Review and
play the repair before an author-signed release. Applying it does not update a
Nostr listing. Each corrected publication will need its own result; old evidence
must not be relabeled as fixed.

## Independent acceptance

```sh
bun scripts/current-shell.ts
# Optional artifact matrix; subdirectories must contain dist/index.html:
SOY_REPAIRS_ROOT=/absolute/path/to/repaired-projects bun scripts/current-shell.ts
```

The optional root contains `funclet`, `napplet-machines-v8`, `physics-type`,
`rail-game`, `soybert-3d`, `soyindent-evil`, `obsidian-breaker`, `truffle-rush`.
Use Outbreak's published-source candidate for this matrix. Directory symlinks are
fine. The runner installs locked `@kehto/paja@0.24.4` outside application
dependencies and uses unchanged host code. Disposable loopback relay/Blossom
fixtures supply signed current kind-35129 events and raw HTML. Paja performs
resolution, hash verification, bridge injection, CSP and NAP dispatch. No Soy
prelude, legacy wrapper or public relay publication is involved.

Verified scope and limits:

- Four generic current-manifest cases cover input, storage/save/reload, MEDIA,
  missing/denied optional domains, blocked direct fetch and rejected tampered
  bytes. The intentional `nostr://` source extension is not a playback requirement.
- Eight repaired artifacts are checked with MEDIA allowed, absent and denied.
  Game probes exercise audio activation, host pause surviving keyboard input,
  host resume and context teardown. OS media actions use Paja's registered handlers,
  which send real NAP commands. Each case uses an isolated browser context.
- Funclet's signed station fixture uses Paja's real OUTBOX path, without contacting
  public radio endpoints. Paja rejects standard shell-owned playback: **radio
  streaming is not qualified there**. Station selection/retry and explicit failure
  feedback are checked. Decorative effects yield during radio connection.
- Funclet's no-MEDIA probe deliberately omits required-domain tags to exercise its
  degradation path. The actual release still requires OUTBOX and MEDIA; it is not
  advertised as usable without them.
- All eight project verification and upstream conformance commands pass. Each
  upstream report has **5 passed, 0 failed, 5 skipped**; missing manifest/wire/
  lifecycle evidence remains unverified. The `CONFORMANT` headline is not complete
  certification. Funclet's UI suite is an application fixture, not another shell.
- The original Obsidian artifact was reproduced opening a running AudioContext
  without a session; repaired output is coordinated. Other unmanaged paths were
  confirmed in the exact archived source before repair.
- Full gameplay, all levels, all viewports, public relay conditions, actual radio
  availability, all NAP domains and historical releases are outside these bounded
  checks. Cooperative media control is not a security boundary against hostile code.

The remaining interoperability question is MEDIA owner/source discovery and focus
policy for effects alongside primary playback. It does not justify direct iframe
networking or looser CSP. The exact candidate passed Linux Nix package/rebuild/VM
CI before merge; local Nix was unavailable. The [0.31.4 release checks](../../../CLI-RELEASES.md)
and [production rollout](../../../DEPLOYMENT.md) are recorded separately.
