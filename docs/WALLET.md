# Shell Cashu wallet

Implementation on `feature/nip-60-and-UI`; not deployed. The wallet belongs to the
selected shell account. It is available beside the account button and under
**Manage → Wallet** (`/manage#wallet`). It does not grant wallet access to napplets.
After sign-in or restoring a saved account, wallet loading starts automatically
once the signer is ready. It never creates a wallet or trusts mints automatically.
Signer failures offer a manual retry instead of repeated prompts. Locking keeps
the wallet closed during the current page session, including route changes;
reloading the app starts automatic loading again.

The header popover starts with the balance, mint selector and four actions:
receive/pay Lightning and receive/send Cashu. Each action replaces the menu with
its own form. QR and text views toggle instead of occupying space together;
the **Transactions** button opens history, and mint settings and token recovery
open only when requested. Manage → Wallet also shows history below the actions.
Normal actions fit without internal scrolling at the verified desktop and phone sizes; overflow
remains available for long settings/history, smaller screens and enlarged text.

## Supported flows

- Create or unlock a NIP-60 wallet using the account's NIP-44 signer (extension,
  remote signer or local account). A separate Cashu receiving key is encrypted
  in the wallet event; it is not the Nostr identity key.
- Receive Lightning through a mint invoice; pay a fixed-amount BOLT11 invoice
  after reviewing the amount, maximum fee and mint. Quotes are polled while the
  wallet is open. A timeout leaves a recoverable pending transaction.
- Send or redeem Cashu tokens, display static or animated QR codes, scan with the
  camera, or read a QR image. A complete pasted/scanned Cashu token from a trusted
  mint is received immediately, with progress, success feedback and a balance
  update; there is no separate review/confirmation step. Retrying the same token
  resumes its saved transaction without crediting it twice. Unknown mints still
  require explicit trust in settings. The camera stops after a successful read.
  Background settlement checks do not close the scanner; a decoded token waits
  for an active wallet operation before receiving.
  Lightning inputs still require amount/fee review and confirmation before payment.
  Outgoing invoices and tokens can be shown as QR or text, copied or downloaded.
  An unspent sent token can be reclaimed through the receive flow.
- Add, edit and remove mint URLs. Minibits, Coinos and 21Mint are suggestions,
  never automatically trusted. Mints with funds or unresolved transactions cannot
  be removed. Changing a URL does not migrate funds. Each mint has its own balance.
- Advertise accepted mints and a dedicated receiving key through NIP-61; review
  and redeem incoming nutzaps. The mint, recipient lock and DLEQ proofs are checked.
- Read typed transaction history, including encrypted Nostr history from other
  clients. Encrypted backups include pending operations and unshared tokens.
- In the zap dialog, pay the existing Lightning zap invoice from a mint, or send
  a nutzap if the author advertises an accepted mint. A nutzap needs a shared mint.
  Paying a Lightning invoice and receiving a provider's NIP-57 receipt are separate
  facts; the wallet does not manufacture zap receipts.

The first implementation uses **sats, Bitcoin mainnet BOLT11 and HTTPS mints**.
It does not implement BOLT12, on-chain quotes, multi-currency wallets or automatic
cross-mint swaps. Existing social zap counters still count verified NIP-57 receipts;
nutzaps appear in wallet activity, not in those Lightning totals. Contributor split
payments are future work and need their own explicit allocation/consent flow.

## Protocol contract

