# Napplet playback profile

2026-10-13 OUTBOX source update: web and preview share an account-scoped Applesauce
store/loaders, verified NIP-65 planner, live route refresh and consented general
event publication. Own write relays, required recipient read relays and explicit
destinations form one deduplicated fanout; incomplete required routing fails before
signing. Partial relay rejection returns the signed event and per-relay results.
Map/app-data writes retain their specialized protections and configured destinations;
generic deletion remains denied. Older publishing/lifetime descriptions below are
superseded by [current OUTBOX behavior and limits](OUTBOX.md). Shipped in soyLI
0.29.0 after compatible shell deployment; see [release evidence](CLI-RELEASES.md)
and [implementation evidence](NAP-OUTBOX-PLAN.md).

2026-10-13 source update: web and preview now implement NAP-INTENT handler
discovery/chooser/defaults and retained cold-target delivery, using shim 0.31.0
and core/nap 0.33.0. OUTBOX/RELAY additionally admit viewer-consented native
kind-35858 map metadata and verified current-owner kind-5 deletion. Metadata
admission does not validate linked map bytes. These capabilities ship in soyLI
0.29.0 and the public shell. See [map writes and intent limits](MAP-INTENTS.md).

2026-09-23 source update: `relay.publish` and `outbox.publish` now accept the
bounded public kind-30078 application-data convention with viewer consent. Other
event kinds and encryption remain denied except the native map subset described above. The optional shell-init `appData`
policy hint describes scope/limits without introducing a new NAP domain. See
[shared data](SHARED-DATA.md) for current-version records, tombstones, missing
history guarantees and the explicit public NIP-78 relay-policy deviation. The local
preview host ships in CLI 0.20.0; matching website deployment is separate.

Implemented 2026-09-12. Open a public card and choose **Play napplet**. Cards distinguish verified, compatible artifacts from missing capabilities and unavailable downloads. Compatibility means this host implements the requested domains; an individual operation can still be refused by policy or fail upstream.

## Playable artifact read budget

The update deployed on 2026-10-12 accepts published HTML up to **100 MiB**, independent
of soyLI’s **25 MiB** build/publishing limit. The same read budget applies to the
website indexer, browser player and local preview. All publishers follow the same
admission rules, including legacy manifests. The complete artifact must pass raw
SHA-256 and UTF-8 verification before it executes. Downloads are bounded while
streaming, with up to 30 seconds per mirror and 60 seconds overall, and can be
cancelled when leaving the player. Managed resources retain their separate 10 MiB
limit. The index rechecks entries rejected under the previous artifact budget.
The website/indexer deployment is `20261012080150614-26110`; local preview ships
in soyLI 0.26.1. See [release verification](CLI-RELEASES.md).

## Standards and integration

Fixtures and relay-imported napplets use the same manifest validator, capability admission, artifact verification, host identity, and resource service. The browser subscription covers named, root, and snapshot kinds without a Space hashtag. Fixture metadata contains no custom snapshot pointer. The creator publisher uses this same admission path; the bundled test key must never be used on public relays.

Named/root manifests retain their existing author/address/build storage and settings scopes across the old-to-new manifest migration, computed from verified HTML bytes. Legacy snapshots keep their validated own-address sharing. New standalone snapshots have an independent author/event/build scope; their optional ancestry never grants parent saves, account backend bindings or social identity. New soyLI pinned URLs use the exact named manifest revision so that the named app keeps its scope. See [migration details](NIP5D-MIGRATION.md). The new protocol artifact identity is the raw SHA-256; the physical legacy-derived save key is a compatibility detail. Old fixture-only prototype saves remain unmigrated.

The browser injects the published **@napplet/shim 0.31.0** prelude, with transitive **@napplet/nap 0.33.0** and **@napplet/core 0.33.0** pinned in the lockfile. These are protocol bindings, not another catalog: discovery remains Applesauce queries against Nostr relays. The shim is loaded with the player route, not by executing an external script inside a napplet.

