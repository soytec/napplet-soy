# Publishing a creation

The CLI connects creator accounts, Git/GRASP, Blossom and NIP-5D publication, with a durable retry journal. The website's [persistent relay index](INDEXING.md) confirms the exact named revision and its artifact, plus the independent snapshot when explicitly requested. A confirmed publication returns `indexed`, `websiteReady: true` and a check timestamp; a website that is unavailable or still catching up leaves the successful relay publication at `announced_pending_index`. Authors can claim named routes on the napplet page after signing in with the publishing identity.

Ordinary `soyli publish` updates the project's stable kind-35129 listing. Its
address, social thread and source repository remain the same across revisions.
Use `soyli publish --snapshot` when you also want an independent immutable
kind-5129 publication. The returned `/r/<current-event-id>` link already pins an
exact signed named revision without requiring that additional snapshot. Back up
the journal and index: relays may prune replaced named events.

## Commands available from this checkout

```sh
bun run soyli publish --project /path/to/my-experiment --network local --dry-run
bun run soyli publish --project /path/to/my-experiment --network local
bun run soyli publish --project /path/to/my-experiment --network local --snapshot
bun run soyli status --project /path/to/my-experiment --network local
bun run soyli publish --project /path/to/my-experiment --network local --resume
```

Start the platform services with `bun run dev` or `bun run dev:prod`. Set up/select an account in the matching network profile. Install the sandbox-check browser once with `bunx playwright install chromium` in this checkout. Creators can also use the standalone `soyli` executable and public installer; see the [CLI guide](CLI.md).

`--dry-run` prints the exact selected files, source size, creator, identifier, artifact hash, snapshot choice and resolved service destinations. It does not open a signer, run code, contact a service, create a journal, or commit source; the one exception is a NIP-05 lookup to resolve the owner of a `nostr://` Git remote. It reports the `sourceRepository` that publication would use. It lists remote and browser checks still required. `status` reads the local journal only; it does not claim to observe the current remote state. `--json` writes one structured result to stdout; publication errors include `code`, `message`, `stage` and `retryable`.

An ordinary `publish` checks the current project. If a different unfinished release exists for the selected author, it stops and explains `--resume`. Explicit resume finishes that author's saved bytes and metadata even while the editor contains newer changes. Publish again afterward to release the newer revision. Pending releases belonging to other authors remain untouched and do not block this author. There is no implicit retargeting, discard, force-overwrite, or rollback command. The snapshot choice is frozen with the job. `--resume` preserves it; a pending named-only job cannot gain a snapshot. Finish that job, then publish with `--snapshot`. Older journals without a saved choice retain their original paired events and signatures on retry. An unchanged completed paired release can still repair those exact events; new ordinary revisions create no extra snapshot.

## Real Git history

Source is the actual committed working repository. Save a checkpoint with
`soyli checkpoint "Describe the change"` or ordinary Git before sharing. The CLI
requires a clean source tree and builds projects with `entry: dist/index.html`
before its sandbox check. Build output and screenshots are separate release inputs;
Git commits and authorship are preserved. The source archive uses that exact tree,
with safe file aliases represented by regular copies of their committed targets.

Code and the ancestry reachable from the pushed main/release refs are public and
open source by default. Other local branches are not pushed automatically. History
checks reject known credential paths/content, including deleted files still reachable
in history. These checks cannot prove an absence of secrets. Ignoring a file does not
remove a previously committed version. `publish.files` may include additional release
inputs, but no longer conceals tracked files or old commits from a Git publication.

The journal retains the committed source and frozen build inputs for retry; it does
not manufacture a separate release history. `source-commit` equals the real source
HEAD. Existing synthetic-history journals require explicit migration or a fresh
publication identity; automatic adoption/rewriting is not performed.

One remix can be published independently and proposed upstream in either order.
See [collaboration](COLLABORATION.md) for proposals, built review and maintainer actions.

## Publishing from your own NIP-34 repository

By default soyLI hosts the source: it announces a repository named after the
napplet identifier on the `grasp` service and pushes `main` and release tags there.
A project that already lives in its own NIP-34 repository can publish against that
repository instead, so readers, remixers and proposals reach the place where
development happens.

soyLI chooses the repository in this order:

