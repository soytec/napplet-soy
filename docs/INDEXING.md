# Persistent relay indexing

The website now ingests ordinary signed napplets through an independent, read-only Applesauce worker. Publication does not call a privileged import endpoint. Any author publishing a supported manifest to an indexed relay follows the same path into the gallery, address route, snapshot route, artifact delivery, and linked/generated previews.

## Operation

`bun run dev` and `bun run dev:prod` start `napplet-local-indexer` under the checkout's PM2 instance. State lives at `.local/services/index`. The VPS script starts `napplet-indexer` with durable state at `/var/lib/napplet-space/index`, checks its release/heartbeat before completing activation, and includes the process in rollback. Caddy needs no new origin or port.

The worker and web server share **SQLite in WAL mode**, using the same schema locally and on the VPS. This revises the earlier Postgres proposal: one writer and read-only web processes fit the current single-VPS deployment without another database service. Signed Nostr events remain the protocol records; SQLite contains their website projection. Horizontal deployment would require a shared projection store or replication design.

| Setting                     | Meaning                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `SPACE_INDEX_DIR`           | Required worker state directory; web readers use the same directory             |
| `SPACE_INDEX_RELAYS`        | 1–8 comma-separated read destinations; WSS or explicitly configured loopback WS |
| `SPACE_INDEX_HINTS`         | Optional portable relay hints, defaulting to read destinations                  |
| `SPACE_INDEX_LOCAL_BLOSSOM` | Dev-only exact numeric loopback HTTP origin for retrieving `/hash`              |
| `SPACE_RELEASE_ID`          | Worker heartbeat release, checked during activation                             |

Production queries its managed relay internally **and** the five external
[shared relay defaults](RELAY-DEFAULTS.md): Damus, nos.lol, Primal, nostr.mom and
Pocketstr. This list is shared with publicdev in `packages/nostr/discovery-relays.json`.
The expansion is a source update awaiting deployment. Portable links replace the
internal managed URL with `wss://relay.<domain>` and retain the external relay hints.
Operators can override `SPACE_INDEX_RELAYS` and optionally `SPACE_INDEX_HINTS` in
`shared/server.env`; an explicit relay list replaces the defaults (include the managed
relay if desired). Ordinary local development still reads only its isolated relay.
Publicdev remains an optional read-only development cache; production discovery uses
the persistent worker with `SPACE_PUBLICDEV=0`. No fixture key or signing credentials
enter the worker.

## Admission, catch-up and storage

The worker verifies signatures, applies NIP-01 timestamp/ID replacement ordering, then validates either the selected standalone NIP-5D manifest or the legacy single-HTML profile. A newer invalid package is retained as the winning record and prevents an older valid package from reappearing as current. Kind-5129 snapshots remain independently addressable. Legacy self-address pairs and exact validated standalone release pairs can share one gallery card. A historical standalone snapshot can also be grouped for display through its own author's exact signed release descriptor naming a live newer listing, as described in [the migration contract](NIP5D-MIGRATION.md). This hint never establishes deletion authority, social scope or runtime identity; snapshot ancestry alone establishes neither grouping nor identity. Authenticated NIP-09 event/address deletions are retained, including before target arrival, and NIP-40 expiration prevents serving a manifest. Unsupported required host domains stay gated; optional domains do not prevent playback.

Observed replaced named/root events are archived in the same SQLite database, including older events that arrive after the current winner. `/r/<event-id>` can resolve any supported kind from this archive. Archived events keep artifact references and receive the same expiration, deletion, moderation and byte-verification checks. They are excluded from the current gallery, but can establish exact signed release pairs for presentation. Back up the database: relays may discard replaceable history, and a fresh index cannot reconstruct events it never observed. See [the migration contract](NIP5D-MIGRATION.md).

