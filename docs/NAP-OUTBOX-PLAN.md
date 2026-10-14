# NAP-OUTBOX implementation plan

Initial draft: 2026-10-13. The implementation checkpoint below records subsequent
source work; no release or deployment is claimed. This standalone feature plan
does not replace historical PLAN.md. No local AGENDA.md or .planning phase setup
existed during this review.

### Implementation checkpoint — 2026-10-13

The draft above describes its original planning status. Work has now started in
`../napplet-soy-outbox` on `feat/nap-outbox`, based on
`feat/black-site-map-intents` at `ff31d0b6c4aa7ba364e145c2989f18483504935e`.
The original INTENT checkout and its uncommitted work remain untouched.

Upstream code reviewed: sibling napplet-web
`44d663a14af0f91a3797614c76e5c3d684cec52e`, specifically
`packages/nap/src/outbox/{types,shim,shim.test}.ts` and core OUTBOX types.
Immutable reference copies of that code and the PR 32 spec are in the ignored
`.local/upstream` directory, with the upstream license. Test fanout vectors were
adapted to our host boundary; the existing released shim remains the runtime
dependency, rather than importing a sibling filesystem path into shipped code.

- O-01: source contract audit started; full compatible-tuple/conformance audit and
  actual-shim publication tracer remain pending.
- O-02: shared relay planner implemented and integrated with existing reads and
  resolveRelays. Positive cache lasts 60 seconds, holds at most 128 authors and
  closes with the account host. Missing-author fallback, read coverage limits and
  incomplete discovery are accounted for. Sidecars and broader filter review remain.
- O-04: publication destination preflight implemented and tested independently;
  own-outbox/recipient-inbox/explicit union, URL validation and strict fanout limits.
  Generic signing, consent and publication transport are not enabled.
- O-03/O-05/O-06: live routing refresh, general host integration, specialized-write
  option reconciliation, browser conformance, builds and release checks remain.

Local verification: 47 tests / 312 assertions across nine files in the Nostr, host,
app-data and map suites passed; `bun run typecheck` and `git diff --check` passed. Nix validation
is still required before pushing shared-package changes. No release or deployment.

## Goal and contract

Support all NAP-OUTBOX operations through the same trusted host in the website
and soyLI preview: getEvent, query, subscribe/close, publish and resolveRelays.
An ordinary third-party napplet must be able to read events and request publication
of a general Nostr event template under explicit viewer policy. Publisher identity,
Space metadata and source provenance must not select a privileged implementation.

