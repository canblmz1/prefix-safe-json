# prefix-safe-json

[![npm version](https://img.shields.io/npm/v/prefix-safe-json.svg)](https://www.npmjs.com/package/prefix-safe-json)
[![CI](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml/badge.svg)](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

Keep an incomplete or ambiguously identified LLM tool call from reaching your
application's tools. `prefix-safe-json` checks the original argument stream,
completion signals and schema **before your application runs a tool**, even
when the SDK's parsed arguments look usable.

The core package returns one-shot decisions; your application performs the
side effect. The separate integration below keeps tool execution in the SDK.
Provider signals must accurately describe completion;
see the [provider-honesty limit](examples/openai-consumer/README.md).

```bash
pnpm add prefix-safe-json ai zod
# or: npm install prefix-safe-json ai zod
```

For AI SDK 7 with OpenAI-compatible Chat Completions, the experimental
[guarded chat integration](packages/ai-sdk/README.md) keeps your ordinary
`execute` callbacks and the SDK's automatic tool-result continuation:

```typescript
import { createGuardedChat } from "psj-ai-sdk";
import { stepCountIs } from "ai";

const chat = createGuardedChat({ name: "provider", baseURL, apiKey });
const result = chat({ model: modelId, tools, prompt, stopWhen: stepCountIs(5) });
```

It buffers each complete response before releasing tool calls, which delays
the first text chunk. See its separate preview install and supported tool
policies before choosing it. Run the [offline example](examples/guarded-chat/)
without a key. The core runtime gains no AI SDK dependency.

For caller-owned dispatch, use the [complete TypeScript agent-loop example](examples/typed-agent-loop/):
[download its ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.6.1/prefix-safe-json-0.6.1-typed-loop.zip),
extract it, then run `npm install --engine-strict --no-audit --no-fund` and
`npm start` with Node 22+. It uses published PSJ `0.6.1`, runs tools, sends
their matched results back to the model, and returns a final answer. Five
authored scenarios use memory counters; no API key or repository build is needed.
[Choose another SDK](examples/README.md).

## Safe execution example

```javascript
import { writeFile } from "node:fs/promises";
import { streamText } from "ai";
import { z } from "zod";
import {
  createAiSdkExecutionGuard,
  createAiSdkExecutionLock,
} from "prefix-safe-json";
import { fromStandardSchema } from "prefix-safe-json/standard-schema";

const writeFileSchema = z.object({ path: z.string(), content: z.string() }).strict();

const tools = createAiSdkExecutionLock({
  write_file: {
    description: "Write a UTF-8 text file",
    inputSchema: writeFileSchema,
  },
});

const guard = createAiSdkExecutionGuard({
  validators: { write_file: fromStandardSchema(writeFileSchema) },
});

const result = streamText({ model, prompt, tools });
for await (const part of result.fullStream) {
  guard.push(part);
}

const { decisions, diagnostics } = guard.finish();
for (const decision of decisions) {
  const authority = guard.takeDecision(decision.internalId);
  if (authority) {
    const input = writeFileSchema.parse(authority.value);
    await writeFile(input.path, input.content);
  } else {
    console.warn(`skipped ${decision.name}: ${decision.action} (${decision.reason})`);
  }
}
if (decisions.length === 0 && diagnostics.length > 0) {
  console.warn("no tool call was executed:", diagnostics);
}
```

`model` and `prompt` are yours. The lock stops the SDK from running `write_file` itself; the guard checks each streamed call against the same schema and hands out a one-shot decision. The caller owns dispatch, and a call the guard doesn't hand out never runs.

Using `jsonSchema()` from `ai` instead of Zod? Give the guard the raw schema inside it: `schemas: { write_file: writeFileSchema.jsonSchema }`. The wrapper itself is refused at construction, because it would otherwise validate nothing.

## Typed inputs and a complete agent loop

Experimental `createTypedAiSdkExecutionGuard` in
`prefix-safe-json/standard-schema` requires **PSJ 0.6.0+**.
The [strict TypeScript agent-loop example](examples/typed-agent-loop/) checks
inferred raw inputs, matching result IDs and a final model answer, plus four
refusal/error scenarios. It runs against the actual tarball without an API
key. The caller owns dispatch and continuation. Schema transformations,
defaults and removed keys are refused; [validation details](docs/VALIDATION.md#typed-raw-input-guard).

To try the published version without cloning this repository, download the
[0.6.1 typed-loop example ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.6.1/prefix-safe-json-0.6.1-typed-loop.zip),
extract it, then run `npm install --engine-strict --no-audit --no-fund` and
`npm start` inside the extracted directory. Node 22+ is required. The example
uses authored model responses and memory counters; no API key is needed.

## When this adds value

PSJ fits applications that can retain original stream evidence and own tool
dispatch, especially when they need the same completion and identity policy
across providers. Check your integration before adding it:

| Your current boundary | First step |
| --- | --- |
| You retain argument deltas and control dispatch | Compare a harmless tool with and without the guard |
| Your SDK already refuses the failure you care about | Test that native behavior first; an extra dependency may add no value |
| Your framework runs tools before exposing raw events | Find a pre-execution hook or keep the native path; observing later cannot prevent an earlier effect |
| You want partial JSON for a UI or recovery of truncated XML | Use a preview/recovery tool; PSJ's execution policy does not provide that behavior |

The [integration guide](docs/TRY_IN_YOUR_PROJECT.md) explains the migration
steps and [external fit audit](docs/EXTERNAL_FIT_AUDIT.md) records useful
integrations and cases where no additional benefit was shown.

For a concrete difference beyond unsafe termination, the
[identity comparison](docs/IDENTITY_TRIAL.md) feeds complete, schema-valid
calls through real `streamText()`: native execution records both calls when
they reuse an ID; the locked PSJ path refuses that ambiguous identity. With
distinct IDs, both paths record both calls. These are authored fixtures,
not live-provider or WorkflowAgent certification. Select `ai-sdk` in the
launcher for this comparison, or run `npm run identity` in that installed consumer.

## Replay an incident and keep it as a regression test

Have a recorded Anthropic or AI SDK tool stream? The experimental
[local replay workflow](docs/REPLAY.md) explains each call's execution decision
and compares it with reviewed expectations in CI. It runs from a repository
checkout without model requests or tool dispatch.

To test an SDK upgrade with original HTTP/SSE bytes, use the separate
[experimental regression development package](packages/regression/README.md).
It checks actual installed SDK inputs, harmless effects and paired results
in CI. Install its [experimental preview tarball](https://github.com/canblmz1/prefix-safe-json/releases/tag/psj-regression-v0.1.0)
as a development dependency; it is distributed separately from the PSJ
runtime package.

## Run a standalone npm demo

From this checkout, with Node 22+ and npm:

```bash
node scripts/try-npm-demo.mjs
```

The default `guarded` trial installs the separate integration preview, published
PSJ `0.6.1`, AI SDK `7.0.143` and OpenAI-compatible provider `3.0.71`.
It uses ordinary SDK callbacks and automatic result continuation. The
explicit `typed` trial installs published PSJ `0.6.1`, AI SDK `7.0.143`
and Zod `4.4.3` in a separate temporary project. It checks a complete
tool → result → model loop, token limits, duplicate IDs, cancellation and a
tool error. The complete control returns a final answer; refused batches do
not continue. The directory stays available for editing and rerunning.

Choose another boundary by passing one of these names:

| Choice | PSJ pin | What to inspect |
| --- | --- | --- |
| `guarded` (default) | `0.6.1` + separate preview | [Native callbacks and automatic continuation](examples/guarded-chat/) |
| `typed` | `0.6.1` | [Typed inputs and caller-owned continuation](examples/typed-agent-loop/) |
| `ai-sdk` | `0.5.4` | [Termination, interleaved calls and native/PSJ identity comparison](docs/IDENTITY_TRIAL.md) |
| `openai` | `0.5.4` | [Original Chat Completions evidence and provider-honesty limit](examples/openai-consumer/README.md) |
| `anthropic` | `0.5.4` | [Final message termination and interrupted streams](examples/anthropic-consumer/README.md) |
| `langchain` | `0.5.4` | [Parsed candidates versus original provider evidence](examples/langchain-consumer/README.md) |
| `openrouter` | `0.5.4` | [Raw events, manual dispatch and paired results](examples/openrouter-consumer/README.md) |
| `tanstack` | `0.5.4` | [Native finish reasons, usage trailers and server-tool results](examples/tanstack-consumer/README.md) |

All trials use authored fixtures and harmless counters; they need no API key,
model server or repository build. Installation requires npm registry access.
A passing fixture is not a live-provider or own-project integration result.
The older [six-SDK ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.5.4/prefix-safe-json-0.5.4-trials.zip)
retains its original six choices and `0.5.4` pins; `typed` is available in
the current checkout and the separate `0.6.1` ZIP linked above.

To connect a real application, follow the [integration guide](docs/TRY_IN_YOUR_PROJECT.md).
Your application must retain original evidence, stop automatic execution and
send accepted tool results into its own continuation loop.

## Why parse success is not enough

Tool-call arguments often arrive as partial JSON. A renderer may reasonably repair or close an unfinished prefix so it can show progressive UI. That is useful for display, but it answers a different question from whether a side effect should run.

Given the prefix:

```text
{"city":"Tok
```

some partial-JSON helpers can expose `"Tok"` immediately. `prefix-safe-json` keeps that field uncommitted until the stream provides enough evidence that the value is complete.

The core distinction is simple:

> **Parse completion is not execution authority.**

See [`docs/REAL_WORLD_FAILURES.md`](docs/REAL_WORLD_FAILURES.md) for independently reproduced examples and [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md) for the decision model.

## Decisions

Every observed tool call ends in one of three actions:

- **`execute`** — arguments are complete and, when configured, validator/schema checks pass.
- **`retry`** — no trustworthy complete value exists yet.
- **`reject`** — the stream contains malformed, conflicting, invalid, or terminally unsafe evidence.

The full reason matrix lives in [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md).

## Resource handling

The coordinator retains the first diagnostic for each rejected-push category:
normalized-event budget exhaustion, input after stream end, and conflicting
terminal reason. Repeating an already-rejected push does not keep appending
that category to its diagnostic history or observation queue. Draining the
queue does not erase the retained evidence or restore execution authority.
This bounds those three categories, not total application memory or network
traffic; existing parser/input limits and caller-owned cancellation still apply.

## Scope and non-goals

The library covers streamed argument evidence, call identity, lifecycle completion, truncation detection, conflicting evidence, validation composition, and one-shot execution decisions.

It does **not** provide:

- application authorization,
- human approval workflows,
- sandboxing,
- prompt-injection defense,
- distributed exactly-once semantics,
- a guarantee that the model selected the correct tool.

An `execute` decision means the tool arguments were observed as complete under the configured boundary. Your application still owns permissions, policy, validation, and the side effect itself.

See [`docs/PRODUCT_POSITIONING.md`](docs/PRODUCT_POSITIONING.md) and [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) for the detailed boundary.

## Vercel AI SDK integration

For `streamText()`, the recommended pattern is:

1. wrap tool definitions with `createAiSdkExecutionLock()`,
2. consume `fullStream`,
3. feed stream parts into `createAiSdkExecutionGuard()`, and
4. dispatch manually only from `takeDecision()`.

`generateText()` returns a non-streaming result, not `fullStream`, so this
raw-stream guard recipe does not apply to it. The lock can remove callbacks
from tools supplied to either function, but that alone does not provide the
raw argument evidence this guard requires. Do not synthesize stream deltas
from `generateText()`'s parsed tool-call results to claim raw-stream integrity.

`createAiSdkExecutionLock()` removes SDK-invoked callbacks that could execute application code before the guard reaches a final decision. A tool definition that bypasses that lock and performs side effects directly is outside the protection boundary.

The adapter targets the public AI SDK `fullStream` surface, not the lower-level `@ai-sdk/provider` `doStream()` boundary.

Detailed lifecycle behavior and version-specific tests are documented in [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md).

## Provider adapters

Low-level adapters are included for:

- OpenAI legacy `function_call`,
- OpenAI Responses API,
- Anthropic,
- Gemini,
- OpenRouter,
- generic OpenAI-compatible endpoints,
- Vercel AI SDK.

```typescript
import {
  createToolCallExecutionGate,
  OpenAIStreamAdapter,
} from "prefix-safe-json";

const adapter = new OpenAIStreamAdapter();
const gate = createToolCallExecutionGate();

for (const rawChunk of stream) {
  for (const event of adapter.push(rawChunk)) {
    gate.push(event);
  }
}

for (const event of adapter.finish({ reason: "complete" })) {
  gate.push(event);
}

const { decisions } = gate.finish();
```

Gemini exposes structured argument projections at this seam rather than raw argument text, so its adapter does not grant the same strict raw-text execution authority. Provider-specific semantics are documented in [`docs/EXECUTION_GATE.md`](docs/EXECUTION_GATE.md).

## Validation

Validation is optional and validator-agnostic. You can use JSON Schema/Ajv, Standard Schema-compatible validators, Zod, TypeBox, Valibot, or a custom validator.

`schemas` takes plain JSON Schema documents (TypeBox schemas count). Zod and other Standard Schema libraries go through `validators` with `fromStandardSchema()` from `prefix-safe-json/standard-schema`. Handing `schemas` a Zod schema or an AI SDK `jsonSchema()` wrapper throws at construction instead of silently validating nothing.

```typescript
const gate = createToolCallExecutionGate(undefined, undefined, undefined, {
  write_file: {
    validate: (value) =>
      WriteFileSchema.safeParse(value).success
        ? { valid: true }
        : { valid: false },
  },
});
```

See [`docs/VALIDATION.md`](docs/VALIDATION.md).

## Conformance corpus

[`conformance/`](conformance/) contains a provider-neutral fixture format and deterministic runner for this problem class. Projects can use the fixtures without adopting this package as their runtime implementation.

See [`docs/CONFORMANCE.md`](docs/CONFORMANCE.md).

## Compatibility

- ESM only. CommonJS code can `require()` it on Node 20.19+ / 22.12+ (Node's `require(esm)`); older runtimes need `import()`.
- Runtime: Node `>=18.0.0`.
- Repository development/release tooling uses newer Node versions.
- CI exercises pinned Vercel AI SDK v5, v6, and v7 integration paths.

| AI SDK major | CI integration check |
| --- | --- |
| v5 | yes |
| v6 | yes |
| v7 | yes |

This is not a claim that every patch release inside each major is tested. Exact pins and provider notes live in [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md).

## Low-level parser API

```typescript
import { createParser } from "prefix-safe-json";

const parser = createParser();
parser.push('{"tool":"calc",');
parser.push('"args":{"x":42}}');

console.log(parser.snapshot().stableValue);

const result = parser.finish({ reason: "complete" });
console.log(result.executable);
```



## Development

Implemented components include the incremental UTF-8 decoder, lexical/grammar state tracking, semantic events, duplicate-key rejection, configurable resource limits, provider adapters, concurrent call coordination, validation hooks, and execution-gate APIs.

Not currently provided: a standalone CLI or network/SSE client.

Runnable examples:

- [`examples/anthropic-truncation-safety.mjs`](examples/anthropic-truncation-safety.mjs)
- [`examples/ai-sdk-execution-gate.mjs`](examples/ai-sdk-execution-gate.mjs)
- [`examples/ai-sdk-lifecycle-proof.mjs`](examples/ai-sdk-lifecycle-proof.mjs)

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the development workflow.

## Release verification

Published packages use npm provenance from this repository's GitHub Actions release workflow. A release tarball can also be rebuilt and compared with its tag using:

```bash
npm run verify:published-release -- <version>
```

Additional release and dependency documentation is available in:

- [`docs/MAINTAINER_AUDIT.md`](docs/MAINTAINER_AUDIT.md)
- [`docs/RELEASE_INTEGRITY.md`](docs/RELEASE_INTEGRITY.md)
- [`docs/RUNTIME_DEPENDENCIES.md`](docs/RUNTIME_DEPENDENCIES.md)

## License

Licensed under either of:

- MIT License ([LICENSE-MIT](LICENSE-MIT))
- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))

at your option.
