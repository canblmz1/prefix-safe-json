# prefix-safe-json

[![npm version](https://img.shields.io/npm/v/prefix-safe-json.svg)](https://www.npmjs.com/package/prefix-safe-json)
[![CI](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml/badge.svg)](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

**Fail-closed execution integrity for streamed LLM tool calls.**

Prevent truncated, conflicting, or unconfirmed streamed tool arguments
from reaching side effects. `prefix-safe-json` distinguishes complete,
unfabricated raw arguments from truncated or unconfirmed input — including
SDK-projected or repaired values that merely *look* complete. **JSON
validity is not execution authority.**

```bash
pnpm add prefix-safe-json ai
# or: npm install prefix-safe-json ai
```

## 30-line safe execution example

```javascript
import { streamText } from "ai";
import { createAiSdkExecutionGuard, createAiSdkExecutionLock } from "prefix-safe-json";

// 1. Lock tool definitions before the AI SDK sees them - removes every
//    SDK-invoked callback that could run your code before this guard does.
const lockedTools = createAiSdkExecutionLock({
  write_file: { description: "Write a UTF-8 text file", inputSchema: writeFileSchema },
});

// 2. Stream, feeding the real fullStream into the guard.
const result = streamText({ model, prompt, tools: lockedTools });
const guard = createAiSdkExecutionGuard({ schemas: { write_file: writeFileSchema } });
for await (const part of result.fullStream) {
  guard.push(part);
}

// 3. finish() signals the stream ended. Every decision is replayable
//    diagnostic state - it does not perform anything by itself.
const final = guard.finish();

// 4. The caller owns dispatch: take each call's authority exactly once,
//    then run the real, irreversible side effect yourself.
for (const observed of final.decisions) {
  const authority = guard.takeDecision(observed.internalId);
  if (authority) await writeFile(authority.value.path, authority.value.content);
}
```

`prefix-safe-json` never calls `writeFile` (or anything like it) itself.
The last line above is the only place a side effect happens, and it's
entirely yours. See [`examples/`](examples/) for full, runnable
demonstrations against real provider/SDK shapes, no mocked internals.

## Why this exists

LLM providers stream tool-call arguments as small JSON chunks. During
streaming, the JSON is frequently incomplete: strings split mid-word,
UTF-8 characters split mid-byte, containers left unclosed, numbers
terminated at chunk boundaries — and even once the JSON *looks* complete,
nothing about its shape says whether the provider actually confirmed the
call is done, or just stopped for an unrelated reason (a token limit, an
error, a content filter) partway through.

> **The core invariant: parse completion is not execution authority.**

Structural validity, confirmed completeness, and execution authority are
three separate questions. Most streaming JSON helpers — including some
already used for LLM tool-call arguments in the wild — are built to show
*something* as early as possible, even if that means guessing. Given a
stream that has so far delivered `{"city":"Tok` (the model is still
typing "Tokyo"):

| | `city` field after this chunk |
|---|---|
| [vercel/ai's `fixJson`](https://github.com/vercel/ai/blob/main/packages/ai/src/util/fix-json.ts) | `"Tok"` — closes the open string as-is, reports a successful parse |
| [langchain's `parsePartialJson`](https://github.com/langchain-ai/langchainjs/blob/main/libs/langchain-core/src/utils/json.ts) | `"Tok"` — returns whatever string content it collected |
| **`prefix-safe-json`** (`snapshot().stableValue`) | *(absent — `city` is not committed yet)* |

Verified by cloning both projects and running their actual code
side-by-side with this library. Neither is a bug — they're built for
progressively rendering a value in a UI, where showing `"Tok"` then
`"Tokyo"` a moment later is good UX. `prefix-safe-json` answers a
different question: *is it safe to act on this value yet* — where
treating `"Tok"` as the city would be wrong. If you need live
"filling in..." UI text, a partial-JSON renderer is the right tool. If
you need to know precisely when it's safe to execute a tool call with the
parsed arguments, that's what this library is for.

## What `execute` / `retry` / `reject` mean

Every tool call gets exactly one verdict:

- **`execute`** — complete, unfabricated, and (if a schema/validator is
  registered) valid. `decision.value` is safe to pass to your tool.
- **`retry`** — nothing is wrong with what arrived; there just isn't a
  trustworthy complete value yet. Continue generation.
- **`reject`** — the data itself is the problem (malformed JSON, a schema
  mismatch, a resource limit, a provider error, a content-policy
  termination). Retrying the same input won't help.

See [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md) for the full
decision table and every `reason` value.

## Failure cases

The risk above isn't hypothetical. [Cline](https://github.com/cline/cline)
(a coding agent that writes files and runs terminal commands from LLM tool
calls — verified by cloning it, commit `81cce3d70e1`) wires a JSON-repair
step directly into tool execution: whatever
[`repairMalformedToolCall`](https://github.com/cline/cline/blob/81cce3d70e10244cdde40dbd0eb0bb711c93006d/sdk/packages/llms/src/providers/ai-sdk.ts#L1332)
returns *is* the tool call that runs, and its repair path closes an
unterminated string as-is, same as the table above.

Feeding both implementations the same truncated `write_file` call — a
`content` argument cut off mid-value:

```text
input: {"path":"config/database.yml","content":"production:\n  host: db.prod.internal\n  password: correct-horse-battery-sta

Cline's parseJsonStream() -> jsonrepair:
  { "path": "config/database.yml",
    "content": "production:\n  host: db.prod.internal\n  password: correct-horse-battery-sta" }
  No error, no warning. This is what gets written to disk.

prefix-safe-json:
  outcome: "truncated", executable: false
  stableValue: { "path": "config/database.yml" }   // content is absent, not guessed
```

This is one instance of a class of defect independently found across
several unrelated agent runtimes — see
[`docs/REAL_WORLD_FAILURES.md`](docs/REAL_WORLD_FAILURES.md) for the full,
strictly-classified matrix (which reports are upstream-fixed, which are
still open, which are internal reproductions only) and
[`docs/CASE_STUDY_SANDBASE.md`](docs/CASE_STUDY_SANDBASE.md) for how one
independently maintained runtime closed this exact gap in production.

## Supported boundaries

`prefix-safe-json` owns **tool-call execution integrity** — raw argument
evidence, identity correlation, lifecycle completeness, truncation
detection, conflicting evidence, and validator-verdict composition, up
through a one-shot execution-authority decision. It does **not** own tool
permission, application authorization, human approval, sandboxing,
application idempotency, distributed exactly-once semantics, or prompt
injection defense — see
[`docs/PRODUCT_POSITIONING.md`](docs/PRODUCT_POSITIONING.md) for the full
owns/does-not-own boundary and
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the complete guarantee/
non-guarantee list, including known internal limitations.

Concretely, it does **not**:

- defend against prompt injection (it says nothing about whether the
  arguments a model *chose* to send are the arguments it *should* have
  sent — only whether they're complete and unfabricated)
- resolve authorization (it doesn't know which caller may invoke which
  tool)
- sandbox execution (`action: "execute"` means "this is genuinely the
  complete value the model produced," not "safe to run without your own
  validation and permissions")
- detect a malicious or wrong tool choice (a model calling the wrong tool
  with complete, valid arguments is still reported `execute`)

## AI SDK integration

The 30-line example above covers the common case. Three integration
patterns exist, strongest first:

- **Strongest — `createAiSdkExecutionLock()`.** Wrap your tool
  definitions with it before passing them to `streamText()`/
  `generateText()`. It removes every AI SDK-invoked callback capable of
  running your code before this library's decision — not just `execute`,
  but also `onInputStart`, `onInputDelta`, and `onInputAvailable`
  (verified directly against `ai@5`/`ai@6`/`ai@7`'s own source: all three
  fire unconditionally, independent of `needsApproval`). It also forces
  `needsApproval: true` and rejects any provider-tool shape whose real
  execution location it cannot verify. Still dispatch manually from
  `guard.takeDecision(observed.internalId)` — this only closes the door
  on the SDK (or your own callbacks) doing it *for* you.
- **Safe, supported pattern (all majors, including `ai@5`)** — define
  your tools *without* an AI SDK-native `execute` callback at all. Not
  even a no-op one. Consume `fullStream` yourself and dispatch manually.
  `createAiSdkExecutionLock()` gets you this automatically.
- **Unprotected / misuse pattern** — attach the real side effect directly
  as `execute`/`onInputStart`/`onInputDelta`/`onInputAvailable` on a tool
  definition that bypasses the lock. If that happens, the side effect has
  already run before this library ever reaches a decision; nothing here
  can retroactively undo it.

The guard does defend against the misuse pattern in one specific way: a
`tool-result`/`tool-error` part on `fullStream` is direct evidence the
SDK's own loop already invoked *some* call's `execute`, and once observed
this library never again reports `action: "execute"` for the affected
call(s) (`reason: "sdk_execution_observed"` — the highest-priority
rejection reason of any). There is no equivalent detection for a bypassed
`onInputStart`/`onInputDelta`/`onInputAvailable` — those callbacks
produce no observable evidence of having run at all. Full behavior, the
exact test matrix, and every verified `ai@5`/`ai@6`/`ai@7` behavioral
difference:
[`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence).

`AiSdkStreamAdapter`/`createAiSdkExecutionGuard()` target the public
`streamText()`/`generateText()` `fullStream` surface (`finishReason` as a
plain unified string), not the lower-level `@ai-sdk/provider`
`doStream()` boundary.

## Provider adapters

Every provider below has a public low-level adapter that composes with
`createToolCallExecutionGate()` the same way the high-level AI SDK guard
does internally:

**OpenAI** (legacy `function_call` and Responses API), **Anthropic**,
**Gemini**, **OpenRouter**, generic **OpenAI-compatible** endpoints, and
the **Vercel AI SDK**.

```typescript
import { createToolCallExecutionGate, OpenAIStreamAdapter } from "prefix-safe-json";

const adapter = new OpenAIStreamAdapter();
const gate = createToolCallExecutionGate();
for (const rawChunk of stream) {
  for (const event of adapter.push(rawChunk)) gate.push(event);
}
for (const event of adapter.finish({ reason: "complete" })) gate.push(event);
const { decisions } = gate.finish();
```

Notes: Gemini's adapter exposes its structured argument projection for
inspection and validation, but never grants strict execute authority —
Gemini does not provide raw argument text at this seam. OpenAI-compatible
and OpenRouter events require a non-negative integer `choice.index`;
missing, invalid, or duplicate choice identity fails closed instead of
guessing zero. Full semantics, the decision table, and provider
finish-reason mapping: [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md).

### Bring your own validator

Schema/validator checking is optional and validator-agnostic — plug in
Zod, TypeBox, Valibot, a Standard Schema-compliant validator, a
hand-written check, or a raw JSON Schema object (backwards compatible,
compiled through an isolated, lazily-loaded Ajv adapter):

```typescript
const gate = createToolCallExecutionGate(undefined, undefined, {
  write_file: { validate: (v) => WriteFileSchema.safeParse(v).success ? { valid: true } : { valid: false } },
});
```

No forced dependency on any specific validation ecosystem. See
[`docs/VALIDATION.md`](docs/VALIDATION.md).

## Conformance

[`conformance/`](conformance/) packages this project's failure corpus as
a portable, provider-neutral fixture format and a small deterministic
runner (`prefix-safe-json/conformance`) — useful even to a project that
never installs this package at runtime, since the fixture format and
expected outcomes are meaningful against any implementation of this
problem class. `prefix-safe-json` is the reference implementation and
dogfoods this exact runner in its own test suite. See
[`docs/CONFORMANCE.md`](docs/CONFORMANCE.md).

## Threat model / non-goals

`prefix-safe-json` is honestly scoped as **execution integrity**, not a
general "AI security platform." The complete guarantee/non-guarantee
list, trust boundaries, and known internal limitations live in
[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md); the product-level
owns/does-not-own boundary this is drawn from is
[`docs/PRODUCT_POSITIONING.md`](docs/PRODUCT_POSITIONING.md).

## Supply-chain verification

Verify releases independently rather than relying on publisher claims.
Published artifacts have npm provenance from this repository's GitHub
Actions publish workflow, and a tarball can be rebuilt and compared
against its release tag with `npm run verify:published-release -- <version>`
from a clone with tags fetched. See the command-driven
[maintainer audit](docs/MAINTAINER_AUDIT.md), the exact
[release/hash mapping](docs/RELEASE_INTEGRITY.md), the
[runtime dependency graph](docs/RUNTIME_DEPENDENCIES.md), and the
[execution-critical source map](docs/EXECUTION_AUDIT_SURFACE.md).

## Compatibility

ESM only (`import`, not `require`), Node `>=18.0.0`. Node 18/20 are
end-of-life and no longer receive security patches; this describes the
package's runtime requirement, not a recommendation to operate an
unpatched Node release. Repository development and release jobs run on
newer Node because the toolchain needs it — that requirement does not
apply to the published package's own runtime dependency graph.

**Vercel AI SDK**, verified directly against each exact pinned major via
a real `streamText()` lifecycle proof (no API key, no network request, no
paid model call — `pnpm run example:ai-sdk-lifecycle-proof`, run in CI on
every push):

| Major | Status |
| --- | --- |
| v5 | verified |
| v6 | verified |
| v7 | verified |

Not a claim that every version within a major is tested. Full
per-provider compatibility matrix, exact AI SDK pin requirements, and the
runtime-vs-toolchain distinction:
[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).

## Development / audit

### Current status

**Implemented:** incremental UTF-8 decoder, 17-state lexical JSON state
machine, grammar stack, semantic event emission, duplicate-key rejection,
`push()`/`snapshot()`/`drainEvents()`/`finish()`, configurable resource
limits, a machine-readable test corpus plus the public
[Tool Call Integrity conformance corpus](conformance/), provider stream
adapters (OpenAI legacy + Responses, Anthropic, Gemini, OpenRouter,
OpenAI-compatible, Vercel AI SDK) with a coordinator for concurrent
tool-call streams, validator-agnostic per-tool validation (see
[`docs/VALIDATION.md`](docs/VALIDATION.md)), `createToolCallExecutionGate()`,
`createAiSdkExecutionGuard()`, call-scoped one-shot authority via
`takeDecision(internalId)`, and SDK execution-ownership detection.

**Not yet implemented:** a CLI tool, network/SSE client integration.

### Low-level parser API

```typescript
import { createParser } from "prefix-safe-json";

const parser = createParser();
parser.push('{"tool":"calc",');
parser.push('"args":{"x":42}}');
console.log(parser.snapshot().stableValue);
const result = parser.finish({ reason: "complete" });
console.log(result.executable); // true if safe to execute
```

Runnable, CI-checked, real-API examples (no mocked internals):
[`examples/anthropic-truncation-safety.mjs`](examples/anthropic-truncation-safety.mjs),
[`examples/ai-sdk-execution-gate.mjs`](examples/ai-sdk-execution-gate.mjs),
[`examples/ai-sdk-lifecycle-proof.mjs`](examples/ai-sdk-lifecycle-proof.mjs).

### Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how to run tests, add a
provider fixture or conformance case, and propose adapter support.

## License

Licensed under either of:

- MIT License ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option.
