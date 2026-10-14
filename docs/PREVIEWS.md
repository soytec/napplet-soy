# Napplet previews

## Direct manifest presentation — 2026-10-06 source

Reconciled with main on 2026-10-13; released as soyLI **0.28.0** on 2026-10-14,
after compatible napplet.soy readers were deployed and verified.
[SPEC D1](../SPEC.md#d1--metadata-belongs-on-the-napplet-manifest) records the
no-companion decision. The profile below is an implemented Soy convention, not
a settlement of the remaining upstream/media/source/rollout questions.

Fresh soyLI publications attach presentation files directly to the signed
current manifest and an explicitly requested `--snapshot` copy. No new kind-32267
Zapstore descriptor, `app` reference or descriptor `imeta` is generated. Capture and local `preview.image` /
`preview.video` configuration remain unchanged.

This is the optional downstream **`soy.presentation/1`** convention, pending upstream
agreement. The selected [NIP-5D revision](PROTOCOL.md) defines icons but no screenshot
or video tags. [napplet/web PR 111](https://github.com/napplet/web/pull/111), reviewed
at `6dd79febfa9807d5d3f51cabd77b793f5893d4b7`, uses the older path/aggregate shape
and does not define standalone presentation tags. This convention does not claim
to implement a new upstream standard or change the authoritative pin.

```json
[
  ["presentation", "soy.presentation/1"],
  ["screenshot", "<file-sha256>", "image/png"],
  ["preview", "<file-sha256>", "video/webm"],
  ["server", "https://blossom.example"]
]
```

Require exactly one profile marker, up to four screenshot claims and at most one
preview claim. Each media tag has exactly three elements: type, lowercase SHA-256
and MIME. Screenshots support PNG/JPEG/WebP; the clip uses the bounded silent VP8
WebM profile below. The publisher currently captures one PNG and an optional clip.
Readers try declared screenshots in order, then legacy descriptor covers, then the
standard icon and generated art. Direct video takes precedence over legacy video.

Fetch `/<hash>` only from declared origin-only Blossom `server` tags. Check SHA-256,
declared MIME and actual image format or video container before rendering. Indexed
images use the normalized verified PNG at `/api/previews/<manifest-event-id>`;
indexed clips use `/api/previews/<manifest-event-id>/video` with byte-range support.
Browser-only discoveries verify bytes before decoding a Blob URL. Additional files
remain explicit links; unverified direct screenshots are not embedded as thumbnails.
Public HTTPS/network policy, redirect refusal, moderation and existing byte/dimension
budgets still apply. A cache is optional and grants no publishing authority.

The profile applies to any signed named, root or snapshot manifest, regardless of
publisher or CLI. Invalid, ambiguous, excessive or unavailable optional claims are
ignored without changing executable identity, capabilities, description or playback.
Sharing, the files list and deletion inventory read the same signed associations.
Shared blobs remain protected by the ordinary lifecycle inventory checks.

Old `app`/descriptor publications remain readable. Interrupted old jobs resume
their original frozen bytes, descriptor and signatures, even after an upgrade.
The next ordinary publish of a completed older job produces direct references,
including when the playable HTML is unchanged. Installing an update does not
rewrite historical events or automatically republish anything. Deploy compatible
readers before releasing the updated publisher. Independent-client rendering and
upstream agreement remain pending; source verification is separate from deployment.

The merged PR #14 passed signed publisher/lifecycle regressions, real local
relay/Blossom/GRASP publication and desktop/mobile legacy/direct-media checks.
Live legacy playback, cached cover and byte-range clip routes passed before the
CLI release. See [release and deployment evidence](CLI-RELEASES.md). Upstream
agreement and independent-client rendering remain separate acceptance steps.

## Standalone manifest icons — 2026-10-04 source

A new-format manifest can advertise `icon` as `["icon", "<sha256>", "image/png"]` (also JPEG/WebP). Icons are optional and do not alter artifact identity. The host downloads only by hash from declared Blossom origins, checks SHA-256, verifies the actual supported file format and decodes it before rendering verified bytes. Browser rendering uses a Blob URL; the index serves its verified normalized PNG. A local 5 MiB / 16 megapixel budget bounds icons. Malformed, missing, unsupported or corrupt icons fall back without blocking playback. Existing screenshots take precedence as covers; a valid icon is a fallback before generated artwork.

The pinned PR 7 has no screenshot-tag schema despite the announcement's mention.
Direct presentation now uses the explicit downstream convention above; existing
linked app descriptors remain optional legacy inputs. Neither is necessary to list
or run a standard manifest.

Release `20260915084016730-23084` (2026-09-15) includes the short-video presentation
and serves soyLI 0.7.0 with recording support. All four CLI downloads were uploaded
before installer activation. See the [release evidence](DEPLOYMENT.md#rich-comments-and-soyli-070-release--2026-09-15).

The browser reads direct presentation claims from the verified manifest. Legacy
`app` references are resolved through Applesauce. Server indexing may cache images
and clips for presentation and SSR/OG; that cache is optional. No catalog executes
downloaded napplets to generate previews. See [direct protocol access](PROTOCOL-ACCESS.md).

## Workshop capture — soyLI 0.13.0

Run `soyli dev`, open Listing and enable **Play in a capture window first**.
Capture screenshot / Record clip opens a fresh interactive Chromium window showing
the frozen current build. Play, then choose **Capture this moment** or **Record the
next N seconds**. Closing the window cancels; an idle session expires after five
minutes. The host controls are excluded. Interactive recording starts immediately
and ignores scripted actions/start-delay; the selected 2–8 second duration applies.

The cached browser/encoder is installed automatically. Interactive capture requires
a graphical desktop (a headless SSH server can still run scripted captures). Saving
checks that project source did not change during capture and preserves earlier
files. Clips get a small hash/build sidecar for later selection without falsifying
their build association. Do not manually edit that provenance to bypass stale checks.
The manager shows earlier root `preview*.png/webm` and `presentation*.png/webm`
captures, supports playback and cover/clip selection, and edits project metadata.

Choose a moment that shows the core interaction, rather than automatically accepting
a splash screen. Review the saved frame and clip for meaningful action, legibility,
cropping and errors. Agent recipes remain useful for reproducible captures.
The manager does not record the existing Play tab or export GIFs.

## Legacy linked metadata

The retained optional presentation extension uses [NIP-5A's app descriptor reference](https://github.com/nostr-protocol/nips/blob/master/5A.md#upstream-app-descriptors). New NIP-5D does not require this extension:

```json
["app", "31990:<descriptor-author-hex>:<identifier>", "wss://relay.example"]
```

- [NIP-89, kind 31990](https://github.com/nostr-protocol/nips/blob/master/89.md#handler-information): read `picture` from the descriptor's JSON content. When content is exactly empty, resolve the descriptor author's latest kind-0 profile and use its `picture`. Missing pictures, malformed JSON, and nonempty content without a picture do not trigger the profile fallback.
- [Zapstore software application metadata, kind 32267](https://github.com/zapstore/zsp#nostr-events): try `image` screenshot tags in order, then `icon` tags. This is the existing Zapstore format, not a claim that NIP-82 is an adopted NIP. Both descriptor kinds can be referenced with `app`.

Across linked descriptors, screenshots take priority over application pictures, then icons; declaration order breaks ties. Unknown descriptor kinds are ignored. A napplet may reference a descriptor signed by a different author: the signed manifest must point to that exact kind/pubkey/identifier. Unrelated descriptors, forged signatures, ambiguous identifiers, and future-dated events are rejected. Select the newest signed event by Nostr ordering before interpreting its content; a newer descriptor that removes its image must not resurrect an old screenshot. Direct manifest presentation takes cover precedence; neither scheme is required for playback.

Preview metadata cannot override the manifest's title, identity, paths, artifact hash, or required capabilities. Missing or unusable previews leave the same napplet in the catalog with the generated poster. A descriptor is addressable, so even a pinned playable snapshot can receive updated presentation metadata on a later refresh; its executable bytes remain pinned.

## Optional server indexing and OG cache

Descriptor queries use the configured discovery relays plus valid public WSS relay hints, capped at twelve destinations. Queries are exact author/kind/identifier filters, with a separate profile lookup only for the NIP-89 fallback. There is no publication, signing, AUTH response, or recursive descriptor traversal.

The metadata transport runs in a short-lived Node worker using Applesauce and pinned `ws` 8.21.3. Bun's native `ws` replacement ignores the required DNS/payload hooks, and loading the Node implementation inside Bun encountered an HTTP upgrade incompatibility during a live relay check. The worker preserves those controls, returns bounded signed events, and exits. Node is already needed by local PM2; linked descriptor lookup requires Node 20.19+ because of the pinned Nostr crypto dependencies. The live worker was tested with Node 24.14.0. No worker is launched when the catalog contains no supported `app` links. The worker bundle is temporary and is removed after each job.

Images must use public HTTPS on the default TLS port. DNS is checked in the actual connection lookup for both relay and image connections. Private/special addresses, credentials, redirects, inline data URLs, and active SVG/HTML documents are refused. Downloads forward no viewer cookies or authorization headers. Hash-shaped Blossom URLs are checked against the downloaded bytes; ordinary HTTPS URLs provide a signed URL association, not a creator-signed image digest.

PNG, JPEG, WebP, and GIF input is decoded using pinned Sharp 0.35.4. Take the first frame, apply orientation, strip metadata, and resize within 1200 × 750 while preserving aspect ratio. Cache only the resulting raster PNG. Input is limited to 5 MiB and 16 million pixels; normalized output is capped at 4 MiB. There are three concurrent image jobs and a 50 MiB download budget per refresh. Metadata/image enrichment has a shared 20-second deadline. Expensive or unavailable previews fall back without changing executable availability.

Catalog refresh has the existing fifteen-minute TTL. Cached verified images at content-addressed URLs can be reused; ordinary mutable HTTPS URLs are fetched again on refresh. Cache profile `manifest-presentation-and-legacy-descriptors-4` triggers enrichment for an older catalog. Current and previous refresh images are retained; older PNGs are pruned after the new catalog is committed. Signed manifest/descriptor bindings, cached byte hashes, and PNG dimensions are checked when reading images. Corrupt or missing files yield the generated card. OG ETags include the rendered bytes; share metadata includes the selected image hash.

### Website share cards — 2026-09-21 source update

The root, About, Create, Docs, connections, creator collections and proposal routes
include server-rendered Open Graph and Twitter large-image metadata. `/cli` keeps
redirecting to `/create`. The shared `/api/og/site?v=4` PNG shows Soybert and the
outlined Fredoka **napplet.soy** wordmark. A root fallback also covers pages without
their own image; existing profile and napplet metadata override it without duplicate
image tags. Canonical origins come from `SPACE_SITE_ORIGIN`, never request headers.

Napplet cards remain at `/api/og/<event-id>?v=4` and are 1200 × 630 PNGs. The
724 × 482 preview area preserves the full image's aspect ratio, with a Soybert
header and title, description excerpt, topics and creator alongside. Titles scale
and wrap using the bundled font metrics; long text is truncated with an ellipsis.
Missing or unusable cached covers get branded fallback art. All publishers use the
same renderer and metadata rules. Profile cards share the typography and branding.

OG is a server composition for crawlers, not a replacement for direct Blossom
image/video links in the browser. Rendering never downloads a URL or executes a
napplet: covers still come only from the admitted, normalized cache. Visibility
and moderation are checked before serving cached napplet images. GET, HEAD and
ETag validation remain supported; the version changes shared image URLs so new
scrapes request the redesign. Existing social-platform caches can still take time
to refresh after deployment.

Production uses shipped DM Sans/Fredoka fonts and the existing mascot, independent
of system fonts or the server working directory. `scripts/og-fonts.py` regenerates
the static bold fonts and wrapping metrics from the pinned Fontsource packages
using Python FontTools; neither Python nor FontTools is needed at runtime. SIL OFL
licenses are retained in `packages/backend/assets/`.

Verified locally with the production build: 17 page routes expose one absolute
image without JavaScript, and site/profile/napplet PNG responses pass dimensions,
HEAD and applicable ETag checks. Existing image-admission and moderation tests
remain in place. This source update is not yet deployed.

## Running and verification

```sh
bun run dev publicdev --refresh
# Or the production build behind local Caddy/PM2:
PORT=3020 bun run dev:prod publicdev --refresh
```

The latest public relay refresh found 93 manifests and no `app` references, so those entries still display generated cards. This does not establish that every public napplet lacks metadata. There are no invented previews or synthetic events inserted into the normal public catalog.

Signed offline fixtures verify descriptor selection, profile fallback, corrupt metadata and images, wrong hashes, unsafe URLs, image limits, cache reuse, generated fallback, and unchanged playback. An isolated browser-test catalog demonstrates the image in the gallery, player, and SSR OG metadata, verifies actual playback, and checks that the browser requests the original image URL. The metadata transport was also checked against a live NIP-89 descriptor on `relay.primal.net`; that descriptor is not added to the gallery.

```sh
bun run check
bun run build
bunx playwright test tests/browser/previews.spec.ts
```

Validation: 57 unit/integration tests, type checking, production build/startup, and five Chromium preview/public/runtime checks passed. The optional 78 MiB packaged-loader test was not repeated in this pass. No VPS deployment was performed.

The browser fixture is local test data with a public test key. It must never be
published. Historical fixtures retain `app` conventions; fresh publication uses
the direct profile above.

## Creator capture and publication (2026-09-14)

The CLI checks the built HTML in the same opaque sandbox before publication. It
also captures a 1200 × 750 PNG of the iframe after fonts load and a 1500 ms settle
period. Host controls are excluded. `napplet.json` may set `preview.delayMs` from
250 to 10000, or `preview.image` to a project PNG (up to 5 MiB, 4096 × 4096).
Explicit images are validated and included in the frozen source; automatic
captures are saved as `preview.png` beside the release's journal and source archive.

For an image the creator/AI can inspect before publishing:

```sh
soyli build
soyli screenshot
# Saves preview.png and selects it with preview.image in napplet.json.
# Existing images are preserved: use screenshot preview-2.png to capture again.
soyli publish --dry-run
soyli publish
```

Choose a representative state, especially for scenes requiring a start click.
Enter the core interaction and capture a legible moment that demonstrates it;
a splash screen is rarely the best cover. For clips, use the supported timed
inputs to show a short meaningful sequence, and watch the resulting file before
selecting it. Ambient work should show its characteristic motion. Avoid blank,
loading or error frames and screenshots that promise features absent from the
app. Automated capture succeeds at creating files, not judging their usefulness.
The generated soyLI integration guidance includes this review step.
The automatic fallback captures startup; it cannot judge whether that frame tells
the story of the app. The installed integration guidance requires visual inspection
as the finishing step. A manually captured PNG may be selected instead. Remove
`preview.image` to return to fresh automatic capture for each release.

Publishing uploads the PNG to the configured Blossom server and puts its hash/MIME
on the current manifest and any requested snapshot under `soy.presentation/1`. Our primary relay acknowledges
the manifests before optional mirror copies. There is no separate descriptor to
sign, discover or acknowledge in fresh jobs. No viewer or app private key is
involved in capture. Already frozen older jobs retain their original descriptor.

Frozen PNG bytes, hashes, manifest signatures and acknowledgements survive
retries. Resume never recaptures or changes destinations. An older completed
publication without a preview can receive one on the next ordinary publish,
including when its executable bytes are unchanged; its old snapshot stays intact.
No existing live publication is automatically modified by installing the CLI.

Generated poster covers now fit fully inside the player at desktop and phone
sizes; actual screenshots retain their existing cover treatment. Regression tests
cover exact capture pixels, custom-image validation, resumed uploads/signatures,
legacy release upgrades, real local service readback, and browser cover fitting.

## Short video previews — soyLI 0.7.0

Implemented locally; CLI distribution and website deployment are separate steps.
Run `soyli record` after building, or use **Listing → Record clip** in `soyli dev`.
Recording uses Playwright 1.63.0's [screencast API](https://playwright.dev/docs/api/class-screencast)
in the same opaque sandbox as screenshots, with no creator credentials. Its cached
Chromium/FFmpeg tooling is installed automatically; no system FFmpeg or Bun install
is needed by a packaged CLI user. It records a fresh run of the built artifact,
not the in-progress session in the creator's visible browser.

The capture viewport is 960 × 600, with a selectable 2–8 second interval, a 0–10
second start delay after normal startup, and optional timed clicks/key presses.
The pinned Playwright 1.63.0 recorder holds its last captured frame for at least
one extra second when stopping (`FfmpegVideoRecorder._stop`). A requested 7-second
action window can therefore produce an 8-second clip; `record` reports the actual
encoded duration. This is a recording tail, not extra scripted action time.
The creator reviews the WebM beside the static cover, title and other posting
fields; recording does not publish. Duration and size depend on the encoder and
scene; the reported output duration is authoritative for the resulting file.

```json
{
  "preview": {
    "delayMs": 1500,
    "recording": {
      "startMs": 500,
      "durationMs": 6000,
      "actions": [
        { "type": "click", "atMs": 200, "x": 480, "y": 300 },
        { "type": "keyDown", "atMs": 1000, "key": "ArrowRight" },
        { "type": "keyUp", "atMs": 2200, "key": "ArrowRight" }
      ]
    }
  }
}
```

Actions are bounded data, never a project script: at most 32, timed within the
recording interval. Keys are arrows, Space, Enter, lowercase letters or digits.
Coordinates refer to the recording viewport. Use the start/duration controls to
select the captured interval; there is no separate editing timeline or audio track.
`soyli record preview-2.webm` preserves an existing clip and selects the new file.
The saved `preview.video` contains `file` and `artifactHash`. Publishing rejects an
older-build selection; record again or remove `preview.video` for a static-only
release. The clip is included in source/remixes and frozen in the release journal.
Resuming preserves its bytes, destinations and signatures.

### Signed association and interoperability

Fresh manifests bind the clip directly with `preview` hash/MIME alongside the
static `screenshot`. See the explicit downstream schema above. Independent clients
may ignore these optional tags and retain the same executable. No video is added
to playable paths or used to override artifact identity.

The legacy reader still supports exact per-release kind-32267 app descriptors,
their `image` PNG and
[NIP-92](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/92.md):
the descriptor content includes the Blossom video URL and an `imeta` tag associates
`url`, `m video/webm`, `x`, `size`, `dim`, `alt` and `thumb` from
[NIP-94](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/94.md).
This applies NIP-92's generic attachment convention to the linked app descriptor;
it does not claim a Zapstore-specific trailer standard or a new NIP-5D field.
Unsupported clients can ignore it and retain the same executable and screenshot.
No video URL is added to the playable `path` entries or used to override identity.

Legacy discovery verifies the manifest → descriptor → exact URL/digest binding. The URL
must appear in descriptor content, and ambiguous duplicate metadata is rejected.
The same adapter applies to every publisher. The newest signed descriptor is chosen
before interpreting attachments, so removing a clip cannot resurrect an older one.
Independent clients have not yet been tested for rendering this attachment.

### Delivery and playback limits

The initial profile accepts one silent VP8 WebM track, up to 12 seconds, 1200 × 750,
5 MiB and 600 frames. MP4, VP9, audio tracks, laced blocks, encrypted tracks,
attachments and chapters are outside this initial profile. Capture/publish decodes
an actual frame in Chromium. Server admission follows the [WebM container structure](https://www.webmproject.org/docs/container/) and checks bounded EBML structure, track
metadata, timestamps and VP8 keyframe dimensions; it is not a full codec decoder.
A corrupt or unsupported clip falls back to the static cover in the browser.

Remote URLs use the existing public-HTTPS/DNS/redirect policy. If an operator sets
`SPACE_INDEX_LOCAL_BLOSSOM`, video lookup first checks that exact numeric-loopback
CAS at the signed hash, supporting local publications and avoiding a public download
for already-hosted clips. Events cannot choose another local origin, path or query;
a public URL is used as fallback when the configured cache misses. Signed SHA-256 is
required for this optional video profile, and every downloaded byte is verified.
Video indexing allows two concurrent jobs and reserves at most 20 MiB per refresh,
with a 5-second per-download timeout under the existing metadata deadline. The
persistent index keeps image/video cache data within its shared 256 MiB cap;
public-dev keeps current/previous refresh clips. Cache version is now
`app-descriptors-2`. These limits describe publishing and the optional server cache.
The browser reads the signed clip URL directly; native codec/range support comes
from the browser and storage provider. The former preview-video API is removed.
Blossom serves native audio/video documents with `media-src 'self'` while retaining
its sandbox, so opening an original media link can actually play it.

Gallery thumbnails have no preview badge/button. Their clips load on mouse hover
or keyboard focus and stop when that interaction ends. The selected featured
slide plays its clip automatically while visible, muted and inline; inactive
slides do not load clips. A clip play/pause control sits below the featured slide,
separate from carousel rotation and the thumbnail's navigation link. It also works
when there is only one featured napplet.

Only one preview plays at a time, and automatic previews cannot interrupt explicit
napplet playback. Scrolling offscreen, hiding the tab or unmounting releases the
media source. Reduced-motion and Save-Data visitors initially see the static cover;
the featured clip can still be requested explicitly. A failed clip keeps the static
cover and removes its unavailable replay control. Viewer previews never create a
napplet iframe. The thumbnail's Play action still starts the ordinary verified
napplet. OG continues to use a static PNG. These website changes require deployment;
they do not alter metadata, upload requirements or media URLs.

Local evidence: real recording and stale-build check; signed publication interrupted
and resumed with identical clip bytes/events; metadata/cache/range rejection tests;
Chromium listing review, gallery lifecycle/reduced-motion, and static OG checks.

## Linked assets on detail pages

Deployed in website release `20260915171125013-66174` (2026-09-15), with soyLI 0.8.3 unchanged.
The single napplet page lists available linked assets immediately below the player.
With direct presentation it includes manifest screenshots/clips as well as the
legacy preview image, WebM clip, additional image/icon or WebM links in selected
supported app descriptors, and the pinned source archive. The same
presentation applies to every publisher and hides when there are no attachments
or while the player is immersive.

Images, clips and source archives open their exact published URLs in a new tab.
The list shows the destination hostname. Normalized cache dimensions are not
presented as properties of the original image. Additional signed descriptor links
remain opt-in; a signed URL association is not a claim that its bytes were checked.
Unsafe schemes and credential-bearing URLs are omitted.

Native audio/video documents need `media-src 'self'` in their response CSP. Blossom
now grants that permission only to audio/video responses while retaining its
script-blocking sandbox. The browser regression checks advancing playback time,
original image URLs, source archive bytes and mobile layout.

Generated OG fallback artwork is not presented as an author-supplied attachment.
This view does not enumerate files inside executable packages, invent preview
metadata, or expand the supported video profile. It renders in SSR, fits phone
widths, and needs no website login. The focused browser fixture verifies actual
image/clip responses and source-archive bytes without publishing any events.
