# OpenCode + soyLI experiment

This is a local feasibility experiment for browser creation, not a shipped chat
feature or a decision to use OpenCode in production.

## Question

Can an existing coding-agent harness use a fresh soyLI project, discover and load
its shipped guidance, implement a small app, recover from a compiler failure, and
produce a playable artifact in soyLI's actual sandbox?

## Setup

- Branch: `feature/quick-vibe`, based on main `68ecb09`.
- Released soyLI: `0.29.0`, macOS arm64.
- OpenCode: `opencode-ai@1.19.3` (the V1 CLI), installed only for this experiment.
- Initial implementation and compiler recovery: `opencode/glm-5.3-flash-free`.
- Follow-up responsive repair: `deepseek/deepseek-flash`, after the user supplied
  their DeepSeek key. The official models endpoint accepted it (HTTP 200).
- Task: Orbit Pop, a responsive target toy with pointer/touch input, a Space-key
  alternative, score and reset. No accounts, networking or persistence.
- Scaffold: `soyli new orbit-pop --identity later --no-install`, then `soyli setup`.
  The original scaffold has its own initial Git commit.
- Working project, transcripts and tools are kept under ignored
  `.local/quick-vibe/`; no creator identity or publishing is needed.
- Upstream boilerplate pin: `cbbebe9bd56271277b054535c0a8d720a588f61d`.
- Upstream skills pin: `976ad0549c38f93d4ed418d3ea59a615a7e5fd7f`.

OpenCode receives the project's normal `AGENTS.md` and discovers its existing
skills. We do not paste the skills into the task prompt. Its tool permissions allow
project reads/edits and selected read-only/build/check commands; account commands,
publication, pushing, external-directory tools and subagents are denied. Sharing
and automatic upgrades are disabled. Inference runs with a small explicit process
environment and separate OpenCode data/config directories.

The supplied key was read without printing it and connected to the experiment's
separate OpenCode credential file, outside the generated project, with mode `0600`.
It was not injected into the agent's shell environment. An exact-key scan found no
matches in the project source, built artifact or experiment evidence.

These are harness permissions for a trusted, disposable local experiment. They are
not an OS sandbox for arbitrary user code. A hosted product still needs isolated
execution, resource limits, secret separation and independent signing controls.

## Results — 2026-10-17

**The bounded experiment passed, with orchestration and browser feedback.** It was
not an unattended one-prompt success. OpenCode wrote all application changes; the
outer harness scaffolded the project, injected a known fault, ran independent
browser checks and supplied the responsive failure report.

| Phase | Observed result |
| --- | --- |
| Fresh scaffold | `soyli run verify` passed before any agent edits. |
| Discovery | All nine project skills were discovered. They appeared under `.claude/skills`; the same shipped files also exist under `.agents/skills`. |
| Initial task | Actual `skill(napplet-make)` call, plus reads of `docs/napplet-space.md` and `docs/napplet-visual-design.md`. The prompt did not paste their contents. |
| Implementation | OpenCode changed the HTML, CSS, TypeScript and settings, added `src/orb-settings.ts`, and documented the result in README. Dependencies, lockfile, tests, guides and skills remained unchanged. |
| Natural recovery | TypeScript reported an undefined `orbScale` and an unused theme flag. OpenCode repaired both and passed type-checking. It also repaired two guidance-test failures without editing the tests. |
| Step budget | The first run used its 30-step allowance and stopped after a green `verify`, explicitly reporting that sandbox checks were still missing. |
| Controlled recovery | The harness changed the import to `./orb-settings-missing.js`. In the same resumed session, OpenCode ran `soyli build`, observed exit 1, restored the import and rebuilt with exit 0. |
| Test guidance | The continuation explicitly requested `napplet-test`; the trace confirms the skill was loaded. `verify`, `check` and `test:conformance` completed successfully. |
| Browser feedback | Independent testing found a 230px document in a 160px-high frame; the orb could extend below the visible area. Passing build checks had not caught this. |
| DeepSeek iteration | A new OpenCode session loaded `napplet-ui` and `napplet-test` after an explicit prompt, fixed compact layout and bounded orb size, and passed verification, sandbox and conformance checks. |

The original implementation took approximately 244 seconds; the resumed recovery
and verification took 139 seconds, including a browser download. The DeepSeek
repair took 63 seconds and 14 model steps. OpenCode reported approximately $0.011
for that DeepSeek session; this is its accounting estimate, not an independently
verified invoice. The initial two sessions used a free model.

Independent Playwright verification of the final artifact confirmed:

- The actual soyLI preview used `sandbox="allow-scripts"`, without same-origin
  permission. This was not a bare Vite preview.
