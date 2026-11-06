# Shell inference and native CVM payments

Local reference implementation; not publicly deployed. BYOK uses the optional
[NAP-LLM draft](proposals/NAP-LLM.md). Paid services use the existing SDK CVM
surface and [NAP-CVM proposal #31](https://github.com/napplet/naps/pull/31), pinned
at `28cf1bdb5c6412bfbfcecb79a5a5121e18376f2f`, with ContextVM SDK 0.14.3 CEP-8
explicit gating. The previously explored VALUE amendment remains deferred;
no VALUE binding, domain advertisement or frame request handlers remain.
NIP-5D authority remains `4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51`.

## Responsibilities

| Component | Responsibility |
|---|---|
| Napplet | Review input, save recovery receipt, call the paid tool, validate/render the report |
| Shell inference | BYOK credentials, model choice, per-request consent and provider HTTP |
| Shell CVM host | Encrypted transport, native payment gate, invoice validation and checkout |
| Existing wallet | Mint/balance choice, fees, explicit approval and durable spending journal |
| Private CVM | Provider credentials/prompt, durable order, invoice, verified settlement and report |

A paid call uses `cvm.callTool(..., {payment: "prompt", timeoutMs: 300000})`.
Free staging, disclosure, status and explicit confirmation calls use `payment: "deny"`.
Neither app-owned networking nor a VALUE amendment is needed.

## Checkout and policy

The host reads signed capability pricing from the server's tool list. Free calls
retain their existing transport identity. Advertised paid calls use a fresh
invocation identity, kept unchanged for the approved retry and then discarded.
Thus a later invocation, another app or a deny call cannot consume its native
paid authorization. Paid calls without an advertised capability fail closed.
This release supports paid **tools**, not paid resource or prompt operations.

`deny` refuses advertised priced tools before invocation. `allow` also refuses
because there is no configured standing allowance. Default `prompt` requires
approval for the exact server, operation, invoice amount and wallet fees.
Explicit-gating negotiation must succeed before checkout. Transparent native
payment notifications are intercepted and rejected promptly; offers are never
forwarded into a napplet for custom handling.

The shell validates the signed fixed-amount Bitcoin Lightning invoice against
the CEP-8 offer, including expiry. It displays a QR and copyable string for an
external wallet. On the website, **Pay from wallet** reuses the existing Cashu
mint chooser, balances, operation guard and transaction journal. The user reviews
amount and fees before spending. The soyLI host has the same checkout and QR
fallback without a spending backend or access to publishing credentials.
Direct Cashu token delivery, NWC spending, LNURL resolution and on-chain payments
are outside this CVM checkout. Existing wallet/zap operations are unchanged.

One deadline includes connecting, consent, payment and execution (default 30s,
maximum 300s). After approval, the host retries the identical method/arguments
once using the same invocation key. Pending/uncertain outcomes do not start
another payment, poll a wallet, or retry execution in a loop. Closing the frame,
changing account or closing the CVM session cancels checkout. Payment cannot
promise successful report delivery or an automatic refund.

## AI Doc reference and quiet settlement

The proprietary service remains in a separate private repository. New orders
use a version-2 contract:

1. `body_journal_paid_prepare` freezes reviewed input and price, with a durable
   recovery receipt. It creates no invoice and runs no inference.
2. `body_journal_paid_run` is priced through native CEP-8. The shell handles the
   offer; tool/status results contain no native invoice.
3. `body_journal_paid_confirm` is an explicit user action. For Minibits it makes
   one incoming-invoice lookup, with no automatic retry.
4. Verified payment makes the order eligible; the paid invocation starts the
   report once. Completed/paid recovery reuses the original order without billing
   again. `body_journal_paid_status` only reads saved report state.

The service uses its existing quiet NWC adapter, **not** the SDK NWC processor's
polling fallback. Native verification waits for a saved confirmation or validated
push notification. Status reads, recovery, background work and startup/restart
make zero NWC commands in manual mode. A wallet supporting incoming-payment
notifications can use passive push. Uncertain invoice creation or interrupted
inference requires operator recovery; it never silently creates a replacement.
Existing legacy invoices/receipts remain recoverable, including their app QR.

## BYOK unchanged

The website uses account settings → AI connections and the private Studio
credential store. soyLI preview's AI connections use
`~/.config/soyli/inference/connections.json` (or `SOYLI_INFERENCE_DIRECTORY`),
owner-only and separate from projects. Provider/model handles belong to one
frame/account lifetime; keys never enter the frame. Changing configuration
invalidates handles. Napplet-declared tools follow the NAP-LLM content-block
contract; the napplet executes returned tool calls. Provider-native tools,
automatic inference retries and arbitrary app-supplied endpoint/headers are
not allowed.

OpenAI-compatible providers, Anthropic Messages and Gemini GenerateContent remain
supported. Explicit image/JSON capability declarations are required. Anthropic
JSON-object output remains unsupported by this adapter. Responses are buffered;
the optional delta arrives at completion, not token by token. Input limits reject
rather than truncate; inference has its existing 20-minute deadline and ephemeral
completed-job retention of 30 minutes. A service restart loses an in-flight job
without automatically repeating a billed call.

## Verification and rollout

Synthetic tests cover native encrypted gate/retry, stable free identities,
policy refusal, withheld offers, invoice validation, wallet approval, durable
spending, pending-payment handling and QR removal. Private tests cover native
gating, restart recovery, a single invoice/report and zero background NWC calls.
AI Doc fixtures cover BYOK, paid recovery, explicit confirmation and validation.
The combined candidate passes 981 unit tests, type checking, a production web
build, the encrypted native-payment fixture, browser checkout acceptance and
the full Linux Nix/KVM checks. No funded transaction is part of automated
acceptance.

The deployed service remains the earlier quiet version until this migration is
explicitly rolled out. Earlier 90-second live observation of that version saw
zero NWC requests across restart and 12 order reads. That is not live acceptance
of this new migration. Public deployment, funded settlement, independent-shell
checkout acceptance remain separate gates.
