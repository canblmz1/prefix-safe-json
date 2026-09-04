/**
 * @public (Stable)
 * The result of validating one tool call's arguments. Structurally minimal
 * on purpose: `errors`, when present, are already-formatted human-readable
 * strings, not ecosystem-specific issue objects (Zod issues, Ajv errors,
 * TypeBox errors, ...) - each adapter is responsible for turning its own
 * validator's native error shape into readable text, so nothing downstream
 * needs to know which validation ecosystem produced a given verdict.
 */
export type ToolValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly errors?: readonly string[] };

/**
 * @public (Stable)
 * The validation boundary this package's execution-authority core depends
 * on. It is deliberately not `ajv`, `zod`, `typebox`, `valibot`, or any
 * other specific ecosystem's own type - implement this against whichever
 * validator your project already uses and pass it in; nothing in this
 * package's core needs to know it exists.
 *
 * A validator verdict is one more piece of evidence, never authority on its
 * own: `valid: false` can make a decision `reject`; `valid: true` never by
 * itself makes a decision `execute` - completeness and lifecycle evidence
 * still have to hold too. See `docs/EXECUTION_GATE.md`.
 *
 * Contract:
 * - `validate` runs synchronously and returns a result; it must not throw
 *   for a merely-invalid value (throwing is reserved for validator
 *   misconfiguration, mirroring how a malformed JSON Schema already fails
 *   fast at construction rather than mid-stream).
 * - `validate` must be deterministic and free of side effects - it is called
 *   with the call's already-parsed, already-complete `stableValue`, and its
 *   return value must depend only on that input.
 */
export interface ToolInputValidator {
  validate(value: unknown): ToolValidationResult;
}

/**
 * @public (Stable)
 * A registered per-tool validator entry: either a `ToolInputValidator`
 * directly, or a JSON Schema (draft-07) object, kept for backwards
 * compatibility with the pre-0.5 `toolSchemas` shape. A raw JSON Schema
 * value is detected structurally (it has no `validate` method) and
 * compiled internally through the same lazy Ajv adapter `createAjvValidator`
 * (from `prefix-safe-json/ajv`) uses directly - existing callers passing
 * JSON Schema objects need no code change.
 */
export type ToolValidatorEntry = ToolInputValidator | object;

function hasValidateMethod(value: unknown): value is ToolInputValidator {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { validate?: unknown }).validate === "function"
  );
}

/**
 * @internal
 * Normalizes one registered `ToolValidatorEntry` into a `ToolInputValidator`,
 * compiling a raw JSON Schema value through the lazy Ajv adapter on demand.
 * Kept out of the coordinator's own module scope so a caller who only ever
 * passes real `ToolInputValidator` instances never causes `ajv` to be
 * imported at all.
 */
export async function resolveValidatorEntryAsync(entry: ToolValidatorEntry): Promise<ToolInputValidator> {
  if (hasValidateMethod(entry)) return entry;
  const { createAjvValidator } = await import("./ajv-validator.js");
  return createAjvValidator(entry);
}

/**
 * @internal
 * Synchronous counterpart of {@link resolveValidatorEntryAsync}. The
 * coordinator compiles schemas eagerly at construction time so a malformed
 * schema fails fast rather than mid-stream, which requires a synchronous
 * path - `ajv` is loaded via a lazy, synchronous `require` (see
 * `ajv-validator.ts`, which owns the actual `createRequire` call) so this
 * still only touches `ajv` when a raw JSON Schema value is present.
 */
export function resolveValidatorEntry(entry: ToolValidatorEntry): ToolInputValidator {
  if (hasValidateMethod(entry)) return entry;
  return createAjvValidatorSync(entry);
}

// Re-exported indirection so this module never has a static/top-level
// dependency on ajv-validator.ts's own `createRequire` machinery - kept as
// a plain function import (not `import type`) because it is genuinely
// called, but the module it comes from performs no work at import time.
import { createAjvValidator as createAjvValidatorSync } from "./ajv-validator.js";
