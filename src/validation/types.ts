import { createAjvValidator } from "./ajv-validator.js";

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
 * @public (Experimental)
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
 * - `validate` runs synchronously and returns a result. It may throw to
 *   signal validator misconfiguration (mirroring how a malformed JSON
 *   Schema already fails fast at construction rather than mid-stream); the
 *   coordinator treats a thrown `validate()` as `valid: false` for that one
 *   call rather than letting the exception abort the whole stream - see
 *   `docs/VALIDATION.md#a-validator-that-throws`.
 * - `validate` must be deterministic and free of side effects - it is called
 *   with the call's already-parsed, already-complete `stableValue`, and its
 *   return value must depend only on that input.
 */
export interface ToolInputValidator {
  validate(value: unknown): ToolValidationResult;
}

/**
 * @internal
 * Builds the coordinator's internal per-tool validator map from the two
 * explicit, separate registration options. There is no structural/duck-type
 * discrimination anywhere in this path - `schemas` entries are always
 * compiled as JSON Schema, `validators` entries are always used as-is, and
 * a tool name present in both is a construction-time error rather than a
 * silently-resolved precedence rule. See `docs/VALIDATION.md`.
 */
export function buildValidatorMap(
  schemas: Record<string, object> | undefined,
  validators: Record<string, ToolInputValidator> | undefined,
): Map<string, ToolInputValidator> {
  const map = new Map<string, ToolInputValidator>();
  if (schemas) {
    for (const [toolName, schema] of Object.entries(schemas)) {
      map.set(toolName, createAjvValidator(schema));
    }
  }
  if (validators) {
    for (const [toolName, validator] of Object.entries(validators)) {
      if (map.has(toolName)) {
        throw new Error(
          `prefix-safe-json: tool ${JSON.stringify(toolName)} is registered in both "schemas" and ` +
            `"validators" - a tool's validation must come from exactly one source. Remove one registration.`,
        );
      }
      map.set(toolName, validator);
    }
  }
  return map;
}
