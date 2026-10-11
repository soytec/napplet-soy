# Unpublish, republish and delete hosted data

soyLI 0.17.0 and the website share the same author-controlled lifecycle code.
The author signs ordinary NIP-09 deletion requests and Blossom authorization
events. Requests go directly to the selected relays, Blossom servers and GRASP;
there is no Soy deletion proxy or website account requirement for the CLI.

## Website

Sign in with the publishing identity. Open **Manage publication** on its napplet
page, or **Your napplets** in the identity menu (`/manage`). Choose an operation,
review its targets, then confirm. **Delete hosted data** additionally requires
typing `DELETE`. Inspection never signs a request or modifies a service.

The dialog updates each service separately: ready, running, done, retained,
awaiting confirmation or failed. A failed mirror does not hide successful work.
Retry unfinished steps after reviewing the same inventory. Refresh an incomplete
inventory before attempting storage deletion; a retry does not silently expand
the confirmed selection.

The browser saves progress and public signed recovery data before sending requests.
Download **Save recovery record** before clearing browser data or changing devices.
Import it on **Your napplets**, signed in as the same author. It contains no private
key. An unpublished listing may be unavailable from relays, so retain this record
or the original soyLI project. Ordinary external publications are supported without
a Soy publishing journal; only assets and history that can be discovered are listed.

The review lists every selected signed release by event ID. For the new standalone
format, a named/root release and snapshot enter the same removal inventory only
when their signatures, author, timestamp, artifact and all shared signed metadata
match exactly. The author must confirm that selection. Matching bytes or `a`/`A`
ancestry alone never selects a snapshot, and managing an independent snapshot never
selects its parent. This inventory association does not change playback, storage,
backend or social identity.

A fresh browser checks relay results and the site's retained signed index history,
then verifies every returned manifest and pair itself. This includes observed older
named revisions that a relay has already replaced, and their exact paired snapshots.
The read-only history endpoint is bounded to 128 named/root revisions, 128 snapshots
and 2 MiB. Coverage notes distinguish absent, truncated and unavailable history;
truncation or a failed history request retains hosted files until a fresh complete
inventory is available. Unobserved snapshots remain independent and are not selected
merely because the same author published them. Saved receipts freeze the reviewed
event IDs; retries never discover and delete additional releases.

## soyLI

Run these in the original publishing project, with its publishing identity selected:

```sh
soyli unpublish
soyli republish
soyli delete
soyli lifecycle
```

Each modifying command shows its inventory and asks for confirmation.
`unpublish` requires `UNPUBLISH`, `republish` requires `REPUBLISH`, and `delete`
requires `DELETE`. `lifecycle` shows the saved progress without changing services.
Local project files, Git history and private keys are never removed.

For an agent or noninteractive terminal:

```sh
soyli delete --dry-run --json
# Review receipt.plan and receipt.steps; obtain the user's confirmation.
soyli delete --confirm TOKEN_FROM_THE_PREVIEW --json
```

The token binds the exact operation and inventory. Noninteractive invocations
without it fail before signing. There is no blanket `--yes`. `--resume` restores
the saved operation and still requires confirmation. `--resume --dry-run --json`
shows its token again. Progress lives in the ignored
`.napplet-space/<network>/lifecycle.json`. The publisher lock prevents simultaneous
CLI lifecycle/publication changes in the same project. Missing journals require
the website flow; a private key alone cannot enumerate undiscoverable historical data.

## What each operation means

| Part                                                      | Unpublish                                                     | Delete hosted data                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Current listing and discovered snapshots                  | Send author-signed NIP-09 requests; check each selected relay | Same                                                                                   |
| Linked app descriptors                                    | Keep them for republishing                                    | Request deletion of known descriptors that are not reused by another napplet           |
| Build, source archives, runtime assets, images and videos | Keep hosted files                                             | Signed Blossom DELETE for each inventoried hash/server                                 |
| Git repository                                            | Keep it public                                                | NIP-09 request to its GRASP relay; verify announcement and public Git download removal |
| Same-author reused files/repositories                     | Keep                                                          | Retain to avoid breaking another creation                                              |
| Local source, keys, other people's comments/zaps/forks    | Keep                                                          | Keep                                                                                   |
| Backend/CVM game state and scores                         | Provider retention applies                                    | No backend purge is requested; manage this with its provider                           |

