import { buildSharedAjvValidators } from "./ajv-validator.js";

/**
 * @public (Experimental)
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
 * Runtime shape check for a `validators[toolName]` entry. `ToolInputValidator`
 * is a TypeScript interface, not a runtime guarantee - a plain-JavaScript
 * caller (or a `as never`/`as ToolInputValidator` cast) can hand this
 * anything. An explicitly *registered* malformed validator must never be
 * silently equivalent to "no validator registered": `coordinator.ts`'s
 * `if (validator) { ... }` truthiness check would otherwise skip a `null`/
 * `undefined`/`false`/`0`/`""` entry entirely, letting the call execute
 * with zero diagnostic - the same class of fail-open gap already closed for
 * a validator that returns a malformed *result* (see
 * `docs/VALIDATION.md#a-validator-that-returns-a-malformed-result`). This
 * check exists so that gap cannot reopen one level up, at registration time.
 */
function isToolInputValidatorShaped(value: unknown): value is ToolInputValidator {
  return typeof value === "object" && value !== null && typeof (value as { validate?: unknown }).validate === "function";
}

function describeInvalidValidator(value: unknown): string {
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return `${typeof value} ${String(value)}`;
}

// Registry key the Vercel AI SDK stamps on the objects `jsonSchema()` and
// `zodSchema()` return (the same global symbol across ai@5, @6 and @7).
const AI_SDK_SCHEMA_MARKER = Symbol.for("vercel.ai.schema");

/**
 * @internal
 * Rejects two schema-library objects that are routinely mistaken for JSON
 * Schema documents. This is not structural discrimination - nothing is
 * converted or re-routed; a recognized non-JSON-Schema object is refused, and
 * everything else is still compiled as JSON Schema exactly as before.
 *
 * - An AI SDK `jsonSchema()`/`zodSchema()` wrapper keeps its schema behind a
 *   `jsonSchema` getter, and Ajv (`strict: false`) ignores every field it
 *   does not recognize, so the wrapper compiles to an accept-everything
 *   validator: every call would pass validation. That is the fail-open case
 *   this check exists for.
 * - A Standard Schema object (Zod, Valibot, ArkType, ...) either crashes Ajv
 *   with an unrelated-looking meta-schema error or, depending on its own
 *   fields, compiles to something that validates the wrong thing.
 *
 * Plain JSON Schema documents, including TypeBox schemas (plain objects that
 * only add symbol keys), carry neither marker and are unaffected.
 */
function assertJsonSchemaDocument(toolName: string, schema: unknown): void {
  // Functions too: an ArkType schema is a callable Standard Schema.
  if ((typeof schema !== "object" && typeof schema !== "function") || schema === null) return;
  const name = JSON.stringify(toolName);
  if ((schema as Record<symbol, unknown>)[AI_SDK_SCHEMA_MARKER]) {
    throw new Error(
      `prefix-safe-json: schemas[${name}] is an AI SDK jsonSchema()/zodSchema() wrapper, not a JSON Schema ` +
        `document - compiled as-is it would validate nothing. Register the raw schema it wraps instead, ` +
        `e.g. schemas: { ${name}: wrapper.jsonSchema }.`,
    );
  }
  const standard = (schema as { "~standard"?: unknown })["~standard"];
  if (typeof standard === "object" && standard !== null && typeof (standard as { validate?: unknown }).validate === "function") {
    throw new Error(
      `prefix-safe-json: schemas[${name}] is a Standard Schema (Zod, Valibot, ArkType, ...), not a JSON Schema ` +
        `document. Register it through "validators" instead: validators: { ${name}: fromStandardSchema(schema) }, ` +
        `with fromStandardSchema imported from "prefix-safe-json/standard-schema".`,
    );
  }
}

/**
 * @internal
 * Builds the coordinator's internal per-tool validator map from the two
 * explicit, separate registration options. There is no structural/duck-type
 * discrimination anywhere in this path - `schemas` entries are always
 * compiled as JSON Schema, `validators` entries are always used as-is, and
 * a tool name present in both is a construction-time error rather than a
 * silently-resolved precedence rule. See `docs/VALIDATION.md`. The one
 * exception is refusal, never re-routing: `assertJsonSchemaDocument` rejects
 * objects that are recognizably not JSON Schema before Ajv sees them.
 *
 * Collision detection runs *before* any schema is compiled, so a colliding
 * tool name is always reported as a collision - deterministically, even
 * when that same tool's `schemas` entry also happens to be malformed JSON
 * Schema (or one of the objects `assertJsonSchemaDocument` refuses).
 * Without this ordering, whichever check happened to run first would decide
 * which error the caller sees, for reasons unrelated to which problem is
 * actually more fundamental.
 */
export function buildValidatorMap(
  schemas: Record<string, object> | undefined,
  validators: Record<string, ToolInputValidator> | undefined,
): Map<string, ToolInputValidator> {
  if (schemas && validators) {
    for (const toolName of Object.keys(validators)) {
      if (Object.prototype.hasOwnProperty.call(schemas, toolName)) {
        throw new Error(
          `prefix-safe-json: tool ${JSON.stringify(toolName)} is registered in both "schemas" and ` +
            `"validators" - a tool's validation must come from exactly one source. Remove one registration.`,
        );
      }
    }
  }

  const map = new Map<string, ToolInputValidator>();
  if (schemas) {
    // Read every entry exactly once, then use that one snapshot for both the
    // refusal check and compilation. If a `schemas` value were an accessor,
    // iterating `schemas` twice (once here, once inside
    // buildSharedAjvValidators) could let a getter return a plain schema on
    // the checked pass and an AI SDK wrapper on the compiled pass, so the
    // wrapper reaches Ajv unchecked and compiles to accept-everything -
    // exactly what assertJsonSchemaDocument exists to stop.
    const schemaEntries = Object.entries(schemas);
    for (const [toolName, schema] of schemaEntries) {
      assertJsonSchemaDocument(toolName, schema);
    }
    const materializedSchemas = Object.fromEntries(schemaEntries);
    // One shared Ajv instance for every schema in THIS `schemas` object -
    // pre-0.5 behavior, restored here after 0.5's per-schema
    // createAjvValidator() calls regressed it (a schema could no longer
    // $ref another schema registered in the same construction - see
    // buildSharedAjvValidators's own doc comment for the direct proof).
    for (const [toolName, validator] of buildSharedAjvValidators(materializedSchemas)) {
      map.set(toolName, validator);
    }
  }
  if (validators) {
    for (const [toolName, validator] of Object.entries(validators)) {
      if (!isToolInputValidatorShaped(validator)) {
        throw new Error(
          `prefix-safe-json: validators[${JSON.stringify(toolName)}] is not a valid ToolInputValidator - ` +
            `expected an object with a "validate" function, received: ${describeInvalidValidator(validator)}`,
        );
      }
      map.set(toolName, validator);
    }
  }
  return map;
}
