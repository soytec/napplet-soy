# Managed Nostr relay

Implemented 2026-09-12. The relay is the first backing service in the publishing path. It runs as a native Go process under PM2 locally and in the VPS deployment definition. The application and clients remain Bun/React/Applesauce. [Blossom storage](BLOSSOM.md) followed on 2026-09-13; GRASP, creator signing, the publish journal, and the persistent website catalog are still pending.

## Run and query

```sh
bun run dev                    # HMR app + persistent local relay + example events
PORT=3020 bun run dev:prod publicdev  # production app, Caddy, relay; optional public reads
bun run dev:doctor
bun run relay:seed              # verify/reconcile local example events
bun run test:relay              # Go race checks + Applesauce process integration
bun run dev:down                # stop this checkout's PM2 processes; retain data
```

Platform development requires Go 1.21+ with automatic toolchain downloads enabled and a C compiler. Xcode command-line tools provide the compiler on macOS; `build-essential` provides it on Debian/Ubuntu. The build runner selects Go **1.25.0** explicitly. The VPS script installs that version using pinned official SHA-256 checksums. Ordinary creators can use the standalone CLI and their existing coding tool without installing Bun or Go.

The direct local endpoint is `ws://127.0.0.1:19347/relay`. A production-build launch also exposes `ws://localhost:8080/relay` through Caddy. The default VPS endpoint is `wss://relay.<domain>`, with its own DNS record and Caddy TLS certificate. The previous `wss://<domain>/relay` endpoint remains an explicitly configured alias. Both paths serve the same events. NIP-42 binds authentication to the selected configured public URL/alias or literal direct listener address (root and `/relay`); arbitrary forwarded headers cannot choose the authentication URL. NIP-11 is available at the corresponding HTTP(S) URL with `Accept: application/nostr+json`. Internal health is at `http://127.0.0.1:19347/health`; it reports service, build fingerprint, and instance identity. Health is only ready after the search rebuild finishes.

Any Nostr client can query, for example:

```json
[
  "REQ",
  "gallery",
  { "kinds": [35129, 15129, 5129], "search": "\"lunar orbit\"", "#t": ["visuals"], "limit": 20 }
]
```

No Space hashtag, snapshot pointer, API key, or special event kind is required. Text search includes retained content, title/name, description/about, and topics. Words are combined with AND; double quotes select phrases. It uses Bleve's standard analyzer, not semantic search or a language-detection model. Ordinary author, kind, ID, time, and tag filters still apply. Results sort by descending timestamp then ascending event ID. NIP-50 extensions such as `language:` are not implemented. Management/NIP-86 is not advertised or enabled.

COUNT/NIP-45 and negentropy/NIP-77 are advertised and enabled. COUNT applies the same filter checks and visibility as REQ (deleted, expired and moderated events are excluded), ignores `limit`, and stops at 5,000 matching events. Filters that khatru answers with HyperLogLog (for example kind 7 by `#e`, kind 1111 by `#E`) return the same count plus author registers. Negentropy sessions read up to 5,000 stored events per filter instead of the 200-event REQ cap.

## Persistence and compatibility

The application pins `fiatjaf.com/nostr@v0.0.0-20260902034142-316ef6591fa2` and Bleve **2.4.4** in `services/relay/go.mod` and `go.sum`. LMDB stores the original signed events. Bleve is a disposable projection used for queries, followed by full ID/filter/deletion/expiration checks against LMDB. This avoids the upstream search adapter's metadata-phrase and candidate-filtering problems. All retained kinds are indexed, including all three napplet kinds and supporting metadata.

The service rebuilds Bleve on startup from retained events. Rebuild work grows with the number of retained events; it is not constant-time recovery. An index write failure fails subsequent requests until restart/rebuild. A process lock prevents two instances from opening the same data directory or rebuilding each other's index. Queries release database locks before sending results to slow clients. Replaceable winners, including equal-time ID tie breaks, stay consistent across storage and search. Durable owned deletion markers block replay and hide a target even if termination occurs before physical removal. Deletion markers cannot themselves be deleted or assigned an expiration. Expired events disappear immediately from queries; a minute timer physically removes up to 200 expired records per pass.

Two small upstream compatibility patches are applied by `scripts/relay-go.ts` in a temporary module copy, with exact input SHA-256 guards:

