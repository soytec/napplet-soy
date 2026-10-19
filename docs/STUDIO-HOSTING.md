# Studio hosting preparation

Target: containers on the existing Linux VPS. This is deployment preparation,
not an enabled hosted Studio. `bun run studio` still starts the trusted, local-only
runner described in [QUICK-VIBE.md](QUICK-VIBE.md). Do not expose that listener.
Studio's React interface now lives in the main shell at `/studio` and `/studio/<id>`
with the shared account context. This frontend integration does not enable hosted
jobs: its loopback HTTP adapter is development-only. The hosted ContextVM browser
adapter and private preview delivery remain outstanding.

**CPU compatibility:** the target VPS exposes an old QEMU x64 CPU without SSE4.2.
The standard Bun/standalone soyLI and OpenCode binaries fail on this host, including
their baseline builds. A temporary combination has now passed isolated VPS probes:
current soyLI source bundles and unmodified OpenCode 1.19.3 source running on
Bun 1.3.8, with the pinned Node/browser toolchain. See the
[compatibility experiment](experiments/STUDIO-LEGACY-CPU.md) for the exact scope.
This is not an enabled hosted runtime profile. The standard image builder and
job entrypoint still enforce the CPU check; they must not be pointed at the old
host by simply removing that guard.

## Implemented components

`apps/studio/hosting/control.ts` provides an MCP control server over ContextVM.
`connectStudioControl` requires encrypted transport, injects the verified caller’s
public key and disables public announcements. An operator admission list is checked
on every call. Callers cannot supply an owner or filesystem directory: the controller
selects the private `nostr:<pubkey>` worker. The workspace factory must provide the
isolated hosted runner; it must not point to the current local `StudioWorker`.

The experimental `soy_studio_call` contract takes `requestId`, `operation` and
`input`. Implemented operations are list, state, create, send, check, stop, files,
file and diff. Each has a strict input schema. Mutations retain the result, including
ambiguous failures, for identical retries during this controller process. Reusing
an ID with different input fails. This is not a durable distributed request journal.
The preparation limits are eight loaded owner controllers, one active build,
120 calls/account/minute, 256 KiB/control response, and 512 retained mutation IDs.
Reaching the last limit fails closed; the current preparation requires an operator
restart after jobs finish. It is not a production lifecycle policy.

`apps/studio/hosting/container.ts` is a separate bounded, offline executor. It accepts
source bytes and an operator-selected command, never browser-selected mounts or
Docker options. A locally installed image must be selected by its exact sha256 ID;
jobs cannot pull an image. The profile uses:

- UID/GID 1000, no capabilities, no new privileges, read-only root filesystem.
- No network, no Docker socket, no live checkout, controller database, host home
  or provider credentials inside the container.
- One CPU, 2 GiB memory including swap allowance, 128 processes, ten-minute deadline.
- A 1 GiB executable temporary workspace and 128 MiB non-executable temporary
  directory. Project-local TypeScript/Vite/esbuild executables need the workspace
  mount's explicit `exec` option. Workspace writes
  consume bounded memory instead of filling the VPS’s persistent filesystem.
- At most 2,048 ordinary source files / 32 MiB transferred in either direction.
  Private state, environment files, Git internals and dependencies are excluded.
  Symlink/hardlink outputs are refused by this preliminary transfer format.
- Explicit container removal on success, failure and cancellation. Killing the
  Docker client alone is not treated as cleanup.

`HostedTools` connects agent, setup, build/check/conformance, screenshot/video and
publication/proposal sandbox checks to the container executor. `isolatedStudio`
assembles these adapters together, binds the owner's controller directory, and requires
an explicit private-preview adapter. It cannot silently use the local subprocess runner.
Fresh scaffolding uses `--no-install`; trusted Git and signing stay in the controller.
The isolated factory currently rejects remix imports until a server-safe source-fetch
broker is connected. Local Studio and soyLI retain their existing remix flow.
A browser caller never selects commands, image IDs, mounts or workspace directories.

The source adapter exports Git-selected source plus ignored `dist/` build output,
with credentials, Git internals and dependencies excluded. Returned source is validated
before import: no path escapes, links, credential patterns, case collisions or edits
to protected dependency/configuration/guidance files. A concurrent controller-side
edit invalidates the result. Build jobs may change only `dist/`. Writes retain rollback
bytes, and the real Git history is never replaced by the job's throwaway repository.
Ignored test reports and dependency caches do not become source changes.

Inference uses a job-specific Unix socket mounted in the private input directory.
A small loopback HTTP bridge inside the network-disabled container connects OpenCode
to that socket. The controller supplies the selected cloud provider's credential;
the job receives no reusable API key. The broker pins the default provider endpoint
and selected model, strips job-supplied headers, rejects redirects, and limits routes
to inference. Hosted settings also reject custom endpoints before saving/testing them.
Local Ollama/LM Studio/custom servers remain supported by the local Studio.

