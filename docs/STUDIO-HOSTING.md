# Hosted Studio

Status: **deployed and live-verified on 2026-10-19**, alongside soyLI 0.31.0.
Open [Studio](https://napplet.soy/studio) with your shell account. The local
`bun run studio` listener remains a trusted local development service and must
not be exposed to the internet. See the [deployment evidence](DEPLOYMENT.md).

The first hosted release uses **your own provider API key**. There is no bundled
inference credit, payment flow or platform-funded model access. Provider charges
apply. Studio supports its listed cloud providers at their default HTTPS endpoints;
Ollama, LM Studio, llama.cpp and custom endpoints remain local-Studio options.

## Start creating

Open [Studio](https://napplet.soy/studio), connect your Nostr account, then open
**Account & settings → AI connections**. Add a supported cloud provider, your API
key and a model with tool calling. The connection's model catalogue can help you
choose; testing that catalogue does not run an agent turn.

Choose **Create in browser** or open a draft from **My creations**. Describe your
idea and send it. Enable **Browser builds** to compile the supported starter in
this tab; leave it off for server builds. Keep the tab open during browser builds.
Both modes run the maker on the host and retain the last passing playable preview.
An interrupted or truncated model response is reported as incomplete, even when
the agent process exits successfully. Saved edits remain available for an explicit
follow-up or check; Studio does not silently start another inference turn.
An unchanged fresh starter is not promoted as a completed creation. Build checks
validate the implementation's mechanics, not whether it satisfies every request.

Use **Publish** to prepare and review the listing, screenshots and gameplay clip.
The active shell account signs the reviewed events. Relay delivery and website
availability are reported separately. To contribute to an existing napplet, use
its **Remix this** entry point and the Studio proposal flow. Existing proposals are
listed in that napplet's source section; review and merging still use soyLI/Git.

Both build modes first import the exact signed release and its published source
using soyLI on the controller. Hosted imports use a credential-free Node worker
for public WSS discovery and HTTPS downloads, with connection-time DNS checks and
normal TLS verification. This avoids Bun's loopback relay tunnel, which the Studio
firewall deliberately blocks. Workers load trusted installation code independently
of the private draft directory and do not write into the installation. Source
archives still require their signed hash, and unavailable exact releases retain
actionable diagnostics rather than silently substituting a newer version.

While that import or the first edit runs, Studio plays the original publication
through the shell's existing browser Nostr reader and verified sandbox player.
It is labelled **Original napplet** and is replaced only when a passing draft
preview is available. This applies to both browser and server builds and existing
drafts. Viewing the original does not run tools, start inference or make the draft
publishable. Exact imported revisions are retained; optional preview failure does
not prevent source editing. No additional API or event kind is introduced.

`bash scripts/test-studio-remix-network.sh` verifies the real CLI import under the
generated Studio firewall in isolated Linux network/mount namespaces (sudo,
nftables, iproute2, OpenSSL and Node required). Its local TLS fixtures require no
external network or inference. It also checks private-address/DNS, redirect and
certificate refusals; Studio service CI runs this regression.

## Responsibilities

| Work                                                        | Browser build                                    | Server build                                |
| ----------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------- |
| Account, model choice, chat, review, exact-event signatures | Shared shell                                     | Shared shell                                |
| Agent and tools                                             | Isolated server container                        | Isolated server container                   |
| TypeScript checking and HTML bundling                       | Browser Web Worker, fixed compiler profile       | Isolated server container, pinned toolchain |
| Draft files, Git history, job receipts                      | Private account workspace on server              | Private account workspace on server         |
| Playable preview                                            | Opaque-origin napplet sandbox in browser         | Same sandbox                                |
| Gameplay recording and release validation                   | Isolated server capture/check                    | Isolated server capture/check               |
| GRASP source push and Nostr publication                     | Controller, signed by shell account after review | Same flow                                   |

Browser builds require the tab to remain open. They do not move inference, Git or
publication to the browser. The experimental local browser-Git work remains separate
and is not authoritative for published source. Existing local drafts are not moved.

## Authorization and transport

The shell signs a NIP-98 kind-27235 POST proof for the exact canonical
`/api/studio/session` URL, method and payload hash. Its body contains an ephemeral
CVM public key and random nonce. This authorizes that tab to access the account's
workspace for eight hours; it does **not** delegate publication signing. Replayed
proofs and ephemeral-key reassignment are rejected. Sign out, account change or
explicit reconnect revokes the old tab session. The last disconnected/expired tab
cancels that account's running job and closes its previews.

Editing, checks, settings, signing requests, proposals and publication use encrypted
ContextVM SDK 0.13.16/MCP over Nostr. The host requires encryption and uses the
transport-verified client key to look up the owner. No request chooses a directory,
container image, executable or owner. The shell retains extension, NIP-46 and
browser-key signing through its existing account layer.

The experimental `soy_studio_call` input is:

```json
{
  "requestId": "UUID",
  "createdAt": 1792368000000,
  "path": "projects/PROJECT_UUID/messages",
  "body": { "prompt": "Make the ball bounce higher" }
}
```

`createdAt` is epoch milliseconds. Optional `upload` references a private binary
transfer instead of embedding a large body. The maintained dispatcher validates
each operation's fields. A mutation's owner, ID and input hash are recorded before
execution; identical retries reuse its result. A restart during an unfinished
mutation yields an explicit uncertain result rather than executing it again.
Receipts last 24 hours. The browser does not automatically repeat mutations.

HTTPS carries NIP-98 session authorization and bearer-authenticated private byte
transfers. Transfers are account-bound, expire after two minutes, and are consumed
explicitly. They are never uploaded to public Blossom. Control inputs are bounded
to 16,000 bytes and inline replies to 10,000 bytes, leaving room for encryption and
Nostr envelopes inside the relay's 64 KiB message limit.

Preview grants last 60 seconds and exchange once for a Secure, HttpOnly,
SameSite=Strict, path-scoped cookie. Every request rechecks the owning session.
Only the trusted preview host/runtime and immutable artifact endpoints are served;
raw napplet HTML has an octet-stream type and sandbox CSP, and executes inside the
existing opaque-origin iframe. Manager/workshop routes and writes are unavailable.
The preview host shares the shell origin; untrusted napplet code does not gain it.
The trusted player explicitly includes only same-origin credentials when fetching
its private artifact, then verifies the hash before creating the sandboxed game.
Public Blossom downloads continue to omit credentials. Preview download redirects
are rejected. Service CI opens this full HTTPS player, interacts with its game and
checks that anonymous access and revoked sessions remain denied.

## Credentials and execution

Provider keys are encrypted at rest using AES-256-GCM with an owner-specific HKDF
key derived from a private host master key. The master key, CVM key and credential
files live outside projects with private permissions. This is host custody, not
end-to-end storage: the operator must protect the host. Keys are never returned to
the browser, mounted into creator jobs, or included in published source.

Each job receives a private Unix-socket inference capability. The broker supplies
only the selected provider's key, pins endpoint/model, refuses redirects and limits
routes to inference. Jobs cannot select another URL, send arbitrary authorization
headers or request provider-side background work. Provider responses are bounded.

The operator pins the worker image by its exact local SHA-256 ID. Containers run
as UID/GID 1000, with no network, capabilities, privilege escalation, Docker socket,
host home, live repository or controller secrets. Root/input filesystems are
read-only; a one-GiB executable workspace and 128-MiB temporary directory are tmpfs.
Limits are one CPU, two GiB memory, 128 processes and ten minutes of execution per
job. The controller passes that same deadline to the worker; there is no shorter
worker-only cutoff. A further 30 seconds allows recovery-file export before forced
termination. Source
transfers admit at most 2,048 ordinary files / 32 MiB, excluding private state,
Git internals and dependencies. Returned files are validated before applying;
protected guidance/dependency files and concurrent edits are guarded. Failed jobs
return recoverable edits when they can complete export; forced termination cannot
guarantee recovery of edits that never left the container.

Execution timeouts retain the `STUDIO_TIMEOUT` classification across the worker
boundary. Studio checks recovered edits without purchasing another inference turn;
only passing checks can promote a preview. If further work is needed, the user can
continue the saved draft. Recovery-file and agent protocol frames are excluded from
retained process output before truncation, so diagnostics cannot show their encoded
payloads in place of the actual error.

One worker runs at a time, with four queued jobs. Queued cancellation starts no
inference. A creator turn has a 20-minute deadline, including queue time. Default
agent budget is 100 steps, configurable per connection. The inference broker
preserves the selected model's output budget and provider defaults: it neither
injects nor lowers an output-token limit. It imposes no separate total-call ceiling
or per-response deadline; cancellation and the enclosing job deadline still apply.
Resource bounds remain two concurrent requests, two MiB per request and 32 MiB
streamed output per job. These are resource bounds, not a spending cap.

The first image supports the starter's exact dependency/lockfile profile. Package
installation happens when building the image, never during creator jobs. Projects
requiring another dependency profile receive an actionable diagnostic and can
continue with local soyLI. Hosted remix and proposals use existing NIP-34/GRASP
flows and exact revisions; no new protocol wrapper or metadata companion is added.

## Operator deployment

Use a dedicated Linux service user and a dedicated size-limited workspace volume.
The supplied service unit uses `/var/lib/napplet-studio`, one GiB controller memory
and the current release's Bun. Its egress helper atomically installs UID-scoped nft
rules before startup. Only public HTTPS/WSS on port 443, explicit DNS resolvers
and the existing loopback CVM relay at port 19351 are admitted. All new private/LAN,
loopback and link-local connections are rejected, including from Git subprocesses.
The preview adapter calls its trusted handler directly and needs no network exemption.
The controller's Docker access is privileged; never give that socket to a job.

`apps/studio/hosting/main.ts` takes an operator-owned JSON config containing
`origin`, `port` (19352), `directory`, `libraryRoot`, `soyli` command, exact `image`,
`profile`, public `relays`, `controlRelay` (`ws://127.0.0.1:19351`), `admitted`
(account keys or `*`), and `networkPolicy: "public-https-only"`. The last field is
an operator assertion backed by the service's kernel policy, not a substitute for it.
Caddy forwards only `/api/studio/*` to the loopback controller. `/health` stays local.
The UI never receives operator paths, image IDs, master keys or the private relay.

Keep a trusted copy of `/opt/profile` from the selected image as `libraryRoot` for
browser compilation. The controller invokes the maintained soyLI scaffold without
installing/running project code. It delegates project execution to the image.
Account admission checks enforce a 256-MiB workspace allowance and refuse new
work when less than 256 MiB remains on the workspace volume. Configure a hard
volume capacity as well. Read/cancel/signing completion remain possible on refusal.
The service currently permits 64 loaded owners, eight sessions per owner, 256 total
sessions, 240 control calls/account/minute and 128 open previews. Transfer staging
is memory-bound to 32 MiB each, 48 MiB/account and 128 MiB total.

The existing VPS requires the temporary `legacy-x64` profile: Bun 1.3.8 and
unmodified OpenCode 1.19.3 source with the pinned Node/Playwright toolchain.
`scripts/studio-legacy-image.ts` prepares a secret-free build context. It verifies
Bun and OpenCode downloads and includes an attributed offline model catalogue.
The standard builder remains available for SSE4.2-capable x64 hosts. Do not weaken
its CPU guard or point a standard image at the legacy host. Both paths require
acceptance of the actual assembled image, not just compilation.

For an initial installation, prepare the image with Bun 1.3.11, build it on the
target architecture, then run `scripts/studio-hosted-acceptance.ts` on Linux with
the resulting exact image ID and profile. This opt-in test uses scripted inference
and disposable projects: it checks agent guidance, build failure/repair, the browser
check bridge, desktop/portrait capture, recoverable failures and cancellation.
It does not call a paid model or publish events. The real browser compiler and
private-preview round trip must also pass in a browser.

After acceptance, run the operator-only installer from the verified checkout:

```sh
sudo bash scripts/studio-install.sh \
  sha256:<verified-image-id> legacy-x64 \
  https://napplet.soy wss://relay.napplet.soy <host-dns-ip>
```

Use the host's actual DNS resolver addresses. The installer refuses an existing
configuration or storage, requires four GiB of free disk, creates a dedicated
service account and one-GiB filesystem, and exports trusted compiler libraries from
the image. It enables the unit but does not start it or change the reverse proxy.
The normal deployment then starts Studio, verifies its loopback health and switches
the website. A failed activation restores the previous release and its Studio
service when present. Image/profile changes require their own acceptance before
updating the operator configuration; deploying source does not rebuild the image.

Storage retention, backup/recovery policy and deduplication remain deferred.
Existing local drafts, Git repositories and the local soyLI workflow are preserved.
A broader proposal inbox, notifications and browser merging are separate features;
proposal discovery remains on each napplet's source section and proposal pages.
