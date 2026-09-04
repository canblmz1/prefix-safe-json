import { createRequire } from "node:module";
import type { ToolInputValidator, ToolValidationResult } from "./types.js";

// `ajv` is loaded lazily, synchronously, and only from inside
// `createAjvValidator()` below - never at this module's top level - so that
// importing this file (or anything that re-exports from it, including the
// package's own execution-authority core) never touches `ajv` unless a
// caller actually registers a raw JSON Schema value. `createRequire` gives
// a working synchronous `require` even though this package is ESM
// (`"type": "module"`); Ajv itself ships a CJS-compatible build, so this
// resolves the same real package `npm install ajv` puts on disk.
//
// This keeps schema compilation synchronous and eager - a malformed schema
// still fails fast at construction time, not mid-stream - while removing
// `ajv` from this package's own module-evaluation graph for every caller
// who never registers a raw JSON Schema.
let ajvRequire: NodeRequire | undefined;

function requireAjv(): typeof import("ajv") {
  ajvRequire ??= createRequire(import.meta.url);
  try {
    return ajvRequire("ajv") as typeof import("ajv");
  } catch (error) {
    throw new Error(
      'prefix-safe-json: a raw JSON Schema value was registered but "ajv" could not be loaded. ' +
        'Install it ("npm install ajv"), or register a ToolInputValidator directly instead of a ' +
        "JSON Schema object - see docs/VALIDATION.md.",
      { cause: error },
    );
  }
}

/**
 * @public (Stable)
 * Compiles a JSON Schema (draft-07) into a {@link ToolInputValidator} using
 * `ajv`. This is the same adapter the coordinator's backwards-compatible
 * `toolSchemas` parameter uses internally for any entry that is a raw
 * schema object rather than a `ToolInputValidator` - calling it directly is
 * only useful if you want an explicit, discoverable Ajv entry point, e.g.
 * to reuse one compiled validator across multiple coordinators.
 *
 * `ajv` remains an ordinary runtime dependency of this package (not an
 * optional peer) for 0.5.x, specifically so this call never fails for an
 * existing caller who already had it working - see
 * `docs/VALIDATION.md#why-ajv-is-still-a-hard-dependency`.
 *
 * Throws synchronously if `schema` fails to compile (malformed JSON
 * Schema), matching the coordinator's existing fail-fast-at-construction
 * guarantee.
 */
export function createAjvValidator(schema: object): ToolInputValidator {
  const { Ajv } = requireAjv();
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);
  return {
    validate(value: unknown): ToolValidationResult {
      if (validateFn(value) === true) return { valid: true };
      const errors = (validateFn.errors ?? []).map((e) => `${e.instancePath || "<root>"} ${e.message ?? ""}`.trim());
      return { valid: false, errors };
    },
  };
}