1. `publish.repository` in the project configuration (`napplet.json` or
   `.napplet-space/project.json`), optionally per network under
   `publish.networks.<network>.repository`. It accepts an `naddr1…` address, a
   `nostr://` clone URL or `30617:<pubkey>:<identifier>`.
2. Otherwise, a Git remote whose URL is `nostr://…` and whose owner is the
   publishing key. ngit URLs work, including NIP-05 owners such as
   `nostr://example.com/relay.example.com/my-project`. Remotes owned by other keys,
   such as a remix's `nostr` upstream remote, are ignored. Two owned repositories
   stop publication until `publish.repository` selects one. A `nostr://` remote that
   cannot be resolved also stops publication, with its cause, rather than falling
   back to a second hosted repository.
3. Otherwise, the hosted repository described above.

Repository references without relay hints are discovered on the selected
publication relay and its configured mirrors. Explicit relay hints are used as
given. A NIP-05 owner lookup is limited to eight seconds and 64 KiB, refuses
redirects and sends no browser credentials.

The repository must belong to the publishing key. soyLI never signs its
announcement or state and never pushes to it. Push the release commit first with
`git push` or `ngit push`. Before signing, and again before announcing a resumed
release, soyLI requires the commit to be contained in a ref of the repository's
signed kind-30618 state, and a clone URL from the announcement to serve that ref
at the signed tip. Otherwise publication stops with `SOURCE_NOT_PUSHED`, naming
the commit to push. Any branch layout is accepted; there is no `main` requirement.

The release's `source` tag becomes that repository's `nostr://` URL, and an
optional preview descriptor's `repository` tag becomes its first clone URL.
`source-commit` and `source-archive` are unchanged, so the exact source remains
recoverable from Blossom even if the branch later moves. soyLI does not add
release tags to your repository; keep released commits reachable there.
`publish --dry-run` and the JSON result report `sourceRepository`.

Dynamic backend deployment still requires soyLI-managed GRASP source. When an
existing repository is selected, `backend deploy` stops with
`BACKEND_SOURCE_LINKED` before contacting a provider or requesting authorization,
instead of trying to build from a nonexistent generated repository. Local backend
previews through `soyli dev` remain available. Supporting linked repositories for
remote backend builds is a separate follow-up.

An existing napplet can move from the hosted repository to your own; the Git host
check does not apply then. The earlier hosted repository is left in place for older
releases. [Deleting the napplet](LIFECYCLE.md) removes hosted repositories but keeps
your own. `soyli propose` and `soyli review` use your repository too, and `soyli
push` refers you to Git or ngit.

## Destinations and identity

| Profile | Primary relay                | Blossom                       | GRASP                     | Website route origin    |
| ------- | ---------------------------- | ----------------------------- | ------------------------- | ----------------------- |
| local   | `ws://127.0.0.1:19347/relay` | `http://127.0.0.1:8081`       | `http://127.0.0.1:8082`   | `http://localhost:8080` |
| public  | `wss://relay.napplet.soy`    | `https://blossom.napplet.soy` | `https://git.napplet.soy` | `https://napplet.soy`   |

The managed public services are deployed at napplet.soy. Starting with the pending
soyLI 0.15.0 release, new public projects additionally mirror manifests to the five
external [shared relay defaults](RELAY-DEFAULTS.md): Damus, nos.lol, Primal,
nostr.mom and Pocketstr. Existing explicit project settings are preserved. Local
mode has no public mirrors or fallback. Automated publication tests use isolated
services; public deployment checks verify existing content without writing test
publications. See the dated verification records in [deployment](DEPLOYMENT.md).

Override destinations with `--relay`, `--blossom`, `--grasp`, `--site` and repeated `--mirror`. Alternatively put `relay`, `blossom`, `grasp`, `site` and `mirrors` in `.napplet-space/project.json` under `project.publish`; an empty `mirrors` array disables mirrors. Flags take precedence over project settings and defaults. Persist custom defaults in the project if subsequent ordinary publishes should use them without flags. `--resume` uses the journal's original destinations; conflicting overrides are rejected.

### Your outbox relays (NIP-65)

