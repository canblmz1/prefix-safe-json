# Threat Model

## Security objective

Prevent irreversible caller-owned tool execution unless the available
raw/terminal evidence positively proves execution eligibility. "Positively
proves" is doing the load-bearing work in that sentence: the default for
every ambiguous, incomplete, or unconfirmed case is *not executable* —
nothing in this library's decision path infers or repairs its way to
`execute`.

## Trust boundaries

```
provider/model stream  (untrusted: arbitrary bytes, may be truncated,
                         malformed, or adversarial)
        |
provider adapter        (normalizes wire shape only - never repairs,
                         never trusts a provider SDK's own resolved/
                         repaired value over the raw delta text)
        |
parser                  (tracks structural completeness byte-by-byte;
                         never fabricates a value for a gap)
        |
coordinator              (tracks per-call state across a multi-call
                         stream; records diagnostics, never silently
                         drops a conflict)
        |
execution gate           <- trust boundary: this is the last point this
                         library controls. Everything above this line is
                         adversarial input this library defends against;
                         everything below is delegated to the caller.
        |
caller / manual dispatch (trusted to actually respect the decision - see
                         "Non-guarantees" below for what this library
                         cannot enforce here)
        |
external tool implementation (entirely outside this library's visibility
                         or control once dispatched)
```

The gate's `ExecutionDecision` is the artifact this library vouches for.
Nothing upstream of it (provider stream, adapter, parser, coordinator) is
trusted; nothing downstream of it (the caller's own dispatch code, the
tool implementation itself) is within this library's control at all. A
library that only validates JSON shape and stops there is implicitly
trusting everything downstream of the parser — this library's actual
contract stops one layer later, at the execution decision itself.

## Guarantees

Backed by the current decision table (`docs/EXECUTION_GATE.md`) and its
test suite (`test/unit/execution-gate-decision-table.test.ts`,
`test/invariants/execution-priority.test.ts`,
`test/guard/ai-sdk-compatibility.test.ts`,
`test/guard/ai-sdk-execution-observed.test.ts`,
`test/unit/coordinator-sdk-execution-observed.test.ts`):

- Malformed or truncated raw input never reaches `execute` — a real,
  positively-observed mid-value or mid-container cut is `retry`/`truncated`;
  malformed content (duplicate keys, bad tokens, broken tool identity) is
  `reject`/`malformed`.
- A length/token cutoff never reaches `execute`, even when the JSON
  received so far happens to be syntactically closeable — a
  structurally-complete-looking value with an unsafe finish reason is
  `retry`/`stream_incomplete`, not `execute`. Provider stream metadata, not
  JSON shape alone, gates execution.
- A provider-side error (`streamEndReason: "provider_error"`) never reaches
  `execute` for any call in that stream.
- Cancellation/abort never reaches `execute` — normalized to `"cancelled"`,
  which resolves to `retry`/`stream_incomplete`.
- Content-policy/safety filtering never reaches `execute` and is reported
  as its own distinct `reject`/`content_filtered`, not lumped in with a
  generic incomplete-stream retry.
- An unknown, unrecognized, or entirely missing terminal state never
  reaches `execute` — an unclassified provider finish reason normalizes to
  `"unknown"` rather than being guessed as safe, and a stream that ends
  without ever reporting why falls back to the same `"unknown"` treatment
  via the gate's `finish(meta)` backstop.
- The raw, byte-by-byte delta text fed to the parser is the sole execution
  authority — a provider SDK's own resolved/repaired representation of a
  tool call's arguments (e.g. the Vercel AI SDK's `tool-call` part, or any
  equivalent "here's what I think you meant" value) is never read by any
  adapter; only what the model literally streamed, character for character,
  can ever become `decision.value`.
- A schema mismatch (registered JSON Schema, draft-07, validated via ajv)
  never reaches `execute`, independent of structural completeness —
  `reject`/`schema_invalid`.
- A tool-call identity conflict (a duplicate/inconsistent `toolCallId` or
  index for the same in-flight call) never reaches `execute` —
  `reject`/`malformed`.
- Concurrent coordinator/gate/guard instances are isolated: no module-level
  or otherwise shared mutable state exists anywhere in the decision path,
  so evidence recorded against one instance can never influence another,
  even when the same provider call ID string is reused across instances.
- Direct evidence that a provider SDK's own tool loop already invoked a
  call's `execute` callback (a `tool-result` or `tool-error` part on the
  Vercel AI SDK's `fullStream`) permanently blocks this library from *also*
  authorizing that call's execution — attributed to the exact call when a
  usable call ID is present, or across every call in that
  guard/coordinator instance (including one that starts afterward) when it
  isn't, rather than guessing which call was affected. This reason has the
  highest rejection priority of any disqualifier.
- Resource limits (input size, nesting depth, string length, queued event
  count, concurrent call count, tool name length) never reach `execute` —
  a limit breach is `reject`/`resource_limit`, checked before every other
  status-based outcome.