Space adds the [NAP-SHELL handshake](https://github.com/napplet/naps/blob/master/naps/NAP-SHELL.md), absent from that shim release. `shell.ready` establishes one frame session; `shell.init` replies once; `shell.ready()`, `onReady()`, `supports()` and `services` expose its environment. Unknown message types are silently ignored before quota accounting; recognized operations can still return policy errors. The host verifies `MessageEvent.source` and the opaque origin, and binds identity to the verified manifest before accepting requests. Messages cannot choose a different author, build, account, or storage namespace.

References: [NAP registry and web projection](https://github.com/napplet/naps), [upstream implementation](https://github.com/napplet/web/tree/1df6dc87e5eee7257af41efb6247d47ec019e3d8/packages), and [NIP-5D proposal](https://github.com/nostr-protocol/nips/pull/2303). Several domains remain draft contracts. This is an implemented playback profile, not a claim of complete registry conformance.

## Available operations and policy

| Domain     | Implemented behavior                                                                                                 | Limits                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`    | Handshake and synchronous capability discovery                                                                       | One session per frame; no named services                                                                                                                                   |
| `storage`  | String get/set/remove/keys, shared and instance scopes                                                               | Shared data persists in this browser per author/address/build/account; instance data lasts for one play session; 256 keys / approximately 1 Mi characters per scope        |
| `keys`     | Named actions, default bindings, unregister and focused Escape forwarding                                            | Frame-scoped limits; reserved/conflicting hints unbound; see keyboard section below                                                                                        |
| `identity` | Connected key, user NIP-65 relay preferences, profile, follows, public mute list                                     | Guest key is the empty string; extra list projections return explicit errors; no private lists or signer access                                                            |
| `theme`    | Resolved shell colors; live `theme.changed` notifications                                                            | Light/Dark/Auto preference; napplets opt in to applying colors; no frame reload. See [appearance](APPEARANCE.md)                                                           |
| `relay`    | Filtered query and live subscribe/close                                                                              | Guarded public WSS reads; signatures checked, duplicates removed, filters reapplied; scoped app-data and native map metadata/deletion with viewer consent; other writes/encryption denied |
| `outbox` | getEvent/query/subscribe/close/resolveRelays and consented templates | Shared verified Applesauce store/loaders, reactive NIP-65 routing, strict complete fanout and specialized protections; [bounds](OUTBOX.md), [evidence](NAP-OUTBOX-PLAN.md) |
| `common`   | Public NIP-19 helpers including nrelay, profile/follows, follow/unfollow/react/report                                | Viewer signer and host approval for writes; signed native event targets only; no secret identifiers                                                                        |
| `resource` | HTTPS and hash-verified Blossom bytes, ordered bulk responses, cancellation, scheme discovery                        | `data:` handled locally by upstream shim; no htree/nostr resolver; raw SVG/HTML/XML denied                                                                                 |
| `intent` | Verified handler discovery, exact conventions, chooser/defaults, attested delivery and cold-target launch | Source implemented/local verified; session queue only; acceptance is not a handled acknowledgement. See [limits](MAP-INTENTS.md) |
| `link`     | HTTPS links presented in a host-owned confirmation                                                                   | User clicks to open; no automatic navigation                                                                                                                               |
| `config`   | Static/runtime schemas, validated settings UI, snapshots/subscriptions, focused settings opening                     | Browser-local values scoped to author/address/build/account; session-only secrets; see [configuration limits](CONFIGURATION.md). Deployed 2026-09-14                       |
| `fs`       | Session files, native file/folder import copies, chunked reads/writes, metadata, move/remove/watch and export picker | 10 MiB aggregate, 256 KiB chunks, 128 entries, 16 watches; no live device paths                                                                                            |
| `upload`   | Asynchronous direct Blossom upload, info/status notifications and verified URLs/NIP-94 tags                          | 10 MiB/file; viewer approval/signature; two active jobs, 32 jobs/32 MiB submitted per session                                                                              |
| `lists`    | Introspection and public item add/remove for supported NIP-51/NIP-65 lists                                           | 64 items per request; no private item decryption/mutation; incomplete list reads cannot overwrite                                                                          |

`fs.pickSaveFile()` opens a host prompt. After writes complete, files appear below the player with download links. This does not write into the user's filesystem without a download action. Download session files before stopping the player. Virtual paths are restricted to `/files`; they never map to server or device paths.

The 2026-09-15 source update adds `media` for shell-owned MP3/Ogg/WAV audio,
including live streams and play/pause/stop/volume. It is deployed and available in soyLI 0.8.0 and later; see [the complete media contract](MEDIA.md) for policy,
unsupported ownership/source modes, limits and evidence. The runtime profile changes
to `space-playback-2` so the index retries formerly unsupported media creations.

Required unsupported domains still gate launch: for example `inc` and `connect`. Composability, napplet signing grants, extended identity projections and arbitrary backend execution remain separate additions. Older artifacts that omit required domains may still depend on unavailable APIs.

The 2026-09-17 local source update adds NAP-CVM and NAP-WEBRTC under
`space-playback-3`. Direct encrypted CVM requests/discovery/registry calls and
host-owned peer channels work in both website and soyLI preview. Shared scores,
rooms and queues are separate provider contracts; see [ContextVM](CONTEXTVM.md)
and the [creator guide](BACKEND-CREATOR.md). This source update is not deployed.
Provider/peer permission, actor scoping, connection budgets and teardown apply
to every publisher equally. No game traffic is proxied through the website API.

## Interactive actions — 0.15.0 source

FS imports, UPLOAD, COMMON writes and LISTS now share `space-playback-4` in soyLI
preview and the website. [Runtime actions](RUNTIME-ACTIONS.md) documents exact
contracts, public-list policy, viewer consent, transport/configuration, limits and
browser verification. This update is implemented locally, not deployed. Creator
publishing credentials remain separate; proposal playback stays guest-scoped.

## Resource and lifecycle boundaries

The iframe remains `sandbox="allow-scripts"`, with no same-origin grant or raw network access. Inline JavaScript and WebAssembly execute within that boundary. Resources are returned as Blobs, not embedded remote URLs. No resource or napplet code executes on the server.

The trusted browser host fetches resource bytes directly from the declared URL or
Blossom server, verifies content-addressed hashes, classifies MIME from bytes, and
returns Blobs to the opaque iframe. There is no resource HTTP proxy. Requests omit
cookies/authorization, reject redirects and obvious private-network destinations.
Only explicitly configured loopback storage is permitted for local development.
Browser CORS and private-network policies apply; a provider without compatible
CORS fails visibly rather than triggering a proxy fallback.

The 0.13.0 source classifies WebM from its EBML signature/document type and allows
font Blob URLs within the opaque frame. Other network/CSP permissions stay bounded.
The managed creator workflow uses these same resource operations; see [ASSETS.md](ASSETS.md).
Codec support depends on the browser. Content recognition is not a guarantee of
successful decoding, and no external URL is granted directly to iframe CSS/media.

Each resource is capped at 10 MiB. The host queues bursts with four simultaneous
fetches, at most 16 outstanding envelopes, 60 operations/minute and 128 MiB per play
session. Executable HTML is downloaded from Blossom and verified before launch.
Queued cancellation starts no request. There is no server resource cache on this
path; shim Blobs belong to the frame and disappear on teardown.

Relay access is through a frame-owned Applesauce pool. Filters, event counts, request concurrency, relay selection and subscription lifetime are bounded. Live subscriptions close after five minutes or 500 accepted events; the napplet receives a closure notification. Stopping/restarting or navigating away destroys the frame session, closes subscriptions and sockets, aborts resources and pending prompts, and revokes download URLs. Account changes preserve the iframe and its single SHELL handshake: old requests are cancelled, subscriptions close, resources abort, prompts/exports clear, and account-scoped storage/files are replaced before `identity.changed` is sent. Late results are suppressed. Shared saves remain available when returning to the same account; instance storage and virtual files start fresh. Napplets must listen to `identity.onChanged` to refresh their own in-memory account state.

## Immersive links

Implemented, verified and deployed on **2026-09-14** in `20260914171728494-21459`.
Append `/play` to a portable `/n/<naddr>`, pinned `/r/<event-id>` or named
`/@<handle>/<slug>` URL. **Open player** on the detail page opens that presentation;
the corner controls can copy its link. The parent route keeps its canonical detail URL
and server-rendered OG metadata. Cold links use the ordinary bounded discovery
queue. Unsupported capabilities and unavailable or tampered downloads still prevent
execution; optional metadata is not a playback requirement.

The corner-control revision (2026-09-15, locally implemented and verified; not yet deployed)
starts a fresh play link automatically after ordinary artifact verification. The
iframe fills the viewport; only a small upper-right triangle remains visible at
rest. Hover or keyboard focus reveals the title, a description excerpt of at most
160 characters plus an ellipsis (clamped to two lines), and the existing share,
settings, restart, stop and fullscreen controls. Session-file downloads appear in
that panel as well. Loading errors and required host permission dialogs remain
visible when needed; the corner control stays available during loading/failure.

Clicking the triangle returns to details. On touchscreens, the first tap reveals
the panel and a second tap on the triangle returns to details; touching the napplet
again dismisses the panel. The triangle has a 48px target, other controls at least
44px, and the panel respects safe-area insets and narrow/landscape viewports.
The corner control sits in the upper-right corner on desktop and mobile, inset
by at least 10px and respecting the top/right safe areas. The panel opens alongside
it and extends downward, with its height bounded to the available viewport.
Hidden controls are inert. Escape dismisses an open corner panel before leaving
CSS expansion; settings/save dialogs retain their own keyboard handling.

**Enter browser fullscreen** requests native fullscreen synchronously with that
control's gesture. Automatic playback uses CSS expansion and does not request it.
The same verified, opaque iframe runs beneath the corner panel, configuration
dialog and save/link prompts. Audio still depends on the browser's user-activation
policy and the napplet's own interaction. Fullscreen is
[subject to browser support and transient activation](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen);
rejection keeps the CSS-expanded player usable.

Browser/system fullscreen exit returns to CSS expansion. **Back to details**, the
second exit control, or Escape while host controls have focus returns to the detail
view. A single native-exit Escape cannot also collapse the expanded player. Settings
and save dialogs get their own Escape first. NAP-KEYS forwards bare Escape from a
focused napplet to the same exit handler; ordinary gameplay keys remain local.
The corner control remains available. Background
branches become inert while expanded; focus and scrolling restore on exit.

Entering from details pushes a history entry; Back/Forward changes only presentation.
The explicit Back to details action replaces the play entry with its detail URL,
including for a fresh external link; it never sends the visitor to an unknown
previous site. Stop ends the session and returns to details (or the gallery card),
where Play can start it again. Gallery expansion has the same two exit layers and returns to its card.

For the same selected release, the parent detail component, iframe and NAP host stay
mounted. Runtime state, instance storage, session files, settings and subscriptions
survive these changes. Relay hints are captured when starting a release, so route
data refreshes do not tear down a live host. A different release, Stop, Restart,
reload, navigation to source or another creation/page still ends that session.
This is not a site-wide background player or an additional protocol identity.

Verification: `bun run typecheck`, `bun run test`, production build, and
`bun test tests/services/immersive.test.ts tests/services/discovery.test.ts
tests/services/source-browser.test.ts`; existing browser runtime regression checks
also cover settings, account changes, exports and sandboxing. Mobile checks use
Chromium touch emulation in portrait/landscape; a real-device Safari/iOS matrix
remains a follow-up.
This checkpoint passed all 181 repository tests, three service/browser integrations
and 12 existing app/runtime browser tests, alongside typecheck and the production build.

The 2026-09-15 corner revision passed typecheck, the production build, all 227
repository tests, the immersive and discovery browser integrations, and all five
runtime browser checks. Coverage includes cold-link autoplay, full-viewport bounds,
hover/keyboard disclosure, touch reveal/dismiss/return, 320px and 390px portrait and
844px landscape layouts, native fullscreen exit, settings and preserved host state.
Desktop and touch screenshots were inspected locally. This revision has not been
deployed; mobile evidence remains Chromium emulation rather than physical iOS.

The gallery and detail-page share icon opens an anchored choice of **Detail link**
and **Player link**. Both work while signed out. Player links append `/play` to the
same address or pinned revision; they do not create another identity. Copy failures
show a selectable URL in the popup. The immersive player retains its own **Copy play
link** control. A fresh link fills the page, but native browser fullscreen still
requires the visitor's Play/fullscreen gesture.

## Verification

Unit/integration coverage also covers unknown-message silence, successful public-key snapshots at quota, verified NIP-65 preferences independent of relay policy, and late-result suppression across account changes. Standalone CLI browser checks cover the same shim/services, local relay reads, resource mediation, save prompts/downloads, account changes, reloads, capability gating and tampered bytes. Unit/integration coverage exercises storage isolation and quotas, virtual file chunking/revisions/traversal/cancellation, resource scheme/IP/MIME checks, request origin binding, queued cancellation, and actual Applesauce WebSocket queries with forged/duplicate/nonmatching events. Browser tests exercise the published shim, handshake, persistent saves, denied publishing, forged host messages, file downloads and player cleanup.

Read-only public smoke checks: Random Sticker displays/changes stickers and exports a WebP; Rubik Cube renders and plays; Packaged Loader Evidence finishes with all ten resources verified; DJ David Clanker renders its decks and fetches library resources; Nostr Pet reaches its public-account view. These are observations, not a guarantee for every listed app or operation. DJ's optional direct MIDI access remains browser-blocked; playback does not support payments or publication.

Earlier interoperability checkpoint: type checking, 48 unit/integration tests, a production build/startup, and four Chromium playback/export checks passed through Caddy/PM2. The 78 MiB packaged-loader check was skipped in this pass; it passed at the previous 43-test/11-browser-check runtime checkpoint. To repeat the public tests (the optional large fixture downloads 78 MiB):

```sh
TEST_ORIGIN=http://localhost:8080 TEST_PUBLICDEV=1 TEST_LARGE_PUBLIC=1 \
  bunx playwright test tests/browser/public.spec.ts tests/browser/runtime.spec.ts
```

## Standalone creator preview

New CLI projects include the same prelude builder, host and resource responder as the website. The browser hash-checks local bytes before injecting `srcdoc`; the opaque iframe has the same CSP and capability set. The host page permits the inline code/WebAssembly required by inherited `srcdoc` policy, while the frame's stricter CSP removes all network access. Save/link confirmations and downloads are host-owned, and browser-extension connection exercises the same identity lifecycle.

`napplet.json` accepts `requires` (mandatory domains), `relays` (fallback read destinations; explicitly configured literal-loopback WS is also permitted in local preview) and `servers` (Blossom hints). Empty arrays support self-contained experiments. The preview server binds loopback, checks Host/Origin, and admits resource requests only for the current compatible local revision. It reuses production origin, URL/IP, MIME, quota and timeout checks. Local source authority and `previewId` do not impersonate a signed publication or creator key. Publishing is available through the separate CLI publish flow. Updating the CLI updates its preview host; older self-contained generated harness copies retain their old bundled runtime.

This conformance checkpoint passed type checking, 62 unit/integration tests, 15 Chromium checks, and a production build/startup. The separate 78 MiB packaged-resource integration test remains opt-in and was not repeated.

## Configuration checkpoint (2026-09-14, source only)

The shared host now provides NAP-CONFIG in both players, with settings inside the
fullscreen wrapper and a static-schema example in new boilerplates. See
[CONFIGURATION.md](CONFIGURATION.md) for semantics and [COMPATIBILITY.md](COMPATIBILITY.md)
for the operation inventory, tested pins and upstream conformance-runner limitations.
A broader release and independent-client acceptance remain separate agenda work.

## Runtime relay routing — soyLI 0.8.2

Discovery/publication relay lists are fallback destinations, not an exclusive runtime
allowlist. Explicit `outbox` relay hints and verified NIP-65 author write relays can
be read through the shared host. Explicit hints take precedence within the eight-relay
fanout cap; NIP-65 discovery uses at most one third of the query deadline (up to two
seconds). Discovery and the final query share the caller's total time budget.

The current shared host reads relays directly with Applesauce WebSockets. It checks
signatures, filters, hints, quotas and deadlines in the trusted browser, without
AUTH, signing or publication grants to the napplet. No `/api/relay-read` request,
HTTP streaming bridge or CONNECT tunnel is involved. Operator/project settings
may explicitly permit literal-loopback WS relays; manifest hints cannot grant
private-network access. The iframe retains `connect-src 'none'`.

Failed or timed-out queries return incomplete results, with an error if no events
arrived. An empty completed read remains distinct from a failed lookup. Live reads
survive EOSE and close with the player/account; their existing host event, lifetime
and concurrency bounds remain. The shared shim regression tests exercise direct
WebSocket traffic, hinted station lookup, stalled fallback/discovery, cancellation,
forged events and NIP-65 routing. See [direct protocol access](PROTOCOL-ACCESS.md).

### Read deadlines — soyLI 0.8.3

The caller's `timeoutMs` includes discovery, network reads and reply delivery. The
shared web/preview host reserves 20% of that budget for delivery (minimum 25 ms,
maximum 1 second). Discovery uses at most one third of the remaining budget, capped
at 2 seconds. At the read deadline the host cancels outstanding requests and returns
all verified events collected so far with `incomplete: true`; if none arrived, the
result also carries a retryable read error. It does not stop on the first event.
This prevents a stalled fallback from making the SDK discard an already retrieved
station. External relay availability and a suspended browser remain outside this
bounded request guarantee. No upstream bindings or napplet changes are required.

`bun test tests/services/relay-deadline.test.ts` exercises the actual pinned SDK and
shared preview through HTTP: normal reads, stalled fallback/discovery, empty reads
and `getEvent`. The repository suite also checks later-arriving events and cleanup.

## Keyboard actions — 2026-10-13 source

The website and soyLI preview implement NAP-KEYS action registration through the
pinned shim 0.30.0, using [NAP-KEYS PR 9 at 8869a4c](https://github.com/napplet/naps/blob/8869a4cf77b023f4b049f47c546910a0280dc1a6/naps/NAP-KEYS.md).
`window.napplet.keys` and `shell.supports('keys')` advertise support; manifests
requiring `keys` can launch. The index runtime profile changes to recheck previous
capability rejections. Creators can register named actions with `defaultKey` and
subscribe with `onAction`; registered gameplay keys execute locally in the iframe.
Ordinary DOM keyboard listeners continue to work.

The host returns a correlated result, pushes the complete binding list on handshake
and changes, and removes bindings on unregister or frame disposal. Bindings survive
account changes within that frame. Duplicate IDs fail explicitly; conflicting or
reserved defaults remain unbound. Limits: 128 actions/frame, 128-character IDs,
160-character labels, 128-character hints, 256 registration/unregistration messages
per minute. Forwarded keys have a separate 120/second budget; gameplay actions do
not consume host request quotas.

The pinned shim excludes text inputs, textareas, selects, contenteditable and IME
composition. Tab, Escape and browser shortcuts cannot be assigned. Default hints
normalize modifier order and ASCII letter case for the shim. Combined Meta+Shift
hints currently remain unbound: the draft specifies Alt+Ctrl+Shift+Meta whereas
shim 0.30.0 emits Alt+Ctrl+Meta+Shift. User rebinding and an action-list UI are not
implemented. These are host policy limits, not new messages or protocol extensions.

Forwarded bare Escape invokes the website's existing exit handler only when the
verified frame has focus, the document is focused and the frame is not inert. Modal
and native-fullscreen guards remain in effect. Other forwarded keys have no shell
command here. Raw keystrokes are neither logged, redispatched as DOM events nor
sent to another napplet. The opaque sandbox and network permissions are unchanged.

Regression: `bun test packages/runtime/src/keys-session.test.ts
packages/runtime/src/host.test.ts tests/services/keys-preview.test.ts` (website
browser coverage requires `bun run build`). The real-host test failed before the
fix and passes with arrow/WASD movement, text editing, unregister/reload, required
capability admission and Escape exit with retained game state. Deployment evidence
is tracked separately from implementation.
