# Public relay defaults

Reviewed on **2026-10-06**. The expanded set below is released in **soyLI 0.24.2**
and deployed to napplet.soy in **`20261006111729495-77355`**. Fresh public desktop
and phone-sized sessions resolve the affected creator's name/avatar in both the
napplet heading and account header using these site defaults. See
[the release verification](CLI-RELEASES.md).

| Relay | Default role |
| --- | --- |
| `wss://relay.napplet.soy` | Primary publication and discovery |
| `wss://relay.primal.net` | Discovery and optional publication copy |
| `wss://relay.nos.social` | Discovery and optional publication copy |
| `wss://relay.nostr.net` | Discovery and optional publication copy |
| `wss://nostr.oxtr.dev` | Discovery and optional publication copy |
| `wss://nostr-01.yakihonne.com` | Discovery and optional publication copy |
| `wss://relay.nostr.wirednet.jp` | Discovery and optional publication copy |

## Review evidence

The reported napplet displayed a public-key fallback rather than its creator's
name/avatar. Anonymous kind-0/10002 reads from its original default relays found
no profile on Soy or Primal. Pocketstr failed DNS resolution; nos.lol and nostr.mom
repeatedly timed out during the handshake. These are dated observations from the
development machine, not a claim that those services are permanently unavailable
or unreachable everywhere.

The same signed, current creator profile was returned by all five newly selected
relays. Direct reads with the website's Origin completed in approximately
0.17–1.95 seconds. Anonymous napplet-kind queries completed on those relays too;
four returned verified manifests, while nos.social completed an empty query.
Their NIP-11 documents did not advertise required payment or authentication for
these reads. No public test events were published. Successful reads do not promise
future latency, retention or publication acceptance; mirrors remain best effort.

The public policies were read directly from the
[nos.social](https://relay.nos.social), [nostr.net](https://relay.nostr.net),
[0xtr](https://nostr.oxtr.dev), [YakiHonne](https://nostr-01.yakihonne.com), and
[WiredNet](https://relay.nostr.wirednet.jp) NIP-11 endpoints using
`Accept: application/nostr+json`. [Nostr.watch](https://nostr.watch/) remains a
review source, not a runtime dependency or authority over napplet content.
Metadata-only relays were excluded from general discovery/publication defaults.

An isolated browser reproduced the missing name/avatar on the actual public
napplet page and resolved both with expanded relay settings. A signed fixture
regression against the production build confirms that an additional default can
populate the creator label, avatar and connected-account header while other
relays are empty or stalled. Server-side profile/social reads now retain up to
eight configured destinations rather than truncating at six.

## Configuration and scope

The six external relays live in
[`packages/nostr/discovery-relays.json`](../packages/nostr/discovery-relays.json).
The public website, production index, publicdev discovery and CLI remix lookup
consume that list. Production reads its managed relay internally and advertises
its public address in links and browser settings. Publicdev uses the external
list; ordinary local development remains isolated. The public web field guide
renders its mirror list from the same file.

New public creator projects keep Soy as primary and copy the external list into
their editable `publish.networks.public.mirrors` defaults. Publishing still
requires primary acknowledgement before best-effort mirrors. A mirror failure
is recorded and retryable without changing the signed release. Config accepts
up to seven mirrors plus one primary, matching the eight-relay discovery bound.

Explicit operator, browser and project settings remain authoritative. Existing
projects with saved mirror lists keep those lists; use **Manage project → Where
it goes** in `soyli dev` to edit Extra relay copies, or edit the effective
configuration shown by `soyli config`. `mirrors: []` disables configured mirror
copies; creator NIP-65 write-relay copies are a separate best-effort destination set.

Separately, publishing looks up the creator's NIP-65 relay list and copies the
release to their write relays (see [Your outbox relays](PUBLISHING.md#your-outbox-relays-nip-65)).
For that lookup only, the public network also reads the relay-list indexer
`wss://purplepag.es`; it is not a discovery default or publication target.
Saved publication jobs retain their original destinations. Browser users can
reset Network settings with **Use site defaults** after deployment, or configure
their own destinations immediately. Operator `SPACE_INDEX_RELAYS` and
`SPACE_INDEX_HINTS` overrides are preserved too.

Signer/NIP-46 and ContextVM transport relay settings are separate and unchanged.
The selected NIP-5D/NAP pins, event validation, deadline bounds and
publisher-neutral admission are unchanged.

## Previous rollout

The original default expansion shipped in soyLI **0.17.0** and was deployed on
**2026-09-21**, following a 2026-09-20 monitor/NIP-11/anonymous-read review. Damus
was removed on 2026-09-21 after the reported outage. The subsequent set was Soy,
nos.lol, Primal, nostr.mom and Pocketstr. Older successful probes describe that
historical set and do not establish its current availability.
