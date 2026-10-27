# NIP-5D compliance audit — 2026-10-27

Status: **audit performed; first remediation batch implemented locally, not deployed**.
The findings and release inventory below describe the repository at `730c4b79fb9ab6d8b555c4afe1d9a679d712bca6`. No public event, listing,
moderation decision, creator source or production configuration was changed.

The complaints expose real weaknesses, but implementation defects, intentional
extensions, application conventions and host capability differences require
different judgments. An unavailable feature is not by itself proof of a sandbox
escape. A successful build or startup is not proof of interoperability.

Classification corrected after review: the initial audit wrongly counted all 89
`nostr://` source references as publisher defects and grouped the documented
`soy.app-data/1` convention with runtime defects. Those observations are retained,
but neither alone justifies marking a napplet broken or requiring republication.

## Authority and scope

The selected authority remains [NIP-5D at 4d0fb2e](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md),
including its reference to [NIP-5A source semantics](https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5A.md).
The legacy reader's [24711d9 NIP-5A](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5A.md)
has the same HTTP/HTTPS source rule.

The intentional source/media amendment is [dskvr/nips PR 12](https://github.com/dskvr/nips/pull/12),
reviewed at [abe23e4](https://github.com/zeSchlausKwab/nips/blob/abe23e43f266770614d18287b75d6edc09ca0e5a/5D.md).
It explicitly adds NIP-34 `nostr` clone URLs to `source`, alongside exact revisions
and optional media. It is open, not merged, as of this audit. Distinguish the
selected baseline from this proposed extension; neither silently supersedes the
other. Recording extension usage does not certify every tag against the amendment.

For drift analysis, compare [current NIP-5D PR 2303 at 5560820](https://github.com/dskvr/nips/blob/5560820fa4f37f45b8ab742a11aeb3001b17dc67/5D.md),
[NAP-SHELL at 25b29ee](https://github.com/napplet/naps/blob/25b29ee49e5bff8ebfe031f4b76dce98705c8b7e/naps/NAP-SHELL.md),
the recorded [NAP-MEDIA pin 2b2d29e](https://github.com/napplet/naps/blob/2b2d29e90c30b994bf5035a65b57e5fe7f08a9a2/naps/NAP-MEDIA.md),
and [current MEDIA PR 10 at 7806f43](https://github.com/napplet/naps/blob/7806f438530251fce5129f8e6239d6b642278759/naps/NAP-MEDIA.md).
Comparing a newer draft does not silently adopt it. The older MEDIA document has
conflicting API-table spellings; its detailed wire table and the installed shim
use the three-part session names, as already recorded in [NAP review](NAP-REVIEW.md).

Read-only discovery completed against `wss://relay.napplet.soy`, for kinds 35129,
15129 and 5129. This is an inventory of events retained by that relay, **not all
soyLI publications on Nostr**, nor a complete history of replaced named events.

| Evidence | Result |
| --- | --- |
| Signed events returned | 89: 39 named listings, 50 snapshots, no root listings |
| Current named formats | 26 standalone; 13 legacy |
| All event formats | 37 standalone; 52 legacy |
| Distinct executable HTML files | 72 downloaded and SHA-256 verified, 78,785,984 bytes total |
| Current source archives | 39 downloaded and SHA-256 verified; inspected without executing project code |
| soyLI provenance evidence | All 39 current archives contain soyLI project structure/guidance; this does not attest which publisher binary ran |
| Our existing manifest validator | Accepts all 89, including the intentional Nostr source extension below |

The [JSON ledger](audits/2026-10-27/release-inventory.json) and
[CSV ledger](audits/2026-10-27/release-inventory.csv) mark each event separately,
with exact author, event ID, artifact hash, baseline differences, extension usage
and runtime-review flags. These are audit records, not newly published Nostr status events. Detailed
observations are in [verification evidence](audits/2026-10-27/verification.json).

## Classification criteria

| Classification | Meaning | Response |
| --- | --- | --- |
| Implementation defect | An established contract is violated without a necessary new capability, or an isolation boundary is broken | Fix the implementation and reproduce the failure in a regression test |
| Intentional proposed extension | A documented use case exceeds the selected draft and has a concrete interoperable design | Retain its rationale, proposal and compatibility limits; test the extension separately |
| Application convention / host policy | App data or a scoped service is carried over existing protocol operations | Document the contract, discover support and handle denial; a new NAP is not automatically needed |
| Host capability mismatch | A valid operation or mode is unsupported by another implementation | Explain the limitation, test degradation and align capability discovery |
| Unverified lead | Static code or metadata suggests a possible issue | Exercise the behavior before assigning a failure verdict |

For each extension, ask what user requirement it enables, whether an existing
standard already covers it, whether it preserves isolation and scoped authority,
and whether another host can independently implement or safely decline it.
Keep baseline conformance, justification, observed portability and security impact
as separate findings. A proposal does not by itself prove safety or correctness;
absence from the baseline does not by itself make useful extension work a bug.

## Findings and classifications

### C01 — Intentional Nostr source extension with an upstream amendment

Every inventoried event has a `nostr://` source tag. The selected NIP-5D delegates
that tag to NIP-5A, which requires an absolute HTTP/HTTPS URL. The current NIP-5D
comparison expands accepted Git URL forms but still does not include `nostr://`.
This is a baseline difference, intentionally addressed by PR 12 above. The
amendment uses the existing NIP-34 clone URL convention to identify a repository
through its signed announcement without requiring a particular web forge.

The publisher selects `repository.source` or `sourceUrls(...).portable` in
[publication](../packages/publish/src/index.ts); the latter explicitly constructs
a Nostr Git address in [GRASP transport](../packages/grasp/src/client.ts).
The [reader](../packages/protocol/src/manifest.ts) checks source-tag ambiguity and
accepts this extension. Its acceptance is not evidence of a missed rejection.

All 89 ledger entries are marked **intentional proposed source extension**, with
the baseline difference recorded separately. Source discovery does not grant a
napplet network access, change artifact identity or weaken its sandbox. The 13
current legacy releases have a separate format-migration consideration; they must
not be silently rewritten or treated as failed current-format publications.
The historical snapshot archives were not inspected for tool provenance.

Action: retain the intentional source design and track upstream agreement.
Validate the NIP-34 reference and exact-revision behavior on their own terms;
report unsupported source navigation separately from playback. Do not require
conversion to HTTPS or republication merely because the scheme is outside the
selected baseline. The amendment's four-field `source-archive` shape is a separate
compatibility item; this classification is not a claim that existing archives
already implement every proposed field.

### C02 — Host wrongly makes unrelated domains depend on SHELL initialization

Historical finding; the source correction is recorded under remediation below.

[Host dispatch](../packages/runtime/src/host.ts) discards requests until
`shell.ready`. [The prelude](../packages/runtime/src/prelude.ts) implements
`shell.supports` from the eventual environment snapshot, rather than immediate
namespace presence.

A direct execution of the actual host and prelude reproduced both:

| Probe | Actual result |
| --- | --- |
| `identity.getPublicKey` before `shell.ready` | No response |
| Same request after `shell.ready` | Correct public-key response |
| Identity namespace present, before `shell.init` | `shell.supports('identity')` returns false |

The current NAP-SHELL contract explicitly makes readiness optional and independent
of other domains. Our automatic handshake often hides this defect. It does not
make the dependency valid; early feature detection can also report a false absence.
Existing host tests even describe the handshake as mandatory.

Remedy: bind verified identity before serving requests as today, but separate that
binding from optional environment delivery. Test omitted, late and duplicate SHELL
messages and immediate domain discovery. Preserve source-window checks, account
cancellation and each domain's own notification lifecycle.

### C03 — soyLI startup checks do not qualify interaction or portability

Historical finding; coverage reporting and configured-input checks are corrected
locally. Comprehensive interaction and independent-host qualification remain open.

The actual `soyli check --project ... --json` process was run on three disposable
fixtures with the shared Chromium preview. No fixture was published.

| Fixture | Exit/result |
| --- | --- |
| Direct `fetch` during startup | Exit 1, `BROWSER_CHECK`, CSP violation |
| Identical direct `fetch` behind a Start button | Exit 0, `status: checked` |
| Web Audio output behind Start, without a MEDIA session | Exit 0, `status: checked` |

[checkPublication](../apps/cli/src/publish-check.ts) does real sandbox, error and
CSP checks, but ordinarily waits for initialization and captures a frame. It does
not exercise arbitrary controls. The publisher invokes this same check; it does
not inherently establish a successful independent-host interaction test.

Studio has additional build and conformance commands, but skipped upstream
manifest, wire or lifecycle checks remain unmeasured. Our
[creator tooling adapter](../apps/cli/src/creator-tooling.ts) also substitutes
soyLI preview for upstream Paja/manual-preview guidance. The
[existing independent acceptance fixture](INTEROPERABILITY.md) explicitly wraps
the new HTML in a legacy manifest for its older Paja leg. That is useful legacy
evidence, not qualification of every current release.

Remedy: report startup, manifest, protocol interaction, degradation and independent
host coverage separately. Require relevant executable interaction scenarios for
publication qualification; an omitted scenario must not become a green check.
Static scans should flag leads, not reject every bundled occurrence of `fetch`.

### C04 — Embedded audio bypasses media coordination in our guidance

Historical finding; host support and generated guidance are corrected locally.
The published artifacts listed here have not been changed or requalified.

23 current bundles contain Web Audio references; two of those also contain audio
element code. Only three current bundles contain the scanned MEDIA operations.
Those counts are triage leads, not proof every occurrence is used.

Concrete source inspection confirms unregistered output in Obsidian Breaker's
`src/audio.ts`, Black Site's `src/game/audio.js`, and Funclet's
`src/control-sounds.ts`. Funclet's radio stream is separately session-managed;
its local mechanical clicks are not. No claim is made that these sound effects
perform network requests.

[Creator guidance](../apps/cli/src/creator-kit.ts) explicitly describes embedded
audio and Web Audio as separate browser features without requiring media-session
coordination. Our [media host](../packages/runtime/src/media-session.ts) accepts
only shell-owned sessions. That leaves a real implementation/guidance gap for
game synthesis, local sounds and multiwindow focus control.

Remedy: implement and qualify the NAP-MEDIA napplet-owned path, including commands,
state reporting and teardown. Teach generated projects to register their output
and handle denied/absent media support. Track newer focus/retirement requirements
against an explicitly selected pin; do not pretend our older subset implements
all of the latest draft. Do not make sound mandatory for otherwise playable games.

### C05 — Documented shared-data convention with optional host-policy discovery

Black Site, Outbreak: Soycoon City, Napcraft and Limb Race contain the
`soy.app-data/1` helper. [That helper](../packages/app-data/src/app-data.ts) requires
`shell.onReady` and `capabilities.appData.profile === 'soy.app-data/1'` before it
will use identity/outbox operations for that feature. An independent host exposing
those standard domains need not provide this optional policy field.

The [public convention](SHARED-DATA.md) uses NIP-78 kind 30078 and existing
OUTBOX/RELAY messages. The hint advertises a constrained write policy and scope;
namespace presence alone does not grant those writes. This is a legitimate
application convention and documented host-policy extension, not a new NAP or a
sandbox bypass. Its presence in a bundle is informational extension usage, not a
noncompliance mark. Other hosts can implement the convention; support is not
guaranteed merely by exposing OUTBOX or RELAY.

Action: qualify absent/denied support, preserve unsent drafts and explain when
public sharing is unavailable. Do not silently substitute local-only persistence
for requested sharing. Verify the chosen relay's public-read policy as documented;
NIP-78 does not guarantee public libraries on arbitrary relays. If common policy
discovery would help multiple hosts, propose that specific contract upstream.
Fix any demonstrated whole-app startup dependency separately; this scan did not
establish one and does not justify removing the helper.

## The reported Funclet failure

Event `0b497cfc2f66c55144f6420c1363b63316e02981c828ffe75473d43e66675778`, HTML
`66f0973c4361d99d7cef612c4a0f7c0501c02b414d975e4607feaef0a575b8f7`.

The supplied public Paja URL loads Funclet, obtains station data, and displays 47
stations. Choosing the HTTPS Omarchy Radio stream produces:

```text
napplet -> shell: media.session.create, owner: "shell", source.url: HTTPS stream
shell -> napplet: media.session.create.result, error: "unsupported owner mode"
```

Source inspection confirms the standard SDK `media.createSession` call. There is
no direct-fetch/WebSocket/XHR call in this scanned artifact. The default WRIF
station is HTTP and already presents an external-playback fallback, which is a
separate limitation from the HTTPS reproduction.

**The reproduced radio failure is an unsupported owner mode.** MEDIA permits a
host to reject a mode it does not implement. Requiring the `media` domain alone
does not guarantee every playback owner/source form. Funclet should explain this
limitation clearly; aligning host implementations or standardizing finer-grained
capability discovery belongs in MEDIA. Loosening iframe CSP is not the fix.

The live Paja deployment was observed on the audit date, not pinned to a locally
verified release binary. These observations do not certify every Funclet feature.

## Sandbox and network conclusions

Source review finds `sandbox="allow-scripts"`, raw artifact verification before
injection, a CSP ahead of app scripts, `connect-src 'none'`, and checks against the
registered frame's `MessageEvent.source`. The direct-network startup fixture is
actually blocked. This audit did not establish the claim of a general iframe
network bypass or missing opaque-origin sandbox.

Our CSP permits `media-src data: blob:` and blob fonts beyond the conservative
baseline. The NIP's CSP language is advisory; these differences are not equivalent
to adding forbidden `allow-same-origin`. They nevertheless permit applications to
depend on behavior that another host blocks and do not enforce MEDIA coordination.

Shell-owned playback sets a host audio element's URL. This is trusted-host
networking, not napplet `fetch`. Its initial URL checks do not prove DNS-resolution
or redirect enforcement by the native media loader. Review that policy separately;
no private-network probe or exploit was attempted in this audit.

Only one of the 72 HTML files had the scanned direct-fetch call sites: Naped
Snowboarding. Its verified HTML was opened through Paja's local-file UI and its
Ride action reached the run HUD/timer without an observed CSP violation. Paja
reported a gamepad-policy warning and local-file asset warnings. This is a limited
successful interaction, not full game qualification, but demonstrates why dead
dependency code and real network requirements must be distinguished.

## Existing standards versus possible upstream work

| Requirement / technique | Assessment | Action |
| --- | --- | --- |
| Live radio through shell-owned MEDIA | Existing standard path; host subset mismatch | Align support and failure UX; no new NAP required |
| Game sounds and synthesized audio | MEDIA already models napplet-owned output | Implement coordination and guidance; clarify focus policy for short effects if needed |
| RESOURCE bytes to image/blob, embedded Wasm compiled from bytes | Legitimate existing mechanisms | Keep hash verification, strict CSP and standard domain calls |
| Nostr source URLs, archives, screenshots, preview clips | Intentional optional metadata extension; source/media amendment PR 12 is open | Retain the design, track baseline differences and test source/media interoperability separately from playback |
| Shared NIP-78 data | Legitimate documented application convention plus an optional host-policy extension | Test explicit support/denial and public-read behavior; propose common discovery if needed, not a new NAP merely for an app schema |
| MEDIA owner/source support discovery | Real usability gap: namespace presence is too coarse | Candidate MEDIA amendment with two independent hosts and explicit denial semantics |
| Blanket networking or NAP-CLASS escape hatch | No demonstrated necessity from these reproductions | Do not introduce it to make the existing checks pass |

## Remediation order and acceptance

1. **Stop overstating checks.** Distinguish startup-only success and skipped
   coverage from interaction qualification in CLI, Studio and creator guidance.
2. **Correct SHELL behavior**, with regression cases above and exact upstream
   pins. Retain intentional metadata extensions and test their compatibility;
   do not rewrite them just to eliminate a baseline difference.
3. **Implement coordinated local audio** and remove guidance that encourages
   unregistered output. Test two simultaneous napplets, pause, teardown and denial.
4. **Add independent-host acceptance for current manifests**, without a legacy
   wrapper or Soy prelude. Include play/start, save, media controls, missing
   optional domains, denied operations, CSP violations and incomplete checks.
5. **Repair existing projects by author-approved releases.** Keep immutable old
   event findings; a corrected release receives its own result. Fix publisher and
   generated guidance first so republishing does not reproduce the defect.

For catalog presentation, use reason-specific labels such as **legacy manifest**
or **audio portability unverified** when useful to the reader. Proposed source
metadata and the app-data convention belong in informational compatibility details,
not broken/unsafe-app badges. Mark actual failures only with the relevant version,
host and evidence; do not convert a regex hit into a blanket verdict.
Use the same rules for soyLI and every other publisher. Production badges,
moderation and republication are not implemented by this audit.

Remaining scope: independent gameplay qualification for the rest of the inventory,
historical source provenance, all-domain wire/policy conformance, and live media
egress-policy testing. No claim of complete NIP-5D certification is made.

## First remediation batch — 2026-10-27

Implemented on `fix/strenghen-5d-compliance`, not deployed or released:

- **C02:** Requests and identity/theme notifications no longer require SHELL init;
  `shell.supports` observes installed namespaces immediately. Frame/origin checks,
  account cancellation and domain-specific cold INTENT delivery are preserved.
- **C04:** The pinned NAP-MEDIA wire contract now supports napplet-owned sessions,
  owner-directed commands/state, advertised controls, cooperative cross-frame
  focus and teardown. No iframe permission or network authority is added. Runtime
  profile is `space-playback-7`; [MEDIA.md](MEDIA.md) records limits and remaining
  host-owned stream policy work.
- **C03:** `soyli check` and publication replay configured `preview.recording`
  inputs even without a new recording. Runtime/browser versions, explicit coverage
  and warnings survive publication journals and isolated Studio checks. Missing
  input scenarios, unverified media coordination and independent-host coverage
  are visible; old records remain readable without fabricated measurements.
- Generated guidance now requires MEDIA coordination for local sounds, silent
  optional-domain fallback, real interaction/denial testing and separately reported
  independent-shell evidence. It no longer describes embedded audio as exempt or
  claims stream quotas absent from the current transport.

Regressions exercise actual CLI processes (startup and post-input CSP failures),
installed-shim Web Audio and host controls in Chromium, source/account isolation,
late and duplicate SHELL readiness, cross-owner/frame media focus, and saved check
reports. These are tests of our implementation. They do not change the dated
inventory or qualify all published games. Independent-shell acceptance for current
manifests, existing-project repairs, full audio-coordination checks and the separate
host egress audit remain outstanding. The intentional source and app-data
extensions, selected protocol/package pins and public artifacts are unchanged.

Local verification for this batch: typecheck and **922 application/unit tests**
passed; **11 Chromium service checks** passed, covering real CLI inputs/capture
and both media ownership modes. The focused Studio process test confirms warnings
remain visible. Production web build and diff/format checks passed. `check:nix`
was attempted but could not run because Nix is not installed locally; the Linux
Nix package/rebuild/VM gate is still required before shipping. No deployment,
binary release or creator publication was performed.
