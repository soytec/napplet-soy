# Map publication and intent handoffs

2026-10-13 OUTBOX integration: general templates now have a separate consented
publication handler; this feature's schema, ownership, revision and configured-relay
protections remain mandatory. OUTBOX own-outbox, recipient-inbox and explicit routing
options are honored only when the complete resolved target set is configured in
host Network settings; otherwise publication fails before signing. Required relay
rejection retains the signed event, per-relay outcomes and feature-specific safe
failure cause. See [current OUTBOX behavior](OUTBOX.md). No release or deployment
is claimed for this source update.

Implemented and locally verified in the 2026-10-13 source tree. These changes
have not been released as a soyLI binary or deployed to the public website.
The shared web/preview runtime uses `@napplet/shim` 0.31.0 with core/nap 0.33.0
bindings and the canonical NAP-INTENT contract at [`e5308ac`](https://github.com/napplet/naps/blob/e5308ac/naps/NAP-INTENT.md). Existing NIP-5D
manifest authority and identifiers remain unchanged.

## Native map writes

NAP-OUTBOX and NAP-RELAY publication admit bounded native Black Site kind-35858
map metadata and narrowly scoped NIP-09 kind-5 deletion, alongside the existing
kind-30078 app-data policy. Every publisher receives the same policy; no editor
publisher, artifact hash or soyLI provenance is privileged. Writes use the
connected viewer signer and host-owned consent, never the CLI creator signer.
Write destinations come from viewer Network settings. Iframe hints cannot add
unconfigured destinations.

Map metadata requires unique `d`, `title`, `version`, `x`, `m` and `size` tags:
map IDs are 1–32 lowercase letters/digits/hyphens starting with a letter or digit;
version is 1; `x` is lowercase SHA-256; MIME is `application/json`; declared size
is 1–262144 bytes. Public HTTPS resource hints, bounded notes and reviewed
metadata/remix tags are admitted. Remix `A/a/P/p` relationships must be valid;
optional `K/k/E/e` are checked when present. A delete requires exactly one
viewer-owned map address, one verified current map event ID and `k=35858`.
Unrelated or foreign events cannot be signed through this policy.

The shipped source wiring admits **metadata only**. It does not download or
validate the linked map JSON before signing. The session provides an optional
trusted `validateBlob` callback, but the current host does not supply it.
Consumers must verify resource hash, size, UTF-8 JSON and map schema before
loading. Consent states this limitation. RESOURCE retrieval and UPLOAD remain
separate existing host capabilities, with their existing byte/hash policies.

Complete selected-relay reads capture the current owner map before consent and
recheck after consent and signing. A changed revision or non-newer timestamp
fails. This detects observed races; native map events have no previous-revision
field and provide no atomic cross-device compare-and-swap guarantee. Signed
retry entries retain the original base revision and reuse signatures after lost
acknowledgements. Identity/frame retirement aborts pending work, including late
signer responses. Map/address locks serialize local sessions and browser tabs
where Web Locks are available. Deletion does not erase old relay copies or
Blossom bytes.

## Opening handlers with NAP-INTENT

A handler advertises standard `z` archetype and queryless `i` convention tags.
Contracts use exact `napplet:<archetype>/<action>` identity; query parameters
are invocation data, not a different convention. A map editor can advertise
`napplet:black-site/map-edit`, `napplet:black-site/map-open`, `napplet:black-site/map-remix` and `napplet:black-site/map-new`.
Payload meaning belongs to that handler's documented contract. For the Black
Site editor, opening an existing map uses its author-qualified map address:

```ts
await intent.invoke('napplet:black-site/map-edit', {
  payload: { address: '35858:<map-author-hex>:<map-id>' },
});
```

The shim normalizes the modern URI call into official request fields. The host
accepts only matching queryless conventions from a verified, compatible catalog.
Catalog IDs remain author-qualified. Web discovery uses ordinary signed Nostr
listings; local preview can register trusted local projects. The shell exposes
handler availability, a chooser and editable per-archetype defaults. Explicit
handler IDs require a user choice; multiple matching handlers without a default
open the chooser. The napplet cannot set preferences or forge another sender.

Accepted payloads are retained by the workspace while a cold target starts and
until its endpoint becomes ready, preserving arrival order. Source closure after
acceptance does not discard the target's delivery. The host attests the sender
from the source catalog identity, reuses/focuses ready surfaces according to
policy and reports bounded startup failures. Handler removal and shell-reported terminal failure or cancellation discard
affected pending deliveries. Closing an endpoint removes its delivery surface. Payloads are bounded to 1 MiB each; the pending queue permits 64 deliveries and
8 MiB total, with a default 30-second startup deadline. This is session retention,
not durable messaging.

`result.ok` means the host accepted delivery responsibility. It is not a handled
acknowledgement from the editor, and does not prove a map was loaded, edited or
published. Receivers still enforce login, map ownership, downloads and unsaved
work protection. An intent does not grant signing or bypass publication consent.
Both preview and web handler launch/chooser/default UI are implemented in source;
public deployment remains separate.

## Verification evidence and limits

The actual source-host browser integration passed native map creation, update,
reload, another viewer's remix, game play and owner deletion against isolated
relay/Blossom fixtures. The actual game's EDIT action passed through the broker
and opened a cold editor. Native session tests passed 10 tests/101 assertions,
including real signatures, optional lineage updates, denial, incomplete reads,
changed signer/account retirement, observed stale writes and acknowledgement
retry. The related runtime suite passed 83 tests.

These checks establish local source integration, not public relay availability,
a released CLI, a deployed website or universal independent-host conformance.
