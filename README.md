# prefix-safe-json

[![npm version](https://img.shields.io/npm/v/prefix-safe-json.svg)](https://www.npmjs.com/package/prefix-safe-json)
[![CI](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml/badge.svg)](https://github.com/canblmz1/prefix-safe-json/actions/workflows/ci.yml)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](#license)

An incremental JSON parser and execution gate for **streamed LLM tool calls**.

`prefix-safe-json` keeps incomplete, conflicting, or unconfirmed streamed arguments from being treated as final tool input. It is designed for callers that need to distinguish:

1. JSON that can be parsed right now,
2. values that are stable enough to expose, and
3. arguments that the provider actually completed and confirmed.

It does not execute tools itself.

```bash
pnpm add prefix-safe-json ai
# or: npm install prefix-safe-json ai
```

## Safe execution example

```javascript
import { streamText } from "ai";
import {
  createAiSdkExecutionGuard,
  createAiSdkExecutionLock,
} from "prefix-safe-json";

const lockedTools = createAiSdkExecutionLock({
  write_file: {
    description: "Write a UTF-8 text file",
    inputSchema: writeFileSchema,
  },
});

const result = streamText({ model, prompt, tools: lockedTools });
const guard = createAiSdkExecutionGuard({
  schemas: { write_file: writeFileSchema },
});

for await (const part of result.fullStream) {
  guard.push(part);
}

const final = guard.finish();

for (const observed of final.decisions) {
  const authority = guard.takeDecision(observed.internalId);
  if (authority) {
    await writeFile(authority.value.path, authority.value.content);
  }
}
```

The caller owns dispatch. `prefix-safe-json` only produces and hands out a one-shot decision for the observed tool call.

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

For `streamText()` / `generateText()`, the recommended pattern is:

1. wrap tool definitions with `createAiSdkExecutionLock()`,
2. consume `fullStream`,
3. feed stream parts into `createAiSdkExecutionGuard()`, and
4. dispatch manually only from `takeDecision()`.

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

- ESM only.
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