- Pointer clicks and Space incremented the score; Space activated the focused orb
  exactly once; keyboard Reset cleared it without scoring.
- At 200×160, 320×560, 900×600 and 1280×720, the controls stayed inside the frame
  and the document did not overflow. The orb remained at least 44px across.
- The optional settings UI changed the orb scale to 150%; the largest orb still
  fit the 200×160 frame without scrolling.
- Chromium phone emulation accepted real touch input in 390×844 portrait and
  844×390 landscape, with no document overflow. This is not a physical-phone or
  Safari compatibility claim.
- Switching the host through light, dark and auto preserved the app-owned palette.
- No app `pageerror` events were observed. The workshop made a harmless missing
  favicon request; it is not counted as an application runtime failure.

The conformance runner reported **5 passed, 0 failed, 5 skipped**. It verified
sandbox boot, injected global, absence of boot errors/forbidden globals and missing
domain degradation. Manifest checks skipped because no published manifest was
provided; wire/lifecycle checks lacked emitted envelopes or lifecycle evidence.
Its `CONFORMANT` label is not evidence that those skipped cases were verified.

## What this tells us about the harness

1. **The shipped project is a workable starting point.** No parallel template or
   invented SDK layer was necessary. The model could use soyLI's existing tools.
2. **Discovery does not guarantee workflow completion.** The first model loaded
   the entry skill but did not automatically load the downstream skills. Explicit
   phase prompts worked. A browser product should make required phase context and
   completion gates deliberate, and resume work when a tool budget ends.
3. **Build success is insufficient.** Browser geometry and input tests found the
   small-frame bug. Feed concrete failures back to the agent and independently
   verify the repair before presenting a preview as ready.
4. **Some guidance still needs consolidation.** The installed `napplet-make`
   triage table mentions the standalone `napplet` CLI and Paja despite soyLI's
   workspace override. It did not cause re-scaffolding here, but creates avoidable
   ambiguity. The inherited guidance tests also assert particular source/CSS
   patterns; their failure caused implementation changes even for this small toy.
5. **Tool and browser setup belong to the harness.** An overly narrow shell
   allowlist initially blocked ordinary inspection pipelines; the model recovered
   using permitted tools. The project's older conformance runner garbage-collected
   soyLI's newer browser revision in the shared cache. We restored that revision
   and disabled browser GC for subsequent experiment runs. Hosted workspaces need
   deliberate cache ownership, preinstalled dependencies and supervised previews.

No production scaffold, skill or dependency was changed as part of this experiment.

## Reproduction and local evidence

Exact prompts are saved alongside this report:

- [Initial creation](experiments/quick-vibe/prompt-create.txt)
- [Controlled build repair](experiments/quick-vibe/prompt-repair.txt)
- [DeepSeek browser-feedback repair](experiments/quick-vibe/prompt-deepseek.txt)

Install the pinned OpenCode version in a disposable tools directory, create a
project with the released soyLI, and run from that project's directory. Use an
explicit provider/model, record `opencode run --format json`, keep separate agent
credentials outside the project, and disable sharing/publication. The first prompt
expects `soyli setup` to have completed. For the second prompt, change the working
`./orb-settings.js` import to `./orb-settings-missing.js` only after verification is
green, then resume the original session with `--session`. The third prompt starts
a new session and supplies the measured browser failure.

Retained local evidence under `.local/quick-vibe/evidence/` includes:

- `environment.json`, scaffold/setup/baseline verification logs;
- `create.jsonl`, `repair.jsonl`, `deepseek.jsonl` and `summary.json`;
- `injected-fault.json`, original failing build and pre-injection source;
- `browser-verification.log`, `max-size-browser.log`, `theme-browser.log`;
- a final source diff and snapshots of the added module.

Screenshots are local in `output/playwright/quick-vibe-{desktop,mobile,tiny}.png`.
The complete generated project remains in `.local/quick-vibe/orbit-pop/`. To open
it again, run `soyli dev --no-open --port 0` there and use its printed URL. The local
experiment launcher `run-opencode.py` selects its isolated profile; it is not a
global OpenCode installation or a production harness.

Full local tool traces may contain project source and should be reviewed before
sharing. Only a concise evidence summary belongs in this document.

## Limits

One small project is evidence of integration feasibility, not an agent benchmark.
This does not test exact-source remix, proposals, publishing, signing, inference
billing, interrupted-session recovery or multi-tenant isolation.

Official references: [OpenCode skills](https://opencode.ai/docs/skills/),
[rules](https://opencode.ai/docs/rules/),
[permissions](https://opencode.ai/docs/permissions/), and
[CLI](https://opencode.ai/docs/cli/).
