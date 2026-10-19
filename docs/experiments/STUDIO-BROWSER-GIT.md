# Studio browser Git experiment

Status: implemented as an opt-in local experiment, not deployed or the default
source of truth. Existing drafts, server Git repositories and soyLI flows remain
unchanged.

## Result and boundary

A browser can perform the Git work required by GRASP. No new Nostr event or protocol
wrapper is needed. GRASP still hosts the remote repository; moving Git execution
does not eliminate remote storage or make a public repository private.

| Operation                                         | Browser                                                      | Local Studio service / GRASP                                       |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------ |
| Import an existing private Studio draft           | Index ordinary Git pack and source into IndexedDB            | Read-only, authenticated export; retain native workspace           |
| Inspect, edit, compare, checkpoint, export backup | Worker running isomorphic-git; LightningFS persistence       | No call needed                                                     |
| Clone public source (integration fixture)         | Direct Git Smart HTTP fetch and exact-commit check           | GRASP serves Git objects, with CORS                                |
| Authorize a push (integration fixture)            | User signing belongs here in the future UI                   | Fixture signs kind 30618 with a disposable key; GRASP validates it |
| Push (integration fixture)                        | Direct Git Smart HTTP, expected old ref and non-force update | GRASP accepts only the authorized commit                           |
| Maker, preview, publication and proposals         | Existing Studio UI/signing and optional browser compiler     | Existing workspace, OpenCode, release checks and soyLI paths       |

The History panel currently exposes the independent local-copy operations only.
It does not expose public cloning/pushing or synchronize browser edits into the
agent's workspace. A checkpoint does not rebuild the playable preview. Placeholder
Git commit authorship is not a Nostr signature or ownership proof.

## Dependencies and safeguards

Pinned dependencies: isomorphic-git 1.44.3, LightningFS 4.10.3 and buffer 6.0.3.
The Git worker is created only when the panel is opened; Vite prebundles its
dependencies to avoid interrupting a live Studio session on first use.

IndexedDB is scoped by shell origin, Studio endpoint and draft ID. A Web Lock
serializes full operations across tabs; saves compare prior file contents and
commits compare HEAD. Completed operations flush the filesystem before acknowledgement.
A reload can reopen the saved repository. Storage eviction, private browsing and
clearing site data are not a backup strategy: export the copy when needed.

Import preserves the original HEAD and reachable history, plus current uncommitted
and untracked public source. It does not transfer Git config, credentials or local
bindings. Native export applies source/history validation and checks that the
workspace did not change during export. Browser imports verify the snapshot digest,
stage objects and files before switching the active pointer, and reject links or
submodules. One prior import is retained; older/abandoned staging trees are collected
under the lock. Corrupt imports leave the previous working copy available.

Refresh is deliberately conservative. An identical source revision is a no-op.
A newer revision cannot overwrite changed browser files or browser commits. Backup
export/restore preserves Git history; automatic merging and resetting are not part
of this experiment.

Direct transport permits only the chosen Git endpoint, omits ambient credentials,
rejects redirects, bounds transfers, and supports HTTPS (loopback HTTP in local
Studio). A clone must match the selected commit. Push checks the expected remote
main ref both before negotiation and in the outgoing update command, uses no force,
and verifies the resulting remote commit. Signed Nostr state remains the authority.

Profile limits: 1,024 regular source files, 40 MiB source, 40 MiB per pack/HTTP
response, 10,000 reachable objects on backup export, and 256 KiB text editing/diffs.
These are experiment limits, not new protocol limits. A compressed-pack size bound
is not a browser memory guarantee for arbitrary untrusted repositories.

## Verification

```sh
bun test apps/studio/browser-git.test.ts
bun test tests/services/studio-browser-git.test.ts
bun run check
bun run build
```

The service fixture starts the pinned local GRASP binary and Chromium on separate
origins, with disposable repositories and a generated author key. It proves a
browser-worker clone, edit and commit; reload persistence; rejection without signed
state; acceptance after publishing a matching kind-30618 state; and an independent
native clone with the same commit, parent and file bytes. A stale remote update is
rejected. Two live tabs sharing IndexedDB also reject stale file saves and stale
checkpoint HEADs. It makes no public source changes and uses no inference credentials.

Engine tests cover native dirty/untracked/deleted files, exact original ancestry,
backup round trips, stale file and HEAD guards, protected refresh, corrupt imports
and refusal to export private paths or links. Native HEAD and worktree stay unchanged.

Local verification on 2026-10-19: the full repository check passed 801 tests, with
6,341 assertions. Typechecking and production bundling passed. The final engine
regressions and real GRASP/browser test passed. A real existing draft was imported,
edited, compared, checkpointed, reloaded and exported through the History UI; its
native Git HEAD and working status stayed unchanged. The panel was checked at desktop
and 390px widths without horizontal page overflow. No inference or public
publication was used.

## Next integration decision

Before switching ownership, define which revision the agent receives, how its
changes return to the browser, and how concurrent edits or disconnected tabs are
reconciled. Publication must freeze and review that exact browser revision, retain
the existing safety checks, and use the selected account for standard GRASP state.
The present read-only snapshot handoff is not a replacement protocol for Git.
