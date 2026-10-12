# Direct protocol access

The interactive website is a Nostr client. Browser navigation resolves signed
napplet manifests, app descriptors, profiles, comments, reactions, deletions and
zap receipts through Applesauce WebSocket relay queries. Social actions and
profile updates are signed by the selected account and published directly to
relays; retries retain the same signed event.

**Network settings** in the footer opens `/network`. Relay and fallback Blossom
URLs are saved in this browser. Public HTTPS/WSS infrastructure may use custom
ports; plaintext access is limited to explicitly configured loopback development
services. Operator defaults come from the server's relay
configuration. Manifest `server` tags and valid runtime relay hints remain useful
across clients; they do not require registration in Napplet's index.

## Files and playback

Direct manifest screenshots and clips under `soy.presentation/1` use verified
media: indexed previews come from the site's bounded cache; browser-only discoveries
verify downloaded bytes before creating a Blob URL. The manifest supplies the
expected hash and MIME. Missing optional media falls back without blocking playback.
See [the presentation contract](PREVIEWS.md).

Legacy descriptor images/videos, avatars, banners and comment attachments can
still use their published URLs. Linked assets show the destination hostname and
open the original file. A valid signed legacy app descriptor can supply media even
when the optional server image cache could not normalize or download it. That
native URL display does not verify the original file's digest on every view.

Executable HTML is fetched directly from Blossom and checked against the signed
manifest's SHA-256 hash before constructing an opaque, restricted iframe. The
iframe cannot access host storage, cookies, signers or the network itself. The
shared host mediates resource and relay requests locally in the browser, retaining
message correlation, quotas, cancellation and account/session isolation. Hash
addressed resource bytes are verified in the host. HTTPS resource bytes use a
bounded browser fetch; native audio uses the original HTTPS stream URL with the
existing gesture controls and teardown.

The source browser and README excerpt fetch the signed source archive URL and
verify its hash before parsing the bounded tar archive in browser memory. File
downloads use those verified bytes. Archive links go straight to storage. No
server extracts a source archive on behalf of an interactive request.

Storage and LNURL providers must support browser requests (CORS) for direct byte
reads and invoice JSON. There is no arbitrary proxy fallback; indexed preview
routes serve already verified cached media. Native image, video and audio URL
display follows the browser's normal media rules. Direct provider requests can be
observed by those providers.

## HTTP that remains

Site-owned HTTP routes remain for administration, previews and publication
receipts. The manifest migration also adds an optional, bounded signed-event
accelerator for pinned revisions that relays may have replaced:

