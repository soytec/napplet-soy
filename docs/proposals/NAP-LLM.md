# NAP-LLM draft

The canonical proposal is [napplet/naps#134](https://github.com/napplet/naps/pull/134)
on the `nap-llm` branch. It defines user-selected, runtime-mediated inference and
includes its schemas, wire examples, errors, lifecycle and conformance cases.
Keep contract changes there so this repository does not maintain a second spec.

The [reference implementation guide](../LLM.md) records implemented behavior,
local policy limits and verification. The implementation is proposed in
[soytec/napplet-soy#45](https://github.com/soytec/napplet-soy/pull/45).
The implementation tracks upstream revision `5e93bdfce0e84c0de728234cb7b3feed498f8635`
(content blocks, tool calls/results, tool choice and C01–C23). The upstream PR is
open for review; this reference PR remains a draft. Neither implies acceptance
or deployment.
VALUE amendments and paid CVM checkout/rollout remain separate.
