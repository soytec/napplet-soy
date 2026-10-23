# NAP concepts and expansion review

## External invitation links — review only, 2026-10-22

A direct-URL delivery prototype was withdrawn because its fabricated source
identifier violates the selected NAP-INTENT sender contract. No runtime or pin
change is proposed. See [the protocol finding and implementation prerequisites](INVITATION-LINKS.md).


## OUTBOX integration — released 0.29.0

The subsequent implementation completes the foundation below with a shared verified
store, actual Applesauce network loaders, reactive live routing, per-event consent,
exact signing and strict per-relay publication outcomes. PR 32 remains pinned at
`8865f73d52a4864afee145f28d26520476273927`, audited against napplet-web
`44d663a14af0f91a3797614c76e5c3d684cec52e` and the installed 0.31.0 shim's
0.33.0 core/nap bindings. Applesauce loaders 6.2.0 joins unchanged core 6.2.0,
relay 6.2.1 and signers 6.2.2. The NIP-5D authority is unchanged. Generic writes
never bypass map/app-data namespace, ownership, revision or deletion checks.
[Policy/limits](OUTBOX.md) and [verification evidence](NAP-OUTBOX-PLAN.md) distinguish
implementation tests from independent-client conformance. The compatible shell
was deployed and verified before soyLI 0.29.0 publication; see
[release evidence](CLI-RELEASES.md) and [deployment record](DEPLOYMENT.md).

## OUTBOX relay planning foundation — 2026-10-13 source

