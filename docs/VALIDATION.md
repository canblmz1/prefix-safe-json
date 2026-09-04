# Validation architecture

This document explains the validator-independent design introduced in
0.5.0: what `ToolInputValidator` is, why `ajv` is isolated rather than
removed, and how to plug in Zod, TypeBox, Valibot, a Standard Schema
validator, or a hand-written check instead.

## The boundary

`createToolCallStreamCoordinator()`, `createToolCallExecutionGate()`, and
every high-level guard accept an optional third argument/`schemas` option:
a map of tool name to a **`ToolInputValidator`** — or, for backwards
compatibility, a raw JSON Schema (draft-07) object.

```ts
export type ToolValidationResult =
  | { valid: true }
  | { valid: false; errors?: readonly string[] };

export interface ToolInputValidator {
  validate(value: unknown): ToolValidationResult;
}
```

This is the *entire* interface the execution-authority core depends on. It
is not `ajv`'s type, not Zod's, not TypeBox's — implement it against
whichever validator your project already uses.

A validator verdict is one more piece of evidence, never authority on its
own: `valid: false` can make a decision `reject`; `valid: true` never by
itself makes a decision `execute` — completeness and lifecycle evidence
still have to hold too. See [`docs/EXECUTION_GATE.md`](EXECUTION_GATE.md).

Contract a `ToolInputValidator` must uphold:

- **Synchronous.** No `Promise`, no callback. If your validator is
  naturally async (a remote check, for example), resolve it yourself
  before this coordinator sees the call.
- **Deterministic and side-effect-free.** Called once per completed call,
  with that call's already-parsed `stableValue`; the result must depend
  only on that input.
- **Throws only for misconfiguration**, not for a merely-invalid value — a
  bad value returns `{ valid: false }`; a broken validator (a schema that
  doesn't compile, for example) may throw at registration time.

## Bring your own validator

```ts
import { createToolCallExecutionGate } from "prefix-safe-json";
import { z } from "zod";

const WriteFile = z.object({ path: z.string(), content: z.string() });

const gate = createToolCallExecutionGate(undefined, undefined, {
  write_file: {
    validate: (value) => {
      const result = WriteFile.safeParse(value);
      return result.success
        ? { valid: true }
        : { valid: false, errors: result.error.issues.map((i) => `${i.path.join(".")} ${i.message}`) };
    },
  },
});
```

The same shape works for TypeBox (`Value.Check`/`Value.Errors`), Valibot
(`safeParse`), or a plain hand-written function. None of this adds a
dependency on the validator library to `prefix-safe-json` itself — the
adapter closure above lives entirely in your code.

## Standard Schema

[Standard Schema](https://standardschema.dev) is a shared interface Zod
4+, Valibot, ArkType, and others already implement. `prefix-safe-json`
ships a small adapter for it that adds no dependency on
`@standard-schema/spec` or any specific library:

```ts
import { fromStandardSchema } from "prefix-safe-json/standard-schema";
import { z } from "zod"; // any Standard Schema-compliant validator works

const gate = createToolCallExecutionGate(undefined, undefined, {
  write_file: fromStandardSchema(z.object({ path: z.string(), content: z.string() })),
});
```

Only synchronous Standard Schema validators are supported — an async
`validate()` throws a clear error rather than being silently awaited or
stalling, matching the synchronous contract above.

## JSON Schema / Ajv

Passing a raw JSON Schema object (the pre-0.5 shape) still works exactly
as before — no code changes required:

```ts
const gate = createToolCallExecutionGate(undefined, undefined, {
  write_file: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
});
```

Internally this is compiled through the same adapter
`prefix-safe-json/ajv`'s `createAjvValidator()` exposes explicitly:

```ts
import { createAjvValidator } from "prefix-safe-json/ajv";

const validator = createAjvValidator(schema); // compile once, reuse across gates
```

`ajv` is loaded lazily and only from inside this one adapter — never at
this package's own module top level — so a caller who only ever registers
`ToolInputValidator` instances (or no validator at all) never causes `ajv`
to be imported at runtime, regardless of whether raw-JSON-Schema support
exists elsewhere in the codebase.

### Why `ajv` is still a hard dependency

`ajv` remains an ordinary `dependencies` entry in 0.5.x rather than an
optional peer dependency. The alternative — moving it to
`peerDependencies` with `peerDependenciesMeta.ajv.optional = true` — would
be the more architecturally "complete" answer, but it changes *install*
behavior: an existing caller who upgrades without separately installing
`ajv` would start failing at construction time instead of continuing to
work. That is a real behavioral break for existing JSON-Schema callers
even though no type or function signature changes, and this project's
`docs/COMPATIBILITY.md` versioning policy does not authorize that kind of
change outside a major version. Isolating the import gets the real
architectural benefit — the core path has zero top-level `ajv` coupling,
and bundlers that never exercise the JSON-Schema path have a real chance
of excluding it — without that install-time risk. See
[`docs/PRODUCT_POSITIONING.md`](PRODUCT_POSITIONING.md) for how this
tradeoff was scored against the alternatives.

## Compiling a schema eagerly vs. lazily

The coordinator's constructor is synchronous by design — a malformed
schema (or a validator that throws while being registered) fails at
construction time, not mid-stream, matching the parser's own fail-fast
philosophy. `resolveValidatorEntry()` (used internally) preserves this:
`ajv` is still loaded and a schema still compiled synchronously, just
lazily — the first time, not at module import time.