| Route                    | Purpose                                                                                                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/admin-access`      | Determine access to this site's administration UI.                                                                                                                                                                                   |
| `/api/admin`             | Signed site moderation, admin membership and featured selections.                                                                                                                                                                    |
| `/api/names`             | Claim and query this site's readable aliases; portable naddrs do not depend on them.                                                                                                                                                 |
| `/api/health`            | Deployment and local service health.                                                                                                                                                                                                 |
| `/api/og/:id`            | Generate this site's share image, including fallback artwork.                                                                                                                                                                        |
| `/api/profile-og`        | Generate this site's profile share image.                                                                                                                                                                                            |
| `/api/publications`      | Optional confirmation that this site's index has observed a publication. Publishing to Nostr is already acknowledged separately.                                                                                                     |
| `/api/manifest`          | Read-only signed manifest lookup from retained index/fixture state. The browser uses it only as a fallback for an exact pinned event ID, then checks the signature, manifest contract and requested ID.                              |
| `/api/lifecycle-history` | Optional bounded inventory of signed named/root revisions and exact paired snapshots retained by this index. The author reviews their independently verified IDs before signing deletion requests; the response grants no authority. |

The older general protocol-proxy routes for artifact, resource, relay-read,
audio, social, gallery-social, genealogy, profile, profile-image, profiles,
source, comment-media, preview video and zap operations remain removed. The
manifest endpoint is an explicit archival fallback, not an executable-byte proxy
or a reason to trust an unsigned response. It does not initiate relay work.

TanStack loaders retain server implementations for HTML rendering and link-preview
crawlers. Their browser implementations query protocols directly instead of
calling corresponding server functions. SSR-only protocol loaders are not exported
as callable HTTP server functions. Site policy/defaults, readable alias
mappings (including historical starter aliases) and About repository links are
site-owned loader exceptions. Starter manifests also resolve over Nostr. Featured records are resolved from the site's
selection over Nostr in the browser.

SSR and generated OG images may use the server index and normalized image cache.
They are conveniences for fast first responses and crawlers; the browser can
resolve an unindexed portable link through its own configured relays. The
browser independently applies its policy and signed deletion checks to a pinned
event recovered from the index. Server
network fetches continue using the existing DNS-safe admission rules. Site
moderation is projected to the browser independently of data transport.

## soyLI

The shared preview host uses the same direct audio, relay and resource transports.
Its local server still serves editable build files and performs explicit local
capture/recording actions: those are filesystem operations, not protocol proxies.
Remix resolves the selected event over Nostr and downloads declared Blossom files
directly. The optional website-index confirmation and readable-name claim are
site-specific conveniences. Existing compiled binaries keep their bundled host
until a new CLI release is built and installed.

## Verification

The repository checks signature/target validation, bounded source parsing,
artifact integrity, direct relay reads through a real WebSocket fixture, remix
archive downloads, and audio lifetime/gesture behavior. Browser coverage uses an
independent relay and actual Blossom service while refusing removed protocol API
paths; it checks comments, profiles, playback, README/source browsing, original
asset links, advancing native video playback, mobile layout and SSR.

At this source checkpoint, type checking, 256 repository tests, the production
build, five direct-asset/browser tests and eight production-server integration
flows pass. Separate shared-preview media/deadline and compiled-remix checks also
pass. Fixtures publish only to isolated local relays; no test payments are sent.
Deployed as website release `20260915191931258-56634` with soyLI 0.9.0.
See [deployment verification](DEPLOYMENT.md#direct-protocol-access-and-soyli-090--2026-09-15)
for live checks and the radio provider's headless-user-agent restriction.

Browser relay connections are shared between concurrent reads and publishing,
reused briefly, and closed after ten seconds idle (at most 24 destinations).
The verified-event store retains at most 8,000 events/16 MiB; conversation and
source caches are also bounded. First-load hydration initializes operator policy
before any child query, then refreshes server-rendered data over the protocols.

## Relay read audit — 2026-10-05 source

The browser uses one verified Applesauce `EventStore`, reused `RelayPool`
connections and scoped RxJS subscriptions. UI reads may render cached and arriving
events while relay refresh continues. An exact event ID has one signed value;
replaceable addresses and mutation prerequisites have different completion rules.
This update is implemented locally and is not a deployment statement.

| Path                                     | Read behavior and limits                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Proposals and repository announcements   | Cached/store timelines render as verified events arrive. New repository winners replace the projection; related revisions, status and comments load in groups of 32 without waiting for the root query deadline. Unmount/refresh cancels subscriptions; at most 100 roots and 2,000 related events. Status and revision authority still use the NIP-34 reducers. |
| Pinned proposal/source manifests         | Exact-ID lookup uses verified cached bytes or the first matching verified event. An empty relay EOSE cannot hide a later match. Source admission still checks manifest validity, moderation, expiration and owner-authored deletions.                                                                                                                            |
| README, source files and downloads       | Identical deletion reads share an in-flight query and a 15-second result, bounded to 512 keys. Every admission merges newly observed signed deletion requests and checks local policy again. Source archive/hash/tar checks remain mandatory; cached files never bypass admission.                                                                               |
| Creator names and avatars                | A batch of up to 32 authors subscribes to the verified profile timeline before starting its relay read. Names/images appear progressively; newer winners supersede earlier ones. Invalid or moderated current profiles never revive an older name.                                                                                                               |
| Featured selections                      | Up to 12 operator selections resolve with four concurrent workers, preserving their display order.                                                                                                                                                                                                                                                               |
| Catalog enrichment                       | Author-deletion and descriptor groups run four batches at a time. Legacy empty-content app descriptors and their kind-0 fallback profiles share a query phase. Current manifest/metadata winner selection still collects relay candidates through the bounded deadline.                                                                                          |
| Genealogy                                | Pinned ancestors reuse exact-ID lookup and source visibility checks. Address-only parents retain current-winner resolution. The 12-generation/cycle/identity limits remain unchanged.                                                                                                                                                                            |
| Social and payment reads                 | Conversation/gallery reducers stream scoped events. Likes use viewer-specific reads; LNURL setup uses available verified profiles. Receipt/payment confirmation still requires its existing proof checks; a timeout or relay ACK is not payment confirmation.                                                                                                    |
| Runtime NAP reads and server indexing    | Playback already streams verified events through scoped Applesauce subscriptions with cancellation/quotas. Finite server indexing deliberately collects candidates before choosing replaceable winners.                                                                                                                                                          |
| CLI review, merge, lifecycle and editing | Existing bounded final reads and any explicit complete-view checks remain separate from browser display projections. No first-response UI snapshot grants merge, deletion, signing or publication authority.                                                                                                                                                     |

Applesauce consumes kind-5 events into its deletion manager rather than retaining
them in ordinary timelines. `ProtocolClient.cached()` therefore merges a bounded
cache of verified signed deletion requests with store results, under the same
8,000-event/16-MiB retention budget. This preserves timestamp/author evidence for
our reducers. Use it for cached deletion reads instead of assuming kind 5 remains
in `store.getByFilters()`.

The detail page keys its conversation by signed identity, not the relay hints in
an encoded address. Hydration can update those hints without remounting proposals,
restarting social reads or clearing a comment draft. A different signed release
still retires pending social work. Empty proposal refreshes complete their loading
state after the bounded reads finish.

Regression fixtures combine a responsive relay with a silent fallback. They cover
progressive proposal/status/profile rendering, source navigation, exact-ID lookup
past an empty EOSE, observable sharing/cancellation, owner-versus-foreign deletion
requests, descriptor/profile batching and drafts surviving relay-hint hydration.
The first uncached source visibility
read can still take the relay deadline (3.5 seconds); this update removes repeated
waits, not Nostr's incomplete-view or third-party availability limits.