Reviewed [NAP-OUTBOX PR 32 at 8865f73d](https://github.com/napplet/naps/blob/8865f73d52a4864afee145f28d26520476273927/naps/NAP-OUTBOX.md)
against sibling napplet-web `44d663a14af0f91a3797614c76e5c3d684cec52e`
OUTBOX types/shim and installed shim 0.31.0 / core/nap 0.33.0. No package or
selected NIP-5D pin changes. Shared read planning now caches verified relay lists,
preserves mixed-author fallback coverage and exposes truncation as incomplete.
An independently tested publication planner resolves the requested target union
and fails unresolved required inboxes or over-limit fanout before signing.
It is not yet a general publishing host implementation or a conformance claim.
See [scope, verification and remaining work](NAP-OUTBOX-PLAN.md).

## Native map and INTENT review — 2026-10-13

Source now uses published shim 0.31.0 and core/nap 0.33.0 for the canonical
NAP-INTENT contract at `e5308ac`. The shared web/preview host implements exact
queryless convention routing, verified author-qualified catalogs, user chooser
and editable defaults, attested senders and retained cold-target deliveries.
Acceptance means delivery responsibility, not a target handled acknowledgement.
The selected NIP-5D authority is unchanged.

Viewer-authorized OUTBOX/RELAY writes now also admit bounded native kind-35858
Black Site map metadata and narrowly verified owner-map NIP-09 deletion.
Configured destinations, consent, complete revision reads, exact signing and
identity cancellation constrain writes. Admission is metadata-only: current host
wiring does not validate linked JSON bytes or the map schema before signing.
No publisher provenance gate or arbitrary signing surface is added.

Actual source-host map create/update/reload/remix/play/delete and the game's
EDIT-to-cold-editor INTENT path passed local browser integration. Native session
tests passed 10/101 assertions; related runtime tests passed 83. Implemented and
locally verified is distinct from release or public deployment; neither occurred
for this update. See [policy, contract and limits](MAP-INTENTS.md).

## Stable publishing and historical gallery grouping — 2026-10-09 source

Ordinary publication now writes the stable named listing; `publish --snapshot`
explicitly adds an independent copy. Old frozen jobs retain their paired events.
This changes a tooling default, not NIP-5D wire semantics or upstream pins.
Gallery grouping can use an exact signed pair or the snapshot author's
release-specific signed descriptor pointing to a live newer listing. Descriptor
hints grant no lifecycle, social, storage or backend authority; independent
snapshots and old links remain valid. See [publishing](PUBLISHING.md) and
[migration semantics](NIP5D-MIGRATION.md). Released as soyLI 0.25.2 and deployed
in `20261009091435416-91120` on 2026-10-09; source/native/Nix, target service
checks and live desktop/mobile gallery plus exact historical-byte checks pass.
See [release evidence](CLI-RELEASES.md).

## Direct presentation review — 2026-10-06

The authoritative NIP-5D pin remains `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`.
It defines hash/MIME icons but no screenshot/video fields. Reviewed
[napplet/web PR 111](https://github.com/napplet/web/pull/111) at
`6dd79febfa9807d5d3f51cabd77b793f5893d4b7`: that draft uploads screenshots using
the older manifest path/aggregate shape; it assigns no new event kind or standalone
screenshot tag. It therefore does not supply the missing standalone schema.

The user approved direct references on existing manifests and stopping new
Zapstore descriptors. Source now uses the explicit optional downstream profile
`soy.presentation/1`, documented in [PREVIEWS.md](PREVIEWS.md). It binds screenshot
and preview hashes/MIME types to each signed revision; declared Blossom origins
provide bytes. All authors use the same reader and verification, with no provenance
gate. Missing or malformed optional fields leave playback intact. Legacy descriptors
and frozen publications retain compatibility. No NIP/NAP pin or shim change is
claimed; upstream agreement and independent-client rendering remain unverified.
Released as soyLI 0.28.0 on 2026-10-14 after compatible reader deployment and live
legacy playback/media verification. See [release evidence](CLI-RELEASES.md).

## NIP-22 comment audit — 2026-10-05

Reviewed the official [NIP-22 at 13664fb](https://github.com/nostr-protocol/nips/blob/13664fb18a3ce5fa48a849de012ab789d82eb254/22.md).
Napplet and proposal writers use kind 1111, plaintext content, uppercase root scope
and lowercase parent references, with the required kind and author tags. Named/root
napplets retain their address across replies; independent snapshots use their own
event. Proposal roots are immutable kind-1617/1618 events, so event references are
appropriate there. No NIP-5D or dependency pin changes are needed.

The audit reproduced a reader interoperability defect: an exactly-one-`p` check
rejected comments containing additional profile mentions, which NIP-22 recommends
tagging. The source correction accepts those mentions while requiring the referenced
parent's author and preserving thread isolation. Existing import tolerance for absent
uppercase `P` remains; writers always emit it. Signed regressions and the related
social/gallery/proposal suites pass 25 tests/233 assertions, plus TypeScript.
Implemented, verified and deployed on 2026-10-06 in `20261006111729495-77355`,
with soyLI 0.24.2. The selected NIP-5D authority and dependency pins remain unchanged.

## NIP-5D standalone manifest migration — 2026-10-04

Selected authority: [dskvr/nips PR 7](https://github.com/dskvr/nips/pull/7), head `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51` (open when initially reviewed; confirmed merged at the same head on 2026-10-05). New writer and explicit dual reader use the same unchanged kinds. New `x` is raw HTML SHA-256; description is plain-text content; `R`/`O`, `icon`, `z` and `i` are supported. Snapshot ancestry is optional provenance, never own-app identity. Legacy `24711d9` readers remain for existing publications.

The announcement mentions screenshot tags and possible intent hints, but neither has a wire contract in this pinned PR. Existing optional screenshot/video descriptors remain; no screenshot tag, intent grant or dispatch message is invented. NIP-91 intersections are an opt-in query optimization with standard tag-filter fallback. All required domains are still checked locally.

Shim 0.30.0, nap/core 0.32.0, starter SDK 0.24.4, Vite plugin 0.11.2 and the upstream boilerplate/skill snapshots remain pinned. Soy's publisher and guidance adapters implement the new manifest; the old plugin's emitted event is not used for publishing. See [migration/rollout](NIP5D-MIGRATION.md) and [creator contract](NIP5D-CREATOR.md). Local implementation is distinct from release/deployment; dated records below describe their original baseline.

2026-10-12 artifact read policy: published HTML readers now accept up to 100 MiB
from every publisher, while soyLI keeps its 25 MiB build/publishing budget. This
supersedes the shared 25 MiB admission limit below. Hash, UTF-8, streaming size,
public-network and sandbox checks remain required. The index projection profile
changes so formerly oversized entries are rechecked after rollout. This changes no
NAP, manifest field or upstream pin; source/presentation metadata remains optional.
Released in soyLI 0.26.1 and deployed in `20261012080150614-26110` on 2026-10-12;
see [verification](CLI-RELEASES.md).

2026-10-05 source-alias correction: safe relative aliases to public files are now
accepted in current as well as historical Git trees. Git retains the links; the
source archive uses regular copies of exact committed target bytes. Configuration,
playable artifacts, managed assets, presentation files and backend build inputs
remain regular-only. The strict untrusted archive parser and size/credential checks
are retained. This supersedes the current-tree restriction in the dated note below;
it changes no protocol pin, wire schema, runtime permission or playback requirement.

2026-10-03 source admission update: the shared publisher/remix/source-browser
budget is 1,024 files, with the existing 40 MiB source and 50 MiB archive ceilings.
The current source tree and archive still require regular files; safe internal
file aliases may remain in earlier immutable Git trees. This is local tooling
policy, with no NAP or manifest change. Retain NIP-5D `24711d9`, shim 0.30.0,
SDK 0.24.4 and the existing protocol pins. Source metadata remains optional for
every publisher and never affects playback. CLI and website parser rollout are
separate; see [source browsing](REMIXING.md#browsing-a-releases-original-files).
Playable HTML admission rises from 10 MiB to 25 MiB while managed resource,
asset, upload and virtual-filesystem limits remain unchanged. These are local
safety budgets, not Nostr quotas. The website, indexer and runtime must deploy
the artifact change before admitting larger public HTML; a CLI release alone
does not provide that deployment.

2026-09-24 note sharing: rechecked official [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md),
[NIP-10](https://github.com/nostr-protocol/nips/blob/master/10.md),
[NIP-24](https://github.com/nostr-protocol/nips/blob/master/24.md) and
[NIP-92](https://github.com/nostr-protocol/nips/blob/master/92.md).
Explicit website sharing signs a standalone kind-1 text note, with lowercase
hashtags and optional matching media metadata. There are no thread/reply tags.
The shell's website-account scope adds kind 1; sandboxed napplets gain no new
permission or NAP operation. NIP-5D, runtime bindings and dependency pins are
unchanged. [Community](COMMUNITY.md) records draft, relay and retry behavior.

2026-09-23 appearance update: reviewed [NAP-THEME at registry pin
`a040914b4bbd3a5cd8a14b0f316a723c968ebfb2`](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/naps/NAP-THEME.md)
and the installed shim 0.30.0 (`@napplet/nap` 0.32.0). The shared host now returns
resolved Light/Dark/Auto colors in `theme.get.result` and broadcasts `theme.changed`
with a `theme` field and no request ID after the handshake. There is no new wire
subscription command, domain or manifest requirement. Changes belong to the frame
lifetime, not the signing account. Creators choose whether to use them. NIP-5D,
package pins and sandbox permissions remain unchanged. [Appearance](APPEARANCE.md)
records browser coverage and limits; independent host conformance remains unverified.

2026-09-23 application-data update: reviewed actual relay/outbox publish request and
result shapes in the installed shim 0.30.0 source maps (its @napplet/core and
@napplet/nap dependencies are 0.32.0). Retained those package pins and the selected
NIP-5D revision. NIP-78 `6aeea6093786644e892dd2869fa5b642fddd271d` is the event reference;
public sharing is an explicit downstream relay-policy convention, not a claim of
conformance to its owner-only AUTH recommendation. Host-owned publication is
limited to bounded, viewer-authorized `soy.app-data/1` kind-30078 records. The
helper observes the existing host handshake and uses ordinary outbox envelopes;
the optional shell-init appData hint is documented as a host extension. No new
NAP domain, generic signing permission or required publishing metadata. See
[contract and limits](SHARED-DATA.md). Wider interoperability remains unverified.

Reviewed **2026-09-14** for upstream concept and interoperability review before wider launch.
This records an upstream reading and code comparison, not a completed conformance
audit. The [compatibility inventory](COMPATIBILITY.md) now records the configuration
milestone and actual test coverage. The site is already deployed; the remaining acceptance work precedes a wider
launch. The user's decision that the NIP-5D proposal has authority still applies.

## Sources and revision boundaries

2026-09-23 Rust/WASM slice: this is compilation into the **existing web projection**,
not adoption of a new WASM projection or capability proposal. Rechecked the registry
and open proposals; retained the selected NIP-5D, shim 0.30.0, SDK 0.24.4 and
boilerplate/conformance pins. Rust uses ordinary async host calls and Bevy's asset
adapter uses the existing RESOURCE bytes contract. No new grants, kinds or
required authoring metadata. [WASM guidance](WASM.md) and the
[compatibility record](COMPATIBILITY.md) distinguish working specimens from engine-wide
or independent-client conformance.

2026-09-20 controller slice (0.16.0 source): native browser Gamepad input is
available inside the existing sandbox on tested Chromium. The workshop tester
and bundled creator helper add no NAP domain, shim/SDK change, new device grant
or NIP-5D requirement. NAP-SERIAL concerns serial sessions, not ordinary gamepad
buttons/axes. See [controllers](CONTROLLERS.md) for fallback behavior and the
remaining physical-device/browser acceptance work.

| Source inspected                                                                                                   | Revision / role                                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| [NAP registry README](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/README.md)     | `a040914b4bbd3a5cd8a14b0f316a723c968ebfb2`, master at review                                       |
| [Web projection](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/projections/web.md) | Registry mapping to the [living NIP-5D proposal](https://github.com/nostr-protocol/nips/pull/2303) |
| [NAP-CONFIG](https://github.com/napplet/naps/blob/448013e6d8cb8c75dce49576b3e7c0d46d960eac/naps/NAP-CONFIG.md)     | PR 14, open; head `448013e6d8cb8c75dce49576b3e7c0d46d960eac`                                       |
| [NAP-CVM](https://github.com/napplet/naps/blob/ad68a938236e9230324e377cd005008a315ff402/naps/NAP-CVM.md)           | PR 31, open; head `ad68a938236e9230324e377cd005008a315ff402`                                       |
| [Our protocol baseline](PROTOCOL.md#1-compatibility-baseline)                                                      | NIP-5D `24711d9`; existing kinds and immutable identity behavior                                   |
| [Released CLI pins](../apps/cli/distribution/release-0.5.0.json)                                                   | Current boilerplate/skill/runtime release evidence                                                 |

Registry status is not a statement that our runtime implements a capability. Open
proposal status is not itself a reason to reject the user's selected contract.
Recheck and pin the concrete proposal, shim, SDK, starter and conformance suite
together when implementing an affected capability.

## Concepts to preserve

The [registry](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/README.md)
separates these concepts:

- A NAP defines a runtime capability contract; a projection supplies its transport.
- Domains identify capabilities. NAP-SHELL supplies the foundational handshake;
  other capabilities are optional, with dependencies and discoverable support.
- Archetypes describe roles; they are distinct from capability APIs and topic tags.
- Conventions describe shared message semantics, separately from archetypes and NAPs.
- Composition belongs to the host. Self-contained creations can remain valid without
  implementing cross-napplet interaction.

The [web projection](https://github.com/napplet/naps/blob/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2/projections/web.md)
uses opaque sandboxed frames, host-bound message sources and `window.napplet` domain
surfaces. Keep signing, payment authority and provider transport in the trusted host.
Future route/flavor/room conventions should preserve stable identities and validated
payloads; URL presentation must not become a second protocol identity.

The overview mentions manifest kind 35128, while our pinned NIP-5D implementation
uses 35129/15129/5129. Record the layer and revision behind each statement; do not
replace deployed identities based on a general overview. The current proposal head
was rechecked and still matches our NIP-5D pin; no kind migration is needed. The
host-owned injection/handshake decision is recorded in the compatibility matrix. This disagreement
was also identified in [earlier research](RESEARCH.md).

## What the current code actually exposes

2026-09-15 media update: reviewed [NAP-MEDIA PR 10 at 2b2d29e90c30b994bf5035a65b57e5fe7f08a9a2](https://github.com/napplet/naps/blob/2b2d29e90c30b994bf5035a65b57e5fe7f08a9a2/naps/NAP-MEDIA.md)
against shim 0.30.0 and starter SDK 0.24.4. The shared host now adds a bounded
shell-owned audio subset. Use the proposal's detailed Wire Protocol table, matching
the installed shim's three-part session names, rather than its conflicting API-table
spellings. No upstream package, NIP-5D kind or iframe permission is changed.
Owner/source subsets are explicitly permitted by the proposal; unsupported modes
return creation errors. See [MEDIA.md](MEDIA.md) for remaining modes and verification.

The [runtime domain registry](../packages/runtime/src/capabilities.ts) advertises
`shell`, `identity`, `storage`, `theme`, `resource`, `relay`, `outbox`, `common`,
`link`, `fs` and, in the new source milestone, `config`. Several write operations are denied by current policy; domain
presence is not permission for every operation. The upstream
[shim integration](../packages/runtime/src/prelude.ts) and
[host dispatcher](../packages/runtime/src/host.ts) are shared by web and CLI previews.

`intent` and `inc` are not advertised; the 2026-09-17 update below adds `cvm` and `webrtc`. Account sign-in and surrounding
website zaps do not automatically implement napplet identity-changing or payment
capabilities. Inventory all domains, including deployed `common` and `fs`, against
their exact proposal/SDK sources; the README alone is not a complete compatibility
matrix. Keep unsupported required capabilities visible and accurately classified.

## Configuration implications — A11

[NAP-CONFIG](https://github.com/napplet/naps/blob/448013e6d8cb8c75dce49576b3e7c0d46d960eac/naps/NAP-CONFIG.md)
defines schema-based settings with shell-owned writes, defaults, validation, snapshots
and subscriptions. Its supported JSON Schema subset is bounded, not arbitrary schema
execution; it includes registration acknowledgements, errors, secret annotations and
version hints. Prefer declared schemas where possible and retain the registration
escape hatch. The pinned Vite plugin already embeds `config.schema.json` as a
`napplet-config-schema` meta tag in signed HTML; there is no new manifest event tag.

Our design work must distinguish publication config, napplet-declared schema,
user-selected values, and provider/game rules. Specify author/account scoping,
release upgrades, reset and invalid-value handling. Reuse a single validator and
settings adapter in the CLI harness and live shell, with an example and conformance
fixtures. These are now implemented in the [shared configuration host](CONFIGURATION.md),
with fresh scopes per verified build/account and memory-only secrets. A schema
annotation must never grant a napplet access to a creator key. The compatibility
record distinguishes the upstream runner's boot checks from actual config tests.

## ContextVM implications — A14/A15

[NAP-CVM](https://github.com/napplet/naps/blob/ad68a938236e9230324e377cd005008a315ff402/naps/NAP-CVM.md)
defines direct provider discovery/requests, MCP conveniences and a host-curated
registry. Transport, encryption, correlation and provider policy stay host-owned.
Registry candidates require liveness checks, and schema identity matters when
selecting substitutes. The proposal's `value` dependency is optional for payments;
the overview's dependency column is not enough to infer mandatory payment support.

Matchmaking, rooms and presence are our separately versioned application contracts,
not new NAPs merely because they run on ContextVM. Keep the direct provider path
usable, public activity opt-in and private sessions undisclosed. Complete the bridge
and three gameplay topology examples before declaring a generalized API. Existing
[ContextVM documentation](CONTEXTVM.md) remains the starter's implementation record.

## Wider-launch acceptance still to do

1. Complete the existing operation/evidence matrix with each remaining NAP's exact
   specification revision, dependencies and per-operation conformance tests.
2. Retain the reconciled NIP-5D manifest/bootstrap and CONFIG bindings; finish the
   cross-client packaged-resource/source/preview audit across the chosen toolchain.
3. Publish with our CLI, discover and run in an independent client without our API;
   import an independent creation back. Include configurable creations when A11 ships.
4. Exercise optional/unknown requirements and malformed messages. Keep one verified
   admission/player path for every publisher, including fixtures and paid placements.
5. Review the host interfaces used by source, immersive routing, comments, settings,
   CVM sessions and flavors. Keep UI layout, media representation, identity and
   provider choice independently replaceable without an unrestricted generic RPC.

These remain launch acceptance steps. The configuration implementation does not
claim native projection support, full cross-client conformance or a production
multiplayer service.

2026-09-14 source-browser slice: no upstream protocol/runtime pin changes. The web client now consumes existing optional signed archive provenance for read-only file inspection, with the same bounded tar policy as remix. Missing archive metadata does not gate playback or standard discovery. The creator asset audit records the unimplemented large-media pipeline in [asset authoring](ASSETS.md); it does not claim new resource capabilities.

## Host account and curation update — 2026-09-15

Local A07/A20 work uses `applesauce-accounts@6.2.0` for website account sessions and
extends site policy with administrator membership and Featured order. It does not
change NIP-5D manifests, NAP permissions, artifact formats or publisher eligibility.
NIP-98 remains the admin request protocol. Saved credentials stay in the trusted
host; running napplets receive only the existing public identity notifications.
See [identity](IDENTITY.md#website-sign-in) and [moderation](MODERATION.md).

## Creator profiles and ancestry — 2026-09-15

A13/A21 add host profile pages/editing and a genealogy view. Reviewed NIP-01/24
and NIP-5A at `a2494f4f81d46684e5814a9bf35e2b1df978f955`; the selected NIP-5D pin,
35129/15129/5129 kinds, artifact verification and NAP operation inventory stay
unchanged. Current `a`/`A` parent/origin semantics are distinct from snapshot `a`
self-reference. Space’s optional exact-parent hint is used only when its signed
target verifies; incomplete ancestry remains a gap. Public key profiles and ancestry
work without Space aliases or profile metadata. Host kind-0 editing adds no napplet
signing permission and does not implement new identity-domain operations.
See [profile limits](PROFILES.md) and [genealogy](REMIXING.md#genealogy-on-napplet-pages).

## Preview media update — 2026-09-15

Reviewed NIP-92/94 and the NIP-5A `app` association at
`a2494f4f81d46684e5814a9bf35e2b1df978f955`. Optional video attachments live in the
linked software descriptor's content and `imeta` tags. The NIP-5D pin, executable
format and NAP operations remain unchanged. This is a generic NIP-92 application,
not an assertion of a dedicated cross-client trailer contract. Every publisher uses
the same adapter; missing video cannot change playback eligibility. See
[preview delivery and local evidence](PREVIEWS.md#short-video-previews--soyli-070).

## Rich comments — 2026-09-15

Reviewed [NIP-27](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/27.md)
and [NIP-92](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/92.md).
Kind-1111 text can display NIP-19 references and media whose optional `imeta` URL
matches its content. No new signed event kind, manifest field, NAP operation or
iframe permission is introduced. Unknown references require verified napplet
resolution before playback. Site aliases remain site-local; optional presentation
does not change interoperability. See [rich comment limits](COMMUNITY.md#rich-comment-presentation--2026-09-15).

## Runtime relay routing correction — 2026-09-15

Rechecked [NAP-OUTBOX proposal 32](https://github.com/napplet/naps/pull/32) and
[NAP-RELAY proposal 2](https://github.com/napplet/naps/pull/2) read semantics against
the existing pinned bindings. Explicit read relay hints are policy candidates;
NIP-65 author write relays can supply reads even when absent from catalog discovery.
No binding, manifest, SDK or proposal pin changed. The shared host now mediates these
reads with public destination checks, bounded filters/streams, TLS and cancellation.
Publishing remains disabled in playback. This fixes the discovery/runtime allowlist
conflation; it does not claim full outbox intelligence or publishing conformance.
See [implemented routing policy](PUBLIC-RUNTIME.md#runtime-relay-routing--soyli-082).

## Read deadline correction — 2026-09-15

The pinned outbox shim starts its `timeoutMs` timer before posting to the host.
The host previously used the same duration for discovery and collection, allowing
a stalled fallback to race the shim's timeout even with verified results in hand.
soyLI 0.8.3 and the shared web host reserve reply-delivery time inside that budget
and preserve partial-result/error semantics. No protocol fields, permissions,
SDK versions or proposal pins change. See PUBLIC-RUNTIME.md for timing limits.

## NAP-CVM / NAP-WEBRTC implementation review — 2026-09-17

Reviewed the registry and open pull requests, including
[NAP-CVM PR 31](https://github.com/napplet/naps/pull/31) at
`ad68a938236e9230324e377cd005008a315ff402` and
[NAP-WEBRTC PR 59](https://github.com/napplet/naps/pull/59) at
`5fae95dd2c8e59bd06c654e0845656add077dcda`. These remain proposal contracts with
user-selected authority; an open PR is not proof of implementation or universal
interoperability. The existing NIP-5D pin and upstream shim/creator pins remain.

The shared host now supplies their standard browser envelopes; app-facing CVM
request/discover/close/registry operations and WebRTC open/send/close/events are
implemented. The service uses ContextVM SDK 0.13.16, encrypted client identity
injection and per-tool CEP-15 hashes. CEP-41 streams and oversized transfers are
disabled; family hash equivalence, payment execution and arbitrary code are not
implemented. NAP-CONNECT/raw sockets are not a workaround for this boundary.

Backend namespaces are author-qualified addresses; provider configuration and
board rules are creator-tool metadata, never mandatory napplet manifest fields.
Native WebRTC signaling is host-owned and separately documented as `soy-rtc/1`.
The proposal does not prescribe a universal host signaling protocol. No new app
wire messages or direct sandbox network exemptions were introduced.

The soyLI 0.10.1/shared-host permission update implements the same proposal's
recommended user policy: a host popup records a browser/origin-wide multiplayer
choice, editable in Network settings. It changes no NAP messages or upstream
pins. Explicit Block persists; dismissals do not. Revocation closes active sessions.

The 2026-09-18 soyLI multiplayer lab adds only creator-side testing and host-side
diagnostics. It uses the same pinned CVM/WebRTC envelopes. Artificial delay/jitter
exists only in runner-owned browser contexts and preserves ordered delivery; the
production channel profile is unchanged. Diagnostic reports omit native candidates,
addresses, SDP and credentials. No diagnostic operation is added to the napplet API.

[ContextVM](CONTEXTVM.md) records behavior, evidence and remaining acceptance;
the self-contained [creator guide](BACKEND-CREATOR.md) ships with soyLI. These
engineering fixtures do not substitute for an isolated creator using only the
released CLI and shell, or for cross-network transport tests.

## 2026-09-18 — Git collaboration review

NIP-34 reviewed at `6d2979b3f503a8539c983efbcdcf901bbcf9ed23` against the
[official specification](https://github.com/nostr-protocol/nips/blob/6d2979b3f503a8539c983efbcdcf901bbcf9ed23/34.md)
and ngit's [PR guide](https://ngit.dev/pull-requests). GRASP remains pinned to
3.0.2 / `cdda4a23fe5dede2411e18aaa8b82c1747c97ddf`; its standard PR purgatory
requires target Git data, so the client pushes the signed event ref and verifies
relay read-back rather than treating an OK acknowledgement as discoverability.
Optional GRASP-06 hosting is not required or enabled by this change.

No NAP or authoritative NIP-5D pin changes. Built review reuses normal sandbox
playback with separate state and guest identity. Optional `soy-preview` is a Soy
attachment convention, explicitly documented in [COLLABORATION.md](COLLABORATION.md),
not claimed as a standardized NAP or prerequisite for external proposals.

### 2026-10-12 Forkless collaboration source correction

Native GRASP 3.0.2 at the existing `cdda4a23` pin accepts non-maintainer roots and
updates at upstream `refs/nostr/<event-id>` after event delivery. Its normative
GRASP pin remains `f35b4f9a4ed2f0aaaf46926e4b1733c79e21b377`. The adapter now uses
that facility directly without signing or publishing contributor repository
announcement/state events. The ngit 2.6.1 source at
`55f3e3a838dffd03f0fdd996103b8dc8c2cddcd6` establishes branch names without `pr/`
and reciprocal maintainer state handling for the tested profile. The independent
fixture covers create/update/checkout/accept in both directions. ngit 2.6.1
`pr merge` merges into the current branch; do not infer newer documented target
selection behavior from this test.

No authoritative NIP-5D, NAP or NIP-34 pin changes. Playable attachments remain
optional. Soy's state resolver covers owners and direct reciprocal maintainers;
role-based or indirect recursive authority requires ngit. Native non-main/ref
preservation and recovery fixtures supplement the independent PR test. These are
local source checks, not a production deployment or independent browser UI check.

## Managed resource authoring review — 2026-09-20

2026-10-03 authoring correction: soyLI's inventory now admits the same verified
binary, JSON and text already supported by the shared resource host. Generated
`assetBlob()` uses the existing `resource.bytes` Blob result or locally decodes
embedded data. The selected RESOURCE/shim pins, MIME policy, CSP, byte limits and
manifest envelopes are unchanged. No new NAP or server upload policy is introduced.

Reviewed [NAP-RESOURCE proposal 13 at `8c0645d`](https://github.com/napplet/naps/blob/8c0645d32ceb159bc3e8bcec1107a92862b7e86a/naps/NAP-RESOURCE.md),
including complete Blob results, canonical `blossom:sha256:<hex>` references, hash
verification and host MIME/policy ownership. The existing shim 0.30.0, starter SDK
0.24.4 and maintained boilerplate pin are unchanged; the NIP-5D authority/pin stands.

The new inventory/helper uses that existing resource surface. Local original serving
is an explicit loopback development adapter; publication uploads immutable bytes to
the chosen Blossom and emits ordinary server/requirement tags. The inventory does
not need an independent-client adapter for playback. The browser test decodes real
PNG/WAV/WOFF2/WebM using local and separate Blossom fixtures; the compiled upstream
Vite test rebuilds embedded/external assets in a fresh Git checkout. This does not
claim full NAP-RESOURCE conformance, arbitrary codec support, Hashtree resolution,
SVG rasterization or an independent-client acceptance test. Existing unsupported
operations remain unsupported. No protocol identity or discovery changes.

## Independent implementation review — 2026-09-20

Rechecked the [NAPS registry](https://github.com/napplet/naps) and
[open proposals](https://github.com/napplet/naps/pulls). The registry remains at
`a040914b4bbd3a5cd8a14b0f316a723c968ebfb2`; the authoritative NIP-5D PR head remains
`24711d9c47bbdd07908bf1d52bf677d9cbc530f0`. CONFIG, CVM and WEBRTC proposal pins are
unchanged. Newly listed proposals do not automatically become advertised support.

[RESOURCE PR 80](https://github.com/napplet/naps/pull/80), head
`fa6bcc6935aa19e7b70ab2a2c721dafca77c78e1`, replaces PR 13 after its merge/revert.
Compared with our selected `8c0645d`, its NAP-RESOURCE.md replaces CDDL shapes with
equivalent field tables and adds a changelog. No wire-operation or resource-policy
change was found. Retain the existing implementation pin and track PR 80 for review.

[Independent-client acceptance](INTEROPERABILITY.md) now runs Soy publications in
unmodified Paja 0.16.4 and imports independently authored fixtures with upstream
manifest builders at `956135bfc41a2cff5e45d6c68d9f9a4d68c50531`. It also fetches Soy
proposal history using ordinary Git/ngit 2.1.0. The observed `config.schemaError`
(`no-schema`) justified the 0.14.1 starter fallback: register the same embedded
schema only when the host has not supplied one. No new envelope, manifest identity,
required presentation metadata or production capability grant was introduced.

These are bounded interoperability checks, not a completed audit of all NAPs.
Paja consent policy, full upstream publishing/review UI, CONFIG edge semantics,
other providers and real-network multiplayer remain separately qualified work.

## Interactive NAP review — 2026-09-20

Selected proposal revisions for soyLI 0.15.0/shared `space-playback-4`:

| Proposal                                              | Exact selected head                        |
| ----------------------------------------------------- | ------------------------------------------ |
| [FS #88](https://github.com/napplet/naps/pull/88)     | `b640cf337c0481f0f9a0216c00843f797a5c6df6` |
| [UPLOAD #33](https://github.com/napplet/naps/pull/33) | `a7cc17463cbf5d9cb87884b31071bc4fc826034c` |
| [COMMON #67](https://github.com/napplet/naps/pull/67) | `de603e205a9b498f252be9a5e8e6825c4648df39` |
| [LISTS #68](https://github.com/napplet/naps/pull/68)  | `72fddac5def8f9bcbedd01dd942c530d89e335e0` |

The pinned shim 0.30.0 already includes these envelopes and SDK bindings; no
upstream dependency or authoritative NIP-5D revision change was needed. NIP-02,
25, 30, 51, 56, 65 and Blossom authorization inform the event constructors.
NAP-LISTS permits policy-selected kinds/item types. The implementation advertises
public items on thirteen list kinds and preserves existing encrypted content;
private item mutation remains explicitly unsupported. Omitted remove visibility
must not silently remove only public items from a list with opaque content.

FS pickers copy into the bounded virtual session filesystem; they grant no live
OS paths. UPLOAD uses direct CORS requests and independent hash verification;
the initial correlated reply precedes asynchronous approval/transfer. COMMON
constructs constrained follow/reaction/report events through the viewer signer.
Generic relay/outbox writes and arbitrary key operations remain denied; the later
app-data subset above is the explicit exception. Browser
Network settings select action relays/upload storage; signed napplet hints do
not silently override those write destinations. Proposal previews remain guests.

[Runtime actions](RUNTIME-ACTIONS.md) records limits, examples, lifecycle and
verification. Both production web player and soyLI preview were exercised with
the real pinned shim against isolated signed relay and Blossom fixtures, including
mobile approval controls. This is not independent-client acceptance or full
NAP conformance. No production deployment is part of this change.

# Local dynamic-backend extension (2026-09-25)

`soy.backends.v1` is a Soy MCP service family transported by the already pinned
NAP-CVM proposal. It does not amend that proposal or create a new host domain.
Its optional local preview and account binding do not affect other publishers'
playback. An opt-in Linux deployment path is qualified separately; public activation and any CEP submission remain separate decisions. See
[DYNAMIC-BACKENDS.md](DYNAMIC-BACKENDS.md) for the implementation boundary.

## Related resource discovery — soyLI 0.25.3

Reviewed BUD-10 at `342cae9e5152c5214c83ca1f7f473c2eba0256f1` for
`blossom:<sha256>.<ext>` with optional exact-size discovery metadata. soyLI's
prepared HTML declares external managed resources through `link rel="related"`;
this is HTML association metadata, not a NAP operation or manifest extension.
The existing NIP-5D and NAP-RESOURCE pins and `blossom:sha256:<hash>` playback
calls remain unchanged. Missing related links never prevent playback or change
publisher admission. See [coverage and limits](ASSETS.md#related-resource-links--soyli-0253).

## NAP-KEYS host support — 2026-10-13 source

The keyboard fix uses [NAP-KEYS PR 9 at 8869a4c](https://github.com/napplet/naps/blob/8869a4cf77b023f4b049f47c546910a0280dc1a6/naps/NAP-KEYS.md)
and the existing shim 0.30.0. No event kind, manifest extension, author restriction
or NIP-5D pin changes. All publishers receive the same frame-scoped action API.
See [runtime behavior, limits and shim normalization caveat](PUBLIC-RUNTIME.md#keyboard-actions--2026-10-13-source).