Queries are bounded and read-only: manifest kinds 35129, 15129 and 5129; 200 events per page; descending timestamp pages with overlap. Deletion queries use kind 5 with `#k` restricted to the napplet kinds. Legacy deletions without the [NIP-09 recommended kind tag](https://github.com/nostr-protocol/nips/blob/master/09.md) are also queried by exact indexed event IDs and addresses, in batches of 64 (the managed relay’s per-tag limit). Changing the target set forces full deletion history for those batches, so a previously issued deletion can hide a newly discovered target. The worker never scans the unrelated kind-5 firehose of a general-purpose relay. Completed per-relay/kind cursors overlap ten minutes on the next pass. A full scan runs hourly to recover older/backdated arrivals. The worker pauses five seconds between rounds. It never advances a failed or saturated cursor. More than 200 matching events at the same second requires a future relay reconciliation strategy; health reports incomplete catch-up rather than silently skipping that second. Relays that silently return less than the requested history cannot prove completeness.

Up to twelve due manifests are selected per round, with a 60-second hydration budget, bounded downloads and retry times; queued lookups run alongside scanning and serialize artifact hydration. Queued discovery retains its 45-second budget, below the queue’s 60-second abandoned-job lease. Executable bytes must match the signed SHA-256 hash, stay within 100 MiB, and decode as UTF-8 before becoming ready. Each mirror attempt has up to 30 seconds within the artifact job’s 60-second deadline, subject to the remaining round or discovery budget; the byte cap applies while streaming. Downloads follow signed hints with the existing public DNS/IP policy and no redirects. The explicitly configured dev Blossom origin also acts as a local cache for any author's signed hash, including fixtures without hints. No manifest can choose another local URL or port.

The 100 MiB read allowance was deployed on 2026-10-12; soyLI still publishes
HTML up to 25 MiB. The index projection profile includes the read budget so entries
rejected under the old limit are scheduled for rechecking after rollout. Website,
indexer and runtime deployment `20261012080150614-26110` activates this policy;
soyLI 0.26.1 provides matching CLI readers. Host resource limits remain separate
and unchanged. See [release verification](CLI-RELEASES.md).

The executable cache is capped at 1 GiB and reclaims unreferenced hashes. Optional normalized raster previews use descriptor/signature/image checks or the standalone manifest's verified hash/MIME icon, refresh every fifteen minutes and have a 256 MiB disk cap. A missing/evicted image falls back to the generated OG card. The index admits up to 10,000 winning manifests/snapshots, 10,000 archived revisions and 10,000 deletion targets; reaching capacity is reported in health and stops cursor advancement. Pinned history is retained, so capacity needs operator attention rather than silently dropping old releases. The gallery filters the whole retained current index plus the optional publicdev collection before returning 24 entries per page; search and topics can find entries older than the former 200-event window. See [discovery](DISCOVERY.md).

`GET /api/health` exposes index heartbeat, release, relay hints and catch-up errors. Pages read stored projections and artifacts without opening relay connections or downloading executable code. Valid unknown portable addresses enqueue bounded exact lookups in a separate discovery inbox; SSR waits briefly and clients show a pending state. The worker performs networking and catalog admission. Invalid addresses still return 404. See [cold-link and OG discovery](DISCOVERY.md).

## Publication confirmation

After source, uploads and primary relay readbacks succeed, the CLI checks `GET /api/publications?address=<naddr>&current=<event-id>` (adding `&snapshot=<event-id>` for an explicitly requested snapshot or an older paired job) for up to 45 seconds. This is a website receipt, not a Nostr extension or a requirement for other clients. The endpoint reads the index only; it accepts no uploads, signer proof or work queue instructions.

A ready receipt requires a recent successful worker heartbeat, the exact current winner, supported capabilities, and a cached artifact whose bytes still match the hash. If a snapshot was requested, its exact event and validated release relationship are required too; named-only receipts return `snapshot: null`. The CLI verifies the returned signed events and exact IDs/hash. An arbitrary HTTP 200 or another release is insufficient. Readiness confirms that the site can serve the verified package; it does not certify third-party napplet behavior or availability forever.

The result becomes `indexed` with `websiteReady: true` and `websiteCheckedAt`; otherwise publication remains `announced_pending_index`. Website downtime does not undo relay publication. `status` reports the last journaled check locally. `status --refresh` repeats only the read-only website check, without opening a signer or republishing. For example:

```sh
bun run soyli status --project ./my-creation --network local --refresh
```

## Verification and remaining work

`bun run check` covers replacement ordering, invalid winners, deletion/expiry, corrupted blobs, retries, process ownership, paging failures and receipt verification. `bun run test:index` builds the website and runs isolated native Khatru and Blossom services, the independent worker process, production SSR and Chromium sandbox playback. It also checks snapshot availability while the worker is stopped and recovery after restart.

Authenticated creator handles/named-route claims are next. Existing example aliases follow their Nostr identities, but new publications currently get portable `/n/<naddr>` and `/r/<snapshot-id>` routes. Public installer distribution, creator-authored media descriptors, source/remix UX, broad client interoperability checks, and larger-scale reconciliation remain separate work.


### Worker readiness

Deployment readiness uses a separate release-tagged worker heartbeat, refreshed
every 10 seconds and rejected after 30 seconds. It is cleared when the worker
stops. A completed relay scan is not required for the process to become ready;
slow external catch-up must not cause an otherwise healthy deployment to roll back.
Catalog scan timestamps and relay errors remain in the separate `health` record
and are not replaced by the heartbeat.
