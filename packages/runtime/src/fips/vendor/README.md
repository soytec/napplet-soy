# Pinned Hashtree TCP/FIPS client transport

These two source files are vendored from `@hashtree/fips-transport` **0.5.0**, published in the pinned [hashtree-ts-runtime-v0.5.38 release artifact](https://github.com/mmalmi/hashtree/releases/download/hashtree-ts-runtime-v0.5.38/hashtree-fips-transport-0.5.0.tgz). They retain the upstream API and MIT license (see `LICENSE`). Atlas pins `@fips/tcp` 0.2.3 and uses `@hashtree/core` 0.3.2's compatible hash/store interfaces. The shell started from Atlas 8ff058a’s client-side cleanup patch. The provider is not modified by this integration. These transport changes live in tracked source, not in manually edited dependency files.

Only `tcpBlobTransport.ts` is changed. In `fetchFromPeer`, a valid MISSING response or complete SHA-256-verified body closes gracefully. Failed attempts abort the TCP stream. A graceful close after a read timeout leaves an unread receive buffer and the provider's queued response alive; a retry then competes with that abandoned stream. The existing TCP endpoint's abort sends RST and releases the local tuple, and the existing provider handles that RST. Server file reads already in progress may still finish before their next write observes the closed stream.

The polling timer also catches transient carrier errors so they are surfaced through bounded request deadlines instead of becoming unhandled rejections. A regression verifies polling continues after a rejected send.

The shell additionally enforces a response-length cap before allocating payload buffers and accepts per-request cancellation, resetting only the abandoned stream. These transport patches do not guarantee throughput; retry and queue policy live in the shared resource client. `uploadRateLimiter.ts` is unchanged and included because the transport imports it. No discovery, browser-provider, or unrelated package source is vendored.

Original packaged file SHA-256 values, before the patch:

| File | SHA-256 |
| --- | --- |
| `src/tcpBlobTransport.ts` | `38b383f198061481ec823ba97ce5208b6e9ebe278c5036cd3e755f71947a33d9` |
| `src/uploadRateLimiter.ts` | `290f25b2ef889a25dafa235cbaecf6e258dfd9d19d6103137605af75bf71de35` |
| `LICENSE` | `d43b5e99d9d0e73f69edac17b4167b5f973bb4920edc77f344c1091c4ec1b86c` |

Run `bun test packages/runtime/src/fips` for the real local FIPS/TCP tests.
The ported `timeout-cleanup.test.ts` drops body packets, checks retained buffers
on both ends after repeated timeouts, then verifies recovery bytes. It covers
complete/missing replies and polling after a rejected send. `transport.test.ts`
covers overlapping reads, provider failover, stream cancellation, a shared
transfer budget and isolated frame counters. Live Atlas verification separately
uses the unchanged published provider. No mutation of that server is required.

When upgrading the upstream dependency, compare this focused change with the new implementation and remove the vendored copy once upstream provides equivalent cleanup.
