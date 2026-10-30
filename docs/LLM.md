# NAP-LLM reference implementation

This branch implements the [NAP-LLM draft (upstream #134)](https://github.com/napplet/naps/pull/134) for review in the
shared napplet.soy / soyLI runtime. It is experimental, not deployed, and is not
part of the pinned upstream SDK. The selected NIP-5D pin and strict sandbox stay
unchanged. Optional inference does not become a playback requirement.

## Use from a napplet

The runtime injects `window.napplet.llm`. Check for its presence and keep the
rest of the napplet usable without it. The [optional consumer example](../examples/nap-llm.ts)
selects a JSON-capable connection, sends a conversation, requires normal
completion and validates the application's output schema. It contains no
provider URL, API key, network call or payment operation.

`generate(request, { signal, onDelta })` returns the final generation. The signal
cancels this invocation; the binding creates the request ID and maps abort to the
wire cancellation. `onDelta(text)` receives optional provisional text. The final
`text` replaces provisional text. This local binding is a draft adapter, not a
claim that the upstream SDK already exposes these methods.

The application pattern comes from AI Doc 3D's shell-owned inference path:
application-owned prompts and inline images, runtime-owned connection and consent,
then application validation of a complete JSON object. The standalone example
makes that boundary reviewable without including the proprietary report service.

## Connection and authority path

1. The user configures AI connections in the main shell settings or soyLI preview's
   **AI connections** panel. Image and JSON capabilities are explicit settings.
2. The napplet requests a selection. The runtime offers matching connections and
   returns an opaque handle scoped to the verified frame and current account.
3. Each generation asks for disclosure consent showing the connection, route,
   model, image count, text summary and possible provider charges. A selection
   does not authorize disclosure. No generation starts when consent is declined.
4. The credential-owning service makes the provider request. Credentials never
   enter the frame, project or published artifact. On hosted Studio this process
   is on the server; prompts/images pass through that server. With soyLI preview
   it runs on the user's computer.
5. Cancellation, deadlines and account retirement settle locally even when a
   provider ignores cancellation. Late output is discarded. Cancellation cannot
   guarantee the provider stopped computing, storing input or charging.

The provider adapters support OpenAI-compatible APIs (including compatible local
servers), Anthropic and Google. Anthropic JSON-object mode and system-message
images are explicitly unsupported. Unknown completion reasons/tool calls fail;
this domain executes no tools. HTTP failures do not forward provider bodies.

## Files and local checks

- [Contract and session lifecycle](../packages/runtime/src/llm-contract.ts)
- [Frame/account dispatch](../packages/runtime/src/host.ts)
- [Injected binding](../packages/runtime/src/experimental-prelude.ts)
- [Shared shell connection client](../packages/runtime/src/llm-service.ts)
- [Provider adapters](../packages/runtime/src/inference-provider.ts)
- [Private inference jobs](../apps/studio/inference-jobs.ts)
- [soyLI preview service](../apps/cli/src/preview/server.ts)

Run the focused fixtures without external inference or payment credentials:

```sh
bun test packages/runtime/src/llm-contract.test.ts \
  packages/runtime/src/llm-conformance.test.ts \
  packages/runtime/src/experimental-prelude.test.ts \
  packages/runtime/src/host.test.ts apps/studio/inference-jobs.test.ts
```

The conformance IDs in the draft map to these executable checks:

| Cases | Evidence |
|-------|----------|
| C01–C03 | Session/input fixtures, injected binding and optional consumer fallback |
| C04–C06 | Consent denial, endpoint-local handles/cancellation and duplicate generation ID |
| C07–C08 | Stalled provider/consent cancellation, deadline, changed connection and host account switch |
| C09–C10 | Buffered provider and synthetic deltas, ordering, terminal suppression, refusal/limits, missing completion and JSON validation |
| C11 | Provider credential/body redaction and actual authenticated Studio HTTP entrypoint |

These are reference implementation checks. They are not independent-shell
acceptance evidence. Synthetic deltas exercise the contract; real provider
responses are currently buffered and the shell client reports their text at
completion. No live-provider request or paid test is required by this suite.

## Current limits and remaining work

- Runtime policy bounds each generation to 20 minutes including revalidation and
  consent. Its shared consent dialog expires after 25 seconds without an answer.
  These values are local policy, not protocol requirements. Users must explicitly
  retry; the implementation never automatically retries a provider generation.
- Local input policy allows 200 messages, 128 parts per message, 200,000 characters
  per text part, 2,000,000 base64 characters per image and an 8 MB wire request.
  The shared frame quota applies too. Limits reject requests; they never truncate
  conversation input. Anthropic's adapter requests at most 8,192 output tokens
  and preserves an output-limit finish as incomplete.
- Provider capabilities are user-configured; they are not certification that
  every model or endpoint supports the chosen input. Provider-specific live
  acceptance and an independent runtime implementation remain unverified.
- The connection/job API is private to the shell. Its short status checks are
  inference-job checks, not wallet polling. No wallet calls occur on this path.
- VALUE amendments, paid CVM checkout/rollout, invoice handling and the private
  AI Doc service are separate work and are absent from this reference change.

## Verification record

Reference code commit: `0200e7c82675a781ea11292a57801f16a93d3101`.
On 2026-10-30, typecheck and all 940 tests passed; the focused inference/host/HTTP
suite passed all 20 tests. The production web build passed. On x86_64 Linux with
KVM, `bash scripts/nix-check.sh` passed the dependency and soyLI realization,
forced rebuild, flake checks and NixOS VM regression check. aarch64 Linux was not
validated in this run. No live inference or payment operations were performed.
