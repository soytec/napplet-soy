# Remixing

Choose **Remix this** on a napplet page and copy the command. It pins the selected manifest event, so a later publication cannot change the starting point:

```sh
soyli remix https://napplet.soy/r/EVENT_ID my-remix
cd my-remix
soyli setup
soyli dev
```

Use `--network local` with a local portable or pinned URL when developing. The CLI also accepts naddr, nevent, note and hexadecimal event identifiers. The website is an optional accelerator: relay lookup uses Applesauce, verifies signatures and matches the exact requested identity.

Source **0.16.1** fixes public remix discovery on the bundled Bun runtime. It
uses the existing DNS-pinned native WebSocket transport, connecting directly to
the relays with TLS verification and bounded reads. No website API or hosted relay proxy
is required. Each relay has a five-second lookup budget including connection
setup, and cancellation closes pending connections. An available signed matching
event can be used even when another relay fails.

Source **0.16.3** returns as soon as a requested full event hash is verified and
closes the remaining relay queries. A silent fallback cannot delay a verified
pinned release. Named/latest lookups still collect responses within their budget
and choose the newest matching signed event; this shortcut does not apply to them.

`REMIX_RELAYS_UNAVAILABLE` means no relay completed the lookup;
`REMIX_NOT_FOUND` means responding relays did not return the requested release.
An old pinned event may no longer be retained: a portable naddr selects the latest
release, while an nevent can supply a relay hint for the exact version.
Malformed links, failed verified downloads and unavailable destination folders
also receive specific errors. Existing directories are never overwritten.

Read-only public acceptance (no signing, setup scripts or publication):

```sh
SPACE_TEST_REMIX_REFERENCE=https://napplet.soy/r/EVENT_ID \
  SPACE_TEST_CLI=/absolute/path/to/built/soyli \
  bun test tests/services/remix-public.test.ts
```

This opt-in test exercises public TLS and the complete temporary checkout;
local relay fixtures cover filtering, signatures, absence/failure and cancellation.

When a signed manifest supplies a NIP-34 source and exact `source-commit`, soyLI
fetches that real Git commit, verifies its relationship to the announced repository,
and starts a work branch while preserving authorship and ancestry. The original
tracked title, creator, README and license stay intact. A separate ignored publication
binding gives your copy its own identifier, signer and destinations. You can publish
a personal version, propose changes upstream, or both in either order. See
[the collaboration guide](COLLABORATION.md).

Without retrievable Git metadata, the signed `source-archive` is hash-verified and
safely unpacked, or the verified HTML provides a starting point. This fallback retains
license/credit but does not invent Git ancestry or automatic upstream PR support.
No downloaded setup/build script runs during remix. Run `setup` explicitly after
reviewing the source. Missing licensing information remains `UNLICENSED`.

For an artifact-only remix, imported descriptions are limited to 1,000 characters
and optional archetypes/intents are copied only when they fit local authoring
bounds. The exact signed source event, selected event ID and downloaded artifact
bytes are preserved; adjusting the editable project metadata never changes the
verified original.

New publications put optional immediate-parent `a` and root-origin `A` on the independent `5129` snapshot only, following [NIP-5D PR 7](NIP5D-MIGRATION.md). The named current event carries no `a`/`A`. These tags are ancestry claims and never grant the parent's runtime identity. The optional `remix-version` records the exact selected source event. Legacy current/snapshot ancestry keeps its previous interpretation. A snapshot without ancestry can still be inspected, played and remixed when retrievable source exists.

