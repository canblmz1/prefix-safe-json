# prefix-safe-json

[![npm version](https://img.shields.io/npm/v/prefix-safe-json.svg)](https://www.npmjs.com/package/prefix-safe-json)
[![CI](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml/badge.svg)](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

Check original streamed arguments and terminal evidence **before your application
runs a tool**. `prefix-safe-json` refuses authority for incomplete input,
conflicting call identity, invalid schemas, or unsafe termination, even when a
parsed tool-call object looks usable.

Your application consumes a decision once and performs the side effect itself.
PSJ never executes tools. Provider signals must accurately describe completion;
see the [provider-honesty limit](examples/openai-consumer/README.md).

```bash
pnpm add prefix-safe-json ai zod
# or: npm install prefix-safe-json ai zod
```

Try a runnable comparison first: [download the six-SDK trial ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.5.4/prefix-safe-json-0.5.4-trials.zip),
extract it, then run `node scripts/try-npm-demo.mjs tanstack` with Node 22+.
It uses published packages, authored streams and harmless counters; no API key
or repository build is needed. [Choose another SDK](examples/README.md).

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

const writeFileSchema = z.object({ path: z.string(), content: z.string() });

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
    await writeFile(authority.value.path, authority.value.content);
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

## When this adds value

Use PSJ when your application owns tool dispatch and needs original-stream
evidence to govern it. If your SDK already blocks unsafe termination, first
check whether that existing behavior meets your need. PSJ does not provide
UI recovery, automatic continuation, or domain validation such as XML
completeness. The [external fit audit](docs/EXTERNAL_FIT_AUDIT.md) records
both useful integrations and cases where no additional benefit was shown.

For a concrete difference beyond unsafe termination, the
[identity comparison](docs/IDENTITY_TRIAL.md) feeds complete, schema-valid
calls through real `streamText()`: native execution records both calls when
they reuse an ID; the locked PSJ path refuses that ambiguous identity. With
distinct IDs, both paths record both calls. These are authored fixtures,
not live-provider or WorkflowAgent certification. The existing launcher
includes this comparison, or run `npm run identity` in the installed consumer.

## Replay an incident and keep it as a regression test

Have a recorded Anthropic or AI SDK tool stream? The experimental
[local replay workflow](docs/REPLAY.md) explains each call's execution decision
and compares it with reviewed expectations in CI. It runs from a repository
checkout without model requests or tool dispatch.

## Run a standalone npm demo

To try it without cloning this repository, download the
[six-SDK trial ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.5.4/prefix-safe-json-0.5.4-trials.zip)
and extract it. With Node 22+ and npm, run this from the extracted directory:

```bash
node scripts/try-npm-demo.mjs tanstack
```

Choose `ai-sdk`, `openai`, `anthropic`, `langchain`, `openrouter` or `tanstack`.
Every example installs published PSJ `0.5.4`; no API key or repository build
is needed. The ZIP contains example sources, the launcher and licenses;
dependencies are downloaded from npm. See the [trial index](examples/README.md)
for the SDK versions and checks. The earlier dated downloads remain unchanged.

With Node 22+ and npm, you can run the published-package demo from this checkout
without installing the repository's development dependencies:

```bash
node scripts/try-npm-demo.mjs
```

The launcher creates a separate temporary npm project and leaves it available
for editing. To connect the guard to your own stream and share a result, follow
the [integration trial guide](docs/TRY_IN_YOUR_PROJECT.md).

Copy [`examples/npm-consumer/`](examples/npm-consumer/) into an empty directory
outside this checkout, then run these commands there with **Node 22+**:

```bash
npm install --engine-strict --no-audit --no-fund
npm ls prefix-safe-json ai zod
npm start
```

The current checkout pins `prefix-safe-json@0.5.4`, `ai@7.0.77`, and `zod@4.4.3`.
It needs no repository build, workspace aliases, or API key. It drives real
`streamText().fullStream` using the SDK's official `MockLanguageModelV4` and
imports the installed package's public entry point and `standard-schema`
subpath. Its only side effect is a harmless in-memory counter: complete input
executes once; truncated and schema-invalid input execute zero times. A
complete, schema-valid call that ends at the token limit also executes zero
times: parse success cannot override unsafe termination. A
projection-mismatch case executes the raw `authority.value`, never the SDK
projection. Every attached SDK callback stays at zero, and a second
`takeDecision()` returns `undefined`.

This is a deterministic mock-provider check, not a live-provider call or
independent adoption evidence. CI runs the same demo against a freshly packed
candidate tarball in a separate, isolated npm consumer directory.

The launcher also runs `npm run batch`: two interleaved calls execute twice
after complete termination, while a token-limited step with one complete call
and one truncated call executes neither. Both cases keep SDK callbacks at
zero. The installed-consumer check also passes with `ai@7.0.137`, matching the
version in [the parallel-call truncation report](https://github.com/vercel/ai/issues/22914).
It does not implement UI state changes or continuation after a truncated step.

The launcher then runs `npm run identity`, including an unlocked native
control with harmless SDK-executed counters. Expected native / PSJ effects
are **2 / 2** for distinct IDs and **2 / 0** for duplicate IDs. The PSJ path
keeps every SDK callback at zero and uses one-shot caller dispatch. CI checks
all three examples with `ai@7.0.77`, `7.0.128`, `7.0.137` and `7.0.140`.
See the [identity trial](docs/IDENTITY_TRIAL.md) for the original-event
boundary and the distinction from WorkflowAgent's result-pairing report.

Using LangChain? The [standalone SDK comparison](examples/langchain-consumer/README.md)
feeds the same original OpenAI-compatible fixture to `ChatOpenAI.stream()` and
PSJ, checking that token-limit calls produce zero effects. It is a mock-transport
comparison; your application still needs access to original provider evidence.

Using the official Anthropic SDK? Run `node scripts/try-npm-demo.mjs anthropic`
for the [installed-package terminal-boundary trial](examples/anthropic-consumer/README.md).
It checks complete, token-limited, missing-`message_stop`, and post-terminal
argument cases through the SDK's actual SSE parser. The LangChain comparison
can also be launched with `node scripts/try-npm-demo.mjs langchain`.

Using the official OpenAI SDK? Run `node scripts/try-npm-demo.mjs openai` for
the [installed-package Chat Completions trial](examples/openai-consumer/README.md).
It checks complete and interrupted calls, duplicate IDs and late argument
evidence through `openai@7.34.0`. It also demonstrates a limit: PSJ cannot detect
upstream truncation when the provider supplies complete JSON and falsely
reports successful termination. These are mock-transport checks, not live
OpenAI or vLLM certification.

Using OpenRouter Agent? Run `node scripts/try-npm-demo.mjs openrouter` for the
[manual dispatch and continuation trial](examples/openrouter-consumer/README.md).
It checks that accepted tool results reach the next model request with matching
call IDs, while invalid batches cause zero effects and no continuation request.
It uses authored SSE through the installed SDK; no live model call is made.

Using TanStack AI with OpenRouter? Run `node scripts/try-npm-demo.mjs tanstack`
for the [installed-package comparison](examples/tanstack-consumer/README.md).
It checks raw native finish reasons, usage trailers and paired results using
published PSJ `0.5.4`, harmless counters and authored SSE. The
[native-first standalone trial](https://gist.github.com/canblmz1/ba1e62d792da37d3f420c328f56d81be)
also offers a PSJ-free baseline and an optional comparison from npm or source.

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

## Product experiment: Devam

[Devam](https://github.com/canblmz1/devam-prototype) is a separate browser prototype for
carrying the current request, completion claims, manual reviews and unfinished
work between AI conversations. It includes examples for everyday users,
people coding with AI, and AI application developers.
[Try the live prototype](https://canblmz1.github.io/devam-prototype/).
Development continues in its own repository; it is not part of the PSJ npm
package and does not currently depend on PSJ. The original experiment remains
here as a tested snapshot. Run that snapshot without dependencies or API keys:

```bash
node experiments/devam/server.mjs
```

Open `http://127.0.0.1:4317`. The prototype is experimental; its
[research notes](experiments/devam/RESEARCH.md) distinguish reported pain,
existing alternatives and unvalidated product demand.

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