Dependencies are pinned to Applesauce wallet/common/core/relay/signers **7.0.0**,
Cashu TypeScript **4.11.0**, and QR Scanner **1.4.2**. The selected NIP-5D proposal
and napplet runtime pins are unchanged. References:
[NIP-60](https://github.com/nostr-protocol/nips/blob/master/60.md),
[NIP-61](https://github.com/nostr-protocol/nips/blob/master/61.md), and the
[Applesauce wallet example](https://github.com/hzrd149/applesauce/blob/6ccf90611d96d91e9852bcf7287edc80d7646dc1/apps/examples/src/examples/wallet/admin.tsx).

| Kind | Use |
| --- | --- |
| `17375` | NIP-60 replaceable wallet, self-encrypted with NIP-44; mint URLs, dedicated key and wallet relays. |
| `7375` | Self-encrypted mint/proofs/unit and `del` references to replaced token events. An empty change event still records superseded proofs. |
| `7376` | Self-encrypted NIP-60 direction, amount, unit, created/destroyed token references; nutzap redemption includes public `e`/`redeemed` and sender `p`. |
| `10019` | Public NIP-61 receiving information: dedicated `pubkey`, wallet relays and accepted sat mints. Disabling reception publishes no mint tags. |
| `9321` | Public NIP-61 nutzap with DLEQ proofs locked to the recipient, exact advertised `u`, `p`, `unit`, optional comment and target. |
| `5` | NIP-09 deletion request for superseded kind-7375 events. |
| `22242` | NIP-42 wallet-relay authentication when requested. |

Compatible extensions are encrypted `mint`, `fee` and `type` history tags, and
`a`/`k` nutzap target tags alongside `e`: addressable napplets use their stable
`kind:pubkey:d` address. No new event kind or companion object is introduced.
No kind-375 private-key backup or kind-7374 quote event is emitted. Pending quotes
and prepared outputs are kept in the device journal and optional encrypted backup.

## Recipient discovery and relay policy

Zap actions are shown only after finding a valid Lightning destination in the
recipient's kind-0 profile (`lud16` or `lud06`) or valid sat nutzap receiving
information (kind `10019`). NIP-65 write relays extend recipient discovery.
Replaceable winners are selected before validating their contents: removing an
address or withdrawing nutzap reception never revives an older configuration.
The Lightning provider's NIP-57 support is verified when opening the dialog.
An address alone is not a guarantee that its provider is online or supports zaps.
Requests are shared per author, refreshed after a minute while visible and on
focus, and update the UI as verified events arrive. Failed discovery does not
expose a dead payment action. Existing split-zap targets remain unsupported.

Wallet traffic is an explicit exception to local-only shell development routing.
Wallet bootstrap uses configured public WSS relays; if the shell has only local
relays, it uses the shared public discovery list. Reads **and signed wallet
writes** can reach those external destinations. Existing wallet relay settings
and the recipient's advertised destinations govern subsequent operations.
This does not change relay policy for napplet frames, app publication, profile
editing or general shell actions. Wallet data remains in its isolated account
store; public recipient metadata and receipt lookups use a separate signer-free
payment client. Neither private wallet proofs nor wallet history are seeded into
the public shell cache.

Loading reuses a saved wallet's own relay addresses. On a new device, the first
lookup fetches wallet data together with relay hints; a second lookup is needed
only for additional advertised destinations. Verified events enter the store as
they arrive. Once a wallet is known and a relay completes its snapshot, the
Applesauce group read policy allows quiet stragglers to stop blocking the initial
view (3-second grace, 1.5-second idle detection, within the 12-second lookup budget).
An empty first relay alone does not end wallet discovery. The live wallet loader
continues synchronization after opening; initial results are not a guarantee of
complete history across offline relays. Mint proof-state checks still precede spending.
Local and production wallets contact relays and mints from the browser; adding
relays improves redundancy but does not inherently make these operations faster.

Review and change wallet relays under **Manage → Wallet → Mints & settings**. The
**Manage → Relays** form edits website relay and Blossom preferences; it does
not migrate wallet data. See [management navigation](MANAGE.md).

## Settlement feedback

While unlocked, the wallet checks outstanding quotes and sent tokens in rotation,
one transaction every ten seconds. It hides a Lightning invoice as soon as its
mint quote is paid or issued, including while wallet synchronization is still
pending. Expired invoices are hidden too, but remain checkable for payment near
their deadline. Successful recovery updates the balance and shows confirmation.
Background outgoing checks never submit or retry a Lightning payment.

Creating a Cashu token means it is ready to share, not that the recipient has
redeemed it. NUT-07 proof-state checks update this distinction. A redeemed token
loses its QR, text and reveal controls; partial or pending redemption also hides
the code and disables reclaim. The encrypted recovery record remains available.
This is mint-reported proof status, not proof of who received the token.

## Money and recovery boundaries

Applesauce supplies event loading, decryption and wallet factories; monetary
operations use explicit Cashu prepare/complete calls. Before a mint can consume
proofs, the account journal stores its inputs, exact blinded outputs and unselected
proofs. After an ambiguous response, NUT-09 restores those same outputs. A Lightning
payment is checked through its existing quote, never replaced by a new payment.
An unpaid failed melt can atomically swap its reserved, unspent proofs back.

Signed wallet updates are saved in a durable outbox before relay publication.
At least one designated wallet relay must acknowledge each wallet event; a nutzap
must be acknowledged by a recipient relay. Delivery includes the recipient’s verified
NIP-65 read relays; redemption history is also forwarded to the sender’s read
relays on a best-effort basis. Rejected or interrupted writes remain
pending and retry identical signed events. Each event is sent to all selected
destinations, but proceeds as soon as a required relay acknowledges it; other
copies finish in the background. Optional receipt-relay acknowledgements cannot
substitute for a required wallet relay. Private wallet events are not sent to
recipient relays. Receiving an ACK is not a guarantee of indefinite relay storage.

IndexedDB holds account-separated AES-GCM encrypted recovery data with a
non-exportable device key. This protects stored values, not against malicious
scripts running on the same origin. The Nostr signer encrypts exported backups to
the same account. Keep account recovery separately and export before clearing
browser data. Relay-only recovery cannot reconstruct an unfinished mint request
whose blinding secrets were only on the lost device.

NIP-09 deletion timestamps never predate the superseded token events, including
events whose timestamp was rounded up by the library. This prevents old proofs
from reappearing in the local balance after consecutive transfers.

A Web Lock prevents two tabs in this browser from spending the same wallet.
Account switches close the old wallet. Proof-state checks detect concurrent use
on other devices; there is no cross-device transaction lock. Pending operations
must be resolved before starting another spend. Unknown errors are sanitized so
proofs, invoices, credentials and provider response bodies cannot leak into logs.

Mints hold the backing bitcoin. DLEQ checks authenticate proofs from a mint; they
do not establish solvency. Users must deliberately choose their operators.

## Verification

Unit/integration tests use an in-memory mint with real Cashu blind signatures,
DLEQ and P2PK witness checks, and fake Lightning settlement. They exercise lost
responses, process restart, relay rejection, input fees, mint removal, duplicate
invoices, forged nutzaps, recovery data durability and chunked encrypted backups.
Browser checks cover creation, QR-image input, Cashu send/receive, Lightning
quotes and settlement, balance/history, encrypted backup download, lock/reopen
and the mobile header popover against isolated fake services. Device storage
encryption and sign-out cleanup are checked in the browser too. They do not spend
real funds or establish live mint/relay interoperability. Simulated camera video
exercises the actual decoder for Lightning, static Cashu and animated Cashu QR,
including stopping all camera tracks after a read. Paid invoice and redeemed-token
QR removal are verified through automatic polling. Automatic opening on sign-in
and saved-account restoration, manual locking across route changes, cross-tab
locking and manual retry were checked. The wallet home, invoice and token-sharing
popover fit at 390 × 844 without internal scrolling. Suggested mint info
endpoints were checked for sat BOLT11, NUT-11 and NUT-12 support. Physical-camera
scanning and an independent-wallet payment remain release acceptance checks.

The direct-receive browser flow also covers paste and camera receipt without a
confirmation screen, duplicate input, unchanged outgoing-payment review, balance
restoration and a deliberately silent relay. Regression tests verify that a
required relay acknowledgement releases a save, optional receipt-relay ACKs cannot
substitute for it, and an empty first relay cannot prematurely end wallet discovery.

Run `bun test packages/wallet` and `bun run check`; build with `bun run build`.
Before pushing the changed dependency lock or shared packages, run the repository's
Nix validation and review any fixed-output dependency hash update. A small real
payment between independently operated wallets remains a separate pre-release
acceptance check, requiring the user's payment authorization.

A disposable zero-balance identity was also tested against a public relay and a
real mint: wallet configuration publication/ACK, fresh relay read and NIP-44
unlock, mint/key recovery, nutzap recipient discovery and reception withdrawal
passed. The test wallet deletion was acknowledged. No real funds were sent.
This is not an independent-wallet payment interoperability test.
