# ContextVM backend services

The Soy backend is an MCP server reached directly over signed, NIP-44-encrypted
Nostr transport. It provides persistent casual scoreboards, leased named rooms,
and matchmaking. The public service does not execute uploaded game code or run a game simulation.
No HTTP endpoint proxies these calls.

An opt-in dynamic backend supports schema-defined handlers and durable instances in
soyLI preview, plus a qualified Linux provider deployment with explicit creator
admission. Public hosting remains disabled until operator activation. See
[DYNAMIC-BACKENDS.md](DYNAMIC-BACKENDS.md) for the source-build contract, account
proofs, restrictions and rollout instructions.

The service uses `@contextvm/sdk` 0.13.16 and MCP SDK 1.30.0. Browser mediation targets
[NAP-CVM PR 31, ad68a938](https://github.com/napplet/naps/blob/ad68a938236e9230324e377cd005008a315ff402/naps/NAP-CVM.md).
Peer transport targets [NAP-WEBRTC PR 145, 69b8f0b3](https://github.com/napplet/naps/blob/69b8f0b367e3e204ce522b5369d446974b11459a/naps/NAP-WEBRTC.md). See [realtime delivery](WEBRTC-REALTIME.md) for compatibility and the additional host signaling profile.
The shell installs shim 0.35.0 with its reviewed local binding patch. These are evolving proposal contracts;
NIP-5D remains authoritative for napplet publication and host messages.

The local creator workflow also includes `soyli multiplayer <scenario.mjs>`:
independent guest contexts, a disposable backend, seeded per-hop delay/jitter,
optional local coturn, creator assertions and a JSON report. Preview connection
diagnostics expose sanitized host observations. These tools change no NAP messages
or signaling profile. Read the [creator testing and synchronization guide](BACKEND-CREATOR.md#responsive-synchronization).
Scenario success covers its assertions; it does not qualify public-network latency,
packet loss, n-player capacity or long-session TURN renewal. Website background
lifecycle and transient delivery profiles remain separate follow-up work.

## Service contract v1

Input schemas are in `packages/multiplayer/src/contracts.ts`, `rooms.ts` and
`matchmaking.ts`. All tools return ordinary MCP content plus `structuredContent`;
errors use `isError`. The transport supplies the authenticated client key.
Caller-supplied `_meta.clientPubkey` cannot impersonate another player.

| Tool                 | Behavior                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| `soy_session`        | Current transport actor, contract version, families and polling policy           |
| `soy_board_register` | Creator-authorized registration of immutable board rules                         |
| `soy_board_submit`   | Update the caller's personal best; retries do not add scores                     |
| `soy_board_read`     | Current ordered scores plus the caller's personal best                           |
| `soy_board_entry`    | One public personal best with its structured attachment; optional revision check |
| `soy_room_create`    | Create a named, optionally listed room with a chosen capacity                    |
| `soy_room_list`      | List rooms in an author-qualified napplet/protocol namespace                     |
| `soy_room_join`      | Join within provider capacity and return current peer keys                       |
| `soy_room_status`    | Renew membership and return current peers                                        |
| `soy_room_leave`     | Leave without closing the room for other members                                 |
| `space_match_join`   | Join an exact-release queue; repeated joins reuse the ticket                     |
| `space_match_status` | Read own ticket and renew a waiting lease                                        |
| `space_match_leave`  | Leave the fixed match; this older queue contract closes it for peers             |
| `soy_ice`            | Temporary authenticated TURN credentials for the host                            |

Room membership lasts 60 seconds without renewal. Poll status every 2–20 seconds.
Rooms disappear when their last lease expires. Provider defaults are 1,000 rooms,
eight peers per room, and four room memberships per actor. Capacity is provider
policy, not a game rule; `SPACE_CVM_MAX_PEERS` can set a limit up to the contract's
64-peer ceiling. The current browser mesh separately admits eight remote peers.
Listed rooms are public rendezvous. An unlisted room ID is not an authorization
credential, and a peer key is not proof of a human, profile, or honest game client.

The creator queue (`soy_match_join/status/leave`) uses `{napplet, protocol, queue,
players}`; equivalence includes the decoded author-qualified napplet identity,
application protocol version, queue and requested count. No self-referential
build hash is required. Legacy `space_match_*` tools retain exact-artifact matching. Its default two-player request and maximum eight are explicit
service limits. Waiting tickets expire after 60 seconds and fixed matches after
ten minutes. Named rooms cover variable membership without that fixed-match
lifecycle. Neither mechanism chooses simulation topology or game rules.

## Durable scores and creator authority

Boards use `{napplet, board}` as their namespace. The napplet is a standard naddr;
relay hints do not change identity. Definitions include title, `highest` or
`lowest` ordering, and finite minimum/maximum bounds. Rules are immutable: choose
a new board ID for new rules or a new season. Scores survive service restarts in
SQLite/WAL. Republishing does not reset them. Remixes get a different napplet
address and must register their own boards.

Registration carries an unpublished signed application proof from the naddr's
author. `boardAuthorization()` specifies its exact kind-1 template: a
`soy-board-registration-v1` tag, provider `p` tag, and JSON content binding the
transport caller and full definition. Its timestamp must be within five minutes.
This is an application authorization format, not a new NIP or a public social
post. The key never reaches the backend. Replaying a proof for another provider,
caller, author or definition fails; retrying the same registration is harmless.

Scores are **client-reported**, keyed to authenticated transport identities.
They are suitable for casual boards, not prizes or claims of cheat resistance.
Names are untrusted display strings. The defaults allow 1,000 boards and 1,000
players per board, return at most 100 rows, and limit each actor to 120 tool calls
per minute. Per-key limits are not Sybil protection. Exhausted resources fail
explicitly; they do not silently evict scores or create paid usage.

### Structured score attachments (service 1.1.0)

`soy.boards.v2` adds a creator-declared immutable `dataSchema`, `data` on score
submission and `soy_board_entry`. These are Soy MCP service contracts over the
unchanged pinned NAP-CVM API. The v1 tool family remains available; its existing
inputs work, with additive `revision`, `hasData` and `nextOffset` result fields.
No score database reset, custom creator code execution, REST proxy or NIP-5D
metadata change is involved. SQLite migration adds nullable data and stable run
revisions to existing records. Update the service before publishing data boards;
update the shell/soyLI for v2 registry discovery and local preview.
Keep the pre-upgrade database backup for an operator rollback: previous backend
binaries use the old SQLite column layout and cannot write to the upgraded table.

Score, name and payload change atomically only for strictly better results.
Ties/worse retries cannot replace the original run. Data is required for a board
declaring a schema and rejected otherwise. A board's schema is bound by the same
creator/caller/provider registration proof as its other rules. Changed schemas
require a new board ID. Existing boards and scores are preserved across upgrades.

Schemas and data each have an 8 KiB UTF-8 JSON budget. The bounded JSON Schema
subset supports nested objects/arrays, primitives, required fields, enum and
bounds, with no references, regular expressions or executable validation. Detailed
limits and copyable configuration/calls are in the bundled
[creator guide](BACKEND-CREATOR.md#score-attachments-cars-drawings-loadouts-and-other-run-data).
List responses omit payloads, include `hasData`/`revision` and cap rows at 16 KiB
in addition to the requested limit. Use `offset`/`nextOffset` for live pagination.
`soy_board_entry` takes `{napplet, board, actor, revision?}` and returns one complete
row, or null if absent; a changed requested revision returns `stale: true` and null
instead of mixing a previous score with a newer attachment. Past runs are not retained.

Attachments are public, untrusted, client-reported game data. There is no profile
identity binding, cheat validation, generic collection CRUD or private cloud save.
Large replay/media data belongs on Blossom with creator-defined URL/hash fields;
this service never fetches or executes those references. Provider quotas remain
bounded free-service policy, not automatic billing.

Local verification covers schema limits and errors, registration proofs, atomic
best/data replacement, ties/retries, persistence, legacy database migration and
bounded pages. Two independent Chromium guests exercise the actual shim, v2
registry/schema hashes, encrypted CVM, a full 8 KiB payload and stale/concurrent
submissions. Compiled darwin-arm64 soyLI also creates and checks an attachment
project without Bun/Node on its PATH. The development namespace now agrees across
dev, checks and captures before selecting a creator. These checks are local evidence;
they do not establish deployment or an independently built game using the feature.

## Provider selection and schema identity

The host's curated families are `soy.matchmaking.v1`, `soy.rooms.v1`,
`soy.boards.v1`, `soy.boards.v2` and the optional `soy.backends.v1`. These are Soy service contracts exposed through the standard
NAP-CVM registry, not additions to the NAP browser namespace. Direct `callTool`
works with other CVM providers. Selecting another provider does not migrate scores,
rooms or active sessions. There is no automatic stateful-provider fallback.

The service attaches per-tool CEP-15 hashes using the installed SDK's normalized
schema/JCS implementation under `_meta["io.contextvm/common-schema"]`. A structural
hash does not prove a provider implements the advertised semantics. No aggregate
family hash or interchangeable-provider claim is made.

## Operator service

```
SPACE_CVM_RELAYS=ws://127.0.0.1:19347/relay bun run cvm
```

Set `SPACE_CVM_KEY_PATH` and `SPACE_CVM_DATA_PATH` to persistent paths outside
releases. Identity files are mode 0600. `--identity` on the service entrypoint
prints only its public key. Public announcements are opt-in with
`SPACE_CVM_ANNOUNCE=1`; `SPACE_CVM_PUBLIC_RELAYS` controls advertised relays while
`SPACE_CVM_RELAYS` controls actual server connections. The deployment uses the
local relay connection and advertises the public WSS address.

`soyli dev` uses the same service implementation with a bounded loopback preview
relay and per-project data in `.napplet-space/backend`. Full-stack development
and production use Khatru. The small preview relay is not a production relay.
Local board provisioning trusts the developer's configuration file and is never
exposed as an unauthenticated public tool.

Service tests exercise encrypted transport, caller binding, registration
ownership, personal-best idempotence, persistence, capacity and lease expiry.
Production rollout and independently created games require separate verification.

## Browser and creator integration (soyLI 0.10.0)

The shared host advertises NAP-CVM and NAP-WEBRTC. Both the shell and compiled
soyLI use the same bridge. See the self-contained [creator guide](BACKEND-CREATOR.md)
for setup, scores, matching, rooms, lifecycle examples and the complete limits.
That guide is bundled into new projects and `soyli skills update`.

`/.well-known/napplet.json` is site-owned public provider configuration. It contains
only the public key and relays, is unavailable when no provider is configured,
and does not proxy gameplay or CVM calls. Creator configuration pins it into
`napplet.json`; generated public `.napplet-space/soy-backend.json` carries the stable naddr and
provider into the artifact. Publishing authorizes board registration directly over
CVM. Dev mode redirects that provider to an isolated instance of the same service.

The host owns a per-tab, napplet- and viewer-scoped transport signer in
sessionStorage, shared by CVM and WebRTC. It survives same-tab reloads and build
updates, but is not a durable profile identity. Duplicated tabs may inherit it;
use independent browser contexts for distinct guest players. Provider sessions
are capped at four, provider requests time out in at most 25 seconds after initialization,
and replies are capped at 256 KB. The iframe call deadline can be up to two minutes
to include human consent and signing; this does not extend backend execution limits.
Payment-required results remain errors.

Registry discovery checks live tool schemas and any advertised CEP-15 hash.
It never equates semantics based only on tool names. Per-tool hashes are exposed;
aggregate family-hash matching is not implemented. General MCP notifications
are forwarded, but CEP-41 streams, payments and large-response transports are
disabled. Curated families do not imply support for arbitrary backend code.

### Remembered multiplayer permission (soyLI 0.10.1)

The first peer-connection request opens a host-owned Allow / Block popup. Either
choice is remembered for all napplets on that host origin in the current browser
profile, including guests and later visits. Not now, Escape, timeout and closing
the player do not save a decision. Network settings on the website and in the
soyLI preview offers Ask me, Allow and Block. Changing to Ask me or Block closes
active peer sessions in the current page and other same-origin tabs. A separate
browser profile or preview origin has its own choice; unavailable browser storage
falls back to the current page only. Clearing site storage resets the preference.

This is user policy under the pinned NAP-WEBRTC proposal, not an app API extension.
Napplet storage cannot alter it. Direct/relay selection remains automatic, and
the popup explains that peers may learn the player's IP address. Approval does
not grant unfamiliar CVM providers, signing, payments, microphone or camera access.

## WebRTC signaling profile `soy-rtc/1`

NAP-WEBRTC defines the app API and leaves signaling to the host. Soy implements
its own published profile; this is not a claim of NIP-100 conformance or automatic
interoperability with every other shell's signaling.

- Events are signed Nostr kind 25050, with `d` = namespace digest and an expiration
  60 seconds after creation. Targeted messages also carry the recipient `p` tag.
- The namespace is SHA-256 of UTF-8 JSON `["soy-rtc/1", identity, scope, channel,
protocol-or-empty-string]`. Production identity is the verified author's
  `pubkey:kind:identifier`, without an appended build hash. A snapshot whose
  address names a different signer uses `snapshotSigner:5129:address` instead. The preview uses its local preview identity. Scope is `["room", roomId]`
  or `["direct", ...lexicographicallySortedTransportPubkeys]`.
- A signed plaintext hello body is `{v:"soy-rtc/1",wire,nonce,type:"hello"}`.
  `nonce` is a fresh UUID per session. Offers/answers are NIP-44 encrypted to the
  peer and contain `{v,wire,nonce,type,to,sdp}`; `to` binds the recipient's nonce.
  The lexicographically lower key offers. Non-trickle SDP includes gathered ICE
  candidates. Hello/offer retransmission runs every two seconds; stalled peers
  leave individually after 45 seconds. Reopening obtains fresh nonces/credentials.
- The host verifies signatures, namespace, freshness, peer allowlists and nonces,
  bounds message rates and queued work, and never exposes SDP or TURN secrets to
  the iframe. Public hellos disclose participation in the opaque rendezvous.
- Native data channels default to reliable/ordered JSON; optional #145 delivery
  and bytes use the [authenticated realtime profile](WEBRTC-REALTIME.md). Broadcast messages are at most
  16 KiB, with 256 KiB channel backpressure. Host sends have a separate realtime
  budget of 120/second and 512 KiB/second. Game traffic does not go through Nostr.

The host is limited to four WebRTC sessions and eight remote peers each. These
are capacity policies, not game rules. Apps select topology and authority. No
host migration, authoritative physics, durable world, anti-cheat or simulation
service is implied. A CVM room alone does not prove WebRTC membership; use explicit
peer allowlists where needed. The pinned API has no dynamic allowlist update.

The operator's `soy_ice` issues ten-minute HMAC TURN credentials to the verified
transport caller. Only the host sees them. Browser ICE selects direct traffic
when possible and TURN otherwise. Reopening requests fresh credentials; long
sessions and credential renewal still require qualification. No TLS/443 fallback
is bundled because that port belongs to the shared HTTPS proxy. See
[deployment configuration](DEPLOYMENT.md#cvm-and-turn-deployment).

Engineering verification: separate Chromium contexts using the actual injected
shim exercised encrypted CVM score submission/read, protocol matchmaking, forced
coturn relay selection, peer payloads, 650 gameplay updates, over-limit rejection
and departure. Service tests cover durable scores/ownership, room leases/capacity,
and the CLI's signed provisioning/remix isolation. Direct ICE on the development
machine's VPN interface did not connect. Separate-network direct and TURN tests,
long-session recovery and independent creator acceptance remain
unverified; the fixtures are not claims of those results.

Production service health was verified on 2026-09-20: the managed CVM and coturn
were running, and a fresh anonymous client completed an encrypted `soy_session`
round trip through `wss://relay.napplet.soy`. This does not qualify real-network
gameplay or TURN packet delivery. See the [deployment record](DEPLOYMENT.md#soyli-0141-and-workshop-release--2026-09-20).

Reproduce service/relay checks with `bun run test:backend`. For the browser fixture,
run `SPACE_TEST_TURN_BINARY=/path/to/turnserver bun run test:backend:browser`;
it starts and stops an isolated loopback coturn instance with relay-only ICE and
asserts the selected candidate is a relay. Without that variable the fixture
uses direct ICE, which requires locally reachable browser candidates. The service
tests do not require coturn. No test contacts the production provider.
