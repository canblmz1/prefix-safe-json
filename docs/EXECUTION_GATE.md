# Execution Safety Gate

`createToolCallExecutionGate()` is a fail-closed decision layer built on top
of `createToolCallStreamCoordinator()`. It answers one question per streamed
tool call: **is it safe to execute right now?** Callers never touch parser
lexical state, coordinator event mechanics, or JSON Pointer paths - push
normalized provider events in, read `ExecutionDecision`s out.

```
Parser  ->  Coordinator  ->  Execution Safety Gate  ->  execute / retry / reject
```

## Threat model

LLM providers stream tool-call arguments as small JSON chunks. That stream
can end without ever delivering a complete, trustworthy value:

- `max_tokens` / length limits cut generation off mid-argument.
- Network interruptions or provider-side errors drop the connection.
- The caller explicitly cancels generation.
- A provider content/safety filter terminates the response.
- The provider's protocol itself is inconsistent (conflicting tool-call IDs,
  a name that never arrives).

A syntax-level JSON repairer can make truncated input *look* structurally
complete - closing an unterminated string or array - without knowing whether
the underlying generation actually finished. Executing a tool call built
from that repaired value means acting on data nobody, including the model,
ever actually produced. See the root README for a concrete example: a
truncated `write_file` call whose `content` argument gets silently
"completed" mid-password by a JSON-repair library and then written to disk.

The gate's job is narrow and specific: **distinguish complete, unfabricated,
schema-valid arguments from everything else**, and default to *not*
executing whenever that can't be established with certainty.

## `execute` / `retry` / `reject` semantics

```ts
type ExecutionAction = "execute" | "retry" | "reject";
```

- **`execute`** - the arguments are structurally complete, were never
  fabricated by a repair, and (if a schema was registered for this tool)
  match it. Safe to run.
- **`retry`** - the provider's output was incomplete or truncated. Nothing
  about the data received so far is *wrong* - there just isn't a trustworthy
  complete value yet. The right response is to continue generation / retry
  the request, not to treat the partial data as final.
- **`reject`** - the data itself is the problem: malformed JSON, a schema
  mismatch, a resource limit, a provider-side error, or a content-policy
  termination. Re-sending the exact same partial input will not fix any of
  these; retrying blindly is not a helpful default.

Every decision also carries a machine-readable `ExecutionReason`:

```ts
type ExecutionReason =
  | "complete"           // execute
  | "truncated"           // retry - parser positively observed an open value/container
  | "stream_incomplete"   // retry - structurally resolved, but not a confirmed genuine completion
  | "schema_invalid"      // reject - complete, but fails the registered JSON Schema
  | "malformed"           // reject - duplicate key, bad token, or a broken tool-call identity
  | "resource_limit"      // reject - a parser or coordinator limit was hit
  | "provider_error"      // reject - the upstream provider call itself failed
  | "content_filtered"    // reject - stopped by a content-safety/policy filter, not truncation
  | "sdk_execution_observed" // reject - the SDK already invoked the call
  | "projection_only"     // reject - structured projection, not raw argument proof
  | "protocol_violation"  // reject - sticky ordering/identity violation
  | "unknown";            // reject - unreachable fallback; fail closed, never guess
```

### The decision table

Evaluated in this order, first match wins. Every fail-closed disqualifier is
checked **before** the single positive `execute` branch - `execute` is
reached only once nothing above has ruled it out, not as a first check that
later conditions could otherwise slip past:

