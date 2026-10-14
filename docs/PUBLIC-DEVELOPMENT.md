# Seeded development, public relays, and share previews

## Commands

```sh
bun run dev                          # seed check + local examples, no public discovery
bun run dev publicdev                # seed check + cached relay discovery
bun run dev --publicdev --refresh    # force refresh of the relay catalog/artifacts
PORT=3030 bun run dev publicdev       # choose a port if 3000 is occupied
PORT=3020 bun run dev:prod publicdev  # same data under the production Bun build, PM2, and Caddy
```

Every dev and dev:prod launch checks the six original examples, restores missing generated artifacts/posters, and rewrites only changed files. Existing creator projects and keys are untouched. The measured warm check was approximately 33 ms on the development machine. The fixture key is deliberately public, local-only test data; no seed event is published.

## Public discovery

Public dev reads signed Nostr manifests through Applesauce from the five external
[shared relay defaults](RELAY-DEFAULTS.md): Damus, nos.lol, Primal, nostr.mom and
Pocketstr. These are configurable bootstrap choices, not an authoritative napplet directory:

```sh
SPACE_PUBLIC_RELAYS=wss://your-relay.example bun run dev publicdev --refresh
```

There is no HTTP directory importer or Nappelin dependency. Discovery queries kinds 35129, 15129, and 5129 without requiring a Space-specific hashtag, title, descriptor, or snapshot-pointer tag. A named event or root event has a portable `/n/<naddr>` route. A real snapshot has `/r/<event-id>`. Site aliases continue to refer to local registered names; public creators are identified by pubkey, not invented site handles.

The client validates signatures and either the new standalone raw-HTML `x` format or the retained legacy path/aggregate format. New snapshots may omit ancestry entirely; their own hash is authoritative and ancestors confer no runtime identity. Legacy snapshots retain their old aggregate/self-address checks. See [migration semantics](NIP5D-MIGRATION.md). Longer public identifiers are accepted; the CLI may still generate short identifiers. Kind-35128 nsites and unrelated events are not treated as napplets.

Replaceable manifests are selected by newest timestamp and then lowest event ID, before package validation. An invalid latest package is not replaced with an older version labeled current. This is a bounded startup catalog, not a complete relay index: each relay query is capped, the catalog holds at most 100 valid manifests, and older versions can fall outside that window. Continuous ingestion, deletion-event handling, profile resolution, relay hints beyond the configured bootstrap set, and a persistent public index remain later work.

Single-file `/index.html` artifacts are downloaded when their required domains are supported by the [public runtime profile](PUBLIC-RUNTIME.md). This includes the shell handshake, storage, identity reads, theme, resource loading, relay/outbox reads, common public-identifier helpers, links, and virtual file exports. Unsupported required domains remain visible on detail pages and gallery cards. Undeclared dependencies in older napplets may still prevent them from working; this is not full NAP conformance. The same host runs in development and production builds.

Blossom artifact downloads use signed server hints, verify hashes and UTF-8, reject private/special network destinations at connection-time DNS lookup, and do not follow redirects. Playable HTML downloads are size-limited to 25 MiB, with three workers, per-mirror timeouts, and a sixty-second total window. No remote URL is fetched on a page/OG request and no napplet code executes on the server. After the user starts playback, NAP resource requests use a separate bounded host endpoint with its unchanged 10 MiB resource limit; its policy is documented in [PUBLIC-RUNTIME.md](PUBLIC-RUNTIME.md).

The 25 MiB artifact allowance is a source update; public website, indexer and
runtime deployments must adopt it before admitting HTML above the former 10 MiB
ceiling. Updating the creator's CLI alone does not update public services.

The public cache lives exclusively under `.local/publicdev`, outside the production archive and build assets. It is reused for 15 minutes, refreshed on startup after that or when the runtime capability profile changes, and retained with its original timestamp when relays fail. `--refresh` bypasses the TTL. Public mode requires an explicit runtime switch, so saved public entries and their artifacts return 404 in ordinary local/production mode. Browser requests do not refresh this cache. An ordinary VPS deployment disables publicdev.

The current read-only smoke run found 93 valid manifests and cached 23 compatible, verified artifacts (up from 13 before the host bridge). Rubik Cube plays; Random Sticker rotates and exports a WebP; Packaged Loader Evidence opens ten verified resources; DJ David Clanker renders its decks and fetches resources. Some declared-compatible artifacts are unavailable from their mirrors, and older undeclared dependencies can still fail. Those counts are observations, not guaranteed inventory or proof that every artifact works in every mode.

## Open Graph

Named, naddr, and snapshot pages emit title, description, canonical URL, complete Open Graph metadata, and Twitter large-image metadata in the initial server-rendered HTML. Crawlers do not need JavaScript, a signer, or WebSocket access.

`/api/og/<signed-event-id>?v=1` returns a real 1200×630 PNG, with GET/HEAD and ETag support. Images use escaped signed metadata and a local graphics template; local example posters can appear in the art panel. Native resvg runs only on the server with a bundled OFL-licensed DM Sans font, independent of the VPS's installed fonts. Images are cached in a bounded process cache and served only for known catalog entries. Unknown IDs return 404. Change the image version when changing the template.

`SPACE_SITE_ORIGIN` supplies trusted absolute URLs. Dev derives it from its port, dev:prod from its Caddy address, and the VPS deploy script sets it to `https://<domain>`. Host and forwarded headers cannot rewrite share URLs. A local preview becomes fetchable by external social platforms only once the site has a publicly reachable origin.

## Linked preview metadata

Catalog refresh reads optional `soy.presentation/1` screenshots/clips directly
from signed manifests, with legacy `app` references to NIP-89 pictures or Zapstore
media and standard icons as fallbacks. Direct presentation uses verified cached
media or browser-verified Blob URLs; legacy linked media can still use original
URLs. Missing metadata or failed images keep the generated poster and do not
affect playback. Thumbnail generation never executes napplet code. Direct browser
fetches contact the chosen media providers. See [direct protocol access](PROTOCOL-ACCESS.md).

Refresh older caches with `bun run dev publicdev --refresh` (or `bun run dev:prod publicdev --refresh`). The preview profile also invalidates older caches once automatically. Descriptor lookup requires Node, already used for PM2, and uses a short-lived bounded worker only when supported app links exist. Read [PREVIEWS.md](PREVIEWS.md) for the supported schemas, limits, and verification evidence.
