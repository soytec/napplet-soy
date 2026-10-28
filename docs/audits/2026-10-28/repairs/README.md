# Owner-scoped source repairs — 2026-10-28

These are **local corrections, not published replacements**. Repair scope is the
operator's napplets: six local Git projects and two earlier Studio publications.
Third-party projects are not modified. The original signed events, authors, source
references and historical audit results remain unchanged. [repairs.json](repairs.json)
records the exact published inputs, repair commits, patch hashes and tested HTML
hashes. Manifests, dependencies, licenses, intentional `nostr://` source metadata
and `soy.app-data/1` are preserved.

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
networking or looser CSP. Nix package/VM validation is still required before
pushing the soyLI changes; Nix is unavailable on the current machine.