**Republish** verifies that the saved build is still available and signs a fresh
current listing under the same key/identifier. Its naddr and readable route stay
the same. Previously deleted immutable `/r/...` links remain deleted. Ordinary
`soyli publish` after unpublishing also creates fresh current/snapshot events,
even if the source is unchanged. If the build has been deleted, publish from the
local source project to upload files again instead of recovering the old listing.
A newer remote publication invalidates a stale confirmation.

## What “deleted” can honestly confirm

- A relay row is done only after it accepts the request and no selected event is
  visible in the follow-up query. Accepted but still visible is **awaiting confirmation**.
- A Blossom row is done when a follow-up HEAD returns 404. A successful DELETE
  followed by available bytes is **retained**: the server may have another uploader
  or a retention policy. Soy removes the author's claim and erases bytes only when
  no uploader claims remain. An authorization failure includes the server status
  and a retry instruction.
- The pinned GRASP `cdda4a23fe5dede2411e18aaa8b82c1747c97ddf` removes the public
  repository and keeps a recovery archive for **90 days by default**, followed by
  its periodic cleanup. Its row explicitly reports that retention; this workflow
  does not claim physical erasure of the archive. Operators can use GRASP's own
  archive management tools. Other Git hosts require their own removal process.
- The Soy index drops deleted projection/cache references when it receives the
  deletion, and its worker prunes unreferenced artifacts/previews. This is eventual
  index convergence, not a synchronous browser confirmation or backup wipe.

Inventory uses verified manifests/descriptors and available publication history.
Runtime references are extracted from hash-verified HTML without executing it.
Unavailable relay inventory or unreadable runtime dependencies prevent storage
deletion. Arbitrary embedded URLs, hosts without supported deletion, unknown older
uploads and repositories without a GRASP relay hint need separate handling.

No protocol can recall downloads, independent relay/storage mirrors, caches,
backups or other people's clones and forks. Inventory is bounded and cannot act as
a global reference count. Avoid publishing concurrent changes from another device
while deleting; independent services do not provide a distributed transaction.

## Verification

Tests cover read-only previews, confirmation tokens, wrong authors, stale
confirmations, shared-file protection, per-service failures, exact signed retries
and fresh republishing. The production migration browser test also covers fresh
shell confirmation of current and retained historical exact pairs while independent
snapshots remain published. The real CLI test uses isolated Khatru, Blossom and the
pinned native GRASP. A browser test covers mobile confirmation, progress, reload
recovery and republishing through an extension signer. No real user publications
are deleted by these tests.

### Linked source repositories

Deleting a napplet retains a creator-owned repository selected with
`publish.repository` or an owned `nostr://` remote, even when the repository and
napplet identifiers match. New linked publications carry the optional signed
`soy-source-repository` retention policy; the CLI also uses its local publication
journal for previously signed releases. The review inventory labels these
repositories as retained. A former soyLI-hosted copy at a different address can
still be included for deletion unless another napplet uses it. This cleanup
metadata is not required for discovery or playback.

### Creator outbox copies

CLI inventories include every retained job's primary, mirrors and cumulative
attempted NIP-65 outbox destinations. Failed attempts can have stored part of a
release and remain in the inventory. Changing the relay list during an unchanged
retry does not erase older destinations. Up to 256 known relays can be reviewed;
a larger inventory is refused explicitly, never silently truncated to eight.
The browser adds the author's current NIP-65 write relays and relays from its
previous saved inventory. A relay-list lookup failure marks the inventory incomplete.
This still cannot identify unknown third-party copies or old destinations that
were never retained locally and no longer appear in the author's relay list.