- Event serialization keeps its base as a pointer and uses `unsafe.Add`, avoiding an invalid pointer-to-integer round trip exposed by Go's pointer checks.
- LMDB query batches are capped at 500 events; a full startup scan no longer allocates its entire result limit as a batch.

The shared Go module cache is never modified. Production builds and race tests use the same patches. Race/pointer checks remain enabled. A changed upstream file requires an explicit patch review; remove the patches when upgrading to a release that contains equivalent fixes. Use the repository's build/test commands, since plain `go test` does not apply these patches.

The runner preserves sanitized Go output, the failed operation and the tool exit
status. A test assertion failure is reported as a test failure; it is not diagnosed
as missing Go/compiler prerequisites. `bun run test:relay` also exercises this
failure path through the actual runner process, including output redaction.

Local state is `.local/services/relay`; production state is `/var/lib/napplet-space/relay`, outside releases. LMDB currently has a 1 GiB map; Bleve and logs need additional disk. PM2 restarts above 1 GiB resident memory and uses a 15-second termination allowance. SIGTERM/SIGINT stops the expiration worker and closes hijacked WebSockets before closing storage. Back up the data directory with the relay stopped; the search directory can be regenerated. Online backup, dynamic capacity management, and large-catalog recovery benchmarks are not implemented.

## Seeding and publication boundary

Both dev modes repair the six bundled examples, then use Applesauce to query and publish their 12 existing signed current/snapshot events through the local relay. Every acknowledged event is read back and signature-verified. A warm check skips all writes (61 ms in the local verification run). The service is reused when its build fingerprint matches. `dev:down` retains events; the next start rebuilds the projection and reconciles seeds.

Fixture publication only accepts literal loopback `ws://` destinations, never relay hints, user defaults, publicdev targets, or a production account. `publicdev` remains an independent read-only public relay import. Deployment starts an empty relay and never runs the fixture seed against it.

These fixtures do **not** constitute completed portable publications: their HTML bytes are now also seeded into local Blossom, but their ordinary manifests still have no published Blossom/source hints. The gallery still reads the existing catalog/cache and bundled posters. The next integration must provision source through GRASP/ngit, include retrievable byte hints in creator publications, and index relay publications into playable/named routes. The publishing contract still requires independent-client discovery and playback without the Space API.

## Operator boundary and evidence

The current relay accepts valid signed events without an account allowlist. It bounds connections (256), WebSocket messages (64 KiB), stored query responses (200), filter dimensions, search length and execution time, and per-connection publication/query rates. These are initial service limits, not a complete public-abuse or moderation system. Public launch still needs operator retention/admission controls, load testing, monitoring, and backup restoration exercises.

Each public connection has separate budgets of 120 publications and 240 queries
per fixed clock minute. The optional loopback-only CVM ingress permits 6,000
publications and 12,000 queries per connection per minute and rejects browser
Origin headers. Both counters reset at the next minute boundary; a connection's
public/service classification is retained. COUNT has its own budget of 1,200 per
connection per minute (24,000 for the service ingress). Over budget, a COUNT waits
for the next minute instead of being answered with khatru's rejection count of 0; at
most 32 can wait per connection, after which a NOTICE and count 0 are returned.
The pinned khatru build also patches a listener race between closing a subscription
and broadcasting an event to it (`scripts/relay-go.ts`). Tests control this budget clock while
using real WebSockets, so crossing a wall-clock minute during a slow CI run cannot
make an otherwise valid acknowledgement fail the deployment gate. Production
continues to use the wall clock, with the same limits.

2026-09-23 regression verification: the ingress test passed ten consecutive race
runs. The complete Go race suite, all five Bun relay/runner integration tests and
repository type checking passed locally. The ingress test covers publication and
query limits, reset on the same sockets, retained service privileges, and rejected
browser access. This verification does not constitute a production deployment.

Verified locally: ten Go tests with the race detector; four Applesauce integration tests against a real process; 62 existing application tests; type checking; production build/start; Caddy WebSocket search and NIP-11; a Chromium public-gallery/playback check. Tests cover signature tampering, metadata phrases, combined filters, paging, replacement/ties, owned deletion/replay, interrupted deletion, expiry cleanup, restart/index corruption, process locking, fixture destination restrictions, seed idempotence, and NIP-42 authentication for protected publication. VPS shell syntax is checked, but no Linux deployment, certificate issuance, reboot or remote rollback has been executed.
