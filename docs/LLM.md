# NAP-LLM reference implementation

This implements [NAP-LLM PR #134 at `5e93bdf`](https://github.com/zeSchlausKwab/naps/blob/5e93bdfce0e84c0de728234cb7b3feed498f8635/naps/NAP-LLM.md)
in the shared napplet.soy / soyLI preview runtime. It remains experimental and is
not deployed by this PR. Inference is optional; the NIP-5D sandbox and equal
publisher treatment remain unchanged. VALUE and paid CVM checkout are separate.

## Napplet API

Check for `window.napplet.llm` and keep the rest of the app usable when absent.
The pinned `@napplet/shim` 0.35.0 supplies `select`, `describe`, `generate` and
`cancel` over its private MessagePort. Our reviewed package patch preserves the
captured transport intrinsics, adds the draft's block deltas and prevents a
pre-aborted generation from being dispatched. There is no extra window-level
transport or application-owned handshake. Runtime profile: `space-playback-9-draft-llm`.

`generate(request, { signal, onDelta })` returns a promise with a `requestId`.
The authoritative result has **`content`**, not the older draft's `text` field.
Content contains text, display-only thinking and tool-call blocks. For ordinary
completion require `finish: "stop"`; for JSON concatenate the text parts and
validate the application's output schema. See the [consumer example](../examples/nap-llm.ts).

Tool definitions are data. **The runtime never executes tools.** A napplet may
execute only its own validated, allowlisted tools after a final `toolUse` result.
It then replays the assistant content and immediately answers every parallel call
with one `toolResult`, preserving call IDs and names. Historical calls/results
can be replayed without enabling new tools. Thinking is stripped from provider
input. A truncated/refused result contains no executable calls, even when some
parallel calls finished earlier.

Discover `tools` and `toolChoiceModes` on the selected Model. `auto` and `none`
are required when tools are enabled; `required` and named `tool` forcing are
individually configured capabilities. Unsupported modes fail before submission;
a provider ignoring a supported requested mode produces `provider-error`.

Optional deltas carry request ID, sequence, event (`start`/`delta`/`end`), block
kind and index. Tool-call starts also identify the call and name. Blocks may
interleave. Deltas are provisional and never authorize execution; replace them
with the terminal content. Our HTTP adapters currently buffer and emit **no**
deltas. The binding/session tests exercise synthetic block streams.

## Connection, consent and lifecycle

1. Configure a connection in shell settings or soyLI preview's **AI connections**
   panel. Declare image, JSON and tool capabilities for that endpoint/model.
   Changing models resets those declarations; changing any saved connection
   rotates its revision and invalidates existing selections.
2. Select a matching connection. Handles belong to one verified napplet endpoint
   and account, and expose only a label, model and human-readable route.
3. Each generation asks for consent, including destination/intermediaries, model,
   input summary, images, tool definitions/results and possible provider charges.
   Selection is not disclosure consent. Changes during consent require reselection.
4. The credential-owning service sends the request. With hosted Studio, inputs
   pass through the server; with soyLI preview, this process is local. Keys never
   enter the iframe, source or published artifact.
5. Cancel, account retirement, revocation and deadlines settle locally even if
   the provider ignores abort. Late output is suppressed. Nothing automatically
   retries an ambiguous operation; provider computation or charges may continue.

## Provider support and explicit limits

OpenAI-compatible, Anthropic Messages and Google generateContent adapters map
content, controls, tool definitions/results, completion reasons and token usage.
They reject malformed/unknown output without forwarding provider error bodies.
Credentials echoed anywhere in a response, including arguments, are withheld.
Usage includes available cache/read/write and reasoning counts; it is not a bill.

- OpenAI-compatible images are supported in user messages; assistant/tool-result
  images are rejected. Tool errors receive the `Tool execution failed.` prefix.
- Anthropic supports image tool results and its native error flag. Parallel
  results share a user turn. Thinking/tool histories needing signed continuation
  are rejected before submission. JSON-object mode and system images are unsupported.
- Google tools are currently limited to the non-thinking Gemini 2.0 Flash family.
  Other Gemini tool selections/continuations are rejected because this adapter
  cannot preserve opaque thought signatures. Its tool results currently support
  text only. Other supported requests can still use text, images and JSON.
- DeepSeek reasoner tool continuations are rejected; the non-thinking adapter
  explicitly disables thinking. OpenAI reasoning-model temperature overrides are
  rejected. Adapter temperature ranges are 0–1 for Anthropic and 0–2 otherwise.
- System-message images are rejected by all adapters; roles are never silently
  changed. Thinking-only historical messages have no replayable provider content
  and are explicitly unsupported.
- Tool parameter schemas are checked against JSON Schema 2020-12. The adapter
  supports object properties, required fields, arrays/items, additionalProperties,
  primitive types, enum/const, annotations and numeric/string/array/object size
  constraints. References, composition, patterns and other valid unsupported
  keywords fail before submission. Schemas are never executed or remotely fetched.
- Capability settings are user declarations intersected with adapter limits,
  not automatic model certification. Provider-specific live acceptance and
  independent-runtime acceptance remain unverified.

Local input policy retains 200 messages, 128 parts/message, 200,000 characters per
text part, 2,000,000 base64 characters/image and an 8 MB wire request, plus shared
host quotas. Inputs are rejected rather than truncated. Generation has a
20-minute deadline including consent; the shared consent dialog expires after
25 seconds without a response. `maxTokens` is forwarded when provided; omission
adds no napplet-defined limit. Anthropic requires a limit and uses the adapter's
8,192-token default when omitted. These are runtime policy, not NAP requirements.

Provider mapping references: [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
[Anthropic tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools),
[Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
and [thought signatures](https://ai.google.dev/gemini-api/docs/thought-signatures).

## Verification

Local verification on 2026-11-06: typecheck, production web build and the full
971-test suite pass. The final provider/capability changes also pass 13 focused
tests. Chromium port-privacy tests (four cases) and production-player revocation
pass. On x86_64 Linux, package realization, forced dependency/soyLI rebuilds and
the NixOS VM regressions also pass. The aarch64 Nix checks were not run locally.

```sh
bun test packages/runtime/src/llm-contract.test.ts \
  packages/runtime/src/llm-conformance.test.ts packages/runtime/src/llm-tools.test.ts \
  packages/runtime/src/experimental-prelude.test.ts packages/runtime/src/host.test.ts \
  apps/studio/inference-jobs.test.ts
bun test tests/services/nip5d-port-privacy.test.ts
```

| Draft cases | Regression evidence |
|-------------|---------------------|
| C01–C03 | Optional consumer, injected private-port binding, strict request and capability rejection |
| C04–C08 | Consent denial, endpoint/account handles, duplicate IDs, abort during consent/revalidation, deadlines and late-output suppression |
| C09–C11 | Block ordering and final replacement, partial/JSON/refusal validation, credential redaction and authenticated local HTTP entrypoint |
| C12, C20–C21 | Parallel history, missing/duplicate/orphan/mismatched results, unique IDs/names, strict fields, schemas, choices and control validation |
| C13–C16 | Forced choices, synthesized IDs reused in history, stop normalization, truncated parallel calls, malformed arguments and unknown names |
| C17–C19 | Thinking omitted on replay, unsupported opaque state rejected before submission, interleaved blocks and capability mode rejection |
| C22–C23 | Image-result rejection, native/prefixed tool errors and explicit consent for definitions/results |

Chromium executes both identity and LLM operations in a real opaque-origin
iframe while adversarial code replaces MessagePort and MessageEvent intrinsics.
The port remains inaccessible. These tests use fixture providers and do not
perform live inference or payments. The inference-job status API never contacts
a wallet; paid CVM rollout and Minibits behavior are outside this change.
