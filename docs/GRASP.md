# Git source hosting

The source service runs **ngit-grasp v3.0.2**, with Git smart HTTP and a Nostr relay at the same root origin. Its authority is signed NIP-34 repository metadata and state, using the upstream GRASP protocol. A Git HTTP request alone cannot authorize a new branch tip. Anyone can clone public source.

## Reviewed upstream

[`services/grasp/upstream.json`](../services/grasp/upstream.json) pins release commit `cdda4a23fe5dede2411e18aaa8b82c1747c97ddf`, the Cargo lockfile digest, Rust 1.97.1, and the reviewed GRASP specification commit. The release was resolved from the maintainer's signature-verified kind-30618 event `c3db2b89615bb51246ae78355cf1021437b5b7df344a1fe269f6c598f7bcabe4` on `wss://relay.ngit.dev`. The maintainer's pubkey is recorded in the pin. The build fetches the [upstream Git repository](https://relay.ngit.dev/npub15qydau2hjma6ngxkl2cyar74wzyjshvl65za5k5rl69264ar2exs5cyejr/ngit-grasp.git), verifies the commit and lockfile, then builds with `cargo --locked`.

The deployment build makes three checksum-guarded changes: lock the working directory against a second writer; add a local profile that ignores inherited operator credentials/dotenv and restricts event-directed connections to literal loopback; and identify the guarded build in NIP-11. Protocol admission and Git authorization remain upstream code. A changed upstream source file makes the patches fail closed. NIP-11 reports `3.0.2-cdda4a23+space.<build-id>`.

See the [GRASP protocol](https://ngit.dev/protocol/grasp) and [NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md). This service is separate from the Khatru gallery/social relay because GRASP couples Git availability to repository-event admission.

## Shared local/VPS service

| Profile              | Public endpoint                                  | Native listener   | Persistent working directory   |
| -------------------- | ------------------------------------------------ | ----------------- | ------------------------------ |
| Both local dev modes | `http://127.0.0.1:8082` / `ws://127.0.0.1:8082/` | `127.0.0.1:19349` | `.local/services/grasp`        |
| VPS                  | `https://git.<domain>` / `wss://git.<domain>/`   | `127.0.0.1:19349` | `/var/lib/napplet-space/grasp` |

`infra/grasp.ecosystem.config.cjs` runs one native process with this working directory. Bun tests/dev tooling and Node/PM2 load the same `services/grasp/config.cjs`. The local profile uses a separate key and literal-loopback connections; the production profile keeps upstream non-global target protections. Sync+ and default user-index/fallback relays are disabled in both profiles. A production operator can explicitly configure a trusted bootstrap relay through upstream settings. Caddy limits request bodies to 50 MiB, Git limits receive-pack input to 50 MiB, and Caddy blocks `/metrics`.

```sh
bun run grasp:build  # cached pinned native build
bun run grasp:seed   # reconcile local example source, after dev startup
bun run test:grasp   # isolated native Git/Nostr process tests
```

Both `dev` and `dev:prod` start Caddy before seeding so Git URLs remain identical between modes. Build/configuration changes restart the managed local service; unchanged startup preserves it. A warm six-repository reconciliation measured 1.2 seconds with zero publications. `--git-domain source.example` overrides the VPS Git hostname; it must differ from both the website and Blossom hostname.

## Source publication adapter

Forkless collaboration uses `packages/collaboration/src/transport.ts` separately
from this author-owned publication helper. It hosts PR roots/updates on existing
upstream immutable refs and publishes accepted branches with saved signed state,
without creating a contributor repository. The contributor's configured repository
host is not the proposal destination. See [collaboration](COLLABORATION.md).

`packages/grasp/src/client.ts` uses an Applesauce-compatible signer. It prepares a kind-30617 announcement with the repository identifier, HTTPS clone URL, relay URL and earliest unique commit, followed by kind-30618 authorizing a commit at `refs/heads/main`. Metadata is signed and checked before network activity. The adapter accepts a committed, clean repository with one root and publishes its selected commit as `main`; it can additionally retain up to 128 immutable `refs/tags/release-<id>` tags. The publisher supplies an expected main commit for a Git force-with-lease; general multi-branch/tag management is left to a full ngit client. The adapter serves only soyLI-hosted repositories; a project that publishes against [its own NIP-34 repository](PUBLISHING.md#publishing-from-your-own-nip-34-repository) is verified read-only and never signed or pushed by it.

Publish those events to GRASP, push the authorized Git objects, then verify both relay events and the advertised branch tip. GRASP initially holds repository metadata in purgatory until the required objects exist. A successful relay acknowledgement alone is insufficient. The adapter supports retrying the same signed publication; it does not re-sign on retry. Private keys never go to the Git subprocess.

`scripts/grasp.ts` exercises this path for the six local examples, storing a public retry journal outside each source repository. Unchanged seeds verify existing events and Git refs without new commits or publications. These repositories demonstrate the source component. The [creator publisher](PUBLISHING.md) now connects Git, Blossom and standard manifest publication; persistent website ingestion remains ahead.

## Verification

`bun test tests/services/grasp.test.ts` starts the actual pinned native service in a temporary directory. It checks signed creation and updates, independent Git cloning, refusal of unauthorized tips and forged signatures, idempotent fixture seeding, exclusive process ownership, recovery after graceful termination and SIGKILL, and production-profile startup/CORS. Local mode generates its own private operator key even when production credentials are present in the parent environment. The tests do not publish to public relays.

## Operations

Keep the entire working directory together: Git storage, relay LMDB, `.relay-owner.nsec`, migration/checkpoint files and the process lock all belong to this service. The key is generated with mode 0600. Stop the service before copying the state for backup; preserve permissions. Never place service keys in the source tree, release archive, PM2 arguments or logs.

ngit-grasp 3.x has storage migrations. A binary rollback is not a database downgrade. The VPS script records `upstream.commit` in the state directory and rejects automatic pin changes. Before changing the pinned upstream version, stop writes and back up the complete state; rehearse migration and restore on a copy before updating the guard. Monitor disk usage: request/pack limits are not a total storage quota. Peer synchronization, Git object expansion and repeated public repositories also consume storage. This integration does not yet provide operator quotas or abuse-management tools.

Local builds require Git, a C compiler and Rust 1.97.1 on PATH; Linux also needs `pkg-config` and OpenSSL development headers. Build artifacts and dependencies are cached under `.local/grasp-build`. No VPS deployment has been executed yet.

## Author publication lifecycle — 0.17.0

[Unpublish, republish and hosted-data deletion](LIFECYCLE.md) use signed NIP-09
requests (kind 5), fresh NIP-5D current listings and direct Blossom BUD-11/12
requests. The author confirms a concrete inventory; per-service status distinguishes
confirmed absence, retained shared data and incomplete requests. No manifest
extension or website deletion API is required. NIP-5D and NAP pins are unchanged.
GRASP retains deleted repository archives for 90 days by default; copies and forks
outside the selected services are not recalled.