Research baseline: [NAP-OUTBOX PR 32](https://github.com/napplet/naps/pull/32),
head `8865f73d52a4864afee145f28d26520476273927`, retrieved 2026-10-13;
[immutable contract](https://github.com/napplet/naps/blob/8865f73d52a4864afee145f28d26520476273927/naps/NAP-OUTBOX.md).
This is a draft upstream contract. The selected NIP-5D authority remains
`4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`; newer upstream references do not
silently replace it. Installed runtime baseline is shim 0.31.0 and core/nap
0.33.0. Their compatibility with this OUTBOX revision still needs a field-by-field
audit; this document does not certify a compatible package tuple.

Full support means covering the contract's mandatory behavior, documenting host
policy bounds and testing failures. Optional resource sidecars and NIP-66
intelligence are not prerequisites for that claim. Shell signing keys stay outside
the frame. Encryption APIs, automatic DM construction, generic NAP-RELAY publishing,
release and public deployment are separate scope.

## Existing foundation and gaps

| Area | Source evidence | Remaining work |
| --- | --- | --- |
| Reads | packages/nostr/src/playback.ts handles getEvent, query and streams; verifies signatures and filters, deduplicates, budgets discovery and collection | Audit limits, complete versus partial results, author coverage, cache and sidecars |
| Routing | PlaybackNostr.plan resolves signed kind-10002 metadata and direction markers | Cache/refresh, deterministic bounded coverage, explicit truncation failures, missing versus denied targets |
| Streams | PlaybackNostr.read survives EOSE and closes on host bounds | Routing refresh, initial timeout/backfill semantics, deduplication across relay changes, lifecycle races |
| Relay hints | Incoming transport reports source relay | Preserve and merge observed sources into optional sidecar.relayHints under disclosure policy |
| Publish | packages/runtime/src/host.ts dispatches to map or app-data sessions | General template admission, viewer consent, own-outbox/recipient-inbox/explicit fanout and per-relay outcomes |
| Existing writes | App-data and map sessions enforce specialized schemas, configured destinations and revision rules | Preserve protections while making OUTBOX routing/options contract consistent; no bypass through generic handling |
| Signing/transport | signExact in action-session.ts; ProtocolClient provides verified reads and publication transport | Audit reuse against fanout completeness, exact template signing and actionable result requirements |

Current read plans truncate authors to 16 and relays to eight. Current reads discard
duplicate observations before recording relay hints. Current stream relay selection
is fixed at open. These are code observations, not failures established by new tests.
No tests were run for this documentation-only draft.

## Decisions to settle

- **O-D01 — publication approval:** open. Recommended first implementation reviews
  every event before signing. Alternative: remembered permission scoped to viewer,
  author-qualified napplet identity and event kind, with clear revocation. Do not
  implement persistent grants until this choice is settled.
- **O-D02 — acknowledgement policy:** proposed: `ok: true` requires every selected
  destination to acknowledge. Any missing required inbox routing or failed selected
  relay produces `ok: false`, retaining signed event and per-relay outcomes when
  available. This strict policy avoids reporting successful partial delivery;
  confirm against pinned binding behavior during the contract audit.
- **O-D03 — host limits:** retain bounded public-network access. Over-limit writes
  fail before signing rather than silently dropping destinations. Bounded reads
  report incomplete coverage. Document exact limits after measuring the existing
  transport and signer deadlines.
- **O-D04 — optional features:** resource sidecars stay default-off. Add relay health
  tracking only if needed for reliable routing; active NIP-66 crawling is deferred.

## Delivery sequence

### O-01 — contract audit and end-to-end tracer

Read PROTOCOL.md and NAP-REVIEW.md before changing behavior. Pin the NAP-RELAY
RelayEventResult dependency, relevant RESOURCE privacy rules, NIP-01 and NIP-65
revisions, installed shim envelopes/types and upstream conformance revision as one
reviewable compatibility record. Check the exact installed source maps rather than
assuming current documentation matches published packages. Resolve discrepancies
explicitly; upgrade only when necessary and preserve the selected NIP-5D authority.

Build a real-shim specimen using a signed ordinary napplet: query kind-1 events,
request viewer approval for one kind-1 template, sign once in the host, publish to
the viewer's advertised write relay, then read back the exact event ID. Exercise
the same host in website and preview. Keep generic publication behind a development
gate until the routing and failure work below passes.

Acceptance: operation/result names and correlation are inventoried; no iframe signer;
one signing call and one event ID across all destinations; consent denial causes
zero signatures and zero event writes. O-D01 must be settled before consent policy
implementation. No production capability claim follows from the tracer alone.

### O-02 — shared relay planning and complete reads

Extract a host-owned planner from PlaybackNostr.plan. Keep routing purpose explicit:
author event reads use author write relays; own publication uses viewer write relays;
recipient delivery uses recipient read relays. Do not reuse an inverted direction
helper without an explicit purpose mapping. Normalize/deduplicate URLs and enforce
the existing public destination policy at every connection.

Use verified latest kind-10002 records, deterministic timestamp/ID ties, bounded
cache freshness, refresh and cancellation. Distinguish absent metadata, empty lists,
failed discovery and policy-denied relays. Read/own-write fallback is allowed;
fallback must never substitute for an unresolved required recipient inbox.
Plan across authors within quotas; account for every omitted author/relay.
Keep resolveRelays advisory and apply disclosure/redaction policy.

Use one verified event store per host data scope where caching is introduced;
reuse existing Applesauce infrastructure rather than creating competing stores.
Audit getEvent ID matching, single/array filters, options.limit versus filter limits,
zero/invalid values, author hints and tag-derived routing policy. Cache hits cannot
claim complete network coverage. Preserve caller deadline margins and partial data.
Merge only actually observed, disclosable relay URLs into returned event sidecars.

Acceptance: marked/unmarked NIP-65 lists, equal-time replacements, malformed records,
mixed author coverage, stale caches, policy rejection, forged/wrong-ID events,
duplicate hints, stalled relays, completed empty reads and partial failures all have
deterministic outcomes through the shim. No partial read masquerades as complete.

### O-03 — live routing and lifecycle

Refresh relevant relay lists while streams are open. Add/remove relay requests
without losing the subscription identity or redelivering existing event IDs.
Bound backfill separately from future live delivery. Specify initial timeout,
connection failure, reconnection, maximum lifetime and quota termination policy.
Keep relay EOSE internal to OUTBOX. Emit one terminal closed message and release
all sockets/listeners/timers on explicit close, host shutdown or identity change.
Use bounded deduplication state with a documented lifetime strategy.

Acceptance: events continue after all relay EOSE messages, routing changes deliver
new events without duplicates, close-during-discovery settles, repeated close is
safe, quota/timeout reasons are useful, and no post-close events escape. Verify
identity changes and player teardown in real browser integration.

### O-04 — general signing and mandatory publish fanout

Add a dedicated generic OUTBOX publication session. Validate bounded unsigned NIP-01
templates and all options before prompting; define treatment of extra signed fields
and caller timestamps against the pinned binding. Support ordinary kinds without a
Soy record schema or publisher provenance requirement. Explain any policy-denied
kind explicitly. Consent displays the signing account, napplet identity, kind,
content/tags and intended destinations without rendering untrusted HTML.

Resolve the deduplicated union of own write relays (default toOutbox=true), every
requested recipient's read relays and explicit validated URLs. toOutbox=false must
avoid adding the viewer's outbox; do not infer recipients from p tags. Preflight
required routing and quotas before signing; reject an empty target set. Never
truncate mandatory recipient destinations to fit a generic relay cap.

Sign an exact immutable template once, validate the returned signature, pubkey and
all submitted fields, then reuse those bytes for every destination. Enforce account
and frame cancellation across consent, discovery, signing and publication. Return
event/eventId when signing occurred, per-relay acknowledgements and a safe actionable
cause for rejection, timeout, policy denial or partial delivery. An acknowledgement
does not prove permanent storage or recipient receipt.

Retain the same signed event for bounded transport retries; never re-sign inside a
relay retry loop. Define request-ID deduplication per frame and explicitly document
that the upstream API supplies no durable idempotency across fresh publish calls.
Test the real signer deadline: a late signer response must not trigger publication
after the shim has timed out or the account changed.

Acceptance: default own-outbox, inbox-only, explicit-only, overlapping targets,
unmarked list entries, missing inbox lists, disallowed/private destinations, excess
fanout, rejection, silent relays and mixed acknowledgements. Assert one signing call,
identical bytes on every relay and no false success for required fanout failure.

### O-05 — specialized writes and host integration

Integrate both players and account adapters. Audit backend-account signer kind
restrictions and frame capability dispatch. Existing app-data/map schema, ownership,
revision, deletion and conflict protections must not become optional by dispatching
the same records through generic publication. Reconcile specialized handlers with
OUTBOX's default own-outbox and mandatory toInboxes rules; either honor options or
return a policy failure, never silently ignore or reroute them. Keep NAP-RELAY's
lower-level semantics distinct.

Acceptance: existing app-data/map tests pass, including malformed record attempts
and generic-handler bypass tests. A third-party napplet gets the same policy as a
Soy-built napplet. Signed-out, read-only, revoked and switched accounts fail safely.

### O-06 — conformance evidence, guidance and release readiness

Run targeted routing/session tests, actual shim tests and local multi-relay process
tests with controllable EOSE/CLOSED/OK/rejection/timeouts. Use real browser tests
for consent, teardown, account switching and web/preview parity. Compare upstream
conformance expectations to the pinned tuple and record any unsupported runner
paths. Add a creator specimen for query, subscription, consented publication,
recipient inboxes, explicit-only targets and partial failure recovery.

Run typecheck and the existing relevant runtime, app-data, map and protocol suites.
Build both website and CLI preview bundles. Before pushing shared-package, CLI,
dependency or embedded-guide changes, run `bun run check:nix`, including the required
KVM regressions; use the documented hash update procedure only on a hash mismatch.
Verify safe useful failure causes through real entrypoints, without raw requests,
credentials or signer exception dumps.

Update PUBLIC-RUNTIME.md, COMPATIBILITY.md, PROTOCOL.md and NAP-REVIEW.md with the
implemented contract, exact pins, limits and evidence. Update affected creator and
specialized feature documents. Track implemented, locally verified, released and
deployed independently. Deployment remains a separately authorized task.

## Completion gate

Every operation has a successful actual-shim test and representative failure tests;
all mandatory upstream behaviors map to evidence; required publish fanout never
silently degrades; one request signs at most one event; lifecycle cleanup is proven;
existing specialized writes retain protections; website and preview match; package
checks pass; documentation states remaining optional features and host policy limits.
Foundation work or a working kind-1 tracer alone does not satisfy this gate.