Current source (not yet released) also copies each release to the creator's own
NIP-65 write relays, so outbox-model clients can find it there. After the primary
relay succeeds, `soyli publish` reads the newest verified kind 10002 relay
list for the publishing key from the primary relay, the mirrors and, on the public
network, the shared discovery relays plus the relay-list indexer
`wss://purplepag.es` (read only, never a publication target). Relays marked `write`
or unmarked receive the same signed current manifest and, when present, descriptor
and explicit snapshot, to up to eight relays not already covered by the primary or mirrors. Listed relays
must satisfy the same endpoint policy as other destinations: public WSS on the
public network, literal-loopback WS with `--network local`; others are counted as
skipped. The normalized URL must fit the persisted 256-character limit, including
percent encoding; overlong URLs are skipped before any write.

The primary completion receipt is saved and the pending pointer cleared before
optional delivery. Lookup plus mirror/outbox delivery has one eight-second network
budget, with at most four destinations copying concurrently. Each destination
keeps descriptor/snapshot/current order. Expiry cancels subscriptions and queued
sends; unfinished destinations get retry diagnostics. Local receipt writes and
website verification are outside that network budget.

These copies are best effort, like mirrors. Lookup or copy failures never undo the
primary publication. The result records `outbox.source` (`nip65`, `none` or
`unavailable`), the selected relays, per-relay `copies`, `errors` with diagnostics
and a `lookupError` when the list could not be read. Each run reads the current
relay list, so rerunning `soyli publish` with unchanged source retries failed
copies and reaches newly listed relays with the same signed events. The relay
list is not part of the frozen destinations and does not affect `--resume`
validation or the returned `naddr` hints.

Attempted outbox destinations are persisted before network writes and accumulated
as `outboxHistory`, including partial failures and relays removed from later lists.
Each release retains up to 128 distinct outbox destinations; new destinations are
skipped explicitly when that history fills, rather than forgetting earlier copies.
CLI unpublish/delete includes these destinations across retained release journals,
as well as every historical primary and mirror. The lifecycle inventory supports
up to 256 known relays and refuses a larger inventory without silently truncating it.
The browser also queries the author's current NIP-65 write list and retains
previously inspected destinations; a failed lookup marks its inventory incomplete.
Unknown third-party copies and old destinations absent from both a journal and
the current relay list cannot be recalled automatically.

`soyli migrate` uses the same bounded outbox delivery after primary migration,
copying its existing signed converted manifest. It does not rebuild or resign the
napplet. `migrate --resume` retries these copies using its saved receipt.

Public endpoints require HTTPS/WSS without credentials, query strings or fragments; service origins have no path. Literal private IPs and localhost/local names are rejected. Local service endpoints require literal-loopback HTTP/WS. The website link may use localhost. These CLI endpoints are operator/creator configuration, not URLs taken from untrusted gallery metadata; DNS pinning against rebinding is implemented in the gallery downloader, not this publisher.

The user's selected account determines the author of the next publication. A saved project `creator` is a public build hint; no credentials are selected from it. Sharing updates the ignored binding and backend context to the selected author before building. The operation captures that account ID before asynchronous work and never resets the global selection if another terminal changes it.

Publication history is separated by public key within each project/network. The same public key through a different signing method continues the same listing. Another public key creates a separate listing and repository; its history can coexist with the original in this folder. `status`, `publish --resume` and lifecycle operations follow the selected author. Legacy journals are imported without moving or deleting frozen releases. A resumed release always retains its original author and destinations.

Each generated identifier is stable and independent of its title; older starter projects derive a stable 13-character identifier from their existing `previewId`. Changing the identifier, primary relay or hosted Git service within one author's existing publication history still needs explicit migration; moving to [your own repository](#publishing-from-your-own-nip-34-repository) does not. Blossom, website and mirrors can change for a new release. Restoring a lost journal is required to continue an existing remote identity safely; automatic journal adoption remains separate work; remix is supported.

## Source and sandbox checks

Tracked source and selected release inputs are inspected, up to **1,024 files and
40 MiB**; the selected count includes built HTML and preview files. The source tar
has a 50 MiB ceiling; playable HTML is limited to 25 MiB. The file count is a tooling
safety budget, not a Nostr or creator quota. A nonempty LICENSE is required.
`publish.files` adds inputs; it cannot narrow Git-visible source or hide history.
Tracked files need no explicit
enumeration, and the complete `napplet.json` remains limited to 16 KiB.

