# prefix-safe-json

> **v0.1** — No longer alpha. Core API (`createParser`, `createToolCallStreamCoordinator`, `createToolCallExecutionGate`, `createAiSdkExecutionGuard`) is considered stable; any breaking change will be called out in [CHANGELOG.md](CHANGELOG.md). Raw provider adapters (`OpenAIStreamAdapter` and friends) remain experimental — see [Current Status](#current-status) for what's covered.

**Don't execute incomplete AI tool calls.**

`prefix-safe-json` is a fail-closed execution-integrity layer for streamed
LLM tool calls. It distinguishes complete, unfabricated arguments from truncated
ones — including ones a syntax-level JSON repairer can make *look* complete
— before they reach a tool with real side effects (writing a file, running a
command, sending a request).

```
model output truncated
        ↓
    json repair
        ↓
    looks valid
        ↓
❌ dangerous execution
```

```
   prefix-safe-json
        ↓
      truncated
        ↓
  executable: false
        ↓
        retry
```

![Demo: a tool call truncated mid-argument is correctly reported non-executable, while the same call delivered in full is reported executable](examples/demo.gif)

*(Real terminal output from [`examples/anthropic-truncation-safety.mjs`](examples/anthropic-truncation-safety.mjs) — not staged. Same script CI runs on every push.)*

## From stream to safe execution, in about 10 lines

```typescript
import { createAiSdkExecutionGuard } from "prefix-safe-json";

const guard = createAiSdkExecutionGuard({
  schemas: {
    write_file: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
});

for await (const part of result.fullStream) guard.push(part);

for (const decision of guard.finish().decisions) {
  if (decision.action === "execute") await tools[decision.name](decision.value);
}
```

`createAiSdkExecutionGuard()` is a drop-in guard for the [Vercel AI
SDK](https://ai-sdk.dev)'s `fullStream` — not a dependency of this library
(no `ai` import, no runtime version lock; see
[`examples/ai-sdk-guard.mjs`](examples/ai-sdk-guard.mjs)). It's a thin
composition over the same lower-level adapter + gate API this library has
always exposed — nothing about the decision logic changes based on which one
you call.

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
v7, with fixes landing across all three release lines (v7's in `ai@7.0.70`).
`prefix-safe-json` does not patch or depend on that fix — it's a
provider-independent guard that requires positive proof a stream ended
safely before treating any tool call as final, regardless of which SDK,
provider, or framework hands it the data. See
`test/guard/ai-sdk-compatibility.test.ts` for the cross-version test
evidence.

**Execution ownership: what must never also happen**

The guard's decisions only mean something if it's the sole thing deciding
whether your tool function runs. The pattern above works because it never
gives the AI SDK's own tool-calling loop a chance to run your tool itself —
in order from strongest guarantee to weakest:

- **Strongest — `createAiSdkExecutionLock()` (`ai@6`+)** — wrap your tool
  definitions with it before passing them to `streamText()`/`generateText()`.
  It drops any `execute` you attach and forces the SDK's own `needsApproval`
  mechanism on, so the SDK's tool loop is *structurally* incapable of
  calling your real handler — verified directly against `ai@6`/`ai@7`'s own
  source, not inferred. Still dispatch manually from
  `guard.finish().decisions`, exactly as shown above; this only closes the
  door on the SDK ever doing it *for* you. See
  [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence).
- **Safe, supported pattern (all majors, including `ai@5`)** — define your
  tools *without* an AI SDK-native `execute` callback at all. Not even a
  no-op one: the guard treats any `tool-result`/`tool-error` it observes as
  proof the SDK's tool loop already invoked that call, and a no-op callback
  still produces one — omitting `execute` entirely is what keeps the SDK
  from running the tool itself in the first place. Consume `fullStream`
  yourself, and dispatch manually — only for `action === "execute"` — after
  `guard.finish()`, exactly as shown above. `createAiSdkExecutionLock()`
  above gets you this same shape automatically (it drops `execute` too) plus
  the SDK-enforced backstop where that backstop exists.
- **Unprotected / misuse pattern** — attach the real, irreversible operation
  (or any `execute` implementation at all, no-op included) directly as the
  tool's own AI SDK-native callback, bypassing both options above, *and*
  separately run the guard on the same stream. The SDK can invoke `execute`
  as soon as it resolves that call's input, independent of and often before
  this guard ever reaches a decision. If that happens, the side effect has
  already run — `prefix-safe-json` cannot retroactively undo it, and on
  `ai@5` specifically nothing in this library can prevent that first call at
  all (verified directly, not assumed — see
  `test/integration/ai-sdk-lifecycle/ai-v5.real.test.ts`).

The guard does defend against the second pattern in one specific way: a
`tool-result` or `tool-error` part on `fullStream` is direct evidence the
SDK's own loop already invoked *some* call. When it names a specific call
(a real `toolCallId`), only that call is disqualified; when it doesn't, the
guard cannot tell which in-flight call was affected and fails closed for
**every** call in that stream rather than guess. Either way the guard never
again reports `action: "execute"` for the affected call(s)
(`reason: "sdk_execution_observed"`, which takes priority over every other
rejection reason), so a caller who also runs the documented manual-dispatch
loop will not invoke the tool function a *second* time. It does not undo
whatever the SDK's own callback already did. See
[`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence)
for the full behavior and test matrix.

**Supported providers**: OpenAI (legacy `function_call` and Responses API),
Anthropic, Gemini, OpenRouter, generic OpenAI-compatible endpoints, and the
Vercel AI SDK. High-level guards currently ship for the AI SDK; every
provider has a public low-level adapter (see below) that composes with
`createToolCallExecutionGate()` the same way.

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

## Installation

```bash
npm install prefix-safe-json
```

ESM only — `import`, not `require`. There is currently no CommonJS build.
Node `>=22.0.0` (Active LTS lines only — Node 18/20 are end-of-life and no
longer receive security patches). See
[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for the full
ESM/Node/SemVer/Stable-vs-Experimental policy and the per-provider
compatibility matrix.

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

For the same demonstration through the low-level execution gate and the
[Vercel AI SDK](https://ai-sdk.dev)'s `fullStream` shape instead, see
[`examples/ai-sdk-execution-gate.mjs`](examples/ai-sdk-execution-gate.mjs)
(`node examples/ai-sdk-execution-gate.mjs` after `pnpm run build`) — also
run in CI on every push. For the drop-in `createAiSdkExecutionGuard()` shown
at the top of this README, see
[`examples/ai-sdk-guard.mjs`](examples/ai-sdk-guard.mjs)
(`node examples/ai-sdk-guard.mjs`) — same scenarios, same guarantees, also
run in CI on every push.

## License

Licensed under either of:

- MIT License ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option.
