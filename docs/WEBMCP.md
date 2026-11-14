# Experimental napplet tools

Local reference profile `soy.webmcp/1`, 2026-11-13. This is **not an accepted NAP**
and is optional. The selected NIP-5D authority remains
`c041f84667c1781c3c1d5bfbd970943131b38cc9`; the normal sandbox and single private
MessagePort are unchanged. The browser adapter follows the WebMCP proposal at
`56b8e7a74a312c4298858f8211388a536b835339` (12 November 2026), using
`document.modelContext`. That proposal can change independently of this profile.

The website player and bundled local `soyli dev` preview use the same registry,
permissions panel, dispatcher and injected binding. “Agent tools” appears when a
napplet registers tools. Expanded players disclose it in the corner controls.
The panel stays above the player in browser fullscreen. Registration accepts a
descriptor; **access starts disabled**, including read-only calls. Users separately
allow internal shell tools and browser-agent exposure for the current document.
Stop cancels calls; Revoke also withdraws access. No chat or inference loop is
included. The inspector is a manual consumer of the same dispatcher a future
shell agent would use.

## Browser-wide switch and exports

Account & settings includes a **WebMCP** switch, enabled by default and stored
only in this browser. This enables availability, never document access. Turning
it off immediately revokes both grants in every live session, cancels running and
queued calls, and withdraws native browser tools. Turning it back on requires
fresh document approval. Manual napplet controls keep working.

NAP-FS exports show an explicit **Download** notification and persistent file
links outside the player's auto-hiding controls. This works in expanded and native
fullscreen players and the local soyLI preview. Notifications remain actionable
above trusted dialogs, including nested file/payment prompts. Download buttons
save the latest host session copy; they do not claim that a file has already been
saved to disk. Chunked writes update the link after a short quiet interval; close
the napplet only after downloading the needed files.

## Authoring

Use deliberate document operations with the same validation, state and undo
history as the toolbar. Do not reflect arbitrary methods, evaluate code, or expose
credentials. Keep ordinary UI and host file workflows usable when the binding is
absent or registration is declined. Do not add this experiment to `requires`.
The injected `window.napplet.webmcp` has:

- `profile: 'soy.webmcp/1'`.
- `registerTool(descriptor, execute)` → `{ id, name, unregister() }` asynchronously.
- `reset()` revokes both consumer grants when the app opens a different document.
- `onExposureChanged(callback)` → unsubscribe; the callback receives a boolean.

A descriptor contains `name`, optional `title`, `description`, `inputSchema`,
optional `outputSchema`, and optional `readOnly`. Input must be an object.
`execute(arguments, { signal, progress })` returns JSON or a promise of JSON.
Check cancellation before side effects and during asynchronous work. Describe units,
IDs, destructive operations and output meaning. Accept an expected document revision
for mutations, reject stale writes, serialize with manual edits, and return the new
revision. Avoid automatically retrying mutations after an unknown outcome.

Descriptions and results, including guidance, are untrusted app content. Ordinary
read-only tools such as `get_modelling_guidance({topic:'printability'})` can return
short task advice. There is no skill registry or guarantee that an agent will read
it. Guidance cannot override user instructions or shell permissions. A read-only
hint is not a security guarantee or consent to disclose a document to a provider.

Do not call native WebMCP from the iframe or add another messaging bootstrap.
Only the shell projects approved descriptors. NAP-FS, signing, payment and other
host permissions remain separate. Export tools should prepare a file through FS
and return file metadata and status; a host virtual path is not a public URL or
proof that an agent/user downloaded a file.

## Wire contract and lifecycle

All messages carry `profile:'soy.webmcp/1'` on the existing private channel:

| Message                         | Fields / effect                                                     |
| ------------------------------- | ------------------------------------------------------------------- |
| `webmcp.register` → `.result`   | `id, tool` → host `registrationId, name, exposed:false` or `error`  |
| `webmcp.unregister` → `.result` | `id, registrationId` → `ok:true`; withdraw and cancel               |
| `webmcp.reset` → `.result`      | `id` → `ok:true`; retain descriptors, revoke document grants        |
| `webmcp.changed`                | Host reports aggregate `exposed` boolean                            |
| `webmcp.invoke`                 | Host `callId, registrationId, sequence, arguments`                  |
| `webmcp.progress`               | App `callId, registrationId, text`                                  |
| `webmcp.complete`               | App `callId, registrationId` and `result` or `error:{code,message}` |
| `webmcp.cancel`                 | Host `callId, registrationId`; cooperative cancellation             |

IDs are scoped to a verified frame and account. Names use a host-generated instance
namespace. Duplicate names are rejected; unregister before replacement. New
registrations revoke existing grants so changed tool semantics require approval.
The binding ignores repeated/older invocation sequences for a registration.
Reload, account change, port loss and teardown withdraw registrations and grants.
Apps must reset exposure before replacing private document context; this cannot
make a malicious app's read-only or document-scope claims trustworthy.

Errors distinguish unsupported, unknown-tool, duplicate-tool, permission-denied,
invalid-tool/schema/arguments/data/request, quota-exceeded, busy, cancelled,
timeout and execution-error. Application errors can explain stale revisions.
Errors and progress are bounded and scrubbed; arguments/results are not logged.
After cancellation or timeout the caller is rejected, queued calls are rejected,
and the document remains busy until the callback settles. Late results cannot
revive a call. Completed effects may remain: inspect/undo or reload rather than
blindly retrying. Malformed terminal results fail the call and release its slot.

## Implementation limits

- 64 tools per frame; each descriptor at most 16 KiB; aggregate 256 KiB.
- 120 registration/reset/withdrawal requests per minute.
- Arguments/results/envelopes: 256 KiB finite JSON, depth 32, 50,000 nodes.
  Prototype keys and non-JSON values are rejected.
- Schema subset: `type`, `description`, `properties`, `required`,
  `additionalProperties` (boolean), `items`, `enum`, `minimum`, `maximum`,
  `minItems`, `maxItems`, `minLength`, `maxLength`, `uniqueItems`; depth 12.
  Types: object, array, string, number, integer, boolean, null. No remote references,
  composition keywords, coercion, executable validation or schema fetching.
- One running call and eight queued calls. Additional calls fail `busy`.
- Execution deadline 120 seconds after dispatch; registration response deadline
  15 seconds. These are safety bounds for this implementation, not proposed NAP
  universal constants. Failure does not trigger automatic resend.
- Progress: at most ten updates/second, 240 characters; error detail 800 characters.

Native registration uses `{ signal, exposedTo: [] }`; aborting that registration
withdraws it. This deliberately enables no arbitrary foreign origins. The shell
attributes each proxy to its napplet; a tool runs against that document, not whichever
iframe is currently focused. Browser registration failure withdraws browser access;
internal tools remain available. Browsers lacking the current native API can use
the internal inspector. Native consumer interoperability must be tested separately
from the adapter's mocked API tests.

## Checks

`bun test packages/runtime/src/webmcp` exercises the actual injected prelude, host,
validation, lifecycle, queueing and native-adapter contract. Build the website then
run `bun test tests/services/webmcp-browser.test.ts` for isolated website and soyLI
preview contexts. Optionally set `NAPPAKURA_ARTIFACT` to its built HTML to exercise
that app in the website player too. No public relay, inference or payment is used.
The Nappakura repository has additional geometry, PDF and browser workflow tests.
These checks do not establish compliance with a future accepted NAP-WEBMCP.