The 25 MiB HTML allowance is separate from the unchanged 10 MiB limits for managed
assets and host resources. The public website, indexer and runtime must deploy the
updated artifact limit before they admit and play HTML above the former 10 MiB
ceiling. Releasing or updating the CLI alone does not update those services.

Managed Git history is bounded to 10,000 reachable objects, 10,000 historical
file versions/paths and 40 MiB of blobs. Current and historical Git trees may
contain safe relative file aliases: every alias must resolve to a public regular
file in that same immutable tree. Working aliases must remain within the selected
public source, and resolved bytes pass credential checks. Absolute, escaping,
dangling, cyclic, directory and private links remain blocked. Configuration,
playable artifacts, managed assets, presentation files and backend build inputs
still require regular files. A safe alias needs no replacement or history rewrite.
Submodules, Git attributes/modules, private state/dependency folders and likely
credentials are refused. Git hooks are disabled.

The CLI builds source only on explicit publish/propose/build commands. Library
callers supply their built artifact; checks and merely opening a review do not run
project scripts. Standard build metadata and required NAP domains are checked.

The browser check runs the frozen HTML under our current shared host, CSP, opaque iframe sandbox and shim. It checks startup, the shell handshake, script errors and CSP violations, while blocking external network requests. It does not use an inherited preview server or modified runtime bundle. This is a startup smoke check, not comprehensive gameplay, performance, NAP, or external-service conformance testing. The compiler runs in a fresh Bun process to avoid the pinned runtime's known build/read issue after networking. The check report records the runtime profile and browser version.

The archive comes from Git's tar of the exact frozen commit. Safe aliases are
materialized as regular files using the exact committed target bytes, including
binary content and trailing newlines; the Git repository itself keeps its links.
Each materialized copy counts toward the 1,024-file and 40 MiB expanded-source
limits. The untrusted archive reader still rejects links. Archives without aliases
keep their original bytes, preserving existing archive hashes and resume behavior.
The result remains a portable, hash-verifiable source snapshot for recovery, offline
inspection and independent mirroring, alongside the Git repository and history.
The playable artifact is the entry selected in `napplet.json`: `index.html`
for legacy projects or `dist/index.html` for the upstream boilerplate. Built projects
include Git-visible source files plus their ignored built HTML by default, so the
release journal retains editable TypeScript, the locked toolchain configuration and
the executable artifact. The Git repository and source tar preserve the actual
committed source tree; ignored build output is a separate Blossom artifact. The
publisher reads standard `napplet-requires` metadata from built HTML in addition to
configured requirements. CLI publish/propose build dist projects before calling the
sandbox checker; the checker itself executes only the frozen HTML. This records exact bytes,
not an independently reproducible-build attestation. Both tar and HTML are uploaded to Blossom and independently retrieved/hash-checked.

## Journal and retry behavior

`.napplet-space/<network>/index.json` selects the pending/latest job. Each job directory stores its public plan, clean source repository, separate frozen `files/` inputs, archive, signed events, checks and receipts. The journal has a schema and content fingerprints. An exclusive SQLite lock covers the project across processes and network profiles; OS process exit releases it. Atomic JSON replacement and fsync preserve completed checkpoints. Native Git objects and source files are also retained locally. Keep this directory when moving to another machine: dropping it loses the retry/concurrency history.

1. Inspect the source and selected identity. Query the newest remote current manifest and Git announcement/state with an explicit completed relay query.
2. Run the sandbox check; reject edits made during that check. Freeze the file set, commit and source archive.
3. Persist the job and snapshot choice, then signed Git authorization and current manifest (plus the explicitly requested snapshot) before sending any of them.
4. Publish Git source and all retained release refs, using a lease on the main branch. Verify Git refs and signed source metadata.
5. Check Blossom ownership and bytes. Reuse verified owned blobs; otherwise issue a scoped signed upload and independently verify retrieval.
6. Publish the optional snapshot first, then the current manifest. Require every requested event to be queryable. A lost acknowledgement leaves the same signed event available for retry.
7. Attempt optional mirrors, then check the website's exact current projection, any requested snapshot and verified artifact. Save confirmed or pending website status without changing the signed publication.

