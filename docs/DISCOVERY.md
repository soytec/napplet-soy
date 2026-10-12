# Browse, resolve and share

The gallery queries the full retained index (currently capped at 10,000 records),
merges it with an explicitly enabled development cache, applies moderation,
replacement/deletion rules, availability, topics and search, and only then returns
24 entries per page. `?page=2` is shareable; changing a filter resets the page.
Featured remains administrator-controlled and empty by default. Topic counts cover
the eligible collection. The web process memoizes unchanged verified projections,
while moderation and expiration are checked on every read.

Clicking a playable cover starts the existing opaque sandbox in that card. The
creation's title opens its detail page. Only one card plays at a time. Expanding
uses the same iframe; exiting preserves the game and scroll position. A CSS
expansion fallback is available where browser fullscreen is unsupported. Scrolling
the player out of view, switching pages/filters, or leaving the route disposes it.
On narrow screens the active card spans the grid so its controls remain usable.
Without JavaScript covers remain ordinary links and pagination remains navigable.

## Browser navigation

Gallery transitions filter the browser's existing catalog immediately; Nostr and
Blossom enrichment runs in the background. Initial server-rendered entries remain
available, and an empty browser catalog displays a discovery state until the read
settles. Concurrent general catalog reads share one in-flight request. Site
moderation, signed deletions, replacement rules and availability filtering still
apply; this does not add a catalog proxy or change the publication protocol.

“All featured” selects the featured filter and anchors the napplet collection.
Pagination also lands at the collection; Explore lands at its filters. Filter
changes preserve scroll, while browser Back/Forward restores the prior position.
Document and route restoration use immediate scrolling; deliberate carousel
movement retains its short smooth transition (instant with reduced motion).
Background gallery refreshes update the view without invalidating the whole router
or replaying a hash jump. Unchanged slide data does not restart carousel rotation.

`tests/services/gallery-navigation.test.ts` covers unavailable relays, delayed
successful responses, cold home navigation, featured pinned snapshots, filters
and history. The local featured selection/anchor budget is 700 ms; it is not a
guarantee for network-bound detail discovery or physical-device performance.
This source behavior is implemented separately from deployment.

Creation verification in the player and the pending relay-discovery screen use
the aligned nine-frame Soybert walking animation. The loading text remains visible;
the mascot can be paused with click/tap or keyboard Space, and reduced-motion
preferences show a still frame. It is removed when the pending state ends. Small
action-button indicators retain their existing behavior. This presentation does
not change discovery retries, artifact verification or playback admission.
Verified locally with the exported image bytes, all nine frame positions,
pause/keyboard/reduced-motion behavior, 320/390/1365px loading views, completion
of pending states and the immersive playback regression. Deployment is separate.

## On-demand Nostr discovery

The search field accepts an naddr, nostr:naddr, note/nevent, or a portable `/n/` or
`/r/` web link. Only the identity is extracted; the pasted website is never fetched.
A missing portable route adds an exact identity request to `index/discovery.sqlite`.
This is a separate inbox, not permission for web processes to write catalog events.
The indexer processes it alongside its ordinary scans through Applesauce.

Configured relays are operator-selected. Up to four untrusted naddr/nevent relay
hints can additionally be queried by the Node worker: public WSS/443 only,
connection-time DNS checks, no private IPs, redirects, AUTH or publications, with
bounded payloads, events and deadlines. Exact kinds, authors, identifiers/event IDs,
signatures and replacement rules are checked before admission. Targeted deletions
are queried too. Downloads use the existing signed Blossom hints, hash checks,
capability rules and storage limits. Finding an event does not imply it can run.

The inbox deduplicates by identity, has 256 slots and admits at most 20 new/retried
jobs per minute globally. Completed results are cached for five minutes. Abandoned
jobs can be reclaimed after a minute. A discovery job has a 45-second deadline;
background hydration batches have a 15-second budget so requested work can proceed.
Relay coverage remains incomplete: “not found” means the available relays did not
return it. Discovery outages and waiting states are visible instead of becoming a
permanent 404 for a valid unqueried identity. Invalid addresses still return 404.

SSR waits up to 5.5 seconds for a queued request. JavaScript clients show a pending
state and retry boundedly. Unknown identities are marked noindex while pending.
The first crawler request may still precede a slow relay; later requests use the
stored result. No system can force a third-party crawler to retry or clear its cache.

## Open Graph

Named, naddr and pinned pages expose trusted canonical, Open Graph and Twitter
metadata in SSR. A newly discovered manifest can supply its signed title and
description before its executable download finishes. Its OG image is a bounded
1200×630 PNG, incorporating a verified direct manifest screenshot, legacy linked
preview or standard icon when available, otherwise a generated poster. This path
never executes a napplet. NIP-89/Zapstore linked image discovery remains supported;
arbitrary linked website scraping is not enabled. See [previews](PREVIEWS.md).

The service test deliberately uses a relay which returns manifests only to exact
queries, proving that opening the cold link causes discovery. It checks SSR OG,
image delivery, sandbox playback, single-player ownership, fullscreen continuity,
mobile layout and offscreen teardown without publishing to public relays.
