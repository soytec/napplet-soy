# Napplet intent handoffs

Implemented in local source on `feat/nap-intent`; not released or deployed. The shared web/preview host uses shim 0.31.0 and nap/core 0.33.0. [The specification review](NAP-INTENT-REVIEW.md) records the current PR-106 revision, evidence and unresolved conformance findings.

A handler advertises roles using standard `z` tags and accepted queryless conventions using `i` tags. The host verifies public manifests, assigns publisher-qualified opaque catalog IDs, and routes exact conventions. Preview also permits trusted local project registration and signed-manifest import. All publishers receive the same installation rules; Space metadata and creator-tool provenance grant no authority.

```ts
const result = await window.napplet.intent.invoke('napplet:profile/open', {
  payload: { pubkey: '<public-key>' },
});
```

The host provides a chooser and user-editable defaults per archetype. Explicit catalog selection requires user authorization. The sender comes from the authenticated source endpoint. Payload meaning and validation belong to the receiving application; the host does not infer kinds or grant edit/signing authority.

`result.ok` means the runtime accepted delivery responsibility. It does not mean the target handled the request or saved anything. Accepted deliveries survive source closure, wait for target readiness and retain arrival order. Terminal startup failure or host cancellation discards pending deliveries without issuing a second invocation result.

Queues are session-only: 1 MiB per payload, 64 pending deliveries and 8 MiB total; startup defaults to 30 seconds. The installed binding buffers received deliveries until `onDelivery` registration. This is not durable messaging.

Current limitations: INTENT requests/readiness depend on the host-owned SHELL bootstrap; the injected namespace is present even on surfaces without an endpoint; web catalog/launch models need refresh reconciliation. The binding normalizes handler recommendations and the broker validates/preserves them, but selection does not yet use them. The plan selects recommendation support for IN-03. Preview cold launch does not correctly resolve legacy aggregate artifact hashes. See the review before claiming PR-106 conformance.

The extraction adds no map publication policy or viewer signing permissions. Existing OUTBOX/RELAY app-data rules are unchanged.

## IN-01 contract parsing and request validation

The catalog now preserves each eligible `i` tag and all advertised parameter strings in order, including duplicates and opaque names. Candidate actions/conventions alone are deduplicated. `default` and `choose` cannot be registered as catalog IDs. Public named, root and snapshot source identities continue to work without handler advertisements.

The host accepts only well-formed named handler-hint coordinates, preserves case-sensitive opaque identifiers and bounds hints to 1024 coordinate characters, eight relay strings and 2048 characters per relay string. It strips unrelated hint fields and never includes recommendations in target deliveries. These are untrusted discovery hints; acceptance does not approve a network destination. Recommendation selection is still pending.

[The clause inventory](NAP-INTENT-CONFORMANCE.md) records the installed shim audit, API ownership and verification work remaining for full support. No release or deployment is claimed.
