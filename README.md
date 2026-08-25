# prefix-safe-json

> **v0.4.1** — Core APIs are stable; raw provider adapters remain
> experimental. See [Current Status](#current-status) and
> [CHANGELOG.md](CHANGELOG.md).

**Execution integrity for streamed LLM tool calls: prove raw arguments and
terminal state before caller-owned side effects.**

Use `prefix-safe-json` when an LLM streams arguments for a tool that can write
files, run commands, send requests, or perform another irreversible operation.
It distinguishes complete, unfabricated raw arguments from truncated or
unconfirmed input, including SDK-projected or repaired values that merely look
complete. JSON validity is not execution authority.

## Install

```bash
pnpm add prefix-safe-json ai
# or: npm install prefix-safe-json ai
```

The published package is ESM-only and supports Node `>=18.0.0`. Repository
development and release jobs remain on Node 22/24 because the development
toolchain and the exact `ai@7.0.77` lifecycle proof require newer Node; those
requirements do not apply to the package's runtime dependency graph.

## Recommended AI SDK boundary

Lock the local tool definitions before the AI SDK sees them, feed the real
`fullStream` into the guard, and keep the irreversible operation in caller-owned
manual dispatch:

```javascript
import { jsonSchema, streamText } from "ai";
import {
  createAiSdkExecutionGuard,
  createAiSdkExecutionLock,
} from "prefix-safe-json";

const writeFileSchema = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

export async function runToolCall(model, prompt, callerOwnedSideEffect) {
  const lockedTools = createAiSdkExecutionLock({
    write_file: {
      description: "Write a UTF-8 text file",
      inputSchema: jsonSchema(writeFileSchema),
    },
  });

  const result = streamText({ model, prompt, tools: lockedTools });
  const guard = createAiSdkExecutionGuard({
    schemas: { write_file: writeFileSchema },
  });

  for await (const part of result.fullStream) {
    guard.push(part);
  }

  const final = guard.finish(); // replayable diagnostic state
  for (const observed of final.decisions) {
    const authority = guard.takeDecision(observed.internalId);
    if (authority) await callerOwnedSideEffect(authority.value);
  }
}
```

In this pattern:

- Never execute `chunk.input` or an SDK-projected/repaired value. Dispatch only
  the `value` returned once by `takeDecision(internalId)`.
- `finish()` remains replayable diagnostic state. `takeDecision()` returns a
  call's executable authority at most once and never consumes another call.
- Provider-executed tools are outside the local guarantee.
- Mutating or reconstructing a locked definition after locking voids the
  guarantee; pass `lockedTools` through unchanged.
- Application-level authorization and idempotency remain caller-owned. The
  one-shot method prevents accidental replay through this guard instance; it
  is not a distributed transaction or idempotency system.
- `prefix-safe-json` returns decisions; it never hides or performs execution.

[`examples/ai-sdk-lifecycle-proof.mjs`](examples/ai-sdk-lifecycle-proof.mjs)
runs deterministic execution-ownership proofs through the real `streamText()`
lifecycle of the exact pins `ai@5.0.244`, `ai@6.0.264`, and `ai@7.0.77`, with
no API key, network request, or paid model call. Run it with
`pnpm run example:ai-sdk-lifecycle-proof`. This is not a claim that every
version in those majors is tested. See [Compatibility](docs/COMPATIBILITY.md).

**What the decisions mean**

Every tool call gets exactly one verdict:

- **`execute`** — complete, unfabricated, and (if a schema is registered)
  schema-valid. `decision.value` is safe to pass to your tool.
- **`retry`** — nothing is wrong with what arrived; there just isn't a
  trustworthy complete value yet. Continue generation.
- **`reject`** — the data itself is the problem (malformed JSON, a schema
  mismatch, a resource limit, a provider error, a content-policy
  termination). Retrying the same input won't help.

**Why the model's finish reason matters as much as the JSON's shape**

A tool call cut short by a token limit, a provider error, or a content
filter can still contain syntactically complete, schema-valid JSON — the
model was simply stopped before finishing the *rest* of its response, not
necessarily mid-argument. Executing on JSON shape alone means trusting data
nobody, including the model, confirmed as final. This is exactly the failure
mode independently reported and reproduced in
[vercel/ai#19063](https://github.com/vercel/ai/issues/19063): tool calls
executing regardless of an unsafe finish reason, across AI SDK v5, v6, and
v7, with fixes landing across all three release lines.
`prefix-safe-json` does not patch or depend on that fix — it's a
provider-independent guard that requires positive proof a stream ended
safely before treating any tool call as final, regardless of which SDK,
provider, or framework hands it the data. See
`test/guard/ai-sdk-compatibility.test.ts` for the cross-version test
evidence.

**Execution ownership: what must never also happen**

The guard's decisions only mean something if they're the sole thing deciding
whether your tool function runs. The recommended pattern above prevents the
AI SDK's own tool-calling loop from running caller callbacks first —
in order from strongest guarantee to weakest:

- **Strongest — `createAiSdkExecutionLock()`** — wrap your tool definitions
  with it before passing them to `streamText()`/`generateText()`. It removes
  every AI SDK-invoked callback capable of running your code before this
  library's decision — not just `execute`, but also `onInputStart`,
  `onInputDelta`, and `onInputAvailable` (verified directly against
  `ai@5`/`ai@6`/`ai@7`'s own real source: all three fire unconditionally,
  independent of `needsApproval`/approval status — `needsApproval: true`
  alone does **not** stop them, which is exactly the gap this function
  closes). It also forces `needsApproval: true`, which still closes the
  `execute` gap specifically on `ai@6`+ via the SDK's own approval
  mechanism. It also rejects a **function-valued `description`**
  (`ai@7`+ invokes it during tool preparation, before the model call even
  begins — arbitrary caller code on the same pre-decision timeline as the
  callback trio; a string `description` is unaffected on every major), and
  any **provider tool shape whose real execution location it cannot
  verify**: `isProviderExecuted: true` (real operation runs entirely on the
  model provider's remote infrastructure), `ai@6`'s discriminator-less
  `{ type: "provider" }`, and `ai@5`'s discriminator-less
  `{ type: "provider-defined" }` are all rejected rather than silently
  accepted; `ai@7`'s `{ type: "provider", isProviderExecuted: false }` is
  accepted (verified to have no `execute` field at all on that shape, so the
  SDK can never auto-run it). The guarantee is precisely about **this
  function's own output, unchanged, on a supported local tool definition**:
  it says nothing about a tool that bypasses this function, one
  mutated/reconstructed after this function returns it, or a rejected
  shape. Still dispatch manually from
  `guard.takeDecision(observed.internalId)`, exactly as shown above; this only closes the
  door on the SDK (or your own callbacks) doing it *for* you. See
  [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence).
- **Safe, supported pattern (all majors, including `ai@5`)** — define your
  tools *without* an AI SDK-native `execute` callback at all. Not even a
  no-op one: the guard treats any `tool-result`/`tool-error` it observes as
  proof the SDK's tool loop already invoked that call, and a no-op callback
  still produces one — omitting `execute` entirely is what keeps the SDK
  from running the tool itself in the first place. Consume `fullStream`
  yourself, call `guard.finish()` for diagnostic state, and dispatch manually
  only from `guard.takeDecision(observed.internalId)`, exactly as shown above. `createAiSdkExecutionLock()`
  above gets you this same shape automatically (it drops `execute` too) plus
  the SDK-enforced backstop where that backstop exists.
- **Unprotected / misuse pattern** — attach the real, irreversible operation
  (or any side-effecting code at all) directly as `execute`, `onInputStart`,
  `onInputDelta`, or `onInputAvailable` on a tool definition that bypasses
  `createAiSdkExecutionLock()` entirely, *and* separately run the guard on
  the same stream. All four are callbacks the SDK invokes on its own
  schedule, independent of and often before this guard ever reaches a
  decision — `onInputStart`/`onInputDelta`/`onInputAvailable` in particular
  run regardless of finish reason, schema validity, or approval status, on
  every major including `ai@5`. If that happens, the side effect has
  already run — `prefix-safe-json` cannot retroactively undo it, and on
  `ai@5` specifically nothing in this library can prevent any of these four
  callbacks from firing at all (verified directly, not assumed — see
  `test/integration/ai-sdk-lifecycle/ai-v5.real.test.ts`).

The guard does defend against the second pattern in one specific way, and
only for `execute` specifically: a `tool-result` or `tool-error` part on
`fullStream` is direct evidence the SDK's own loop already invoked *some*
call's `execute`. When it names a specific call (a real `toolCallId`), only
that call is disqualified; when it doesn't, the guard cannot tell which
in-flight call was affected and fails closed for **every** call in that
stream rather than guess. Either way the guard never again reports
`action: "execute"` for the affected call(s)
(`reason: "sdk_execution_observed"`, which takes priority over every other
rejection reason), so a caller who also runs the documented manual-dispatch
loop will not invoke the tool function a *second* time. There is no
equivalent detection for a bypassed `onInputStart`/`onInputDelta`/
`onInputAvailable` — those callbacks produce no observable `fullStream`
evidence of having run at all, so a misuse of any of the three is invisible
to the guard entirely; the only defense is calling
`createAiSdkExecutionLock()` in the first place. It does not undo
whatever the SDK's own callback already did. See
[`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence)
for the full behavior and test matrix.

**Supported providers**: OpenAI (legacy `function_call` and Responses API),
Anthropic, Gemini, OpenRouter, generic OpenAI-compatible endpoints, and the
Vercel AI SDK. High-level guards currently ship for the AI SDK; every
provider has a public low-level adapter (see below) that composes with
`createToolCallExecutionGate()` the same way.

Gemini's adapter exposes its structured argument projection for inspection
and validation, but it never grants strict execute authority because Gemini
does not provide raw argument text at this seam. OpenAI-compatible and
OpenRouter events require a non-negative integer `choice.index`; missing,
invalid, or duplicate choice identity fails closed instead of guessing zero.

`AiSdkStreamAdapter`/`createAiSdkExecutionGuard()` target the public
`streamText()`/`generateText()` `fullStream` surface, whose `finishReason`
is a plain unified string (`"stop"`, `"length"`, ...). They are not
currently an adapter for the lower-level `@ai-sdk/provider` `doStream()`
boundary (`LanguageModelV3`/`V4`), where finish reason is
`{ unified, raw }`-object-shaped — building your own provider against that
interface directly needs different handling of that field.

Full semantics, the decision table, provider finish-reason mapping, and the
high-level guard API: [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md).

## The lower-level problem this is built on

LLM providers (OpenAI, Anthropic, Gemini, OpenRouter) stream tool-call arguments as small JSON chunks. During streaming, the JSON is frequently incomplete: strings split mid-word, UTF-8 characters split mid-byte, containers left unclosed, numbers terminated at chunk boundaries.

This library parses each chunk incrementally and provides:

- **Committed values**: Fields whose values are definitively complete
- **Pending tokens**: Partially received values awaiting more data
- **Monotonic semantic events**: JSON Pointer-based events that are never retracted
- **Parse diagnostics**: Structured error reporting with severity and recoverability
- **Deterministic repair**: When the stream ends, a clear accounting of what was repaired and why
- **Execution safety**: Whether the parsed result is safe to use for tool invocation

## Core Principle

> The parser never fabricates missing data. It clearly distinguishes what is definite, what is pending, what was deterministically repaired, and what is lost.

> **Valid JSON is not safe generation completion. Safe generation completion is not permission to execute a side effect.** Structural validity, confirmed completeness, and execution authority are three separate questions — the gate layer (below) answers all three before ever returning `execute`, not just the first. See [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the full guarantee/non-guarantee list.

## Why not a general "partial JSON" parser?

Most streaming JSON helpers (including ones already used in the wild for
LLM tool-call arguments) are designed to show *something* as early as
possible, even if that means guessing. Concretely, given a stream that has
so far delivered `{"city":"Tok` (the model is still typing "Tokyo"):

| | `city` field after this chunk |
|---|---|
| [vercel/ai's `fixJson`](https://github.com/vercel/ai/blob/main/packages/ai/src/util/fix-json.ts) | `"Tok"` — closes the open string as-is and reports a successful parse |
| [langchain's `parsePartialJson`](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/utils/json.ts) | `"Tok"` — its recursive-descent parser returns whatever string content it collected before running out of input |
| **this library** (`snapshot().stableValue`) | *(absent — `city` is not committed yet)* |

Both of those are real, current, well-engineered implementations — verified
by cloning `vercel/ai` (commit `fbb154a0`) and `langchain-ai/langchainjs`
(commit `555d6f14`) and running their actual code side-by-side with this
library. Neither is a bug: they're built for progressively rendering a
value in a UI, where showing `"Tok"` and then `"Tokyo"` a moment later is
good UX. This library is built for the different question — *is it safe to
act on this value yet* — where treating `"Tok"` as the city would be
wrong. It's why `city` only appears in `stableValue` once its closing
quote genuinely arrives, and why `executable` only becomes `true` once the
whole document is unambiguously, definitively complete.

If you need live "filling in..." UI text, a partial-JSON renderer is the
right tool. If you need to know precisely when it's safe to execute a tool
call with the parsed arguments, that's what this library is for.

### A concrete case where this matters: silent execution on truncated data

The risk above isn't hypothetical. [Cline](https://github.com/cline/cline)
(a coding agent that writes files and runs terminal commands from LLM tool
calls — verified by cloning it, commit `81cce3d70e1`) wires a JSON-repair
step directly into tool execution:
[`sdk/packages/llms/src/providers/ai-sdk.ts:1332`](https://github.com/cline/cline/blob/81cce3d70e10244cdde40dbd0eb0bb711c93006d/sdk/packages/llms/src/providers/ai-sdk.ts#L1332)
registers `repairMalformedToolCall` as the Vercel AI SDK's
`experimental_repairToolCall` hook — whatever it returns *is* the tool call
that runs. That function's own docstring names its target: "truncated
payloads ... common with weaker models." Its repair path
([`sdk/packages/shared/src/parse/json.ts:42`](https://github.com/cline/cline/blob/81cce3d70e10244cdde40dbd0eb0bb711c93006d/sdk/packages/shared/src/parse/json.ts#L42))
runs the raw argument text through
[`jsonrepair`](https://github.com/josdejong/jsonrepair), which — like the
two implementations above — closes an unterminated string as-is rather
than rejecting it.

Feeding `parseJsonStream` (copied verbatim from that file) and this
library the same truncated `write_file` tool call — a `content` argument
cut off mid-value, the exact scenario the docstring describes:

```
input: {"path":"config/database.yml","content":"production:\n  host: db.prod.internal\n  password: correct-horse-battery-sta

Cline's parseJsonStream() -> jsonrepair:
  { "path": "config/database.yml",
    "content": "production:\n  host: db.prod.internal\n  password: correct-horse-battery-sta" }
  No error, no warning. This is what gets written to disk.

This library:
  outcome: "truncated", executable: false
  stableValue: { "path": "config/database.yml" }   // content is absent, not guessed
```

To be clear about scope: `jsonrepair` also fixes things this library
intentionally doesn't (single quotes, trailing commas, unquoted keys) — it
isn't a strict RFC 8259 parser and isn't trying to be, so this library
can't simply replace it there. The gap is narrower and specific: nothing
in that repair path currently distinguishes *"the model's JSON syntax is
wrong"* from *"the model's JSON was cut off mid-value and the rest is
unknown"* — `jsonrepair` handles both the same way, silently. This library
draws exactly that distinction (`outcome: "truncated"`) and could gate
execution on it without touching the syntax-repair behavior for the other
case.

## Scope: what this does and doesn't protect against

This library is honestly scoped as **execution integrity** — complete,
unfabricated, schema-valid arguments — not a general "AI security platform."
It does **not**:

- defend against prompt injection (it says nothing about whether the
  arguments a model *chose* to send are the arguments it *should* have
  sent — only whether they're complete and unfabricated)
- resolve authorization (it doesn't know which caller may invoke which tool)
- sandbox execution (`action: "execute"` means "this is genuinely the
  complete value the model produced," not "safe to run without your own
  validation and permissions")
- detect a malicious or wrong tool choice (a model calling the wrong tool
  with complete, schema-valid arguments is still reported `execute`)

See [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#limitations---what-this-does-not-protect-against)
for the full list, including known internal limitations, and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the complete security
objective, trust boundaries, and guarantee/non-guarantee list.

## Current Status

### Implemented

- Incremental UTF-8 decoder with split-byte handling
- Lexical JSON state machine (17 states)
- Grammar stack with object/array tracking
- Semantic event emission for committed scalar values
- Duplicate key detection and rejection
- `push()` / `snapshot()` / `drainEvents()` / `finish()` API
- Configurable resource limits (depth, input size, string length, queued events)
- Machine-readable test corpus with 25+ canonical fixtures
- Chunk invariance verification
- Provider stream adapters for OpenAI (legacy `function_call` and Responses API), Anthropic, Gemini, OpenRouter, generic OpenAI-compatible endpoints, and the Vercel AI SDK, plus a coordinator for tracking multiple concurrent tool-call streams
- Optional per-tool JSON Schema validation on the coordinator (see below) — a value can be structurally complete and still not match what a tool declared it needs
- `createToolCallExecutionGate()` — a fail-closed `execute` / `retry` / `reject` decision per tool call, built on top of the coordinator (see [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md))
- `createAiSdkExecutionGuard()` — a drop-in high-level guard for the Vercel AI SDK's `fullStream`, composing a provider adapter with the execution gate; every `ExecutionDecision` also carries an `evidence` object explaining why (see [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#high-level-guards))
- Call-scoped one-shot authority via `takeDecision(internalId)`; replayable `finish()` results remain available for diagnostics, while the recommended dispatch path cannot take the same execute authority twice
- SDK execution-ownership detection — direct evidence that the AI SDK's own tool loop already invoked a call (attributed or, when it can't be, stream-wide) permanently blocks this library from also authorizing it, with the highest rejection-reason priority of any disqualifier (see [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence))

### Not Yet Implemented

- CLI tool
- Network/SSE client integration

`Advanced repair engine (structural/lossy repairs)` was previously listed here and has been removed — "lossy repair" (fabricating/guessing a value to fill a gap) is the opposite of this library's core principle, not a missing feature.

### JSON Schema validation

`createToolCallStreamCoordinator()` optionally accepts a third argument: a map of tool name → JSON Schema (draft-07). When a call for a registered tool reaches a structurally complete outcome, its `stableValue` is validated against that schema.

This is a genuinely different check from prefix-safety. `executable` from the core parser only means *"this value is not truncated or fabricated."* It says nothing about whether the value matches what the tool actually needs — a model can finish generating a syntactically complete object that's still missing a required field, or has the wrong type for one. Schema validation catches that separate class of problem. The coordinator's own `executable` (on `tool_call_finished` and `ToolCallState.parser`) is only `true` when *both* hold.

```typescript
import { createToolCallStreamCoordinator } from "prefix-safe-json";

const coordinator = createToolCallStreamCoordinator(undefined, undefined, {
  write_file: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
    },
    required: ["path", "content"],
  },
});

// ...push provider events...

const call = coordinator.snapshot().calls[0];
call.schemaValid; // true | false | undefined (undefined = no schema registered for this tool)
```

A schema mismatch also surfaces as a coordinator diagnostic (`E_SCHEMA_VALIDATION_FAILED`) with ajv's own error detail. Malformed schemas are compiled eagerly at construction time, so a bad schema fails fast rather than mid-stream.

## Package requirements

ESM only — `import`, not `require`. There is currently no CommonJS build.
Node `>=18.0.0`. Node 18/20 are end-of-life and no longer receive security
patches; compatibility here describes the package runtime, not a recommendation
to operate an unpatched Node release. See
[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for the full
runtime-versus-toolchain distinction, exact AI SDK pin requirements, and the
per-provider compatibility matrix.

## Low-level API: Quick Start

The AI SDK guard (above) covers the common case. For other providers, or
when you need the adapter/gate instance directly, `createToolCallExecutionGate()`
and the provider adapters (`AnthropicStreamAdapter`, `OpenAIStreamAdapter`,
etc.) are equally public — see [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#example).
The `createParser()` API both are built on is also fully public, for anyone who
needs direct access to parser state:

```typescript
import { createParser } from "prefix-safe-json";

const parser = createParser();

// Feed chunks as they arrive from the LLM stream
parser.push('{"tool":"calc",');
parser.push('"args":{"x":42}}');

// Get committed values at any point
const snap = parser.snapshot();
console.log(snap.stableValue);

// Drain semantic events
const events = parser.drainEvents();

// Signal stream completion
const result = parser.finish({ reason: "complete" });
console.log(result.executable); // true if safe to execute
```

### End-to-end example (real API, no mocked internals)

The snippet above is illustrative; for a runnable, verified demonstration
against the actual provider-adapter + coordinator public API — including
the exact truncation scenario described above — see
[`examples/anthropic-truncation-safety.mjs`](examples/anthropic-truncation-safety.mjs)
(`node examples/anthropic-truncation-safety.mjs` after `pnpm run build`).
It feeds `AnthropicStreamAdapter` a realistic Anthropic Messages API SSE
sequence — including one cut off mid-argument by `max_tokens`, matching
Anthropic's real streaming shape — through `createToolCallStreamCoordinator()`,
and asserts the truncated call is never reported executable while a
genuinely complete one is. This example runs in CI on every push, so it
can't silently rot into a stale claim.

For the exact-major AI SDK ownership proof, run
`pnpm run example:ai-sdk-lifecycle-proof` after `pnpm run build`. It asserts
for each exact pin that an unlocked control invokes caller code before guard
authority, locked unsafe calls perform no operation, and locked safe calls are
manually dispatched exactly once. CI and the release workflow run this same
command.

For the same raw-evidence demonstration through the low-level execution gate and the
[Vercel AI SDK](https://ai-sdk.dev)'s `fullStream` shape instead, see
[`examples/ai-sdk-execution-gate.mjs`](examples/ai-sdk-execution-gate.mjs)
(`node examples/ai-sdk-execution-gate.mjs` after `pnpm run build`) — also
run in CI on every push. [`examples/ai-sdk-guard.mjs`](examples/ai-sdk-guard.mjs)
is a lower-level wire-shape guard demonstration; it is not the canonical
execution-ownership example. Both remain CI-checked.

## License

Licensed under either of:

- MIT License ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option.
