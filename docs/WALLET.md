# Shell Cashu wallet

Implementation on `codex/nip60-wallet`; not deployed. The wallet belongs to the
selected shell account. It is available beside the account button and under
**My work → Wallet** (`/manage#wallet`). It does not grant wallet access to napplets.

## Supported flows

- Create or unlock a NIP-60 wallet using the account's NIP-44 signer (extension,
  remote signer or local account). A separate Cashu receiving key is encrypted
  in the wallet event; it is not the Nostr identity key.
- Receive Lightning through a mint invoice; pay a fixed-amount BOLT11 invoice
  after reviewing the amount, maximum fee and mint. Quotes are polled while the
  wallet is open. A timeout leaves a recoverable pending transaction.
- Send or redeem Cashu tokens, display static or animated QR codes, scan with the
  camera, or read a QR image. Scanning fills an input; it never initiates payment.
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
pending and retry identical signed events. Private wallet events are not sent to
recipient relays. Receiving an ACK is not a guarantee of indefinite relay storage.

IndexedDB holds account-separated AES-GCM encrypted recovery data with a
non-exportable device key. This protects stored values, not against malicious
scripts running on the same origin. The Nostr signer encrypts exported backups to
the same account. Keep account recovery separately and export before clearing
browser data. Relay-only recovery cannot reconstruct an unfinished mint request
whose blinding secrets were only on the lost device.

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
real funds or establish live mint/relay interoperability. Suggested mint info
endpoints were checked for sat BOLT11, NUT-11 and NUT-12 support. Physical-camera
scanning and an independent-wallet payment remain release acceptance checks.

Run `bun test packages/wallet` and `bun run check`; build with `bun run build`.
Before pushing the changed dependency lock or shared packages, run the repository's
Nix validation and review any fixed-output dependency hash update. A small real
payment between independently operated wallets remains a separate pre-release
acceptance check, requiring the user's payment authorization.
