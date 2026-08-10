# prefix-safe-json

> ⚠️ **Alpha** — This project is under active development. APIs may change without notice. Do not use in production.

Incremental LLM tool-call JSON parser and deterministic repair engine.

## Problem

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

## Current Status (Alpha)

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
- Provider stream adapters for OpenAI (legacy `function_call` and Responses API), Anthropic, Gemini, OpenRouter, and generic OpenAI-compatible endpoints, plus a coordinator for tracking multiple concurrent tool-call streams

### Not Yet Implemented

- Advanced repair engine (structural/lossy repairs)
- JSON Schema validation
- CLI tool
- Network/SSE client integration

## Installation

```bash
npm install prefix-safe-json
```

## Quick Start

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

## License

Licensed under either of:

- MIT License ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option.
