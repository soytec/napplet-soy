# FIPS resources: contract and integration

Status: implemented on `codex/fips-resource-integration`, with release verification recorded below. Production activation is recorded separately in [DEPLOYMENT.md](DEPLOYMENT.md). Companion Atlas changes are on `codex/soyli-fips-consumer`. Development and acceptance use isolated worktrees; the original Atlas checkout, running builds and provider configuration are unchanged.

## Contract review — 10 November 2026

The reference is Atlas `8ff058a`, with handoff `e8fc1c5`. The actual shell baseline is `ee16dff`: shim **0.35.0**, core **0.37.0**, nap **0.36.0**. The handoff's older 0.31/0.33 package inventory is superseded. NIP-5D transport/identity stays pinned to `c041f84667c1781c3c1d5bfbd970943131b38cc9`.

| Requirement | Contract and ownership |
| --- | --- |
| Signed discovery and withdrawals | Existing OUTBOX reads/subscriptions. Atlas verifies its map/view schemas, signatures, revisions, expiry and cross-relay deletions. Relay access stays in the shell. No signer is needed for public reads. |
| Ordinary resource reads | Preserve the installed Blob/`requests` binding. Selected RESOURCE revision `8c0645d32ceb159bc3e8bcec1107a92862b7e86a` remains the compatibility baseline. |
| Current RESOURCE proposal | [PR 80 at `ae5b9c6`](https://github.com/napplet/naps/blob/ae5b9c64ab8a4d8909f288829a01e99d6bd713bc/naps/NAP-RESOURCE.md) uses canonical base64 wire bytes and `urls`. Do not mix these with the installed binding. It does not define block sessions, transfer progress or RPC. |
| MESH | [PR 122 at `bf9a472`](https://github.com/napplet/naps/pull/122) concerns the user's circle, event dissemination and blob availability counts. It does not provide public provider-pinned blob reads or Atlas RPC. |
| HASHTREE | [PR 73 at `6799770`](https://github.com/napplet/naps/blob/67997706ac6208761dfd1b1d02fe8f13713d7f32/naps/NAP-HASHTREE.md) puts tree traversal in the host. This integration retains application-owned traversal and does not claim that contract. |
| Selective block reads | Explicit experimental resource profile **`soy.fips/1`**, supplied by the shared host and its matching SDK adapter. Raw SHA-256 blocks are not advertised as standardized `htree:` file resolution. Atlas owns file traversal and byte-range selection. |
| Authority | A shell-approved, expiring root/size/chunk-size/provider grant. Approval is distinct from the app's discovery verification. The shell authenticates transport peers, checks Merkle membership before cache access, verifies SHA-256 and lengths, and revokes in-flight access when the grant closes. |
| Binary transfer, diagnostics and cancellation | The experimental profile transfers completed verified ArrayBuffers on the private NIP-5D MessagePort. It has explicit cancellation/deadlines, bounded queues/cache and payload counters. No iframe-window message bridge. |
| Server operations | An explicitly selected **application protocol** adapter for Atlas RPC v1, pinned to a grant's root and one provider. No ContextVM/MCP claim, host-admin access or automatic retry of uncertain operations. Status, headers and binary bodies survive the adapter. |

`resource.soyFips` is an experimental injected binding, not a new NAP domain and not a standard RESOURCE method. Its matching adapter detects absence and explains the unavailable capability. It must not be listed as an invented manifest `R` domain. Standard `resource` and `outbox` remain the only required protocol domains; profile absence is handled visibly. A follow-up upstream proposal can use the implementation and acceptance evidence, but this task does not publish a proposal or claim cross-shell support.

## Implementation boundary

The shared runtime owns FIPS identity, seed connections, provider selection, bounded transport work, cancellation, verified caches and grant lifecycle. Transport identities are ephemeral and separate from the shell's Nostr account. Approval never exposes signer keys or grants arbitrary networking. Frame replacement, account changes and disposal retire all grants. Cache hits cannot extend authority. An accepted root permits only that root and descendants learned from verified Hashtree file nodes, never arbitrary hashes at its provider.

Atlas owns discovery configuration, signed catalog/default-view validation, composition, selective file reads, decoding, rendering and operation input/output schemas. Its network-free consumer imports accept byte readers; HTTP/relay/FIPS implementations are separate entry points. Geometry and essential directory metadata load by default; labels and imagery are explicit choices. Routing/search/analysis blocks are not startup dependencies.

Provider/seed hints are untrusted inputs until validated and approved by the shell. Public WSS seeds are allowed; local tests require explicit trusted-host loopback configuration. No HTTP archive fallback is introduced. Multiple publishers use the same policy. Public discovery and data access do not require login.

### Bounds and dependency pins

Two active transfers and 128 waiting transfers are shared across frames. Each frame/account has independent ephemeral identities, connections, counters, deduplication, a 32 MiB verified-byte cache and at most 128 pending calls. A frame can hold 32 roots and eight seed groups; grants expire within seven days. Blocks are at most 2 MiB, tree fanout 128, depth 16, with one million retained proof links. Root file length is bounded at 1 TiB; it is not downloaded eagerly. Queued reads have a 20-minute deadline, with 30-second transport attempts and one transient retry per provider. Cancellation resets abandoned TCP streams. Exhausted transient reads retire their cached carrier: a later read can establish a fresh connection, while operations already using the old carrier finish without replay. These are bounded resource defaults, not a throughput guarantee.

Atlas v1 operations use port 39019, GET `capabilities` or POST `route`, `isochrone`, `search`, `reverse`, `peak`, `features`, `offline`, optionally below `members/mN/`. Requests are limited to 16 KiB, JSON responses to 16 MiB and binary responses to 32 MiB. The server has other endpoints; they are deliberately not exposed. An operation retains its selected provider and is never automatically replayed after an uncertain response.

Transport pins match the Atlas reference:

- `@fips/core` 0.0.52 from release `runtime-v0.0.56`.
- `@fips/tcp` 0.2.3 from release `fips-tcp-v0.2.4`.
- `@fips/transport-websocket` 0.0.9 from release `runtime-v0.0.54`.
- `@hashtree/core` 0.3.2.
- Two MIT-licensed files from `@hashtree/fips-transport` 0.5.0, release `hashtree-ts-runtime-v0.5.38`, with the reference timeout cleanup plus cancellation/size enforcement. See [transport provenance](../packages/runtime/src/fips/vendor/README.md).

The shim integration is a tracked package-manager patch, exercised in the built player. There are no manual `node_modules` edits or Atlas preview injections; Bun applies the declared patch reproducibly. New soyLI projects receive [the creator guide](FIPS-CREATOR.md) and the network-free SDK example; deployment archives include both.

## Acceptance record

Verified locally on 10 November 2026:

| Command / check | Result |
| --- | --- |
| Shell `bun run check` | TypeScript and **1,025 tests passed**, zero failures; 7,967 assertions. Includes the existing host, transport, playback and OUTBOX regressions. |
| Shell `bun run build` | Production client and SSR build passed. |
| `bun test tests/services/packaged-cli.test.ts` | Native compiled CLI creates a project with byte-exact FIPS guidance and SDK: one test, 14 assertions. The native CLI and legacy worker share the raw TypeScript source loader. |
| Full Nix packaging gate | Passed on an isolated x86_64 Linux/KVM builder: realized and force-rebuilt dependency and soyLI outputs, then passed flake/VM checks. The creator guide is an explicit Nix source input; the changed dependency output hash was measured and reviewed. AArch64 Nix checks were not run. |
| `bun test scripts/deploy-archive.test.ts apps/cli/src/creator-kit.test.ts tests/services/cli-preview.test.ts` | 12 passed, one existing optional test skipped. Archive includes the new guidance/SDK. |
| `FIPS_TEST_WEB_ORIGIN=http://127.0.0.1:4218 bun test tests/services/fips-browser.test.ts` | Real opaque shim/host in ordinary soyLI and the compiled website Player: 28 assertions passed in Chromium. |
| Same browser fixture with `FIPS_TEST_BROWSER='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'` | 28 assertions passed in Brave against the compiled player; also passed against the development player. |
| Atlas consumer `pnpm verify` | Guidance (6), recovery (9), resource/discovery (7), TypeScript and single-file build passed. |
| Atlas root `bun run typecheck` and `bun run build:client` | Passed; standalone/local browser entry points still compile. Existing WASM artifacts were copied into the isolated worktree; original builds were not run or interrupted. |
| Atlas root `bun test tests/hashtree.test.ts tests/hashtree-fips-contract.test.ts tests/fips-runtime.test.ts tests/composition.test.ts` | 24 passed, 148 assertions. |
| Final Atlas `bun test tests` on isolated Linux, with native release/debug prerequisites | 499 passed, zero failures; 4,908 assertions. Includes provider validation/counter compatibility and deterministic acquisition review-persistence regression. |

The shell fixtures exercise real encrypted FIPS/TCP transports: overlapping reads, missing-provider failover, cancelled streams and packet-loss recovery, subsequent polling after a carrier error, and the global two-transfer budget with isolated frame counters. Session tests cover hash/length corruption, unauthorized descendants/providers, expiry, cache authorization, release, late completions and uncertain RPC responses. Actual host tests cover malformed envelopes, approval, account replacement and frame teardown.

The browser fixture is a small **non-Atlas document reader**, using the same SDK, a local encrypted FIPS peer and explicit root/operation approvals. It reads only one selected leaf of a two-leaf file, verifies warm-cache reuse, rejects access after release, preserves a binary 206 operation response and snapshot header, and checks no-login operation, opaque origin, `allow-scripts`, `connect-src 'none'`, cancellation and 390px layout. The production player uses a hash-correct local fixture artifact; no public publication is modified.

Atlas tests cover two signed roots with different provider identities, cross-relay deletion ordering, revisions, expiry, a signed two-map default view, selection overrides, geometry-only startup, overlap, opt-in labels/imagery, batched consent and withdrawal/disposal during approval. The live public provider is checked separately; it is not the source of these deterministic lifecycle claims.

### Read-only public Atlas acceptance

Ordinary `bun apps/cli/src/index.ts dev --project /path/to/isolated/atlas-consumer --no-open` was exercised with the unchanged published provider, without the historical launcher. Brave and Chromium discovered six signed offers and composed Lower Rhine West and East. The final Chromium run loaded **27/27 tiles, 100,499 triangles, 4.34 MiB of verified payload and 131 verified blobs**, reaching the ready state after roughly 95 seconds. These are selective reads from offers advertising 15.49 and 17.80 GiB archives, not archive downloads. An earlier Brave run took roughly 130 seconds to finish geometry.

The final run recorded zero JavaScript page errors and **no HTTP requests outside the local preview origin**. Geometry controls and explicit label/imagery toggles remained usable. At 390 × 844, the iframe body remained 390px wide and its map and controls rendered; this is browser resizing, not physical-device testing. Labels and imagery were disabled initially. Actual optional imagery content and distinct live providers are not established by that run; their selection/independent-provider behavior is covered by deterministic fixtures.

A separate explicit `GET capabilities` call through the same SDK returned **200**, JSON schema metadata and snapshot `5581476881ff0a76409a7b23b4cd3c2ac9be100f40414b45a8ed53ed1e687b31` in both body and `x-atlas-snapshot`. It was pinned to root `65e91586df3eb1a197a26902cca601e45b90e54d878053fcf6d90b7b1092c87c` and peer `02ec568d5b30f4602188ed4749d4b9336167e461bdad0f9dc2854c2b7dd802c068`; no replay or HTTP request occurred. Binary/status preservation and lost-response behavior are fixture-tested.

An intervening cold run stopped with a visible directory-load error. A follow-up on a frozen artifact reproduced a TCP/FIPS read timeout after a seed reconnect; the directory retries exhausted and the consumer displayed **Retry map loading**, without falsely reporting readiness. Three subsequent cold contexts each completed in roughly 91 seconds without a product or provider change. A prolonged packet-loss test then exposed a cached carrier that stayed unusable after Retry. The runtime now retires exhausted carriers while allowing active operations to finish. With the fix, dropping 424 incoming packets produced visible read failures, and one Retry after restoring traffic loaded all 27 tiles in the same frame (about 90 seconds after Retry). A forced WebSocket disconnect/reconnect also recovered. The deterministic encrypted-wire regression holds an active operation across carrier retirement and confirms it completes once without replay; public-path latency and availability remain transport-dependent, not guaranteed performance results. Live acceptance scripts and screenshots are local development artifacts, not shipped product assets.

The upstream consumer conformance harness reports **5 passed, 0 failed, 5 skipped**. Its manifest-event/index/requires, observed wire and clean-teardown cases remain skipped. Shared-host/private-port lifecycle tests provide separate evidence; they do not turn those skipped cases into passes. No independent-shell interoperability or physical mobile/controller acceptance is claimed.

### Rollout gates

The full Nix gate passed on 10 November 2026 after adding the missing creator-guide input and measuring the exact dependency output hash. The release candidate is soyLI **0.33.0**. Native release CI must pass on all four platforms before publication. Activate compatible website and hosted-worker readers before publishing the dependent Atlas consumer. The existing Atlas provider requires no restart.

Atlas development remains in its private repository. A consumer-only export excludes host, administration, map compiler, deployment configuration and Git history; the owner approved this limited source export under MIT on 10 November 2026. This approval does not cover the rest of the private repository. The export includes the consumer dependency closure and renderer/routing WASM provenance. Its custom toolchain must not be advertised as supported by the stock Studio browser build profile.

Upstream standardization of public content-addressed provider grants and the optional operation boundary remains open. `soy.fips/1` must remain visibly experimental until a compatible contract is agreed and tested with another implementation.
