# NIP-5D media and source amendment

Prepared locally on `nip5d/media-source-attachments`, 2026-10-17. Not submitted,
pushed, deployed or released. The amendment is against `dskvr/nips:nip/5d` at
[`5560820f`](https://github.com/dskvr/nips/blob/5560820fa4f37f45b8ab742a11aeb3001b17dc67/5D.md),
the head of [NIPs PR 2303](https://github.com/nostr-protocol/nips/pull/2303).
The shell's selected interoperability pin remains `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`.

## Proposed contract

Keep metadata directly on the manifest. No companion kind, GRASP wrapper, platform
registration or presentation requirement is introduced.

| Field            | Proposal                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `source`         | Retain one location; accept the NIP-34 `nostr://` repository URL forms alongside Git's existing transports.     |
| `source-commit`  | Optional full Git commit object ID; preserve the source revision when the repository's branch head advances.    |
| `source-archive` | Optional HTTPS URL, explicit SHA-256 and archive MIME type. Hash compressed/downloaded bytes before extracting. |
| `screenshot`     | Zero or more hash/MIME references, in preferred display order. **No protocol count limit.**                     |
| `preview`        | At most one video hash/MIME reference; supported codecs and playback policy belong to each client.              |
| Media attributes | Optional `dim`, `size`, `alt`, `duration` strings after the hash/MIME tuple; unknown attributes are ignored.    |

```json
[
  ["screenshot", "<sha256>", "image/png", "dim 1200x750", "size 184320", "alt The puzzle board"],
  ["screenshot", "<sha256>", "image/webp", "dim 750x1200", "alt Touch controls on a phone"],
  ["preview", "<sha256>", "video/webm", "dim 960x600", "duration 8.5"],
  ["source", "nostr://<repository-naddr>"],
  ["source-commit", "<full-git-commit-id>"],
  [
    "source-archive",
    "https://blossom.example/<archive-sha256>",
    "<archive-sha256>",
    "application/x-tar"
  ]
]
```

NIP-34 already defines Nostr repository URLs; no new repository wrapper is needed.
Media attributes borrow NIP-94 vocabulary and NIP-71 duration without making a kind-1063 descriptor
or NIP-92 content URL necessary. The signed `x` remains the executable identity.
A source pin records an author's claim, not proof of a reproducible build.
Snapshots retain their own source/media references. Retaining referenced objects
is still the publisher's responsibility; replacement does not guarantee storage.

Clients may ignore excess screenshots without rejecting the set. Mirrors of one
hash are one image. Malformed optional hints cannot invalidate a valid blob
reference. Downloads still need actual hash/format verification and local resource
limits. Screenshots, video and source availability never gate playback.

## Implementation on this branch

The media reader and writer implement the proposed tuple/attribute format under
the temporary `soy.presentation/2` marker. Marker-free proposed-format tags are
also read; old `soy.presentation/1` tags and legacy companions remain readable.
This is not a claim that the upstream amendment has been adopted.

The shell shows up to eight distinct screenshots, ignores extras and lazily
verifies additional linked-asset thumbnails. Deletion/shared-blob checks inventory
all supported screenshot claims, independent of the display limit. The publisher
still emits one PNG and an optional short silent VP8 WebM, now with measured
size/dimensions and video duration. Other publishers can supply more screenshots
and alt text. Frozen publication jobs retain their original shape and signatures.
Existing image/video byte and decoder budgets remain client policy.

Source handling already uses NIP-34 repository locations and exact SHA-1 Git
commits. **The proposed four-field archive tag and SHA-256 Git repositories are
not implemented here.** Current soyLI archives retain the two-field URL convention
and verify the digest encoded in the content-addressed URL; they remain readable.
The upstream source additions are proposed semantics for discussion, not a silent
change to saved publication jobs. Agreement would require compatible archive
readers before changing the writer. No source-archive migration runs on this branch.

See [the implemented presentation contract](PREVIEWS.md) and [SPEC §4](../SPEC.md#4-napplet-publication-and-presentation).

## Review boundaries

The proposal does not standardize Soy's eight-image limit, 5 MiB media budgets,
12-second VP8 profile, automatic capture, gallery layout or signing workflow.
It does not add soundtrack tags, curation roles, taxonomy vocabularies, build
attestations or collaboration event kinds. Those are independent questions.

## Verification

The branch adds regressions for legacy and marker-free media, five/eight/excess
screenshots, malformed attributes, mirror deduplication, ordered attachment lists,
frozen version-1 publication resumes and shared references beyond the eighth image.
Browser fixtures exercise ten declared screenshots on desktop and mobile: eight
verified images render and the extras are never fetched. Legacy and direct clips
remain playable. Build, typecheck and full-suite results are recorded in the local
PR preparation notes. Nix validation remains required before any later push.
