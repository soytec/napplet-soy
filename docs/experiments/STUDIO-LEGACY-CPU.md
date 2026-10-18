# Studio on the existing legacy CPU VPS

Date: 2026-10-17. Scope: a temporary compatibility experiment, not a deployment.
The VPS exposes a QEMU x64 CPU without SSE4.2/AVX. Changing its exposed CPU is
unavailable for now. The standard image and execution CPU guards remain enabled.

## Result

The useful workaround is to keep the current application and harness source while
running them with the already working Bun 1.3.8 runtime. Installing an older Bun
alongside OpenCode's native executable does not change that executable's embedded
runtime: OpenCode itself must run from its pinned source in this experiment.

| Probe on the VPS                                                       | Result                                                                                                                                      |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Bun 1.3.8 JavaScript and Node 24.21.0 startup                          | Passed                                                                                                                                      |
| OpenCode 1.19.3 Linux x64 baseline executable                          | Exit 137, container reported OOM, before version output at 768 MiB                                                                          |
| Unmodified OpenCode 1.19.3 source under Bun 1.3.8                      | Started; source mode reports version `local`                                                                                                |
| Current soyLI 0.29.0 source bundle under Bun 1.3.8                     | Started and scaffolded a fresh project                                                                                                      |
| Starter guidance tests, TypeScript and Vite build                      | Passed; 6 guidance tests                                                                                                                    |
| `soyli check`                                                          | Passed, `space-playback-6`                                                                                                                  |
| Upstream conformance                                                   | 5 passed, 0 failed, 5 skipped                                                                                                               |
| Landscape cover and video                                              | Captured, 1200 × 750 PNG and WebM                                                                                                           |
| Portrait cover and video                                               | Captured, 360 × 640 PNG and WebM                                                                                                            |
| Actual Studio adapter + source OpenCode + deterministic fake inference | Loaded shipped guidance, invoked `napplet-make`, edited a file, observed TS2322, corrected it, searched the source and rebuilt successfully |
| Native DeepSeek configuration with a preprovisioned catalog            | Same complete tool loop passed using `deepseek/deepseek-flash` and fake inference responses                                                 |

The fake provider deliberately requested a compiler error and its repair. This
exercises the real harness, permission configuration, tools, compiler and streaming
adapter; it does not measure a model's independent reasoning or provider latency.
No provider credentials, real inference payments, Nostr signing, uploads or publication
were involved. Conformance skips still include unresolved manifest checks, unused
wire envelopes and unmeasured teardown.

## What the profile needs

- Bun **1.3.8**, with current soyLI/capture code bundled as JavaScript. These are
  experiment-specific launchers, not replacement standalone release binaries.
- OpenCode **v1.19.3** source and its frozen dependencies, installed before jobs run.
  The source was not patched. The tested adapter still uses `opencode --pure run`.
- The existing pinned Node **24.21.0**, pnpm **10.8.0**, starter lockfile,
  shell capture browser, and the conformance CLI's own locked browser version.
- Git and **ripgrep** preinstalled. Otherwise source-mode skill discovery/search
  attempts a download that correctly fails inside the network-disabled job.
- A preprovisioned model catalog (`OPENCODE_MODELS_PATH`) and
  `OPENCODE_DISABLE_MODELS_FETCH=true`. The compiled OpenCode executable has a
  catalog snapshot; an unprepared source checkout does not. Disabling catalog
  fetch with only the explicitly configured custom model sufficed for the first
  fixture; real native-provider profiles also need the catalog.
- An explicit executable workspace tmpfs. Docker's default `noexec` mount made
  project-local `tsc` fail with exit 126. `/tmp` remains non-executable.

The tool and project probes ran as UID/GID 1000, without network or capabilities,
with a read-only root, one CPU, 2 GiB memory including swap allowance, 128 processes,
a 1 GiB workspace and 128 MiB `/tmp`. Test deadlines removed containers on failure.
Image preparation was separate and allowed dependency downloads. The OpenCode
dependency installation needed a disk-backed cache and 2 GiB memory: a 512 MiB
tmpfs cache filled, and a subsequent 1 GiB memory attempt was OOM-killed.

The complete build/check/conformance/two-format capture probe took about 23 seconds;
the fake-provider skill/edit/search/error-repair loop about 18 seconds. These are
small starter smoke tests, not capacity or multi-user performance measurements.

The final run also used the maintained container worker to return all 73 source and
generated files, both screenshot/video pairs, and a 256 KiB binary verified byte for
byte. This caught a legacy stdout issue after child tools ran: `console.log` could
truncate large protocol lines, while `Bun.write(stdout)` could spin. The worker now
uses `fs.write`, advances by the actual byte count and retries backpressure. A real
worker-process regression leaves stdout non-blocking in a child and checks the
complete binary export and completion marker. This is required for the temporary
runtime; successful build/capture alone was insufficient evidence of safe transfer.

## Fingerprints and limits

Tested Bun binary SHA-256:
`b607d67724a4de3e149f15813a2d52f15e470c4feba3e0db753d2043ce3a6607`.

OpenCode source from
[`anomalyco/opencode` tag v1.19.3](https://github.com/anomalyco/opencode/tree/v1.19.3),
codeload archive SHA-256:
`8395f12e26df2d16610760ae224daf87da1d253a9883bf230be2c53984fe99ea`.

Preprovisioned public model catalog SHA-256:
`d4c6777c47b62c18eb501f1591ff77eb60222986bfe4a19af69f8d6d772a31b2`.

This demonstrates a viable temporary runtime combination on the tested VPS. It
does not establish upstream support for this old CPU, an enabled hosted Studio,
or compatibility with every native dependency a creator might add. A reproducible
operator-selected legacy image, explicit profile selection, real broker acceptance
and the remaining hosted UI/security integration still need to be completed before
opening Studio to remote users. See [hosting preparation](../STUDIO-HOSTING.md).

Both captured screenshots were inspected after their complete worker export. The
temporary VPS containers, images and source/cache workspace were removed after
archiving evidence locally. Production configuration stayed unchanged; the site
returned HTTP 200 after cleanup. The final focused CPU/worker tests passed 7 tests
and 38 assertions, with TypeScript and formatting checks passing.
