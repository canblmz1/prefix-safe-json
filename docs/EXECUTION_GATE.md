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
  | "unknown";            // reject - unreachable fallback; fail closed, never guess
```

### The decision table

Evaluated in this order, first match wins. Every fail-closed disqualifier is
checked **before** the single positive `execute` branch - `execute` is
reached only once nothing above has ruled it out, not as a first check that
later conditions could otherwise slip past:

| # | Condition | action | reason |
|---|---|---|---|
| 1 | A resource-limit diagnostic was recorded (`E_LIMIT_*` on the parser, or `E_COORDINATOR_LIMIT_*` / `E_TOOL_NAME_LIMIT` on the coordinator) | reject | `resource_limit` |
| 2 | The stream-level end reason was `"provider_error"` | reject | `provider_error` |
| 3 | A content-policy termination was recorded (`E_CONTENT_FILTERED`) | reject | `content_filtered` |
| 4 | `status === "complete"` and the registered schema failed | reject | `schema_invalid` |
| 5 | `status === "invalid"` (duplicate key, bad token, broken tool identity) | reject | `malformed` |
| 6 | `status === "truncated"` (a real, raw mid-value/mid-container cut) | retry | `truncated` |
| 7 | `status === "complete"` **and** `parser.executable` **and** schema passes (or no schema registered) | **execute** | `complete` |
| 8 | Everything else non-executable - `"salvaged"` (repaired-closed, unconfirmed), `"complete"`-but-not-`executable` (stream-reason mismatch or trailing data), `"cancelled"`, `"collecting"` | retry | `stream_incomplete` |

Row 8 is the important one for container-level truncation: a value like
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
}

for (const decision of gate.finish().decisions) {
  if (decision.action === "execute") {
    await tools[decision.name](decision.value);
  } else {
    console.warn(`${decision.name}: ${decision.action} (${decision.reason})`);
  }
}
```

See `examples/anthropic-truncation-safety.mjs` and
`examples/ai-sdk-execution-gate.mjs` for full runnable versions (no network
calls, no API key - literal, correctly-shaped provider events, run by CI on
every push).

## Fail-closed guarantees

- `execute` is reached from exactly one branch in the decision table, and
  only after every disqualifying check has already run.
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
