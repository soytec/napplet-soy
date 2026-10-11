# soyLI error diagnostics

`CONFORMANCE_BROWSER` identifies missing compatible headless Chromium or FFmpeg
for the project's own Playwright version, including the expected revision and
executable path. Nix builds report this before running the project conformance
script or a browser installer, with flake/version/cache recovery options. Regular
installations still install missing browsers automatically. Browser inspection
and installation failures retain the tool's cause and exit status. Real compiled
CLI regressions cover cache reuse, Nix refusal, terminal/JSON recovery, and the
ordinary installation fallback; the offline NixOS VM also runs upstream
conformance with real packaged Chromium.

Historical source failures now identify the rejected path, Git blob, containing
commit and release commit without printing blob contents. `publish --dry-run`
performs the same history checks before sandbox/network work; these failures are
not resumable service failures. Recovery distinguishes a still-tracked generated
context from an ancestry-only blocker, where editing `publish.files` cannot help.
The narrow legacy public backend-context compatibility rule and explicit cleanup
procedure are documented in [Historical source checks](CLI.md#historical-source-checks).
CLI terminal and JSON regressions verify the context, recovery, redaction and
unchanged repository/publication status.

Safe relative source aliases, including `CLAUDE.md -> AGENTS.md`, are accepted in
current and historical trees. Rejected aliases retain the affected source path and
a safe reason (for example a cycle or missing selected target), without printing
raw link targets or credentials. Git history errors retain the blob and containing
commit. Safe aliases do not require replacement or history rewriting. A
`GIT_MERGE_SOURCE` diagnostic means the predicted merge failed source checks before
any branch was changed; it preserves the underlying source cause and recovery.

`GIT_INITIAL_COMMIT_FAILED` reports a failed initial scaffold checkpoint, preserving
the Git cause, exit status and bounded redacted output. Generated files stay in the
new folder; the recovery step explains how to inspect and checkpoint them without
recreating the project. `GIT_INIT_FAILED` separately identifies initialization
failures. Both paths are covered through the real CLI entrypoint.

Score attachment schema validation preserves the failed field/rule without echoing
submitted values. Validators can explicitly attach a safe `diagnosticMessage` to
a custom Zod issue; other Zod messages remain suppressed. `BACKEND_VERSION` reports
an older provider lacking `soy.boards.v2` before a registration signer is opened,
with the required upgrade/configuration step. Real CLI tests cover both failures.

2026-09-23 source no longer reports `CREATOR_MISMATCH` for a live project merely
because its saved scaffold creator differs from the selected account. Sharing
captures the selected account and journals releases by public key. Frozen jobs
still validate their author; a missing or failing captured credential reports its
cause without falling back to another account. Agents must not change selection to
work around an error. Real CLI dry-run/status and encrypted NIP-46 tests cover this
boundary; lifecycle commands cannot manage another selected author's releases.

2026-09-23 source separates remote session files from local private-key storage.
`account storage file|keychain` verifies the destination before changing metadata.
`SESSION_CLEANUP` means the new copy is active but removal of the old copy failed;
the error identifies the retry command, with only safe OS operation/codes when
available. Cleanup is persisted for recovery after a process restart. `KEYSTORE_FILE`
reports unsafe file permissions/types without falling back to Keychain. Real CLI
tests exercise connect/reconnect with native access denied, destination write
failure, cleanup failure/retry, and permission refusal with redacted diagnostics.

2026-09-23 bunker validation reports the actual failed relay-count, URL, key or
secret-length constraint as `INVALID_BUNKER`, with a hidden-input recovery step.
It preserves only validator-authored safe text; URL/parser exceptions and the
supplied connection string are never included. Entrypoint regressions cover a
four-relay connection reaching transport and a nine-relay rejection without
exposing the synthetic test secret. See [IDENTITY.md](IDENTITY.md) for limits.

2026-09-23 source adds pinned Rust/WASM and custom build recipes to the same
diagnostic/process runner. Rustup, Cargo and wasm-bindgen failures retain tool
status and bounded redacted output, including the tail containing compiler errors
after lengthy compilation logs. Missing targets, conflicting lock/tool pins,
oversized modules/HTML, unsupported memory profiles and missing scene readiness
have specific recovery messages. A failed Rust build keeps the previous complete
HTML; its watcher retries after a source edit and terminates owned compilers on
preview exit. Real entrypoint tests cover compiler failure/redaction, lock mismatch,
literal custom arguments and watch failure/recovery/cancellation. See [WASM.md](WASM.md).

Source **0.16.2** replaces the top-level `CLI_FAILED` message with a shared
diagnostic. Failures report the operation, original error message/code, available
tool exit status or service HTTP status, underlying causes and a recovery step.
These changes and the 0.16.3 improvements below ship in **0.17.0**.

Source **0.16.3** also retains Git failure output from **both stdout and stderr**.
Git merge preflight reports conflicts on stdout, including affected filenames;
those details now reach terminal, JSON and local review errors. A conflict still
leaves the working tree untouched. Both streams use the same bounded secret
redaction as other tool errors.

Optional publication copies retain `mirrorErrors` alongside the existing
`mirrors` success flags in `soyli publish` / `soyli status --json` and the saved
journal. Each failure identifies the public event ID/kind, attempt time, diagnostic
and retryability. Terminal output and the workshop also show these nonfatal
warnings. A failed mirror does not undo primary publication; a successful retry
clears that mirror's failure. Older journals without this field remain readable.
Run `soyli publish` again to repair copies of the saved release; unchanged source
reuses the existing signed events. Failed primary publication still uses
`publish --resume`.

Best-effort copies to the creator's NIP-65 write relays are reported separately as
`outbox` in the same results and journal: per-relay `copies`, `errors` with the
same diagnostic shape, and `lookupError` (`OUTBOX_LOOKUP`) when no relay list was
read. Lookup diagnostics keep each failed lookup relay as a target and cause.
Terminal status/publish output and the workshop show `Optional outbox copy failed`
warnings and lookup failures; none of them fail the publication. Real CLI tests
cover terminal and JSON output and redaction. Canonical relay URLs exceeding
256 characters are skipped before writes, with a terminal explanation. The total
optional network phase is capped at eight seconds; `OPTIONAL_COPY_TIMEOUT` or
`OPTIONAL_COPY_CANCELLED` leaves primary completion intact and identifies every
unfinished destination for retry. Attempted destinations remain in the cumulative
`outboxHistory` even when the next lookup selects a different list.

For example, a failed project dependency installation can report:

```text
PROJECT_TOOL: The project tool reported a failure.
Operation: install project dependencies
Tool: pnpm
Exit status: 1
ERR_PNPM_OUTDATED_LOCKFILE …
Next: Fix the tool error shown above and retry setup/build or the requested project command.
```

There is no debug flag to discover before obtaining useful errors. Missing files
include their path; invalid configuration reports field paths. JSON parsing errors
omit input excerpts. The normal CLI error includes its version and platform.

## For agents and bug reports

For commands supporting `--json`, stdout contains an error envelope:

```json
{
  "error": {
    "code": "PROJECT_TOOL",
    "message": "The project tool reported a failure.",
    "operation": "install project dependencies",
    "details": ["Tool: pnpm", "Exit status: 1", "ERR_PNPM_OUTDATED_LOCKFILE …"],
    "recovery": "Fix the tool error shown above and retry setup/build or the requested project command."
  },
  "version": "0.16.2",
  "platform": "darwin-arm64"
}
```

Tool progress stays on stderr. Publication errors also retain `stage` and
`retryable` when available; their saved retry records retain the sanitized cause.
A failure to save that record is reported explicitly. Inspect `soyli status`
before resuming a release; `publish --resume` uses the saved bytes and signatures.
Use `propose --resume` for a saved proposal. Do not recreate a project or identity
to work around an unrelated failure. `run`/`exec` continue passing their trailing
arguments to the project command, including any `--json` flag.

The local workshop and review UI receive the same formatted diagnostic. Existing
local HTTP error responses retain their `error` text and add a `diagnostic` object.

## Wrapped operations

- **CLI updates:** release lookup retains HTTP status and timeout causes; installer
  failures retain sanitized curl/tar output and exit status. Doctor reports an
  unavailable release check alongside local diagnostics. `soyli update --json`
  keeps installer progress on stderr and emits one structured result/error.
  A package-manager build (`--distribution nix`) refuses with `UPDATE_INSTALLATION`,
  naming that package manager in the recovery instead of the GitHub installer.
- **Git:** startup, exit status, bounded stdout/stderr, timeout and output-limit errors.
  Failed source alternatives retain their causes when no source succeeds.
  Proposal inbox confirmation includes failed Git ref pushes, and Git execution
  errors are distinguished from merge conflicts or an advanced upstream branch.
- **Own source repository:** an unresolvable `nostr://` remote (`REPOSITORY_REMOTE`)
  keeps each remote's name, URL and NIP-05/HTTP cause instead of falling back to a
  hosted copy. `SOURCE_NOT_PUSHED` names the release commit, the signed refs checked
  and each clone URL's `ls-remote` failure. `REPOSITORY_AMBIGUOUS`,
  `REPOSITORY_OWNER` and `REPOSITORY_UNAVAILABLE` name the repository and how to
  select one. These errors keep their own recovery when saved in the journal.
- **Project tools:** setup, build and other wrapped commands retain a sanitized
  output tail. Vite watcher failures include their output and exit status when
  available. Toolchain downloads identify their destination and HTTP failure.
  A packager-provided toolchain reports `TOOLCHAIN_PROVIDED` for an incomplete or
  missing `SOYLI_NODE`/`SOYLI_PNPM` pair and `TOOLCHAIN_VERSION` with the Node path
  when it is not the pinned version.
- **Relay build/test runner:** Go dependency and build/test failures preserve
  sanitized tool output, operation, exit status, relay directory and recovery
  command. Test failures are no longer mislabeled as missing build prerequisites.
  The relay service gate checks this through a real failing Go subprocess.
- **Browser:** installer output/status, cancellation and timeout are distinguished.
  Startup checks preserve browser errors and a bounded sample of script errors.
- **Relays and Blossom:** exhausted remix lookups/downloads retain individual
  failure causes; publication refusals identify the service and reported reason.
  A successful fallback is still a success.
- **Credentials:** OS-store failures identify read/write/delete and supplied
  OS error code/errno. Raw credential-store exception text is deliberately omitted.
  No usable diagnostic data from the OS is reported as such.

This is a diagnostic boundary, not a change to the NAP protocol, storage policy,
publication checks or retry semantics. Optional missing metadata can still be
absent without failing an otherwise successful operation.

## Bounds and sensitive data

`packages/diagnostics/src` handles formatting and scrubbing for the terminal, JSON
and local UI. It removes recognized private keys, signer connection URLs, URL
credentials/query/fragment, JWTs, common labeled secrets and terminal controls.
All 64-character hexadecimal strings are obscured because a private key cannot
be distinguished from a public hash by shape alone.

Tool output is processed by line, including across stream chunks. Each stream
retains an 8 KiB tail; oversized lines are omitted. Diagnostics retain up to eight
2,000-character details, with bounded cause depth and aggregate traversal. No
argument, environment, request or credential dumps are collected. Redaction
cannot identify arbitrary unlabeled secrets printed by third-party programs;
do not print credentials in project scripts. The original error stays available
internally while only the selected, sanitized diagnostic is displayed or saved.

Regression tests exercise the actual CLI entrypoint, including a failing tool
fixture, and can run against a compiled binary with `SPACE_TEST_CLI=/absolute/path/to/soyli`.
Shared tests cover cause cycles, configuration values, split-chunk secrets and
bounded output; credential tests check that only OS codes cross the vault boundary.

Manifest migration reports `MIGRATION_NOT_FOUND`, `MIGRATION_STALE`,
`MIGRATION_SNAPSHOT`, `MIGRATION_DELETED`, `MIGRATION_EXPIRED` or `REMOTE_CONFLICT`
with a next step. Exhausted artifact downloads retain bounded server/HTTP/hash
failure causes through the diagnostic boundary. `MIGRATION_PUBLISH` retains the
primary relay refusal and instructs the author to resume the exact saved event.
No migration failure silently rebuilds or overwrites an existing publication.

`BACKEND_SOURCE_LINKED` reports the current remote-backend limitation when a
project uses its own NIP-34 repository. The CLI identifies that repository and
keeps the account unchanged; no remote build or authorization has been sent.
Local backend previews remain available through `soyli dev`.
