# Public Git collaboration with soyLI

The same working copy supports a personal napplet and changes proposed upstream.
Code and the pushed commit ancestry are open source by default. Editing or making a
local checkpoint does not upload anything. New projects use MIT; remixes keep their
existing license. A website account is unnecessary: the CLI uses your Nostr signer.

`soyli new` saves the generated scaffold and agent guidance in an initial local
commit before development begins. This checkpoint needs no creator identity and
uploads nothing. Git-backed remixes retain the exact published commit and ancestry;
existing work is never automatically checkpointed by setup or skill updates.

soyLI 0.16.3 retains both Git output streams in failure diagnostics, including
conflicting filenames emitted by `merge-tree` on stdout. Merge preflight needs
Git 2.38 or newer. Conflicts leave the checkout unchanged; the diagnostic explains
how to resolve with ordinary Git and how to abort that manual attempt. Tool errors
(including an unsupported Git option) remain distinct from merge conflicts.

```sh
soyli remix <napplet-link> my-idea
cd my-idea
soyli setup
# Make a change with your editor or agent; run its relevant checks.
soyli checkpoint "Add a new idea"
soyli propose "Add a new idea"
# Optional, before or after proposing:
soyli publish
```

A Git-backed remix fetches the exact signed `source-commit` from the source's
NIP-34 clone servers, preserves its ancestry, and starts `pr/my-changes`. `upstream`
is the HTTP Git remote; `nostr` is the portable remote for git-remote-nostr/ngit.
It does not rewrite the original title, README, license or creator in tracked files.
Run `soyli skills update` explicitly if you want to update inherited agent guides.
Archive/HTML-only remixes remain available, but cannot invent a Git upstream for PRs.
If an advertised Git source is unavailable, retry it rather than silently losing ancestry.

The ignored `.napplet-space/project.json` is the visible local publication binding:
creator, independent identifier, upstream, targets and backend provider. `soyli config`
shows its path and effective destinations; `config init` materializes editable targets
there. `napplet.json` remains portable source metadata and configuration. Preserve both
Git and the ignored binding/journals when moving a working copy between machines.

`checkpoint` explicitly stages the working tree and creates a normal Git commit after
source checks. Ordinary `git add`/`git commit` work equally well. Inspect your diff first;
keep unrelated work out of the checkout. `publish` and `propose` require a clean committed
tree, and their CLI entry points build `dist/index.html` projects before sandbox checks.
New projects without separate builds use committed `index.html`. Source archives contain
the actual Git tree; ignored build outputs are separate Blossom artifacts.

## Proposing and retrying

`propose` checks the built HTML in the host, captures a screenshot, uploads preview
artifacts directly to the configured Blossom server and hosts the real Git tip on the
existing upstream through its GRASP-01 proposal facility. It publishes an ordinary NIP-34 PR (1618), or an
update (1619) to the existing proposal for this working copy/branch. It does not release
a named napplet. Repeating a completed tip reuses its event; `propose --resume` finishes
an interrupted signed submission. A different pending tip must finish before new edits
can be proposed. External updates and closed proposals stop automatic updates.

The proposal path creates no repository announcement/state and requests neither
kind 30617 nor 30618 signing permission. It advertises upstream clone URLs and sends
the signed event before pushing `refs/nostr/<event-id>`. Success requires that exact
remote ref, fetching its `c` commit and fresh upstream relay read-back. A pending
GRASP acknowledgement is insufficient. Hosting refusal retains its cause and saved
event; no contributor repository is created as a fallback. Optional GRASP-06 is
not used. Preview uploads and the PR itself still require their own signatures.

New roots store `branch-name` without `pr/`, matching ngit. Soy can continue an open
ngit proposal by matching its author and branch, including ngit checkout names with
the root ID suffix. Ambiguous matches stop. When ngit advances an existing Soy job,
Soy requires that exact remote revision in the local ancestry before continuing.
Use a distinct branch for a separate open proposal. Closed/merged jobs retained in
the same local journal still need the explicit lifecycle action before updates.

Version-2 jobs save signed events, source, preview descriptors and screenshots
locally. Prior signed journals are archived under the branch's proposal folder
when a new revision replaces the active journal. Delivery retries do not reconnect
the signer. A timeout before journaling
requires rerunning the description command, without `--resume`; frozen preparation
files alone do not constitute a saved signed proposal. Legacy version-1 jobs retain
their signatures and original clone locations. Resume pushes the immutable ref
upstream and requires the original clone to remain fetchable; it never publishes
their saved repository announcement/state. An unavailable legacy clone stops with
recovery guidance. A subsequent revision can advertise the upstream clone without
rewriting old revisions or deleting old repositories.

Legacy roots retain their original `branch-name`. Use `ngit pr checkout <id>` to
link a branch to that existing root before updating it through ngit.

## Reviewing and accepting

