# Validation architecture

This document explains the validator-independent design introduced in
0.5.0: what `ToolInputValidator` is, the explicit `schemas`/`validators`
split, why `ajv` is still loaded statically, and how to plug in Zod,
TypeBox, Valibot, a Standard Schema validator, or a hand-written check.

**Status: this surface is `@public (Experimental)`, not Stable.** It is
new, unproven against real external usage, and may still change before
1.0 based on what real callers need. `docs/PRODUCT_POSITIONING.md`'s API
table has the full classification.

## The boundary: two explicit options, never one heuristic

`createToolCallStreamCoordinator()`, `createToolCallExecutionGate()`, and
every high-level guard accept **two separate** registration surfaces,
never a single ambiguous one:

```ts
createToolCallExecutionGate(
  limits?,
  parserOptions?,
  toolSchemas?: Record<string, object>,             // raw JSON Schema (draft-07) - unchanged pre-0.5 shape
  validators?: Record<string, ToolInputValidator>,   // additive, 0.5.0+
);
```

(The AI SDK guard's options object form is `{ schemas, validators, limits, parserOptions }`.)

There is **no structural discrimination** anywhere in this path - no
"does this object have a `validate` method" check decides which option a
value belongs to. A raw JSON Schema value always goes in `toolSchemas`/
`schemas`; a `ToolInputValidator` always goes in `validators`. This was a
deliberate reversal of an earlier 0.5.0 design (a single widened
`Record<string, ToolInputValidator | object>` option, discriminated by
duck-typing) that principal review rejected: JSON Schema is open-ended
enough - and a caller's own custom object shapes varied enough - that
guessing which one an arbitrary object is from a `validate` property
alone is not a safe ownership boundary.

### Collision semantics

A tool name present in **both** `toolSchemas` and `validators` is a
**construction-time error**, not a silently resolved precedence rule:

```ts
createToolCallExecutionGate(undefined, undefined,
  { write_file: schema },
  { write_file: validator },
); // throws: 'tool "write_file" is registered in both "schemas" and "validators"'
```

Each tool's validation comes from exactly one explicit source. No
validator or schema ever silently overrides the other.

## `ToolInputValidator`

```ts
export type ToolValidationResult =
  | { valid: true }
  | { valid: false; errors?: readonly string[] };

export interface ToolInputValidator {
  validate(value: unknown): ToolValidationResult;
}
```

This is the *entire* interface the execution-authority core depends on
for the `validators` option. It is not `ajv`'s type, not Zod's, not
TypeBox's — implement it against whichever validator your project
already uses.

A validator verdict is one more piece of evidence, never authority on its
own: `valid: false` can make a decision `reject`; `valid: true` never by
itself makes a decision `execute` — completeness and lifecycle evidence
still have to hold too. See [`docs/EXECUTION_GATE.md`](EXECUTION_GATE.md).

Contract:

- **Synchronous.** No `Promise`, no callback. If your validator is
  naturally async (a remote check, for example), resolve it yourself
  before this coordinator sees the call.
- **Deterministic and side-effect-free.** Called once per completed call,
  with that call's already-parsed `stableValue`; the result must depend
  only on that input.
- **May throw** to signal validator misconfiguration - see "A validator
  that throws" below for what happens when it does.

## Bring your own validator

```ts
import { createToolCallExecutionGate } from "prefix-safe-json";
import { z } from "zod";

const WriteFile = z.object({ path: z.string(), content: z.string() });

const gate = createToolCallExecutionGate(undefined, undefined, undefined, {
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

### A validator that throws

If `validate()` throws, the coordinator catches it and fails **that one
call** closed - `schemaValid: false`, a descriptive
`E_SCHEMA_VALIDATION_FAILED` diagnostic naming the thrown error - rather
than letting the exception propagate out of `push()`/`finish()` and abort
every other in-flight call in the same stream. This is deliberate: one
misconfigured or buggy validator should not take down processing for
calls it was never registered for.

### A validator that returns a malformed result

`validate()` is typed to return exactly `{valid: true}` or `{valid:
false, errors?}` - but that is a compile-time guarantee, not a runtime
one, for a validator implemented in plain JavaScript or violating its
own declared type. If `validate()` returns anything else without
throwing (`undefined`, `null`, `{}`, ...), the coordinator treats it the
same as a thrown exception: `schemaValid: false`, with an
`E_SCHEMA_VALIDATION_FAILED` diagnostic naming the actual malformed
value received. There is no silent path where an unrecognized result
shape gets treated as if no validator had run at all.

### A malformed `validators[toolName]` registration

The same fail-closed principle applies one level up, at registration:
`validators[toolName]` is checked at construction time (non-null,
an object, `validate` a function) and throws a specific, deterministic
error if it isn't - `null`, `undefined`, `false`, `0`, `""`, `{}`, and
`{ validate: <non-function> }` are all rejected. This matters because
`ToolInputValidator` is a TypeScript interface, not a runtime guarantee,
for a plain-JavaScript caller or an `as`-cast: without this check, a
registered `null` validator would be indistinguishable at runtime from
"no validator was ever registered for this tool" - the coordinator's own
internal `if (validator) { ... }` lookup is a truthiness check, and
`null` is falsy. An explicitly registered malformed validator must never
silently degrade into "this tool has no validation at all."

## Standard Schema

[Standard Schema v1](https://standardschema.dev) is a shared interface
Zod 4+, Valibot, ArkType, and others already implement. `prefix-safe-json`
ships a small adapter for it that adds no dependency on
`@standard-schema/spec` or any specific library:

```ts
import { fromStandardSchema } from "prefix-safe-json/standard-schema";
import { z } from "zod"; // any Standard Schema-compliant validator works

const gate = createToolCallExecutionGate(undefined, undefined, undefined, {
  write_file: fromStandardSchema(z.object({ path: z.string(), content: z.string() })),
});
```

**Precise compatibility claim: compatible with *synchronous* Standard
Schema v1 validators only.** This is not universal Standard Schema
compatibility - the execution gate's decision path is synchronous by
design, and Standard Schema's own `validate()` is permitted to return a
`Promise`. When it does, `fromStandardSchema()`'s own adapter throws
immediately with a clear message naming the problem, which the
coordinator then converts into the same fail-closed `valid: false`
outcome described above ("A validator that throws") - never a silently
awaited or ignored Promise, and never a hang.

### Construction-time v1 shape validation

`fromStandardSchema(schema)` checks `schema["~standard"]` at construction
time - `version === 1`, `vendor` a string, `validate` a function - and
throws synchronously and specifically if any of those don't hold, rather
than accepting an arbitrary object and failing confusingly later,
mid-stream. This is a real runtime check, not just a TypeScript type,
for the same reason every other validation boundary in this package is:
a plain-JavaScript caller (or a `.d.ts`-less dependency) can hand this
function anything.

### Result semantics (exact v1 contract, not an approximation)

Standard Schema v1 defines the result union precisely:

```ts
type SuccessResult<Output> = { value: Output; issues?: undefined };
type FailureResult = { issues: ReadonlyArray<Issue> };
```

`fromStandardSchema()`'s adapter follows this exactly, not a looser
reading of it:

- A present `issues` field (any array, **including an empty one**) is
  always a `FailureResult` - `{ issues: [] }` is **invalid**, never
  treated as success. An empty issues array is still evidence the
  validator explicitly returned a failure shape, distinct from omitting
  `issues` entirely.
- Success requires `issues` to be genuinely absent/`undefined` **and**
  a `value` key present on the result. `{}` - neither field present -
  is not success; it's a malformed result, and fails closed the same way
  a validator that returns `undefined`/`null` does (see above).
- A `null` result, a primitive result (string/number/boolean), or a
  non-array `issues` field are all malformed for the same reason and
  fail the same way - a thrown, specific error the coordinator's outer
  catch converts into `schemaValid: false`.

None of this is weakened because TypeScript's own types would normally
prevent these values at the call site that constructs the schema object
- a real Standard Schema vendor library's own `validate()` return value
is still checked at runtime here, the same as everywhere else in this
package's validation boundary.

### Issue path formatting

A Standard Schema v1 issue's `path` entries are
`ReadonlyArray<PropertyKey | { key: PropertyKey }>` - either a bare
`PropertyKey` (string/number/symbol) or the official `PathSegment` object
form. Both are formatted correctly (the object form renders its `.key`,
never a bare `String()` of the object itself, which would otherwise
produce `"[object Object]"`).

### The Standard Schema transformation boundary

`fromStandardSchema()` uses the Standard Schema result only as
**validation evidence** - `valid: true`/`valid: false`, nothing else. It
does **not** substitute Standard Schema's returned/transformed
`SuccessResult.value` into the tool-call arguments that actually reach
`takeDecision()`/execution. `prefix-safe-json` owns execution authority,
not schema transformation: a schema that coerces, defaults, or otherwise
transforms its input on success will see that transformation reflected
in its own `SuccessResult.value` - but `fromStandardSchema()` never
replaces the coordinator's original parsed `stableValue` with that
returned/transformed `SuccessResult.value`. What a caller's own code
actually receives and executes against remains the coordinator's own
parsed value, exactly as it was before validation ran. Callers whose
schemas perform coercion/defaulting/transformation must perform their
normal parsing/transformation step themselves, before the side effect,
or provide a `ToolInputValidator` directly whose acceptance semantics
match the arguments they actually execute. This adapter is not, and does
not claim to be, a replacement for a project's normal parsing/
transformation pipeline.

## JSON Schema / Ajv

Passing a raw JSON Schema object via `toolSchemas`/`schemas` works
exactly as it did before 0.5.0 — no code changes required:

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

`prefix-safe-json/ajv` is kept as an explicit, discoverable entry point
because it has real, concrete DX value on its own - compiling one
validator once and reusing it across multiple coordinators/gates, or
constructing one directly to pass through the `validators` option
alongside genuinely custom validators for other tools.

### Shared-instance compatibility for `toolSchemas`/`schemas`

Every schema in **one** `toolSchemas`/`schemas` object, on **one**
construction call, is compiled through a single shared Ajv instance -
matching pre-0.5 behavior exactly, where the coordinator held one `Ajv`
and compiled every registered schema through it. This means schemas
registered together can `$ref` one another via a shared `$id` registry
(verified directly: two schemas, one with `$id: "address"`, the other
`{"$ref": "address"}`, compile and validate correctly when registered
together).

This is a **different, narrower** internal path than calling
`createAjvValidator(schema)` once per schema yourself: each standalone
call there gets its own, separate Ajv instance (by design - see its own
doc comment), so schemas compiled through two separate
`createAjvValidator()` calls cannot `$ref` each other. If your schemas
need to reference one another, register them together via `toolSchemas`/
`schemas` rather than compiling each one individually.

### Ajv loading

`ajv` is imported **statically**, at the top of
`src/validation/ajv-validator.ts` - exactly as it was before 0.5.0's
brief detour through a `node:module`/`createRequire`-based lazy-load.
That lazy-load was reverted after principal review for a simple reason:
**`ajv` is still a hard runtime dependency in 0.5.x either way** (see
"Not zero-runtime-dependency yet" below), so deferring *when* it loads
bought no real reduction in what gets installed, while adding a real
portability risk of its own - `createRequire` in an ESM package is a
legitimate pattern, but it is one more thing that can behave differently
across bundlers, edge runtimes, and non-Node ESM hosts than a plain
static `import`. Trading a real, if narrow, portability risk for a
product claim ("lazy-loaded!") that could not honestly be sold as "zero
dependency" anyway was not a good trade. See `docs/RUNTIME_DEPENDENCIES.md`
for the exact, current install-time graph.

The `validators` path (`ToolInputValidator`, `fromStandardSchema()`) has
no dependency on `ajv-validator.ts` or `ajv` at all, conceptually or in
its own module's import graph - a caller who only ever uses `validators`
never has reason to touch that file's logic, even though `ajv` itself is
still present on disk as an ordinary installed dependency either way.

### Not zero-runtime-dependency yet

**This release is validator-*independent* architecture, not a
zero-runtime-dependency release.** `ajv` remains an ordinary
`dependencies` entry, unconditionally installed for every consumer,
exactly as before 0.5.0. Nothing about the `validators` option or the
static-import revert changes the installed dependency tree - see
`docs/RUNTIME_DEPENDENCIES.md` for exact before/after numbers (there is
no "after": the graph is unchanged). Making `ajv` a genuinely optional
peer dependency remains a real, tracked possibility for a *later*
release once there is real usage data suggesting existing JSON-Schema
callers can safely absorb that install-time change - see
`docs/V1_CRITERIA.md`.

## Compiling a schema eagerly

The coordinator's constructor is synchronous by design — a malformed
schema (or a validator that throws while being registered - not to be
confused with throwing during `validate()`, both fail closed but at
different times) fails at construction time, not mid-stream, matching the
parser's own fail-fast philosophy.

A `schemas`/`validators` name collision is checked **before** any schema
is compiled, so a colliding tool name is always reported as a collision -
deterministically, even when that same tool's `schemas` entry also
happens to be malformed JSON Schema. Compilation order does not decide
which error a caller sees for a tool with two independent problems.
