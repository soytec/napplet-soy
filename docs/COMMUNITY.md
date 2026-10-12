# Names and community

Deployed additions (2026-09-15, `20260915084016730-23084`): creator links now open
portable `/p/<npub>` pages with ordinary Nostr metadata, all discovered creations,
and an own-profile editor. `@handle` remains a site alias service. Comments and
saved accounts resolve the shared latest kind-0 cache. See [profiles](PROFILES.md)
and the [signed remix family tree](REMIXING.md#genealogy-on-napplet-pages).

Creators can connect their Nostr browser signer, open their napplet, and use **Named link** to claim `/@handle/slug`. Claims are NIP-98 signed HTTP requests bound to this site's exact URL, method, timestamp and JSON body. The signer must own the napplet's decoded Nostr identity. No private key goes to the website.

One account has one handle. A handle has at most 128 links. A claimed link cannot move to a different creation, including when the same owner asks; additional slugs preserve previous links. Concurrent claims are serialized in SQLite. Replayed authorization events, reserved handles and ownership collisions fail. Relay hints are normalized out of identity comparisons. The registry currently caps at 20,000 links.

Aliases resolve the current indexed manifest at request time, so new releases keep the same friendly URL. `/@handle` lists the creator's claimed links. SSR, canonical URLs and OG metadata work on named routes; portable Nostr and immutable event routes remain available. An alias is a site service, not a new Nostr protocol claim or NIP-05 identity.

The web process requires `SPACE_COMMUNITY_DIR`. `bun run dev` and `bun run dev:prod` set it to `.local/services/community`; restart an existing dev process to pick it up. The VPS script sets it to the persistent `community` directory alongside the relay/index state. Back up this directory with the other service state using SQLite's backup mechanism or with the service stopped. The deployment test process explicitly unsets it so tests cannot alter operator data. No automatic deployment is performed by these changes.

## Social actions

### Responsive social actions — 2026-10-05 source

The comment composer and sign-in control render with the verified manifest, before
conversation/profile reads finish. Replies, counts and names fill in as verified
events arrive; an empty thread continues to say it is loading until its scan
finishes. The `#comments` link focuses the composer without waiting for relay
hydration. Cached and acknowledged events are reduced with the same scope,
reference, author-deletion and moderation checks as incoming events.

Likes use a small viewer-only reaction/deletion read rather than fetching the
whole conversation, every author's profile and zap receipts. Interactive reads
can use the first relay's completed result plus verified cached events. Remaining
relay reads continue to update the store; this is a partial social view, not an
all-relay mutation guarantee. Lifecycle and other reads that require a complete
view still wait for every configured relay.

Publication sends the same signed event to all selected relays concurrently and
reports success at the first positive acknowledgement. Other attempts continue
with their existing six-second deadline. Exhausted attempts retain redacted relay
failure reasons and the exact signed event for retry. Acknowledged likes/comments
update locally, and conversation refresh runs in the background; refreshing cannot
hold the posting button busy or turn a successful post into a publication retry.
Replacement refreshes and route teardown cancel obsolete read subscriptions.

The zap form uses a known verified creator profile or the first verified profile
received; empty relays do not end that lookup prematurely. Other relays continue
refreshing the profile store. The current replaceable profile is chosen before
moderation/content handling, so a blocked or malformed current profile cannot
silently resurrect an older Lightning address. LNURL lookup and invoice validation
remain direct to the creator's service, with no conversation/receipt-total scan
on the form's critical path. Closing cancels profile and endpoint lookup. Existing
amount, recipient, invoice and payment-proof checks remain in force.

Verification: `packages/client/src/transport.test.ts`, `social.test.ts` and
`tests/services/social-actions-latency.test.ts` exercise a fast relay alongside a
stalled fallback. Local Chromium measurements observed the composer within 6 ms
of the discussion heading, a confirmed comment within 22 ms of acknowledgement,
an anonymous invoice request in 357 ms from opening the zap dialog, and a gallery
like in 510 ms from clicking. These fixture measurements isolate application waits;
real signer approval, relay connection and Lightning-service latency still vary.
This follow-up was deployed on 2026-10-05. Fresh live desktop/mobile checks also
confirmed the updated napplet's restored 10,000-sat total; the local timings above
are fixture measurements, not a public-network latency guarantee.

### Sharing a napplet as a Nostr note — 2026-09-24 source

The share menus on detail pages and root gallery/ranking cards offer **Post to
Nostr** alongside the existing detail/player link copy actions. The dialog starts
with the title, a short description, the original linked preview video (or main
image when there is no video), the portable fullscreen `/play` URL, `#nappletsoy`
and the napplet's topics. Missing media is omitted; generated OG cards and media
proxies are not substituted. Named pages share the portable napplet identity.

Buttons above the textarea toggle each generated element. Ordinary edits to an
element are retained when it is removed and restored; restoration appends it.
Replacing several elements at once makes that text wholly user-owned, so toggles
cannot erase the replacement. The complete text can be rewritten, up to 10,000
characters. Removing a hashtag or media URL also removes its associated tags:
lowercase `t` tags are derived from the final prose, and NIP-92 `imeta` is emitted
only while the selected original asset URL is still present. This is an ordinary
standalone kind-1 note, not a comment, repost or new napplet manifest.

Guests can prepare a draft and sign in; posting requires the selected website
account. Only **Post to Nostr** asks its extension, NIP-46 signer or local session
to sign. The signature, author and exact payload are checked by the existing
account manager. Direct publication uses the viewer's configured relays and
requires at least one positive acknowledgement. Failed delivery keeps the exact
signed event for retry, with editing locked until retry is cancelled. A signer
refusal preserves the editable draft. Closing before signing finishes prevents
the late signature from publishing; closing after sending cannot recall a note.
The button contains signing/publishing/error/success feedback; acknowledged notes
show **Posted to Nostr** and close the dialog. Drafts survive closing/reopening on
the same mounted page, not a reload or route change. No public note is posted by
copying a link, opening the composer, or changing a toggle.

Verification: pure draft/media/tag tests, restored-account kind-1 signing and
`tests/services/share-note.test.ts` exercise a real local relay/test signer.
Production deployment and independent-client display remain separate checks.

Napplet detail pages and gallery cards share likes/unlikes and zaps. Detail pages also have comments, replies and author deletion; the gallery comment bubble opens and focuses the detail composer. Likes and commenting require sign-in, while viewing counts and anonymous zapping do not. Connect a NIP-07 signer through Applesauce. Its returned signature, author and complete event payload are verified. Signing happens in the trusted website; napplet iframe signing permissions remain unchanged.

**Detail toolbar (deployed 2026-09-14 in `20260914171728494-21459`):** named, portable and
pinned pages also show like/count, share and zap icons beneath the creator name.
One `NappletSocial` owner supplies the toolbar, feedback and discussion, so header
and discussion likes stay synchronized without fetching a second conversation or
maintaining separate pending events. A failed header action uses its own button for retry (local polish, 2026-09-15);
retry sends the same signed event and requires the same account. A successful like
fills the heart without adding a visible message row. Existing discussion controls
remain available below the player.

Like stays disabled until signed in and conversation data is available. Share and
zap remain available to guests; the zap dialog can resolve the known signed manifest
without waiting for discussion data and retains its anonymous QR/wallet flow. Sharing
reuses the gallery control's portable URL, checkmark, manual-copy fallback and focus
restoration. Existing scope/signature/payment rules are unchanged. Verified through
the local community integration (including both like controls and exact-event retry),
gallery/player regressions and desktop/mobile browser checks; no production actions
or payments were sent.

**Button feedback (deployed, 2026-09-15):** preparing/signing/publishing
spinners replace the initiating icon or label. Failures turn that control into Retry;
error details are available through its title and screen-reader description. A small
cancel control stops retrying and refreshes the conversation. Success uses the filled
heart/count or a “Posted” checkmark, with no extra delivery panel. Comments, replies,
comment likes and deletion use the same behavior. Both detail like controls and all
gallery copies of a card share the action state. If filters remove every copy of a
pending card, a compact retry button remains available until resolved or cancelled.

Uncertain delivery retains the exact signed event and requires the same account for
retry; other writes are locked while it is pending. Acknowledged publication clears
the pending event before refreshing. A failed read instead turns Refresh into Retry
refresh, so it cannot cause a duplicate publication. Direct relay queries have a
3.5-second deadline per relay and publication attempts a six-second deadline;
signer approval remains user-driven. Named-link claims
also keep progress/errors/success in their button; their retry uses fresh NIP-98 HTTP
authorization, not a replayed auth event. The claim itself remains idempotent.

Comments use [NIP-22](https://github.com/nostr-protocol/nips/blob/master/22.md) kind 1111 with address-qualified root and parent tags for named/root napplets (including the current event reference when available). Replies retain the root and reference their parent comment. These address threads survive title changes, aliases and new versions. New standalone snapshots have their own event-rooted threads; even a same-author `a` or `A` ancestry claim cannot borrow a parent's conversation. Only legacy snapshots retain their validated same-author self-address grouping. HTML-looking strings remain escaped text; recognized references receive the presentation described below. See the [manifest migration](NIP5D-MIGRATION.md) for pinned named revisions and gallery pair presentation.

NIP-22 audit, 2026-10-05: writers include `K`/`k`, `P`/`p`, and separate root/parent
references; proposal discussions also use kind 1111. The reader now permits additional
lowercase `p` tags for profile mentions while still requiring the author of the
referenced parent. Previously multiple `p` tags incorrectly hid valid comments and
replies from other clients, along with their comment reactions. This source correction
passes 25 related tests (233 assertions) and TypeScript; it was deployed on
2026-10-06 in `20261006111729495-77355`, with soyLI 0.24.2.
The existing import compatibility accepts an absent uppercase `P` when the root is
unambiguous, rejects a conflicting supplied `P`, and does not omit it when publishing.

### Rich comment presentation — 2026-09-15

Paste a napplet link, `nostr:naddr`, `note` or `nevent` into a comment to offer **Play
here**. Portable `/n/` and `/r/` links work across clients; readable `/@handle/slug`
links resolve only on the site that owns the alias. `/play` links are also recognized.
Profile references link to the profile page. Ordinary links remain links and no
remote website HTML is embedded. These are ordinary signed kind-1111 comments,
readable in clients without this presentation.

Each comment admits up to four distinct media/napplet embeds and 24 recognized
references within 4,000 characters. Known napplet previews load from the local
catalog when visible. Explicit Play admits bounded relay discovery for a missing
reference, then uses the existing verified-artifact sandbox. Unknown references,
blocked creations and unsupported capabilities never create a frame. Stop,
fullscreen and **Back to comments** use the shared player; fullscreen preserves the
session. Starting another napplet or a manual clip stops the previous player across
the shell. Decorative gallery clips cannot interrupt explicit playback. Compact
players stop offscreen; all players stop when the tab is hidden or they unmount.
Threads are not recursively embedded. Likes, replies, zaps and owned deletion retain
their existing signature, permission and receipt rules.

HTTPS PNG/JPEG/GIF/WebP URLs render as lazy images; WebM/MP4 URLs offer **Load video**
followed by native playback controls, without autoplay. Optional NIP-92 `imeta`
can identify extensionless media, alt text and SHA-256, but must match the exact URL
in the signed content. Native browser decoding determines supported image/video formats. There is no
application-server normalization or media byte limit on this direct display path. The stricter
silent, short-WebM publication-preview profile is a separate feature.

Media uses the original HTTPS URLs in verified visible comments. Native images
load lazily; video waits for explicit intent. Membership, signature, deletion and
site moderation are checked in the browser before rendering the comment. Removing
or hiding a comment tears down its embeds; there is no comment-media HTTP proxy.

Verification: parser/cache/thread/moderation tests plus
`bun test tests/services/rich-comments.test.ts`. Browser coverage includes no eager
execution or eager media requests, fullscreen session preservation, main-player
handoff, lazy images, manual video, cleanup, errors, deletion and mobile width.

Likes use [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md) kind 7, with `e`, `p`, `k` and `a` references. Addressed interactions follow the stable kind/author/identifier across releases, even if relays have discarded the older target event. A known conflicting event/address pair is rejected; optional k tags may be absent. Event-only interactions require a verified target. Independent snapshots and comment reactions remain event-scoped. One actor counts once per creation. Unlike and comment deletion use kind 5, applied only to matching events from the same author. Deleting an older like cannot delete a later like. Deleted comments retain a placeholder for replies.

The browser reads and publishes through Applesauce to its configured relays. Finite
queries retrieve comments, reactions, referenced releases, profiles and deletion
markers. Signed events are verified before reduction and retained in bounded
browser memory. Site moderation still controls this client's presentation; the
relays independently enforce publication policy. The UI refresh reads the
protocol again. This is a recent conversation view, not exhaustive history or a
global count. Operator defaults put the managed relay first.

Publication needs a positive relay acknowledgement. If an acknowledgement is lost, Retry sends the same signed event ID; it does not sign another comment. Counts change after acknowledgement. Signer cancellation leaves the draft intact. A successful publication is distinct from a later refresh failure. Names and events survive web process restarts when their configured state directory is preserved.

## Zaps

[NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) zaps use the author's latest verified kind-0 `lud16` or `lud06` profile. LNURL endpoints and callbacks are fetched directly in the browser with bounded responses, public URL validation and no redirects. Providers must support browser CORS. Profiles and payment endpoint metadata remain separate from aliases.

The creator's Lightning service must advertise `allowsNostr`, a receipt-signing pubkey and valid amount limits. The user chooses sats and signs kind 9734 with their connected account, or with a fresh browser-memory key for an anonymous zap. Anonymous mode is automatic while signed out and optional while signed in; it never invokes the profile signer or persists the temporary key. Only the signed request is sent to the Lightning provider. This hides the Nostr profile association, not network/payment metadata from the wallet service. That request goes to the LNURL callback, not to a Nostr relay. Before showing the invoice, the browser checks its BOLT-11 checksum and signature, exact millisatoshi amount and expiry. When a description hash is present, it must match the serialized signed request sent to the callback. The wallet remains responsible for Lightning feature negotiation, route selection and fees.

The invoice offers a locally generated QR code, `lightning:` wallet link and copy control. QR encoding loads lazily in the browser, without a third-party image endpoint. When WebLN is available, **Pay with browser wallet** explicitly enables the wallet and requests payment; invoice creation never pays automatically. The public total uses kind-9735 receipts verified against the advertised provider, signed request, recipient, target, invoice amount and description; an optional preimage must match the payment hash. Event IDs and payment hashes are deduplicated. A receipt remains the Lightning provider's assertion. Changing providers may make older receipts unverifiable from the current profile.

Source update 2026-10-12 (not yet deployed): payment tracking belongs to the
invoice, not the dialog. It continues when the dialog closes while its napplet or
comment remains mounted, resumes on return to the page and after reload, and
checks immediately when the browser regains focus or the user chooses **Check payment**.
The shared tracker checks the provider's optional
[LUD-21 verification URL](https://github.com/lnurl/luds/blob/luds/21.md) and queries
the invoice's relays for a matching receipt. It queries the prepared event ID and,
for addressable napplets, the stable address; validation still requires the exact
signed request ID and payment hash. Multiple controls for one target share polling. Provider confirmation must name the
exact invoice, report `settled: true`, and have a matching preimage if supplied.
A WebLN preimage matching the invoice's payment hash also confirms immediately;
a wallet response without that proof waits for provider/relay confirmation.
Receipt confirmation must match both the payment hash and signed request ID.
On confirmation the dialog shows **Zap sent!**, updates counts and sats across
gallery copies, detail controls and the relevant comment, then closes after 1.2
seconds. Polling stops on success or when the last control for the target unmounts;
pending checks resume when that target is viewed again. Hidden pages pause checks.
Expired invoices offer a new-invoice action; slower checks can still recognize a
late provider confirmation for 24 hours after expiry. Unpaid invoices never show
success. Failed checks produce a confirmation-unavailable message instead of a
silent wait. Providers without a status URL are identified as receipt-only; the
wallet may have paid even while the provider has not supplied a detectable proof.

Confirmed local payments bridge relay delivery lag in the existing bounded memory
cache (256 targets, 2,000 payment hashes per target). Up to 128 checked local
confirmations (up to 65,536 JSON characters) are remembered in browser storage for
30 days, using only target,
payment hash, amount and confirmation time. Public relay reads are not persisted
by this cache. Up to 32 pending invoice reminders are retained, with a 524,288
JSON-character budget, until 24 hours after their expiry. Expired records are
discarded when storage is loaded or updated. These reminders include the
invoice, public signed request/target, provider and relay metadata, and optional
verification URL. A verification URL can expose that invoice's status to someone
with access to it. No anonymous signing key, wallet key or payment preimage is saved.
Saved reminders are checked for signatures, target/amount/hash binding, public URLs
and retention bounds before being used. Blocked or full browser storage does not
prevent payment; invoice preparation reports when recovery cannot be saved.

Relay receipts merge by payment hash, so a local confirmation and its eventual
receipt count once and a stale read cannot undo the update. These records are local
to this browser and are never published as fabricated receipts or uploaded to the
site. Other visitors still need the provider's public receipt. Verification uses
direct provider/relay access with the existing public URL, size, timeout and
redirect policy; there is no new site payment API. Invoices lost before this
recovery support cannot be reconstructed from the napplet URL alone.

For interoperability with providers such as Minibits, plain-description invoices
are accepted automatically, including empty descriptions. This is an intentional
compatibility exception to NIP-57's required `h` field: the client trusts the
creator's advertised HTTPS callback to associate the returned invoice with the
request. Receipts for these invoices are accepted only when signed by the
advertised provider, with a valid signed request and matching recipient, target
and amount. Optional payment preimages are still checked and payment hashes are
deduplicated. The provider's signed receipt supplies the association that the
invoice's description hash normally supplies. A payable invoice alone never adds
to the zap count; a payment confirmation or receipt is required. This applies to all providers,
napplet and comment zaps, and signed-in and anonymous senders.

Compatibility never ignores an incorrect description hash when one is present.
If invoice validation fails, the dialog identifies the callback provider and
distinguishes a wrong amount, expired invoice and mismatched hash. Plain-description
invoices use the same QR, wallet-link and explicit WebLN payment flow without an
extra confirmation dialog; invoice creation itself does not pay.

Current limits: mainnet amount-bearing BOLT-11 invoices, NIP-07 account signing or ephemeral anonymous signing, recent relay history, and whole-satoshi invoice creation capped at 1,000,000 sats. No wallet custody, NWC pairing, automatic payment or real payment was performed during implementation. Split-recipient `zap` tags are detected and explicitly referred to a split-aware client; this UI does not silently pay the author instead. A missing Lightning profile does not prevent comments, likes, or playback. Local-only development does not create zaps without public WSS relay hints.

Validation: `bun run check`; `bun run build && bun test tests/services/community.test.ts tests/services/zap-confirmation.test.ts tests/services/remix-cli.test.ts`. The latter uses temporary loopback services, the documented public fixture key, a temporary CLI executable, and a simulated wallet. No public events or Lightning payments are sent by these tests.

Plain-description compatibility is covered by `bun test packages/community packages/client`
and the production-browser tests `tests/services/community.test.ts` and
`tests/services/gallery-social.test.ts`: invoices with and without hashes, signed-in
and anonymous wallet flows, provider-signed receipts, duplicates and rejected
amount/signature/hash/target mismatches. No test sends a real payment.

## Remixing without an installed CLI

The **Remix this** dialog offers both the existing-CLI command and an install-and-remix command:

```sh
curl -fsSL https://napplet.soy/install.sh | sh -s -- remix 'https://napplet.soy/r/REVISION_ID' my-remix
```

Both select the exact revision and preserve remix attribution. The installer forwards
arguments to the verified native CLI; creators do not need Bun or Node installed.

## Reactions to comments

Each visible NIP-22 comment can receive a NIP-25 like and a NIP-57 zap. Reactions target
the comment's event ID, kind 1111 and author. They do not inherit the napplet address or
its author as payment recipient. Likes count unique authors; creators can undo their
own reactions. Deleted comments have no reaction actions. Comment zap invoices and
receipts use the commenter's verified Lightning profile and the same invoice checks
as napplet zaps. Payment still requires an explicit wallet action.

## Gallery and Featured

Ordinary soyLI publication updates one stable listing. Additional immutable
snapshots are explicit (`publish --snapshot`). The gallery groups verified exact
publication pairs, including retained old revisions, and historical snapshots
whose own release-specific signed descriptor unambiguously points to their
same author's live newer listing. Missing or invalid evidence leaves a snapshot
independent. Grouping is display only: direct snapshot links, independent social
threads and storage remain separate. An old named revision opened through `/r/`
does not become another current gallery card.

The homepage reads the standard relay/index collection. **Newest** sorts by the
first signed publication observed for each identity; **Recently updated** sorts by
the latest manifest timestamp. The persistent index recovers original dates from
retained old revisions and same-author legacy snapshots, and keeps them across
updates/restarts. Independent snapshot ancestry never changes a parent's date.
When no history survives, the current timestamp is the fallback; these are not
claims of a globally complete publication history. Tag/search/capability/sort
controls apply to the general list, below the independent social ranking rails. Bundled
examples are no longer prepended as a special collection. The dev seed process still
publishes them to the local services, where discovery treats them like any other napplet.
Legacy direct example links remain available for compatibility.

**Featured** is an explicit gallery selection managed at `/admin`. It is empty by default,
including for existing policy files. Feature a napplet naddr to follow its releases, or
an event ID to select a revision. These actions require the existing administrator's
signed requests, revision checks and replay protection. Selections are stored alongside
moderation state and audited, never added to the creator's signed manifest. Featuring
content does not unblock it or import content that discovery has not indexed.

The **2026-09-15 deployed revision** adds an ordered hero rotation beside the landing
headline. Admin up/down controls determine priority. The first twelve available,
unblocked selections appear; addresses resolve current releases, event IDs link
to their exact `/r/<id>` revision. Duplicate revisions are shown once. Missing
selections are skipped without deleting their saved policy, and an empty result
retains the original hero artwork. Gallery filters and pagination do not narrow
the editorial hero. The collection refreshes every thirty seconds in a visible tab
and on focus; blocking remains enforced again when opening/playing content.

A single preview rotates every seven seconds. Hover/focus, manual movement, hidden
tabs, offscreen placement and reduced motion stop automatic rotation. Manual arrows
and pause/resume remain available. No napplet executes until the normal player flow.
The terminal remains first on mobile with Featured below it. These features are
verified and deployed in `20260915084016730-23084`, and remain separate from paid placement.

Local slider revision: featured previews and their captions now move together in a
horizontal scroll-snap track. Touch/trackpad swipes, arrow buttons and left/right
keys on the focused track select a slide. Manual interaction pauses rotation;
automatic/button changes slide smoothly unless reduced motion is requested.
Offscreen slides are inert so their links do not enter the keyboard focus order.
The selected slide stays aligned after resize or refreshed curation. The browser
regression test `tests/services/featured-slider.test.ts` covers automatic rotation,
animated movement, keyboard wrapping, reduced motion, resize and an actual touch
gesture without accidental navigation. Implemented and verified locally, not deployed.

## Gallery social discovery

Card titles still open the detail page. The adjacent expand icon is a separate,
44px fullscreen link to the portable `/n/<naddr>/play` or `/r/<event-id>/play` route,
including cards reused in social carousels. It opens the immersive player view;
browser-native fullscreen remains subject to the browser's user-gesture controls.
Both address and revision links are covered by the featured-slider browser test.
This revision is verified locally, not deployed.

Every normal gallery card shows unique-author likes, visible comments/replies, verified
zap receipt count, and sats received. Unknown/unavailable counts use a dash rather than
zero. The comment bubble is disabled while signed out; signed-in navigation opens the
canonical portable detail route with `#comments` and focuses the composer after data
loads. A direct logged-out hash link focuses the sign-in control, retaining the focus
intent after connecting. Comment likes and replies follow the same sign-in rule.

Gallery and ranking cards also offer an icon-only **Share** control (verified and
deployed on 2026-09-14 in `20260914171728494-21459`). It copies this site's portable
`/n/<naddr>` detail URL, or `/r/<event-id>` for an entry without an address. Sharing
does not require signing in or depend on social counts, and does not navigate or
start playback. Success briefly changes the icon to a checkmark with a screen-reader
announcement. If clipboard access is blocked, a dialog provides a selected, read-only
URL for manual copying; closing it restores focus to the share button. Example cards
use the same control. Local browser checks cover these paths and mobile card/rail fit.

Most liked, Most zapped and Most commented are scroll-snap carousels with manual arrows,
keyboard/touch scrolling and reduced-motion handling. They rank the full matching
relay-discovered collection, independently of the grid's current page, and obey the same
search/tag, availability, Featured and moderation filters. Zero/unknown entries are
excluded; ties use newest manifest then event ID. Most zapped ranks by total millisats,
not number of invoices or receipt events. All card copies coordinate one active player.

The social carousels sit on a sage background. The normal grid begins on a cream
background with a dark **All napplets** tab, mirroring the playground entrance.
Its heading becomes **Matching napplets** for a search/tag query or **Featured
napplets** for the unfiltered Featured view, and shows the matching count. The grid,
pagination and empty results belong to this named section. This presentation change
is verified locally at 320–1920px; it has not been deployed.

The browser queries counts directly over Nostr, processing up to 64 napplets per
sweep. Compatible relay sets share batches of up to 32 napplets, with at most three
concurrent readers. Publication relay hints retain the same per-query bounds;
batches split when combining hints would discard a publication's relay choices.
Verified events update counts and rankings as they arrive, coalesced over 40ms,
without waiting for slow relays to finish. Cached counts appear immediately on
returning to the gallery or changing filters/accounts in the same browser session;
the current viewer's liked state is recomputed. A reload still starts a fresh read.

Gallery summaries fetch referenced releases/reply parents and author deletions in
a shared follow-up query. They omit comment-reaction and general profile hydration,
which remain part of opening a conversation. Partial counts can change as those
dependencies or slower relays arrive. Each main filter is limited to 500 events;
the existing transport also caps each query at 1,000 distinct events. The client
refreshes every thirty seconds (five while filling the cache), pauses while hidden
and refreshes after acknowledged actions. The bounded cache and queries describe
the discovered matching collection; these are not global exhaustive totals. No
gallery or social REST endpoint participates.

Zap receipts use the same validator as details, including provider signatures,
invoice description/amount and payment-hash deduplication. LNURL JSON and invoices
come directly from the author's provider, which must allow browser CORS. Anonymous
receipts follow the same checks. Invoice creation and WebLN success never increment
a verified total. Threads without receipts skip Lightning-provider lookups entirely;
receipt verification updates the zap rail independently of likes and comments.
Provider lookups share a bounded, one-minute cache keyed by author and profile
revision. Unverifiable receipts leave totals unknown. See
[direct protocol access](PROTOCOL-ACCESS.md).

Gallery signing verifies the selected identity and payload, keeps a failed signed
like for an exact-event retry, and gates retry on the matching account. Counts and
carousels never sign automatically. Browsers may still inspect existing conversations
through ordinary detail links while signed out.

Verification: `bun test packages/community/src`; `bun run build` followed by
`bun test tests/services/community.test.ts tests/services/gallery-social.test.ts`.
These use temporary databases/local relay events and simulated invoices/wallets;
no production Nostr events or Lightning payments are sent.

The progressive aggregation update is verified locally and not yet deployed.
`bun test packages/client/src/gallery-social.test.ts` covers batching a 48-napplet
collection, release references, deletions, moderation, account changes, cancellation
and delayed provider verification. After building, run
`bun test tests/services/gallery-social-latency.test.ts` for the production-browser
regression with one fast relay and one stalled fallback. In that fixture, six
napplets' rankings changed from 21.5 seconds to approximately 85ms after the fast
relay delivered events. This measures rendering latency after event delivery,
not a guarantee about public relay or Lightning-provider response times.
