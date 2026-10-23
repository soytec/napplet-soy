# Invitation links: protocol review

Reviewed 2026-10-22. **Direct public URL delivery is blocked by a protocol gap.**
This document proposes no runtime change, new event kind, namespace, or manifest
field. It does not change Soy's selected specification pins.

## Desired behavior

A player opens a link to a verified napplet and reaches the invited table without
copying a room code. Only that selected player receives the launch payload, after
its receiver is ready. An existing match must not be replaced silently. Ordinary
network consent, artifact verification, and the opaque iframe sandbox remain.

## Sources checked

- Nostrbook MCP `@nostrbook/mcp@0.5.3`: actual `read_nip` calls for NIP-19 and
  NIP-21 succeeded. `read_nip("5D")` reported that this proposal is absent from
  the official NIPs repository; that is a coverage limit, not an audit of NAPs.
  [MCP documentation](https://nostrbook.dev/mcp).
- [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md) defines the
  `naddr` identity encoding. [NIP-21](https://github.com/nostr-protocol/nips/blob/master/21.md)
  defines `nostr:` URIs. Neither defines a Soy player URL's invitation fragment.
- Soy's selected [NIP-5D revision
  4d0fb2e](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md)
  defines verified manifests, sandboxing, injected domains, and `z`/`i`
  advertisements. Domain message semantics belong to the corresponding NAP.
- [NAP-INTENT at Soy's e5308ac pin](https://github.com/napplet/naps/blob/e5308ac92cfd49e4fb026812c60886571515e219/naps/NAP-INTENT.md)
  was compared with the same file at [master 19de5ce](https://github.com/napplet/naps/blob/19de5ce1cea40cd4c76089cdd8126e9f87648049/naps/NAP-INTENT.md).
  The files are identical. Its catalog-identifier and sender requirements apply.
- [NAP-INTENT #106](https://github.com/napplet/naps/pull/106), head `fc121fc`, is
  open. It reconciles recommendation fragments and catalog identifiers; it does
  not authorize an invented shell sender.
- [NAP-INTENT #128](https://github.com/napplet/naps/pull/128), head
  `652524288c269c9acc823e041e915d1d1f891d6b`, proposed null shell provenance and
  delivery IDs. It was closed **without merge** on 2026-10-19. Do not silently
  adopt it as the current contract. [NAP-NAVIGATION #126](https://github.com/napplet/naps/pull/126)
  refers to that proposal and does not independently fix the missing contract.

## Finding: fabricated source provenance

The withdrawn local prototype decoded a fragment such as
`#intent=napplet:cardtable/join&table=<room>.<host>` and sent `intent.deliver` with
`sender: "soy:link"`. That sender did not identify a verified source napplet.

The selected NAP-INTENT contract requires the runtime to derive the source
identifier from its verified manifest and authenticated endpoint. Labeling a
made-up sender as "untrusted URL input" does not satisfy that requirement.
Changing it to the target's identity would falsely claim a source. Using null
would silently adopt a different, unmerged wire contract. Neither is a fix.

The prototype is therefore **not a conforming host patch and must not be shipped**.
The public HTTPS fragment itself would be a Soy URL convention, not a NIP-19,
NIP-21, or cross-shell link standard. `napplet:cardtable/join` is an app convention.

## Resolution needed before implementation

Agree on a normative external/shell-origin delivery contract and pin it together
with compatible host, shim, SDK, and conformance implementations. Alternatively,
an actual verified source napplet can use ordinary INTENT invocation; a URL alone
must not be treated as that source. This review does not select or implement an
alternative protocol, publish a launcher, or revive a closed proposal.

Once the contract is agreed, implement these acceptance cases:

1. Cold URL opens the exact verified target; it receives the payload only when ready.
2. No delivery to review previews, other catalog entries, or a replaced endpoint.
3. Forged source identities and delivery metadata are rejected or ignored according
   to the selected contract; advertisements never grant additional capabilities.
4. Malformed encoding, repeated decoded keys, unsupported conventions, and excessive
   payloads fail safely. Normalization preserves literal plus signs and string values.
   Document URL-specific bounds separately from NAP payload requirements.
5. Duplicate handling and guest reload preserve a live match; a new invitation
   cannot silently replace it. Errors remain visible without replaying game moves.
6. Public player, CLI preview, four isolated browsers, and four physical devices
   are checked separately, including a mobile-data guest and reconnect behavior.

## Evidence and release boundary

The withdrawn prototype passed 29 targeted tests / 162 assertions, type checking,
the web build, and the immersive web service test / 101 assertions against Soy
`e5b23fa80603d85d6e2fac5e380e39c2fc9f9e2e`. Those results demonstrate prototype
behavior, **not specification conformance**. Nix verification was interrupted and
is incomplete. No prototype code belongs in the documentation-only contribution.

The game already accepts valid ordinary INTENT deliveries and supports manual
invitation entry on the current host. Public direct links, public deployment,
and four physical devices remain unverified. A local patched preview does not
establish release readiness. This audit covers invitation delivery only; it is
not a full WebRTC, signaling, publishing, or application security audit.