Repeating the same release rechecks storage/relay evidence, repairs missing blobs/events and retries unavailable mirrors without creating another snapshot or source commit. `unchanged` means the release identity and bytes were reused, even if missing remote data needed repair. A change in source, title, topics or required domains creates a new release; identical HTML alone does not make metadata changes a no-op.

With the prepared soyLI 0.8.1 upload fix, slower transfers can continue while data
arrives. Upload and independent verification have separate time budgets; see
[Blossom timeout policy](BLOSSOM.md#upload-timeout-correction--prepared-for-soyli-081).
After upgrading and deploying the server fix, retry an interrupted frozen publication
with `soyli publish --resume` from the existing project. Preserve its `.napplet-space`
journal and identity. Completed blobs are reverified and reused; a partially uploaded
blob is resent in full with the same frozen bytes/hash.

Checks before and after remote stages reject unknown competing current or source events. Timestamps increase monotonically with a bounded clock-skew check. A Git lease protects the branch update. Nostr relays do not provide a distributed compare-and-swap transaction: a concurrent event can still arrive between checks. The CLI detects an observed conflict and stops instead of claiming it can roll back already-public events. There is no automatic destructive conflict override.

Source state retains at most 128 release refs in this initial adapter. Reaching that limit stops without deleting refs; a scalable retention policy is future work. Optional mirrors may be offline while primary publication succeeds. Stored receipts are observations, not promises of permanent hosting. Back up the journal and creator recovery material separately.

The website confirmation endpoint accepts a current revision without a snapshot.
Older paired CLI jobs retain the same exact-pair confirmation. Deploy the updated
website/indexer to confirm named-only releases; an older endpoint leaves an
otherwise successful relay publication at `announced_pending_index`.

## Protocol output

Fresh publications use the selected [standalone NIP-5D draft at 4d0fb2e](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md) and [NIP-34 Git URLs/state](https://github.com/nostr-protocol/nips/blob/master/34.md).
Ordinary publication writes kind 35129 with stable `d`; `--snapshot` additionally
writes kind 5129 without `d`. Both carry one two-element `x` tag with the HTML SHA-256, nonempty plain-text
`content`, server hints, optional title/topics and the same advertised capabilities.
There are no `path`, aggregate-marker, `description` or `requires` tags in new events.
Snapshot `a`/`A` is optional immediate/root ancestry, never its own application
identity. Named current events do not carry these lineage tags. `source` remains
an ordinary `nostr://` repository URL.

Creators retain the convenient local `requires` field and existing Vite build
declarations; the publisher writes them as `R`. Optional `optionalDomains`,
`archetypes`, `intents: [{intent, parameters}]` and `icon: {file, mime?}` configure
`O`, `z`, `i` and hash-addressed icon tags. Unknown optional domains do not block
publishing or playback. An icon is an optional local PNG/JPEG/WebP up to 5 MiB,
included in source and uploaded with a journaled receipt. These declarations
do not grant runtime capabilities. The [creator manifest guide](NIP5D-CREATOR.md)
includes the schema, editor/CLI workflow and migration instructions.

Already signed legacy events remain readable. A saved publication job with the
previous plan shape finishes in that original format, preserving its exact
signatures, frozen source and descriptor. A fresh publication after upgrading
uses standalone manifests even when the HTML has not changed. No history rewrite
or republishing of other authors' events is needed. Deploy the compatible shell
and indexer before distributing a CLI that publishes the new shape.

Two optional provenance tags, `source-commit` and `source-archive`, carry the exact Git commit and content-addressed source tar URL. These are Space publishing conventions, not NIP-5D requirements. Clients may ignore them; ordinary `source`, manifest and Blossom discovery still work. There is no mandatory descriptor, branded hashtag or current-to-snapshot pointer. Automatic screenshots and optional video descriptor authoring are supported; metadata from other clients remains optional.

## Verification

```sh
bun run check
bun run test:publish
# Optional native OS store test: creates and deletes its own temporary credential IDs.
bun run test:publish:native
```

The deterministic tests cover interrupted uploads, lost relay acknowledgements, unchanged retries, metadata-only updates, modified working/frozen source, forged saved signatures, competing remote versions, concurrent processes, identity/target isolation, failed mirrors and repair of missing data. Native service tests use the actual Khatru/GRASP/Blossom implementations, the browser check, an independent Nostr wire reader, tar extraction and independent Git clone/fetch. An opt-in test drives the real CLI across processes with temporary native Keychain credentials.

Persistent website ingestion, confirmed playable links, authenticated names, the public installer, preview descriptors and remix are implemented. Additional build profiles, explicit journal adoption/conflict recovery, broader native keystore acceptance, and publication/discovery acceptance in an external public client remain separate work. See [the interoperability contract](PROTOCOL.md) and the dated [deployment verification](DEPLOYMENT.md).

## Visible project destinations and previews

Run `soyli config` to inspect effective destinations without an account,
build, or network request. `soyli config init` materializes the current
network's targets in `.napplet-space/project.json` under `project.publish`. New projects and remixes
include explicit public and local profiles:

```json
{
  "publish": {
    "networks": {
      "public": {
        "relay": "wss://relay.napplet.soy",
        "blossom": "https://blossom.napplet.soy",
        "grasp": "https://git.napplet.soy",
        "site": "https://napplet.soy",
        "mirrors": [
          "wss://nos.lol",
          "wss://relay.primal.net",
          "wss://nostr.mom",
          "wss://relay.pocketstr.com"
        ]
      },
      "local": {
        "relay": "ws://127.0.0.1:19347/relay",
        "blossom": "http://127.0.0.1:8081",
        "grasp": "http://127.0.0.1:8082",
        "site": "http://localhost:8080",
        "mirrors": []
      }
    }
  },
  "preview": { "delayMs": 1500 }
}
```

Merge this into the existing project configuration; do not replace its identity,
entry, license, or other metadata. Precedence is CLI target flags, selected
`publish.networks` profile, legacy direct `publish` fields, then built-in defaults.
`publish.files` can add release inputs but does not remove tracked Git history. Top-level `relays` and `servers`
are runtime read/resource hints; they are never upload destinations.

`relay` receives signed manifests and preview descriptors. `blossom` receives
HTML, source archives, PNG previews and optional raster icons. `grasp` must be a compatible NIP-34/GRASP
Git service; it is unused while `repository` or an owned `nostr://` remote selects
[your own repository](#publishing-from-your-own-nip-34-repository). `site` determines share links and indexing checks. `mirrors` are
best-effort extra copies after primary acknowledgement, not substitute primaries;
set `mirrors: []` to disable them. A failed primary stops publication and leaves
an exact resumable journal; it does not silently switch services.

Edit e.g. `publish.networks.public.blossom` to choose another server. New releases
may change Blossom, site or mirrors. Changing the identity, primary relay or Git
service of an existing journal requires migration of their published history;
the CLI refuses to overwrite competing state. Pending releases always resume with
their original destinations. Keep earlier stores available for existing snapshots.

See [preview capture and metadata](PREVIEWS.md#creator-capture-and-publication-2026-09-14)
for automatic screenshots and choosing an inspected image. `soyli skills
update` refreshes managed guides and adapted skill bodies in an existing project
while reporting and preserving creator edits. Vendored upstream snapshots and
pins remain unchanged; generated manifest guidance reflects the selected draft.

## Author publication lifecycle — 0.17.0

[Unpublish, republish and hosted-data deletion](LIFECYCLE.md) use signed NIP-09
requests (kind 5), fresh NIP-5D current listings and direct Blossom BUD-11/12
requests. The author confirms a concrete inventory; per-service status distinguishes
confirmed absence, retained shared data and incomplete requests. No manifest
extension or website deletion API is required. NIP-5D and NAP pins are unchanged.
GRASP retains deleted repository archives for 90 days by default; copies and forks
outside the selected services are not recalled.

## Related game resources — soyLI 0.25.3

Publication and playable proposal previews include deterministic BUD-10
`<link rel="related">` declarations for external managed assets inside the prepared
HTML, before browser checks, artifact hashing and freezing. The signed `x` therefore
covers these declarations. Retries reuse frozen bytes rather than adding metadata to
older jobs. Editable legacy HTML and committed source archives stay source; builds
write the declarations into `dist/index.html`. See [asset coverage and backup limits](ASSETS.md#related-resource-links--soyli-0253).
soyLI 0.25.3 prepares these declarations without requiring a host deployment.
Existing napplets remain valid; rebuild and publish to add links to a future revision.