| # | Condition | action | reason |
|---|---|---|---|
| 1 | SDK execution ownership evidence exists - `status === "sdk_execution_observed"` for this call, **or** an unattributable `tool-result`/`tool-error` was recorded anywhere in this stream (see [Execution ownership](#execution-ownership-tool-resulttool-error-as-evidence) below) | reject | `sdk_execution_observed` |
| 2 | A resource-limit diagnostic was recorded (`E_LIMIT_*` on the parser, or `E_COORDINATOR_LIMIT_*` / `E_TOOL_NAME_LIMIT` on the coordinator) | reject | `resource_limit` |
| 3 | The stream-level end reason was `"provider_error"` | reject | `provider_error` |
| 4 | A content-policy termination was recorded (`E_CONTENT_FILTERED`) | reject | `content_filtered` |
| 5 | Call evidence is a structured projection rather than raw argument text | reject | `projection_only` |
| 6 | A call-scoped or genuinely stream-wide authority protocol violation was recorded | reject | `protocol_violation` |
| 7 | `status === "complete"` and the registered schema failed | reject | `schema_invalid` |
| 8 | `status === "invalid"` (duplicate key, bad token, broken tool identity) | reject | `malformed` |
| 9 | `status === "truncated"` (a real, raw mid-value/mid-container cut) | retry | `truncated` |
| 10 | `status === "complete"` **and** `parser.executable` **and** schema passes (or no schema registered) | **execute** | `complete` |
| 11 | Everything else non-executable - `"salvaged"` (repaired-closed, unconfirmed), `"complete"`-but-not-`executable` (stream-reason mismatch or trailing data), `"cancelled"`, `"collecting"` | retry | `stream_incomplete` |

Row 1 is checked before every other row, including the resource/provider/
content-policy checks in rows 2-4: it is a statement that execution
authority already left this library's hands, not a statement about the
arguments or stream being unusable, and a caller's higher-level logic might
need to act on that completely differently (e.g. safe to regenerate the
whole tool call on a resource limit; never safe to once SDK execution was
observed, since a fresh generation could trigger the SDK's own `execute()`
again for whatever already ran).

Row 10 is the important one for container-level truncation: a value like
`["npm install","npm test"` has no unterminated string - the parser *can*
structurally close the array - but if the stream ended for reason `"length"`
rather than `"complete"`, the result is still `retry` / `stream_incomplete`,
never `execute`. Provider stream metadata, not just JSON shape, is what
gates execution.

### `ExecutionDecision` is a discriminated union

```ts
interface ExecuteDecision {
  action: "execute";
  executable: true;
  reason: "complete";
  value: JsonValue;          // always present, never undefined
  stableValue?: JsonValue;
  // ...
}

interface NonExecutableDecision {
  action: "retry" | "reject";
  executable: false;
  reason: Exclude<ExecutionReason, "complete">;
  // no `value` field at all - not optional, absent
  stableValue?: JsonValue;
  // ...
}

type ExecutionDecision = ExecuteDecision | NonExecutableDecision;
```

TypeScript itself enforces the contract: narrowing on `action === "execute"`
is required before `decision.value` type-checks at all. `stableValue` - what
was safely committed, complete or not - stays available on every decision so
a caller can see what *part* of a rejected/retried call arrived (e.g. a
`path` field that came in before a `content` field got cut off), without it
ever being mistaken for a safe-to-use final value.

## Provider finish reasons

Every adapter normalizes its provider's own finish/stop reason into the
shared `StreamEndReason` (`"complete" | "length" | "network_error" |
"provider_error" | "cancelled" | "unknown"`):

| Provider | Signal | Maps to |
|---|---|---|
| OpenAI / OpenAI-compatible (Chat Completions shape) | `finish_reason: "stop" \| "tool_calls" \| "function_call"` | `complete` |
| | `finish_reason: "length"` | `length` |
| | `finish_reason: "cancelled"` | `cancelled` |
| OpenAI (Responses API shape) | `response.completed` | `complete` |
| | `response.incomplete` + `incomplete_details.reason: "max_output_tokens"` | `length` |
| | `response.incomplete` + `incomplete_details.reason: "content_filter"` | `cancelled` **+** an `E_CONTENT_FILTERED` diagnostic, same treatment as the AI SDK adapter's `content-filter` below |
| | `response.incomplete` with a missing/unrecognized `incomplete_details.reason` | `unknown` (never assumed to be a plain cancellation) |
| | `response.failed` / `error` | `provider_error` |
| Anthropic | `stop_reason: "end_turn" \| "tool_use"` | `complete` |
| | `stop_reason: "max_tokens"` | `length` |
| Gemini | `finishReason: "STOP"` | `complete` |
| | `finishReason: "MAX_TOKENS"` | `length` |
| | `finishReason: "SAFETY" \| "RECITATION" \| "OTHER"` | `cancelled` |
| AI SDK (`ai` package) | `finishReason: "stop" \| "tool-calls"` | `complete` |
| | `finishReason: "length"` | `length` |
| | `finishReason: "content-filter"` | `cancelled` **+** an `E_CONTENT_FILTERED` diagnostic, so the gate reports `content_filtered` specifically rather than the generic `stream_incomplete` a plain cancellation gets |
| | `finishReason: "error"` | `provider_error` |
| | `finishReason: "other"` / anything unrecognized | `unknown` (never assumed to mean `complete`) |
| | `{ type: "abort" }` part (present on `ai@5`/`6`/`7`'s `fullStream`) | `cancelled` |

A `"complete"`-looking `StreamEndReason` is necessary but not sufficient for
`execute` - the gate still requires `parser.executable` and schema validity.

## Schema interaction

`createToolCallExecutionGate()` takes the same third argument as
`createToolCallStreamCoordinator()`: an optional `Record<string,
JsonSchemaLike>` mapping tool name to a draft-07 JSON Schema. Structural
prefix-safety and schema validity are independent checks:

- **Case 1 - complete + schema-valid**: `execute`.
- **Case 2 - complete + schema-invalid** (e.g. a required field the model
  genuinely never produced, not merely truncated): `reject` /
  `schema_invalid`.
- **Case 3 - truncated**: `retry`, regardless of whether the partial data
  would have passed the schema - there's nothing to validate yet.

## Example

```ts
import { createToolCallExecutionGate, AnthropicStreamAdapter } from "prefix-safe-json";

const gate = createToolCallExecutionGate(undefined, undefined, {
  write_file: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
});
const adapter = new AnthropicStreamAdapter();

for (const rawEvent of anthropicSseEvents) {
  for (const normalized of adapter.push(rawEvent)) gate.push(normalized);

  // Optional in-flight inspection - never required, never destructive, and
  // never a substitute for the two finish() calls below (see the three-way
  // distinction immediately after this example).
  gate.snapshot();
}

// The caller has exhausted the raw provider evidence source - let the
// adapter synthesize/finalize provider-stream termination if it hasn't
// already. Call this for every adapter, always, even one whose push() may
// already have observed a genuine provider-level terminal (e.g. Anthropic's
// own message_delta/stop_reason, or OpenAI's Responses API
// response.completed): every adapter's finish() is idempotent - it returns
// no events at all once the stream has genuinely already ended - so this is
// the one safe, universal pattern regardless of which provider adapter is
// in use. There is no provider-specific exception to memorize.
for (const normalized of adapter.finish()) gate.push(normalized);

// Compute the final decisions - only now, AFTER adapter finalization above.
const final = gate.finish();
for (const observed of final.decisions) {
  const authority = gate.takeDecision(observed.internalId);
  if (authority) {
    await tools[authority.name](authority.value);
  } else {
    console.warn(`${observed.name}: ${observed.action} (${observed.reason})`);
  }
}
```

Three different operations, two of them both named `finish()`, easy to
conflate:

- **`gate.snapshot()`** means *non-destructive in-flight inspection* - safe
  to call at any point, as often as you like, including from inside the
  `for await` loop before the raw provider evidence source is exhausted. It
  never mutates gate state and never reports `action: "execute"` for any
  call - see its own documented contract (`gate/types.ts`) for why a
  positive decision is only ever reported once finalization has genuinely
  happened.
- **`adapter.finish()`** means *the caller has exhausted the raw provider
  evidence source* - the `for await`/`for` loop over the provider's own raw
  events has ended. It tells the **adapter** to synthesize/finalize
  provider-stream termination if `push()` hasn't already emitted a genuine
  one, and to close any tool call whose own evidence never got a chance to
  report its own terminal. It normally returns zero or more
  `NormalizedToolStreamEvent`s that must still be pushed into the gate, same
  as every event from `push()`.
- **`gate.finish()`** means *final decision computation, performed AFTER
  adapter finalization* - not an in-flight snapshot API. It is replayable
  once finalization has begun or completed (`finish()` is replayable
  diagnostic state - see
  [One-shot execution authority](#one-shot-execution-authority) below), but
  calling it **before** `adapter.finish()` is a mistake, not merely a
  redundant no-op: the coordinator's own `finish()` fallback synthesizes a
  `reason: "unknown"` stream end for anything not yet genuinely terminated,
  and the gate caches that fact on its *first* `finish()` call - a
  premature call permanently pins the gate to that fallback, so the real,
  later `adapter.finish()` event can no longer update it. Use
  `gate.snapshot()`, never `gate.finish()`, for any inspection performed
  before the raw provider evidence source is exhausted.

Calling `adapter.finish()` before `gate.finish()` is required to reach a
genuine `execute` decision reliably across every provider adapter - some
adapters' `push()` can legitimately observe the whole provider stream ending
on its own (a single `message_delta`, a Responses API `response.completed`),
but the `OpenAICompatibleStreamAdapter` family (`OpenAICompatibleStreamAdapter`,
`OpenAIStreamAdapter`'s plural `tool_calls` path, `OpenRouterStreamAdapter`)
deliberately never does: a single choice's own `finish_reason` is
choice-local evidence only, never proof the whole (possibly multi-choice)
provider stream has ended - see [`COMPATIBILITY.md`](COMPATIBILITY.md) and
that adapter's own class-level lifecycle-contract doc for why. Following the universal pattern
above means never needing to know, per provider, which case applies.

This is the public **low-level adapter + gate** lifecycle - composed
yourself, for when you need the adapter or gate instance directly. It is
distinct from the **high-level guard** lifecycle
([`createAiSdkExecutionGuard()`](#high-level-guards) below), which owns its
internal adapter entirely: a guard caller never holds an adapter reference
at all, so it has nothing to call `finish()` on directly - `guard.push()`/
`guard.finish()` already do the equivalent internally, on the guard's own
two methods, not three.

See `examples/anthropic-truncation-safety.mjs` and
`examples/ai-sdk-execution-gate.mjs` for full runnable wire-shape versions
(no network calls, no API key, run by CI on every push). For the canonical
AI SDK ownership boundary driven by the real `streamText()` lifecycle, use
`examples/ai-sdk-v7-safe-boundary.mjs`.

## High-level guards

For the common case - one provider, no need to hold the adapter or gate
instance yourself - `createAiSdkExecutionGuard()` composes
`AiSdkStreamAdapter` and `createToolCallExecutionGate()` behind four
methods: `push()`, `snapshot()`, `finish()`, `takeDecision()`. Same decision logic, same
fail-closed guarantees, no new parser or coordinator.

The canonical, complete integration is
[the README's recommended AI SDK boundary](../README.md#recommended-ai-sdk-boundary):
it applies `createAiSdkExecutionLock()` before `streamText()`, feeds the real
`fullStream` into `createAiSdkExecutionGuard()`, and manually dispatches only
`decision.value`. The same path is executable and assertion-backed in
[`examples/ai-sdk-v7-safe-boundary.mjs`](../examples/ai-sdk-v7-safe-boundary.mjs).

`createAiSdkExecutionGuard()` does not depend on the `ai` package at runtime
and does not import its types - `push()` accepts `unknown`, matching every
provider adapter's own `push()` signature. It has been verified (not merely
documented) against the published `fullStream` part shape, finish-reason
vocabulary, and real `streamText()` lifecycle of the exact pinned versions
`ai@5.0.244`, `ai@6.0.264`, and `ai@7.0.77`. This is not a claim that every
version in those majors is tested; see `test/integration/ai-sdk-lifecycle/`
and `docs/COMPATIBILITY.md` for the exact evidence.

The low-level API (adapter + gate, composed yourself) remains fully public
and is what the high-level guard is built from - use it directly if you need
the adapter or gate instance for something the guard doesn't expose (e.g.
`drainEvents()` for a UI feed). The two produce identical decisions for
identical input - `test/guard/ai-sdk-guard.test.ts` asserts this directly.

### One-shot execution authority

`finish()` is deliberately replayable diagnostic state: callers can inspect
the complete decision and diagnostics more than once. It is not the recommended
dispatch token. After finishing, call `takeDecision(internalId)`. It returns an
`ExecuteDecision` once for that call, then `undefined`; taking one call never
consumes another. Unsafe, malformed, schema-invalid, projection-only, or
protocol-poisoned calls always return `undefined`.

This is local authority consumption, not application idempotency. A caller can
still reuse a value it already received, another process can repeat a side
effect, and a crash can happen between dispatch and persistence. Authorization,
durable idempotency keys, retries, and transactions remain caller-owned.

### Decision evidence

Every `ExecutionDecision` carries an `evidence` object explaining *why* it
came out the way it did - purely observational, never a second input to the
decision itself:

```ts
decision.evidence
// {
//   provider: "ai-sdk",
//   providerReason: "length",
//   streamEndReason: "length",
//   terminalConfirmed: true,
//   structurallyComplete: false,
//   parserExecutable: false,
//   schemaValid: undefined,
//   receivedBytes: 117,
// }
```

- `terminalConfirmed`: whether a real stream-end reason was ever observed at
  all, regardless of whether it was safe - `"length"` has `terminalConfirmed:
  true`; a stream that never reports why it ended has `false`.
- `structurallyComplete`: whether the JSON's root container actually closed
  (`ToolCallState.parser.rootComplete`), independent of whether the
  stream-end reason makes that closure trustworthy. A value cut short by
  `length` that happens to be syntactically complete has
  `structurallyComplete: true` and `parserExecutable: false` at the same
  time - that combination is exactly the scenario this library exists to
  catch.
- `receivedBytes` is the only metric included beyond the fields decide.ts
  already computes - a received-chunk count was considered and deliberately
  left out: the parser only tracks cumulative bytes, not `push()` call
  counts, and adding that tracking solely to populate an evidence field was
  judged not worth the new cross-layer coupling for this release.

## Execution ownership: `tool-result`/`tool-error` as evidence

The decision table above assumes the caller is the only thing that will
ever invoke the real tool function for calls this library evaluates. That's
true for the documented pattern (consume `fullStream` yourself, dispatch
manually after `finish()`) - but nothing stops a caller from *also*
attaching the real, irreversible operation as the AI SDK-native `execute`
callback on the same tool definition - not even a no-op implementation of
one. In that configuration the SDK's own tool loop can invoke `execute` as
soon as it resolves a call's input - independent of, and typically before,
this guard ever reaches a decision for that call. If that happens, the side
effect has already run before `prefix-safe-json` was ever consulted; no
library operating purely on `fullStream` evidence can undo that
retroactively.

What this library *can* do, and does: a `tool-result` part (the SDK's
`execute` callback returned - including a no-op one) or a `tool-error` part
(it threw) on `fullStream` is direct, observable proof that a provider
SDK's own tool loop already invoked *some* call - regardless of what its
arguments look like or how the stream eventually finishes.
`AiSdkStreamAdapter` normalizes either into a `provider_diagnostic`; the
coordinator treats success and failure identically (an error does not
prove the absence of a partial side effect before the throw). Two evidence
shapes exist, and the gate's response scales to how much the evidence
actually tells it:

- **Attributed** - the part carries a `toolCallId` the coordinator can
  resolve to a specific in-flight call. That exact call's `status` becomes
  `"sdk_execution_observed"` immediately, mid-stream, the moment the
  evidence arrives - mirroring the same mid-stream mutation
  `handleIdentity()` already performs for identity conflicts. The
  transition is one-way and call-scoped: nothing that arrives afterward for
  that call - a safe finish reason, a structurally complete value, a
  passing schema, a duplicate of the same diagnostic - can move it back,
  and an unrelated concurrent call is unaffected.
- **Unattributable** - the part carries no usable `toolCallId` at all. The
  coordinator cannot know which in-flight call (if any specific one) it
  refers to, and does not guess: it records a stream-wide diagnostic
  (`internalId: undefined`) instead of assigning it to one call arbitrarily.
  With no way to rule any call out - including one whose `tool_call_start`
  arrives *after* this point - as the one the SDK already executed,
  **every call the gate ever decides for this stream fails closed**, not
  just the one that happens to look safest. This is deliberately the more
  conservative of the two responses: attributing wrongly risks leaving the
  actually-executed call free to run again while a different, genuinely
  safe call is punished for no reason; refusing the whole stream never has
  that failure mode.

Either way the gate reports `reject` / `sdk_execution_observed`, permanently
- and that reason takes priority over every other rejection reason
(`resource_limit`, `provider_error`, `content_filtered`, structural
truncation/malformedness; see the decision table above), because it is
categorically different information from all of them. So a caller running
the documented manual-dispatch loop never invokes the tool function a
*second* time for a call (or, in the unattributable case, any call) the SDK
already ran.

**Safe, supported integration** - never attach an AI SDK-native `execute`
callback - not even a no-op one - to a tool definition whose actual
execution will be manually dispatched from this library's decisions.
Consume `fullStream`, feed every part to the guard/adapter, and dispatch
manually only from `takeDecision(internalId)` after `finish()` (see the
recommended boundary in the root README). Under this pattern
`tool-result`/`tool-error` never arrive, because the SDK never runs
`execute` itself.

**Unprotected / misuse pattern** - defining `execute` (a no-op
implementation included) *and* running the guard on the same stream. This
library will refuse to *also* authorize execution once it observes the
evidence - of every call in the stream, if the evidence can't be
attributed to one - but it never had the chance to stop the first one.

### Closing the first-execution gap: `createAiSdkExecutionLock()`

Everything above is *detection* - it stops a second, library-authorized
execution, but by definition can only observe the SDK's own first one after
it already happened. `createAiSdkExecutionLock()`
(`src/guard/ai-sdk-execution-lock.ts`, `@public (Experimental)`) closes that
specific gap for **local, user-defined tool definitions, unchanged, passed
through it**.

**The guarantee, precisely stated:** for a tool object returned by this
function and passed unmodified to `streamText`/`generateText`, none of
`execute`, `onInputStart`, `onInputDelta`, or `onInputAvailable` can run
before this library's gate reaches a decision, because none of them exist
on the object the SDK receives. This is deliberately not phrased as "the SDK
cannot execute your handler" in the abstract - it is a claim about this
function's own output specifically, and it stops applying the moment a tool
definition bypasses the function, gets mutated/reconstructed afterward, or
is provider-executed (see below).

**Why all four fields, not just `execute`.** An earlier version of this
function only removed `execute` and set `needsApproval: true`, reasoning
that `ai@6`+'s own approval mechanism would keep the SDK from calling
anything else. That reasoning had a real gap: verified directly against
`ai@5`/`ai@6`/`ai@7`'s own actual runtime source (not their published
types), `onInputStart`/`onInputDelta`/`onInputAvailable` are invoked by a
transform stream (`invokeToolCallbacksFromStream` in `ai@7`; differently
named internals in `ai@6`/`ai@5`, independently confirmed) with **zero
reference to `needsApproval` or approval status anywhere in it** -
`onInputAvailable`'s own doc comment states it "is called when a tool call
can be started, even if the execute function is not provided." A caller
could put an irreversible side effect inside any of the three and
`needsApproval: true` alone would not stop it. This function now removes
all four fields, confirmed by real `streamText()` calls against all three
majors that a caller-supplied implementation of each never fires (see the
test files below) - including an explicit unlocked control proving the SDK
genuinely would have invoked them under the identical stream.

**On `ai@6`+ specifically**, forcing `needsApproval: true` still closes the
`execute` gap through the SDK's own tool-approval mechanism
(`needsApproval`/`tool-approval-request`/`experimental_toolApprovalSecret` -
shipped in `ai@6`, December 2025): verified directly against `ai@6` and
`ai@7`'s own real source (`executeToolsFromStream`/`isApprovalNeeded`) that
a tool call pending approval is never added to the set of calls the SDK
actually executes. Real execution stays exactly where it already was in the
safe pattern above: driven manually from `guard.takeDecision()`, using
the value the gate itself authorized from raw evidence.

**Provider-executed and execution-location-ambiguous tools are rejected, not
silently wrapped.** A tool's real execution location is only ever verifiable
when the object shape itself proves it, checked per-major against each
major's own real source rather than inferred from a package-name/version
string:

- `isProviderExecuted: true` (any major that sets it, chiefly `ai@7`) runs
  its real operation entirely on the model provider's own remote
  infrastructure - there is no local `execute` (or `onInputStart`/etc.) for
  this function to remove, because the side effect never happens in this
  process. **Rejected.**
- `ai@7`'s `{ type: "provider", isProviderExecuted: false }` (a
  provider-defined-but-locally-executed tool, e.g. a local shell tool with a
  provider-defined schema): verified against `ai@7.0.77`'s own real source
  that this shape structurally has no `execute` field at all - the SDK's own
  `isExecutableTool()` check (`typeof tool.execute === "function"`) can
  never auto-run it, the same "no `execute` means never auto-executed" rule
  an ordinary tool follows. **Accepted**, passed through the same
  strip-and-relock path as any other tool.
- `ai@6`'s `{ type: "provider" }` has **no `isProviderExecuted`
  discriminator at all** - `ai@7` added it for exactly this reason. This
  function cannot safely infer local-vs-remote from the shape alone.
  **Rejected as ambiguous**, not silently accepted.
- `ai@5`'s `{ type: "provider-defined" }` also has no execution-location
  discriminator - some provider-defined tools execute locally, some
  remotely, and nothing in the object distinguishes them. **Rejected as
  ambiguous.**

`createAiSdkExecutionLock()` throws for every rejected shape rather than
returning an object that would falsely imply it had done something to it.

**Function-valued `description` is rejected (`ai@7`+).** `ai@5`/`ai@6` type
`description` as `string` only. `ai@7` additionally allows a function -
verified directly against `ai@7.0.77`'s own real source that `prepareTools()`
calls `resolveToolDescription()`, which invokes that function during tool
preparation, *before* `streamText`/`generateText`'s model call begins and
therefore necessarily before this library's gate can reach any decision (real
`streamText()` calls in `test/integration/ai-sdk-lifecycle/ai-v7.real.test.ts`
confirm the SDK invokes it at least once per step - twice, in fact, from two
separate internal call sites - well before any part reaches `fullStream`). A
function-valued `description` is arbitrary caller code running on that same
pre-decision timeline as the callback trio above, so this function rejects it
rather than silently passing it through. A string `description` is
unaffected and remains supported on every major.

**Not a sandbox for a tool definition's *other* fields.** The guarantees
above only ever concern the five fields this function removes or requires
(`execute`, `onInputStart`, `onInputDelta`, `onInputAvailable`,
`description`-as-function) plus the provider-shape checks. A JSON Schema
library's own validation/refinement/transform machinery, a getter, or a
Proxy attached to `inputSchema` (or any other field this function preserves
unchanged) is caller-provided executable code this library has no visibility
into and does not run, remove, or guard - a schema used inside this security
boundary must itself be side-effect free. This is a threat-model boundary,
not a reason to drop schema support.

**`ai@5` has no `needsApproval` at all** (verified directly against its
published types: the only match for the string "approval" anywhere in
`ai@5`'s entire type declaration file is an unrelated JSDoc comment) - the
forced-`true` half of this function is a harmless no-op there. Its
callback-removal half still applies on every major, `ai@5` included.

**What this cannot protect against, on any major:** a tool definition that
bypasses this function entirely and attaches `execute`/`onInputStart`/
`onInputDelta`/`onInputAvailable` directly. That bypass case is exactly the
"Unprotected / misuse pattern" above. The `sdk_execution_observed` detection
this whole section describes remains a backstop for a bypassed `execute`
specifically (via `tool-result`/`tool-error` evidence on `fullStream`) - it
has **no equivalent** for a bypassed `onInputStart`/`onInputDelta`/
`onInputAvailable`, since those callbacks leave no observable trace on
`fullStream` at all. Calling `createAiSdkExecutionLock()` is the only
defense for that trio; there is nothing to detect after the fact.

See `test/guard/ai-sdk-execution-observed.test.ts`,
`test/unit/coordinator-sdk-execution-observed.test.ts`,
`test/unit/execution-gate-decision-table.test.ts`,
`test/guard/ai-sdk-execution-lock.test.ts` (including its type-level
regression tests proving `execute`/`onInputStart`/`onInputDelta`/
`onInputAvailable` do not exist on the locked type at all, not merely
optional-and-absent), and
`test/integration/ai-sdk-lifecycle/ai-v5.real.test.ts` /
`ai-v6.real.test.ts` / `ai-v7.real.test.ts` (each with a dedicated "P1:
input-lifecycle callback neutralization" suite; `ai-v7.real.test.ts` also
has "P1-A: function-valued description neutralization" and "P1-B:
provider-execution shape policy" suites, both with real unlocked-control
proof alongside the locked-rejection proof) for the full evidence and
test matrix: concurrent-call isolation, duplicate/reordered evidence,
cross-guard-instance isolation, unattributable evidence disqualifying an
entire stream (including a call that starts after the evidence arrives),
rejection-reason priority against every other disqualifier, and - the
`ai-v*.real.test.ts` files specifically - real `streamText()` calls against
each major's own official (`ai@6`/`ai@7`) or hand-built-to-spec (`ai@5`,
avoiding an unrelated `msw` dependency the official test double
transitively requires) provider test double, not hand-constructed
`fullStream` event objects, proving both the lock's real guarantee on every
major and its real limits with actual SDK behavior rather
than an assumption about it.

## Fail-closed guarantees

- `execute` is reached from exactly one branch in the decision table, and
  only after every disqualifying check has already run.
- Once a call's `status` becomes `"sdk_execution_observed"`, or an
  unattributable `tool-result`/`tool-error` is recorded anywhere in the
  stream (see [Execution ownership](#execution-ownership-tool-resulttool-error-as-evidence)
  above), that fact is permanent - for the call, or for every call in the
  stream in the unattributable case - and is checked before every other
  disqualifier. Nothing that arrives afterward, and no other rejection
  reason that also happens to be true at the same time, can route a call
  back through the `execute` branch or hide that this evidence exists.
- The status→decision mapping is an exhaustive `switch` with no `default`
  case; the TypeScript compiler (`noImplicitReturns`) fails the build if a
  future coordinator version adds a status this function doesn't handle,
  rather than silently falling through.
- A structurally "complete" call whose `parser.executable` is `false` for
  any reason (stream-end-reason mismatch, trailing data, a safe-container-
  close repair) is `retry`, never `execute` - JSON shape alone is never
  sufficient.
- `ExecuteDecision.value` is only ever populated from `parser.stableValue`
  once every check above has passed, and only if that value is genuinely
  present (a defensive `!== undefined` check - an `executable: true` call
  with no actual value still fails closed instead of executing `undefined`).
- A second `provider_stream_end` arriving after the stream already finished
  can never change any call's already-decided outcome - the coordinator's
  `isFinished` gate rejects it before it reaches any call at all. When that
  second event's reason genuinely *contradicts* the first (e.g. `"complete"`
  then `"abort"` - a real provider-protocol anomaly, not just a harmless
  late duplicate of the same reason), it gets its own diagnostic code,
  `E_TERMINAL_REASON_CONFLICT` (`severity: "fatal"`), distinct from the
  generic `E_EVENT_AFTER_STREAM_END` every other post-finish event gets -
  forensic signal that something worth investigating happened, not a second
  chance to change the decision.

## Limitations - what this does NOT protect against

Consistent with the rest of this library's scope (see the root README):

- **Not a prompt-injection defense.** The gate says nothing about whether
  the arguments a model chose to send are the arguments it *should* have
  sent - only whether they're complete and unfabricated.
- **Not an authorization layer.** It doesn't know which caller is allowed to
  invoke which tool.
- **Not a sandbox.** `action: "execute"` means "safe to treat as the
  complete, real value the model produced" - not "safe to run without your
  own validation, permissions, or side-effect review."
- **Cannot undo execution a provider SDK already performed.** If a caller
  attaches the real operation as an AI SDK-native `execute` callback *and*
  separately runs this library on the same stream, the SDK can invoke it
  before this library ever reaches a decision. This library detects that
  after the fact (`reason: "sdk_execution_observed"`) and refuses to *also*
  authorize a second execution - it cannot prevent or reverse the first one.
  See [Execution ownership](#execution-ownership-tool-resulttool-error-as-evidence)
  above.
- **Not malicious-tool-selection detection.** A model choosing the *wrong*
  tool, or a genuinely malicious model, produces a structurally complete,
  schema-valid call the gate will happily mark `execute`.
- **`GrammarStack.canSafelyCloseAll()` has a known, pre-existing reach
  limit**: it only inspects each container frame's own expectation, so an
  ancestor whose value is itself an in-progress-but-closeable child
  container is treated as "still missing a value" and blocks the safe-close
  repair for the whole stack. A single unclosed container (e.g.
  `["a","b"`) salvages correctly; two nested unclosed containers (e.g.
  `{"commands":["a","b"`) currently reports `truncated` rather than
  `salvaged`/`stream_incomplete`. This does not weaken the safety guarantee
  - both outcomes are still non-executable - but it means the gate's more
  specific `stream_incomplete` reason doesn't fire for every case the
  underlying JSON shape could in principle support. Not fixed in this phase
  (a core `GrammarStack` change, out of scope for this API layer) - tracked
  as a Phase 2 candidate.
- **Per-call end reason is stream-wide, not per-call.** The coordinator
  finalizes every open call in a stream with the same `StreamEndReason` (see
  `DefaultToolCallStreamCoordinator.handleStreamEnd`). If one tool call
  finishes cleanly early in a multi-tool-call stream that later gets cut off
  by `length`, that early call is still evaluated against the stream's final
  reason, not its own. This is existing coordinator behavior, unchanged by
  the gate - and arguably the more conservative choice: it doesn't get
  overridden here.
- **`E_COORDINATOR_LIMIT_CALLS` never produces a decision.** A tool call
  rejected before a `ToolCallState` could be created (the coordinator's
  `maxToolCalls` limit) has no `internalId` to attach an `ExecutionDecision`
  to. It's visible in `ToolCallExecutionGateFinalResult.diagnostics`, not in
  `decisions`.
