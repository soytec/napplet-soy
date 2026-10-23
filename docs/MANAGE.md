# Manage

The shell's **Manage** link opens `/manage`. Its tabs share the current account:

- **My work**: existing creations/drafts, incoming proposals, contributions,
  activity and publication recovery. Notification dots still indicate unread work.
- **Wallet**: the account's [NIP-60/61 wallet](WALLET.md), payments, transaction
  history, mints, wallet relays and encrypted recovery.
- **Relays**: add/remove website Nostr relay and Blossom URLs, restore site
  defaults, and manage multiplayer permission. These are browser preferences,
  not a published NIP-65 relay list. Changing website relays does not move funds
  or change an existing wallet's designated relays.
- **Profile**: the existing kind-0 editor and a link to the public profile. Editing
  preserves unknown fields, checks for concurrent changes and requires a signed,
  acknowledged publication using the shell account.

Tabs support keyboard navigation and browser history. Links can use `#work`,
`#wallet`, `#relays` or `#profile`; work subtabs use `#creations`, `#proposals`
and `#activity`. `/network` redirects to `/manage#relays`. The account menu's
profile shortcut opens `/manage#profile`; public `/p/<pubkey>` pages remain
available. The header wallet popover links to `/manage#wallet`.

Relay preferences remain available while signed out. Work, wallet access and
profile editing require the selected account. This navigation change does not
alter existing drafts, Git repositories or the local soyLI flow.

Locally verified on desktop and at 390px: direct tab links, keyboard navigation,
browser history, the legacy network redirect, profile editing and wallet creation
with a local-only website relay configuration. Payment buttons were checked for
profiles with no destination, Lightning only and nutzaps only.

Implemented and locally verified; not deployed.