Remix has shipped since CLI 0.3.0. Historical releases are recorded in
[deployment notes](DEPLOYMENT.md#rich-comments-and-soyli-070-release--2026-09-15);
the source version above does not imply a deployment.

## Genealogy on napplet pages

Implemented, verified and deployed on **2026-09-15** in `20260915084016730-23084`.
**The family tree** appears on detail pages when the selected signed manifest
declares ancestry. It connects known ancestors down to **You are here**, linking
each parent release and its creator’s Nostr profile. It loads separately from the
player and never downloads or executes ancestor artifacts.

Genealogy reads format-specific signed ancestry. Legacy named events use their historical `a`/`A`; legacy snapshots use `a` as their own address, never a parent. New snapshots use `a`/`A` strictly as parent/root provenance and need neither. New named events have no standard ancestry tags; an optional exact `remix-version` claim can still lead to the selected source revision.

Every ancestor's signature and manifest must validate. An exact revision pin must agree with any declared parent address. Without a revision pin, an address-linked parent is labeled as its **current release**, which can change. These relationships are author-declared, not proof of code derivation or permission to access another napplet's data.

Lookup starts with the local index/cache and uses configured relays for missing
ancestors. It follows at most twelve generations, detects repeated identities/IDs,
and permits at most four remote requests within a nine-second scheduling window
(each existing relay request has its own 2.5-second deadline). Four tree requests
may run concurrently per web process. Exact retrieved manifests use the bounded
community event cache. Missing, ambiguous, mismatched, blocked/deleted, cyclic and
truncated ancestry have explicit gaps; an ancestor’s absence never blocks playback.
This slice shows ancestors, not a reverse index of every descendant or sibling remix.

Verification: unit cases cover standard manifests, snapshot self-addresses, pinned
generations, origin-only gaps, missing/ambiguous/mismatched parents, cycles, depth
limits and forged events. The production-build profile/browser test displays a
three-generation chain and verifies its ordering and creator links.

## Browsing a release’s original files

Implemented, verified and deployed on **2026-09-14** in release
`20260914151021458-42270`. See the [deployment record](DEPLOYMENT.md#source-browser-release--2026-09-14). **Browse source** on each
napplet opens `/r/EVENT_ID/source`; `?file=src/main.ts&view=project` links to a file
in that exact signed release. The tree lists the bounded source archive, offers its
license file and author-recorded commit, and displays selected text with syntax
highlighting. Downloads retain the original bytes. **Remix this** reuses the same
pinned event in both the installed-CLI and install-and-remix commands.

Safe source aliases such as `CLAUDE.md -> AGENTS.md` remain links in Git-based
remixes. New source archives represent these aliases as regular copies of the
exact committed target bytes, so archive recovery and this source browser can
read them without following links. Git history itself is unchanged. Each copy
counts toward the expanded-source budget.

The signed `source-archive` URL must end in its SHA-256 digest (optionally `.tar`).
The browser verifies downloaded bytes and uses the same Git-tar parser as the CLI:
50 MiB archive, 40 MiB expanded files, 1,024 files, no traversal, symlinks, special
entries, conflicting paths or credential files. It never clones a repository, runs
build/scripts, extracts to disk or renders HTML/SVG/Markdown as active documents.
Lowlight 3.3.0 and selected Highlight.js 11.11.1 grammars produce text/span tokens;
the tree uses native disclosure controls. This avoids loading an editor or the full
language catalogue. These dependencies load with the source route, not the gallery.

The 1,024-file limit is a 2026-10-03 source update shared by CLI remix and source
browsing. It is a tooling safety budget, not a Nostr quota. Updating the CLI enables
publishing and remixing projects beyond the former 128-file limit. Older website
deployments need the updated parser to browse
those archives; a CLI update alone does not update a website. Source availability
and this inspection limit do not affect playback admission.

The archive remains a portable source snapshot for recovery, offline inspection
and independent mirroring; its signed hash identifies the same bytes wherever
they are stored. It complements the repository's commit history.

Reading published playable HTML for remix, proposal review and playback has a
separate 100 MiB limit. soyLI still requires new publications to fit within 25 MiB;
a larger downloaded original may need optimization before republishing. Public
website, indexer and runtime deployments must adopt the read limit before admitting
artifacts above 25 MiB; a CLI release alone does not enable public playback of them.

Only the selected file’s text is sent to the page. Text over 200 KiB and binary files
have a download state; highlighting stops at 64 KiB. Unknown file extensions use
plain text. A missing path stays missing instead of silently selecting another file.
Downloads are attachments with `nosniff` and a sandbox CSP, including HTML and SVG.

Public retrieval uses bounded HTTPS requests, enforces public DNS/IP destinations
at connection time and refuses redirects. Development permits only the configured
`SPACE_INDEX_LOCAL_BLOSSOM` loopback origin/path. There are at most two simultaneous
archive fetches and twelve new fetches per minute per web process; requests for the
same URL share a download. The cache retains at most eight entries / 96 MiB for ten
minutes, with a 30-second failure cache. Event visibility and archive-hash moderation
are checked again even on cache hits and after downloads.

**Built HTML** (`?view=html`) is an explicit fallback using the existing verified
artifact store. A publisher without the archive convention still has this view and
its author-supplied source reference. An external repository link may change and is
labeled accordingly. No license is inferred when missing; read the author’s license
before reusing files. Missing or invalid source metadata never affects playback.

A pinned URL never follows a later publication. Snapshot manifests remain available
under the index’s normal retention policy. Superseded replaceable manifests may
become unavailable if neither the index nor a relay retains them; the source browser
does not create an independent permanent event archive or substitute the new version.
The signed archive digest proves the author selected those bytes; `source-commit`
and source-to-build correspondence remain author claims, not a verified rebuild.

### README excerpt on detail pages

Deployed addition (2026-09-15): “Peek at the source” lazily loads a
root README as the section nears the viewport. Names are case-insensitive, preferring
`README.md`, then `README.markdown`, `README`, and `.txt`/`.rst`; nested dependency/docs
READMEs are not substituted. The terminal shows the first ten physical lines, keeping
blank lines and normalizing CRLF. Each displayed line is capped at 1,000 characters.
“Read full file” opens that exact file in the pinned source browser.

This shares the verified archive download and cache described above. It returns only
the excerpt, not the repository tree or full README. Non-UTF-8/binary, empty or >200 KiB
files, missing archives and failed retrievals omit this optional preview. Visibility
and hash moderation are rechecked even on cache hits. React escapes all text: embedded
HTML, links and images cannot execute, navigate or load resources from the excerpt.
The README and its terminal presentation introduce no manifest requirement.

Asset originals included by the publisher are browsable and downloadable too. See
[asset authoring and current gaps](ASSETS.md).

Verification: 181 repository tests pass, including source retrieval/visibility and
shared archive adversarial checks. Production-build browser checks cover desktop and
mobile file navigation, stable file links for snapshot/current-manifest IDs, inert
highlighting, byte-identical attachment downloads, missing/binary/large files, explicit
HTML fallback, pending artifact discovery and immediate moderation of cached source.
Typechecking and the production build pass. No source scripts, installs, real accounts
or production publications were used by this verification.
