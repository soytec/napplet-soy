# NIP-5D standalone manifest migration

This source targets [dskvr/nips PR 7 at `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md), reviewed on 2026-10-04 and confirmed merged at the unchanged head on 2026-10-05. It supersedes the writer contract at `24711d9c47bbdd07908bf1d52bf677d9cbc530f0`, retained by the legacy reader. Kinds remain **35129 / 15129 / 5129**. Deployment and CLI release verification are recorded separately below.

## Read old, publish new

| Area                    | New publication                                                              | Existing publication                                          |
| ----------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Artifact                | Exactly one `x` containing raw HTML SHA-256                                  | Verified `/index.html` path and legacy aggregate binding      |
| Description             | Nonempty plain-text `content`                                                | Existing `description` tag                                    |
| Required capabilities   | Repeated `R`                                                                 | Existing `requires`                                           |
| Optional capabilities   | Repeated `O`; missing domains do not block                                   | No extra capability is inferred                               |
| Icons                   | Optional hash plus PNG/JPEG/WebP MIME                                        | Existing linked covers remain supported                       |
| Discovery               | `z` archetypes, queryless `i` intents and parameter names, `#R`/`#O` filters | Existing kinds, titles, descriptions and topic filters        |
| Snapshot ancestry       | Optional `a` parent / `A` root on 5129 only                                  | Historical named ancestry and snapshot self-address semantics |
| Source and presentation | Optional Git/source/archive and direct presentation extensions               | Existing source and preview links remain valid                |

One shared validator handles web, indexer, local review, remix, moderation inputs and playback. Format selection is explicit; failure is not a reason to reinterpret a malformed new event as an old event. Nostr ordering still chooses the current event before package admission. An invalid newer event does not silently restore an older release as current.

Fresh publication and proposal previews use the new shape. A frozen legacy journal resumes the exact original plan, event format and signatures. Re-publishing an unchanged project after an older completed publication still creates the new-format publication. No source history or signed historical event is rewritten.

Local `requires` remains the authoring option and is translated to `R`. `optionalDomains`, `archetypes`, `intents` and `icon` are editable through project metadata and the local manager; see [the creator guide](NIP5D-CREATOR.md). Required build metadata is combined with explicit required domains. Optional declarations cannot override required ones or grant any permission.

## Identity and saved data

A new manifest binds the protocol identity to the raw artifact hash. Existing named/root applications retain their author-qualified address, and their browser saves/settings keep the deterministic legacy-derived physical build key. The same author, address and HTML bytes therefore keep the same data across a manifest-only upgrade. A different HTML build retains the existing build-isolation behavior; this migration does not promise cross-build save migration.

New snapshots are independent. Parent/root tags cannot select a parent's storage, account backend binding, social thread, moderation identity or deletion scope, even for the same author. They are provenance claims only. Legacy snapshots retain their old validated own-address behavior. A bare new snapshot with no ancestry is valid, discoverable and playable.

New soyLI pinned links use `/r/<signed-current-event-id>` to preserve the named app's address-based integrations while pinning its exact executable and metadata. `/r` accepts all three manifest kinds; existing snapshot links continue to work. The persistent site index archives observed replaced revisions, keeps their verified artifact references, and applies deletion/expiration/moderation to those revisions too. They do not become extra current gallery entries. Current events and archived revisions each have a 10,000-record operational bound; artifact/preview cache budgets still apply.

Back up the index alongside other persistent service data. Relays can prune replaceable events: a new operator cannot reconstruct an unobserved older named event from a relay that discarded it. An exact signed-event link pins identity and content, not eternal data availability. Independent snapshot events remain ordinary relay-retainable immutable publications.

Exact current/snapshot pairs may be coalesced in the gallery only when their signer, timestamp, artifact and every shared signed presentation/capability/source field agree and both manifests validate. The index compares archived named revisions too. If an old named revision was never observed, a snapshot's release-specific signed kind-32267 descriptor can provide a display-only link to its author's live newer listing: exact `app` reference, same author/timestamp/title and one unambiguous `latest` address. Missing or invalid evidence leaves the snapshot independently discoverable. Matching ancestry, title or artifact alone is insufficient. Direct snapshot URLs retain their independent scope; descriptor-based grouping never authorizes deletion or grants parent permissions. Loading old named events does not resurrect old gallery cards.

Lifecycle review separately enumerates exact signed pairs, including retained historical revisions, and shows their event IDs before author confirmation. The shared planner revalidates that inventory; saved receipts freeze it for retries. Unknown or near-matching snapshots remain independent. A bounded optional history endpoint supplies signed events, not deletion authority. See [the lifecycle contract](LIFECYCLE.md).

## Optional features and trust

Icons are downloaded by hash only from declared Blossom origins. Both the hash and actual decoded PNG/JPEG/WebP format are checked. Byte and dimension budgets apply before rendering; the browser uses verified Blob URLs and the index uses normalized verified images. Invalid or unavailable icons fall back to ordinary artwork without blocking execution. Existing screenshots take cover precedence.

The gallery exposes archetype, intent, required-domain and optional-domain filters alongside existing search/topics. Intent/capability tags advertise behavior, not authority. The complete `R` set is checked at launch against actual host support. `O` does not constrain compatibility. Targeted intersections cannot enumerate every compatible app, so they never replace this local check.

The discovery helper also supports opt-in intersection queries from [NIP-91 PR 2252 at `b93bda29d45998866e81c65e0693616294a78672`](https://github.com/dskvr/nips/blob/b93bda29d45998866e81c65e0693616294a78672/91.md). Every `&` constraint retains its matching `#` fallback in the same filter, and results are checked locally. The gallery's single-selection facets use ordinary NIP-01 filters. The managed relay supports those indexed filters but does not advertise NIP-91 intersection support; that separate relay extension is not a requirement of NIP-5D.

The upstream announcement mentions screenshot tags and possible intent hints, but
the pinned PR defines neither a screenshot-tag schema nor an intent dispatch
operation. Fresh soyLI publications use the documented optional downstream
[`soy.presentation/2` convention](PREVIEWS.md#direct-manifest-presentation--2026-10-06-source)
for hash/MIME screenshot and video references on the existing manifest. This is
not part of the selected NIP-5D pin. Existing signed application descriptors remain
readable; old frozen jobs finish unchanged. There is no new event kind, runtime
`intent` grant, inter-napplet launch or automatic handler invocation.

The executable remains one self-contained HTML file verified before CSP and shim injection into an opaque `allow-scripts` iframe. WASM and managed resource transport are unchanged. No source, icon, descriptor, Git host, site alias or Soy provenance is a playback prerequisite. All publishers use the same admission rules.

## Dependency and rollout boundaries

The manifest migration is implemented by Soy's parser/publisher and managed guidance adapters. Runtime shim 0.30.0, nap/core 0.32.0, starter SDK 0.24.4, Vite plugin 0.11.2, conformance CLI 0.2.15 / engine 0.13.0 and the recorded boilerplate/skill snapshots retain their pins. The plugin still builds single-file HTML and embeds required-domain metadata; its optional legacy event output is not used by soyLI publication.

1. Deploy the dual-format reader, indexer, runtime and associated service policy first. Preserve the index database and allow projections to refresh.
2. Verify old and new named, root and snapshot fixtures through the deployed site, including old links and unavailable-artifact states.
3. Release the updated CLI writer and guidance. Existing projects can run `soyli skills update`; source/build configuration remains the creator's work. Publish normally to upgrade a release; use `--resume` only for an existing frozen job.
4. Keep the legacy reader. No bulk re-signing, history rewrite or deletion is necessary for old napplets to remain playable.

Independent clients must adopt the new event shape themselves. The pinned Paja/upstream-builder checks in [interoperability](INTEROPERABILITY.md) qualify the legacy format only. Passing those tests is not evidence that an older external host understands PR 7.

## Verification

Local verification on 2026-10-04:

- `bun run check`: 495 tests passed across 119 files, 4,054 assertions; typecheck passed.
- Go relay `test -race ./...` passed, including raw-hash moderation, legacy/snapshot identity and indexed discovery tags.
- `tests/services/nip5d-migration.test.ts`: real relay/Blossom/indexer and production browser passed (35 Bun assertions plus UI checks). Covers all three kinds in both formats, saved-state continuity, independent snapshots, required/optional capabilities, plaintext descriptions, icons, filters, archived pinned navigation and confirmed removal of current/historical pairs while independent snapshots remain listed.
- Real publishing, proposal, remix and mobile lifecycle service tests passed. Source and compiled arm64 CLI lifecycle runs each passed 31 assertions through publish, unpublish, republish and hosted-data deletion. The compiled fixture includes the release preview bundle and companion browser libraries.
- Native CLI fresh scaffold, project metadata roundtrip and guidance update passed with an isolated account directory and no creator account setup.
- Pinned Paja/upstream-builder/ngit interoperability passed 26 assertions for the **legacy format**. This does not qualify those external clients for PR 7.

The regression suites also cover frozen legacy journal resume, fresh upgrade, third-party metadata bounds, identity isolation, moderation, signed history inventory, icon verification and cold legacy discovery. Tests use isolated local services; no remote publication, release or deployment is claimed.

Additional local verification on 2026-10-05: TypeScript plus 545 source tests across
129 files (4,421 assertions), production web build and Go relay race/integration
checks pass. Fresh Chromium tests cover both formats and address-bound gallery
social counts after the previous release disappears (68 assertions). The compiled
macOS ARM64 CLI passes migration confirmation/retry and safe source-alias/size
checks (13 tests, 147 assertions). These are local verification results; the
release rollout still requires production checks and all four native CI jobs.

## Release rollout — 2026-10-05

The dual reader/index/runtime and associated service policy were deployed first
in `20261005090521302-87357`, with persistent index/service state preserved.
Application, relay, Blossom, GRASP and health gates passed locally and on the VPS.
Fresh live desktop/mobile checks confirmed the gallery order/options and restored
10,000-sat total for the affected updated napplet, with no page errors. Its original
receipt and a read-only metadata-conversion plan independently verified against
the current manifest and exact published HTML. No public social event, payment
or migration was posted as a test.

Then [soyLI 0.24.0](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.24.0)
was published from `a85da7dbd3f46f284dd163ba32628e84ddc90996` after
[workflow 37289773986](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37289773986)
passed the source gate, all four native jobs and release verification. Website
installer/download references are advanced only after those public packages exist.
Existing signed napplets and user-project histories are retained. External-client
support for the new shape remains a separate qualification.

The clean-install migration-preview correction is included in
[soyLI 0.24.1](https://github.com/zeSchlausKwab/napplet-soy/releases/tag/soyli-v0.24.1),
source `2a8733af7fe14f6179a6d034db56ece351ac9f2e`.
[Workflow 37292441710](https://github.com/zeSchlausKwab/napplet-soy/actions/runs/37292441710)
passed all four native platforms and release publication. Previewing before account
setup creates only its private plan directory; original-author confirmation and
selection remain mandatory for signing. The compiled CLI's account-free preview
also verifies the affected napplet's actual published HTML.

Final website deployment `20261005095909023-57511` is active with the 0.24.1
installer and four native download links. Production service/sandbox checks passed;
web and index health agree on that release. A fresh public installation reports
0.24.1/current and verifies the existing HTML in an account-free migration preview.
Fresh live desktop/mobile browsers confirm the restored 10,000-sat total, both
chronology options and gallery control order, without page errors or horizontal
overflow at 390px. Persistent service/index state and existing signed events remain.

## Dedicated author migration

soyLI 0.24.0 adds the opt-in `migrate <link> --dry-run` / `--confirm` / `--resume`
flow described in [the creator guide](NIP5D-CREATOR.md#upgrade-an-existing-publication-without-rebuilding-it).
It verifies and reuses exact published HTML, retains named/root identity and
optional source/media references, and never rewrites signed history or rebuilds.
It refuses stale pinned releases, deleted/expired publications, changed primary
state, wrong authors and unverified bytes. Snapshot conversion is excluded because
standalone snapshots have a different independent identity. A fresh publication
from an existing local project also recognizes an exact metadata-only migration
of its saved previous manifest; arbitrary remote changes remain conflicts.

## Stable publication defaults — 2026-10-09 source

Ordinary `soyli publish` now updates only the stable named listing. `--snapshot`
explicitly adds an independent immutable publication; `/r/<current-event-id>`
still pins the named revision. The journal freezes this choice. Missing choice
fields in older jobs preserve their original paired behavior and signatures,
including interrupted releases. No historical event, source commit or identity
is rewritten. These source changes require a matching CLI release and website
rollout; the earlier deployment records above describe their original baseline.