Each job permits the selected step budget plus four inference requests, two concurrent
requests, 2 MiB/request, 32 MiB of streamed responses and at most 8,192 output tokens
per request. Provider requests have a 120-second deadline. Cancellation/revocation closes
the socket and removes the container. These are resource bounds, **not a monetary
spending cap**. Provider keys currently use the controller's private OS-user storage;
production custody, billing and the browser settings transport still need integration.

`scripts/studio-image.ts` prepares an explicit Docker context containing selected build
sources and browser assets; it never sends the repository, `.env` or draft directories to Docker.
It takes an exact Bun base-image digest, installs the checksum-pinned baseline Bun
1.3.11 runtime for older x64 CPUs, and uses OpenCode 1.19.3 and soyLI's
pinned Node/pnpm/browser versions, and compiles baseline x64 binaries in the image.
Build it with a dedicated memory/CPU-limited Docker builder, then supply the resulting
local image ID to `ContainerJobs`. The image installs one starter dependency/lockfile
profile. Each job checks that profile and copies dependencies into its own temporary
workspace; unsupported dependencies fail with a profile diagnostic. No package download
or install script runs in a creator job. This deliberately limits the initial hosted
profile; it does not restrict ordinary local soyLI projects.

## Required integration before hosted use

The current local agent still executes with the local OS user’s permissions.
Do not infer that adding a container helper makes it safe to expose remotely.
The remaining integration is:

1. Package the explicitly selected temporary compatibility profile, or use a
   compatible CPU with the standard image. Complete acceptance through the assembled
   controller/runner, including real inference through the broker, cancellation and
   retained passing previews. The isolated source-harness build-error repair and
   landscape/portrait capture probes have passed; that is not full controller acceptance.
   Additional dependency profiles need explicit operator provisioning.
2. Integrate production credential custody and spending policy. A user's local
   Ollama/LM Studio needs an authenticated connector back to that device; the VPS's
   loopback address is not the user's computer.
3. Confine source import and publication destinations with a server-side network
   policy before enabling hosted remix/publication. CLI URL checks alone are not a
   server egress boundary.
4. Connect the browser to authenticated CVM control, including publication signing,
   connection settings and asset transfer. Bind downloads/previews to short-lived
   owner authorization on a separate origin. No private draft bytes go to public
   Blossom or public GRASP before explicit publication.
5. Exercise two independent owners end to end: create, edit, preview, remix,
   propose, publish, cancel and disconnect, including a real NIP-46 browser session.

Broader storage/recovery, retention, backups and deduplication are explicitly deferred.
That does not waive execution quotas or owner isolation. Existing local drafts and
the local soyLI workflow are preserved. No production route or deployment flag
enables hosted creation in this change.

## Verification

The CVM test uses a real loopback relay, encrypted SDK transports and three disposable
identities. It rejects a forged caller metadata field, unadmitted callers, another
owner’s draft, modified duplicate requests, and duplicate spending work. Prompt/source
text is absent from relay-visible ciphertext.

The container profile was exercised on the target VPS using its existing Bun image,
without installing an image or changing any service. The probe verified non-root
execution, blocked network, read-only root/input, absent host secret paths, bounded
source export, nonzero exit reporting and timeout cleanup. All test containers and
temporary VPS files were removed. This verifies the executor profile, not a complete
hosted OpenCode/build/capture flow.

The assembled image attempt on the target VPS exposed the CPU blocker above.
A minimal Bun 1.3.11 JavaScript process was OOM-killed within a 512 MiB container;
the same probe passed with the older Bun image. The new CPU check rejects the host
before executing a job and preserves the SSE4.2 cause and exit status 78 through
the controller diagnostic. The disposable builder, test-image tag and temporary
VPS files were removed, and the live website returned HTTP 200 after cleanup.

The selected image source context successfully cross-compiles the soyLI and capture
Linux x64 binaries locally. This checks source completeness, not Linux execution.
The full repository check passed 772 tests before the final hosted guards; the final
Studio/CPU regression run passed 46 tests, with TypeScript checking clean. The web
production build and desktop/phone header checks passed. Existing drafts and the
published draft's journal were preserved across the local restart.

The later [legacy CPU experiment](experiments/STUDIO-LEGACY-CPU.md) demonstrated
the temporary source-runtime alternative on this same VPS. It also caught two image
preparation defects: invoking a transitive Playwright CLI through a nonexistent
project-level binary, and leaving the workspace tmpfs non-executable. The image
builder now installs the actual locked Playwright versions and ripgrep; the executor
explicitly permits project tools on the workspace mount. Jobs remain offline,
non-root and resource-limited. OpenCode source additionally needs a preprovisioned
model catalog and disabled online catalog refresh. No source patches to OpenCode
were needed for these probes.

Container hardening follows the [Docker Engine security model](https://docs.docker.com/engine/security/).
