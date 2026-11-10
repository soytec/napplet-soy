# Experimental verified FIPS resources

`soy.fips/1` is an experimental napplet.soy/soyLI resource profile. It is **not a
standard NAP**, and other shells may not implement it. Show an unavailable state
when it is absent. Never relax the sandbox or silently switch to HTTP delivery.

Use ordinary OUTBOX to discover signed public offers. Your application owns its
event schema, publisher selection, signature/revision/expiry checks and withdrawal
handling. Show the configured publishers and let the user change them. Discovery
does not grant access: the shell separately approves immutable roots and their
provider hints, without requiring a login or exposing account keys.

Copy `docs/examples/fips-resource-client.ts` into your application source. This
adapter contains no networking. The shell owns bootstrap; call `fipsResources()` and
`info()` in a try/catch. An absent binding or disabled policy is a supported empty
state. Keep standard `resource` and `outbox` requirements where essential; do not
invent a manifest requirement such as `fips` or `mesh`.

```ts
import { fipsResources } from './fips-resource-client';

const resources = fipsResources();
const info = await resources.info();
if (!info.enabled) throw new Error('Enable FIPS resources in shell Network settings.');
// acceptedOffer must already be validated against your signed discovery schema.
const [grant] = await resources.open([acceptedOffer], { signal });
try {
  const rootBlock = await resources.bytes(grant!, acceptedOffer.root, { signal });
  // Traverse verified Hashtree File nodes to select only the needed ranges.
  // The shell denies a child until its verified parent has authorized it.
} finally {
  await resources.release(grant!);
}
```

An offer contains `root` (SHA-256 hex), immutable file `bytes`, `chunkBytes`, Unix
`expires` (within seven days), and `providers`. Each provider has a compressed
FIPS `peerId`, public WSS `seedUrls`, blob `servicePort: 39018` and optional
`rpcPort: 39019`. URLs, keys and hashes are public hints, never secrets. A provider
is not authorized for arbitrary hashes just because one root was approved.

The shell verifies SHA-256, lengths and Merkle membership, and transfers binary
buffers through the private NIP-5D port. It bounds blocks to 2 MiB, frame caches
to 32 MiB and pending calls to 128. All frames share two active transfer slots.
Keep application range queues bounded too; debounce viewport changes, abort stale
reads and retry missing tiles while preserving completed work and the viewport.
Use `subscribe()` for verified payload/cache/active/queued/retry diagnostics; these
are not wire-bandwidth measurements. Reopening a root can reuse verified bytes
only after new approval and proof traversal. Release grants on withdrawal and
dispose subscriptions on teardown. Account changes and frame replacement revoke
all grants. Revocation cannot recall bytes already delivered to the app.

Server operations are separate from block delivery. The optional `request()`
adapter implements **Atlas RPC v1**, not CVM/MCP or arbitrary HTTP. It allows GET
`capabilities` and POST `route`, `isochrone`, `search`, `reverse`, `peak`, `features`
and `offline` (optionally under `members/mN/`). The shell asks for separate
permission and pins requests to the root and one provider. Preserve status,
snapshot headers and binary replies. Never automatically repeat a request after
an uncertain response, and never expose host administration. Non-Atlas apps can
use the generic block API without adopting Atlas operations.

Acceptance must exercise the real opaque iframe: selective reads, cache access
after authorization, corruption, cancellation, expiry, withdrawals, frame/account
replacement and missing-profile handling. Test a second implementation/shell
before claiming cross-shell support. Skipped upstream conformance cases are not
passes. See `docs/FIPS-RESOURCES.md` in the shell repository for exact protocol
pins, scope and verification evidence.