- On the Vercel AI SDK, across `ai@5`/`ai@6`/`ai@7`: a local, user-defined
  tool wrapped with `createAiSdkExecutionLock()` and passed through
  unchanged cannot have `execute`, `onInputStart`, `onInputDelta`, or
  `onInputAvailable` invoked by the SDK's own tool loop at all — not
  detected afterward, structurally excluded because none of the four exist
  on the object the SDK receives (verified directly against each major's
  own real source, not their published types; on `ai@6`+ the SDK's own
  `needsApproval` mechanism additionally backstops `execute` specifically).
  Rejects (throws) rather than silently wrapping a provider-executed tool.
  This is the one guarantee in this list that constrains something
  *upstream* of this library's own trust boundary — see "Non-guarantees"
  below for exactly how far it reaches and where it stops.

## Non-guarantees

This library is honestly scoped as an execution-*integrity* layer, not a
general AI security platform. It is explicitly **not**:

- **An authorization system.** It has no concept of which caller, user, or
  principal is allowed to invoke which tool. `action: "execute"` says
  nothing about *permission* — only that the arguments are genuinely
  complete and unfabricated.
- **A sandbox.** It never runs, inspects, or constrains the tool
  implementation itself. `action: "execute"` means "safe to treat as the
  real, complete value the model produced," not "safe to run without your
  own validation, permissions, or side-effect review."
- **Prompt-injection prevention.** It says nothing about whether the
  arguments a model *chose* to send are the arguments it *should* have
  sent — only whether they are complete and unfabricated. A model that was
  manipulated into calling a destructive tool with complete, well-formed,
  schema-valid arguments is reported `execute` just the same as a benign
  call.
- **Semantic correctness verification.** A structurally complete, schema-
  valid, genuinely-model-produced value can still be the *wrong* value for
  the task at hand. This library has no opinion on that.
- **Safe-shell-command validation, or any other domain-specific argument
  policy.** A `run_command` call with `{"command": "rm -rf /"}` that is
  complete, unfabricated, and schema-valid is reported `execute`.
- **Business-policy enforcement.** Rate limits, spend caps, approval
  workflows, and similar organizational policy are entirely the caller's
  responsibility.
- **Provider honesty verification.** The decision trusts that a provider's
  own terminal signal (`finishReason`, `stop_reason`, etc.) accurately
  describes what happened upstream. A provider that lies about its own
  finish reason is outside this library's ability to detect.
- **Network isolation.** The library performs no network I/O of its own
  and has no visibility into, or control over, what a dispatched tool
  implementation does over the network.
- **Secret management.** It has no concept of credentials, tokens, or
  secret material passing through tool arguments.
- **Transactional rollback after execution.** Once a caller (or, in the
  misuse case documented in `docs/EXECUTION_GATE.md`, an AI SDK's own tool
  loop) has actually invoked a tool implementation, that invocation is
  outside this library's ability to undo. See the next point.
- **Permission management** for the tools themselves — which credentials
  or scopes a given tool implementation runs with is entirely outside this
  library's model.

**Most importantly:** everything above this point in the document describes
*decision integrity* — whether the `execute`/`retry`/`reject` verdict this
library produces is trustworthy. It says nothing, by itself, about
*execution ownership* — whether this library's decision is actually the
thing controlling whether the real operation runs at all. Those are
different problems with different guarantees:

- If an SDK or caller already executed an irreversible action before this
  library's decision was consulted — most concretely, a native AI SDK
  `execute`/`onInputStart`/`onInputDelta`/`onInputAvailable` callback wired
  directly onto the same tool definition this library is meant to gate, on
  any major bypassing `createAiSdkExecutionLock()`, or a
  **provider-executed** tool (`isProviderExecuted: true` — its operation
  runs entirely on the model provider's own remote infrastructure, outside
  this library's process and reach regardless of what wraps it) —
  **this library cannot undo that first execution.** What it can and does
  do, for a bypassed `execute` specifically, once it observes direct
  evidence that this happened (the `sdk_execution_observed` guarantee
  above), is refuse to *also* authorize a second, caller-driven execution
  of the same call. There is no equivalent detection for a bypassed
  `onInputStart`/`onInputDelta`/`onInputAvailable` — those callbacks leave
  no observable trace on `fullStream` at all.
- Using `createAiSdkExecutionLock()`, on a local, user-defined tool
  definition passed through it unchanged: this library's decision *is* the
  thing controlling execution, because none of `execute`, `onInputStart`,
  `onInputDelta`, or `onInputAvailable` exist on the object the SDK
  receives, on any of `ai@5`/`ai@6`/`ai@7` (verified directly against each
  major's own real source, not their published types). This is the one
  case in this document where decision integrity and execution ownership
  coincide — and it is scoped precisely to this function's own output,
  unchanged: it does not extend to a tool that bypasses the function, one
  mutated/reconstructed afterward, or a provider-executed tool.

The precondition for every *other* guarantee in this document to mean
anything at all is that this library is consulted *before* the irreversible
operation runs — see "Execution ownership" in `docs/EXECUTION_GATE.md` for
the full breakdown of which pattern gets which guarantee.