In soyLI 0.14.0, `soyli dev` → **Manage project → Proposals** embeds this same
review interface. Changes/checkpoints and publishing have their own workshop
sections. Opening review runs the supplied checked HTML, not contributor build
scripts. Merging remains a local Git operation; the GUI does not silently push,
publish, install dependencies or solve conflicts. The reviewed revision remains
pinned, and a changed maintainer identity or target requires a refreshed review.
See [workshop controls and limits](CLI.md#local-workshop--0140).

```sh
soyli review                         # proposal inbox for this project's upstream
soyli review <proposal-event-id>      # open one proposal
soyli proposals --json
soyli review <proposal-event-id> --json --no-open
soyli comment <proposal-event-id> "Please adjust the controls"
soyli close <proposal-event-id> "Not a fit for this version"
soyli reopen <proposal-event-id>
```

The loopback review app lists proposals/revisions, plays Original or Proposed, shows
the Git diff and public NIP-22 discussion, and offers local merge/close/reopen actions.
Refresh never silently replaces the selected revision. Mutations require a random
session token and same-origin request; no public review-control service is exposed.
Opening a proposal never installs dependencies or executes its build scripts.

`soyli review <id> --rebuild` explicitly opts into setup/build of that selected source
in a temporary checkout. Use it to compare source and supplied preview; it is not a
reproducibility attestation or a general-purpose code-execution sandbox. The resulting
artifact runs in the ordinary napplet sandbox with a local backend where configured.
Prebuilt previews have isolated player state and no original creator credentials.
Website previews use a guest session and require the usual consent for custom backends.

An agent can merge the exact reviewed revision and target:

```sh
soyli merge <proposal-id> --revision <reviewed-event-id> --target <reviewed-local-HEAD>
soyli publish    # publish hosted Git source, mark included proposals merged, and release
# Or use soyli push to publish Git state and merged status without a napplet release
```

Merging does not delete the proposal, its revisions or discussion. `soyli push`
announces a separate NIP-34 merged-status event for included open proposals.
A local or ordinary Git merge alone does not announce that relay status.

Merge requires a selected maintainer identity, current proposal revision, unchanged clean local
HEAD and an upstream state already integrated into that target. A Git conflict stops
before changing the checkout; resolve using ordinary Git/ngit. Git authorship and
ancestry are retained. Merge resolves a declared target branch when supplied, otherwise
the signed state's `HEAD`, and requires that branch to be checked out. `push` publishes
the checked-out existing upstream branch, preserving other signed refs and `HEAD`.
It works for the owner and directly listed maintainers with reciprocal repository
announcements. An invitation alone grants no state authority. Role-based `M`/`m`
authority and indirect recursive maintainership remain outside this adapter profile;
use ngit for those layouts. Creating/deleting branches, rebasing and squash acceptance
also use ordinary Git/ngit. A relay's “merged”
status is an authorized claim, not independent proof of integration into a Git branch.

Explicit `soyli push` can publish an existing linked Nostr repository; `soyli publish`
still verifies linked source read-only. Push saves its signed state and exact applied
events in `.napplet-space/push-outbox/` before delivery. Applied status is sent only
after Git publication is confirmed and itself requires relay read-back. A partial
failure resumes from the same local tip without another merge or new signatures.
Before sending each saved applied event, push rechecks the proposal's current revision.
If it has changed, the old applied event stays in the journal but is not sent. Git
publication still completes, and `supersededProposals` lists proposals needing a fresh
review/merge. A later push can accept the new revision once it is actually integrated.
If the tip, upstream state or maintainer authority changes during recovery, stop and
reconcile it; do not discard the journal or force-push around the check.

The shell's **Proposed changes** section queries Nostr directly. `/proposals/<event-id>`
is a shareable observer view with revision selection, discussion and opt-in playback.
The local-review command appears only after selecting a proposal; the empty inbox
shows contribution guidance. Long commands wrap visually and copy as one command.
External proposals without Soy metadata remain visible, with a local-review command.
External patch roots (1617) can be read; applying/revising patch series uses ngit.

For named napplets, the signed-in original author can select **Review & merge in
Studio** on the original listing. A separate private workspace pins the proposal
revision and current target, rebuilds the merged source, and presents the diff and
playable candidate before confirmation. The workspace is labelled **Merge review**,
links the published proposal and shows its contributor. Proposal cards show **Proposed
by** with the signed root author's profile or public-key fallback; this can differ
from the napplet author or repository maintainer.

The merged candidate is pinned before project tools run. Its committed contributor
tests and guidance are part of the reviewed source; later changes to protected files
are still refused. Hosted dependencies must match an operator-installed profile.
The private sandbox check tests the merged executable independently of inherited
listing clips and capture-only ready selectors, without changing those settings in
source. An existing cover is retained and validated. The offline sandbox still
requires the host handshake and rejects script errors; a selector waiting for live
relay data belongs to the separate capture flow. After merging, **Publish update**
can retain the original listing and media, subject to an explicit review against
the updated build; **Capture new media** offers re-recording instead. See
[media reuse](PREVIEWS.md#short-video-previews--soyli-070). Older failed reviews without
a pinned candidate require a fresh review. These profile/review checks were deployed
with the controller and additive worker image on 2026-10-23; see the
[deployment evidence](DEPLOYMENT.md#most-recent-application-deployment--proposal-reviews-2026-10-23).

Source sharing reuses `push` and its durable NIP-34 state/status outbox; no wrapper event is introduced. Retrying the same reviewed
browser merge reuses its signed events, even after delivery succeeded. Publishing the
resulting napplet is a separate action, preserving its named coordinate and refusing
a stale release anchor.
The merge button shows **Merging…** immediately, with a spinner and live source/status
delivery details until the result arrives. Merge signatures use the selected shell
account, including standard NIP-34 kind-1631 merge status; signing permissions are
shared with Studio's publication policy. Remote signers may request approval for
that event kind.
The shell's **My work** dashboard links incoming/outgoing proposals and recent public
activity. Repository lookups retain the relay hints in the manifest's source link
alongside publication and configured fallback relays; Git proposals need not live
on the napplet catalog's relays. Unread markers stay in the browser for each account. See
[Studio collaboration](QUICK-VIBE.md#propose-changes-from-a-remix) for the UI flow.

## Optional runnable preview attachment

NIP-34 is pinned to `6d2979b3f503a8539c983efbcdcf901bbcf9ed23` for this adapter.
The authoritative NIP-5D pin remains unchanged. The only new Soy extension is an
optional tag on the signed PR/update:

```text
["soy-preview", "https://blossom.example/<descriptor-sha256>", "<descriptor-sha256>", "<git-c-commit>"]
```

The bounded (64 KiB) JSON descriptor contains `version: 1`, `commit`, a signed
NIP-5D snapshot `manifest`, `check: {profile, browser}`, and optional `image` URL.
Its snapshot is an attachment, not a published gallery listing. The reader verifies
the descriptor hash, author, exact source commit and ordinary manifest/artifact hashes.
Updates need their own bound attachment; a prior revision's preview is never substituted.
A signed preview proves attribution and bytes, not that its source reproduces those bytes.
Missing, unsupported, stale or inaccessible attachments do not hide a valid proposal.

Bounds: up to 100 recent proposal roots plus an explicitly requested root, and 500
related events per query; current Git profile
supports 1,024 source files, 40 MiB of reachable blobs and 10,000 reachable objects.
The file count is a tooling safety budget, not a Nostr quota. Current and historical
Git trees may retain safe relative aliases to public regular files inside the same
committed tree. Git-based remixes preserve those links; the source archive and
archive-based remixes contain regular copies of their exact committed target bytes.
Copies count toward the 40 MiB expanded-source budget. No history rewrite or
replacement at HEAD is needed for safe aliases.
Unsafe links, submodules, credential files and Git attributes/modules remain blocked. Before
merging a reviewed proposal, soyLI validates the predicted merged tree as well as
the proposed history. A merge that would remove an alias's target is refused
before a reachable merge commit is created; the diagnostic identifies the source
problem and leaves the working tree unchanged.
Playable previews use the 25 MiB HTML limit; the public website, indexer and runtime
must deploy that limit before admitting larger artifacts. Managed resources still
have their separate 10 MiB limit. Git-backed automatic setup/build/publish currently
expects a valid `napplet.json` and the supported entry/toolchain layout; foreign source can
still be inspected with Git/ngit and adapted explicitly. This does not affect reading
external proposals or playing their standard napplet manifests. No automatic history rewrite or legacy journal adoption is
performed. Existing synthetic source journals need an explicit migration or a fresh
publication identity; do not reset or force-push over them to bypass a conflict.

Implementation is local until explicitly deployed. Native tests exercise two independent
creators, real relay/Blossom/GRASP services and an independent Git reader. See the test
results recorded with the change; no external ngit version is bundled by soyLI.

Proposal submission selects up to four distinct supported clone URLs in advertised
order, filtering unsupported alternatives before applying that limit. An SSH or
other unsupported alternative does not block a usable HTTPS host (loopback HTTP
in the explicit local profile). No eligible host produces an actionable error before
preview preparation or upload. The repository announcement is unchanged.

### Proposal status during publication

`soyli publish` also marks included open/draft Git proposals merged after confirming
source delivery. It shares `push`'s ancestry, target-branch and current-revision
checks; unrelated proposals and patches are left alone. Signed applied events are
saved in the release journal before source delivery and reused by
`soyli publish --resume` after a failure. A newer proposal revision is never closed
by an older saved acceptance.

For hosted source, this applies to the published `main` branch. Linked repositories
remain read-only for Git/state: status reconciliation applies when the checked-out
branch's signed tip equals the release commit and the selected author is an
announced maintainer. Other linked branch layouts remain publishable without
automatic status changes. Relay hints from the source URL remain usable even when
the announcement omits its optional `relays` tag.

The release journal pins the reviewed target branch alongside its signed statuses.
Before sending them, including on resume, soyLI rechecks that branch's signed tip,
maintainer authority and the clone's served branch. A tag retaining the release
commit does not prove the target was merged. A changed or unknown target stops
status delivery with an actionable error; correcting the target lets resume reuse
the original signatures. Switching local branches does not retarget saved statuses.
