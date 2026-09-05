import type { ToolInputValidator, ToolValidationResult } from "./types.js";

/**
 * @internal
 * The exact Standard Schema v1 (https://standardschema.dev) `~standard`
 * surface this adapter depends on. Not a dependency on `@standard-schema/spec`
 * - just its documented shape, which Zod 4+, Valibot, ArkType, and others
 * already implement without any package of ours needing to know that.
 */
interface StandardSchemaV1Like {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => unknown;
  };
}

/** @internal A Standard Schema v1 issue's `path` entry - a bare PropertyKey, or `{ key: PropertyKey }`. */
type StandardSchemaV1PathSegment = PropertyKey | { readonly key: PropertyKey };

interface StandardSchemaV1Issue {
  readonly message: string;
  readonly path?: ReadonlyArray<StandardSchemaV1PathSegment>;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function describeForError(value: unknown): string {
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return `${typeof value} ${String(value)}`;
}

/**
 * @internal
 * `path` entries in a Standard Schema v1 issue are `ReadonlyArray<PropertyKey
 * | { key: PropertyKey }>` - either form is legitimate, and rendering the
 * object form with a bare `String()` produces `"[object Object]"` instead of
 * the actual key.
 */
function formatPathSegment(segment: unknown): string {
  if (isRecord(segment) && "key" in segment) {
    return String((segment as { key: PropertyKey }).key);
  }
  return String(segment);
}

function formatIssue(issue: StandardSchemaV1Issue): string {
  const path = issue.path && issue.path.length > 0 ? issue.path.map(formatPathSegment).join(".") : "<root>";
  return `${path} ${issue.message}`.trim();
}

/**
 * @internal
 * Validates that `schema` satisfies the Standard Schema v1 `~standard`
 * surface this adapter actually depends on - `version === 1`, `vendor` a
 * string, `validate` a function. Runtime-checked, not just TypeScript-typed:
 * a plain-JavaScript caller (or a `.d.ts`-less dependency, or an `as`-cast)
 * can hand `fromStandardSchema()` anything, and guessing at an unsupported
 * or malformed shape - then failing confusingly later, mid-stream - is worse
 * than refusing it here, synchronously, with a clear, specific reason.
 */
function assertStandardSchemaV1(schema: unknown): asserts schema is StandardSchemaV1Like {
  if (!isRecord(schema) || !("~standard" in schema)) {
    throw new Error(
      'prefix-safe-json: fromStandardSchema() requires an object with a "~standard" property ' +
        "(the Standard Schema v1 interface - see https://standardschema.dev). Received: " +
        describeForError(schema),
    );
  }
  const standard = (schema as { "~standard": unknown })["~standard"];
  if (!isRecord(standard)) {
    throw new Error(
      'prefix-safe-json: fromStandardSchema() requires schema["~standard"] to be an object. Received: ' +
        describeForError(standard),
    );
  }
  if (standard.version !== 1) {
    throw new Error(
      'prefix-safe-json: fromStandardSchema() only supports Standard Schema v1 (schema["~standard"].version ' +
        `=== 1). Received version: ${describeForError(standard.version)}.`,
    );
  }
  if (typeof standard.vendor !== "string") {
    throw new Error(
      'prefix-safe-json: fromStandardSchema() requires schema["~standard"].vendor to be a string. Received: ' +
        describeForError(standard.vendor),
    );
  }
  if (typeof standard.validate !== "function") {
    throw new Error(
      'prefix-safe-json: fromStandardSchema() requires schema["~standard"].validate to be a function. ' +
        `Received: ${describeForError(standard.validate)}`,
    );
  }
}

/**
 * @public (Experimental)
 * Wraps a Standard Schema (https://standardschema.dev) v1-compliant
 * validator - Zod 4+, Valibot, ArkType, and others already implement this
 * without any adapter of their own - as a {@link ToolInputValidator}. Adds
 * no dependency on `@standard-schema/spec` or any specific validator
 * library; it only reads the `~standard` property the spec itself defines,
 * and validates that surface at construction time (`version === 1`,
 * `vendor` a string, `validate` a function) rather than trusting an
 * arbitrary object - see `docs/VALIDATION.md#standard-schema`.
 *
 * Only synchronous Standard Schema validators are supported here, matching
 * this package's synchronous, deterministic validation contract. An async
 * validator throws a clear error rather than silently stalling or being
 * awaited implicitly.
 *
 * **Validation evidence only - not a transformation pipeline.** A Standard
 * Schema validator's `SuccessResult.value` may be transformed, coerced, or
 * defaulted relative to the input. This adapter never substitutes that
 * `value` into the tool call's arguments that actually execute - only
 * `valid`/`issues` is read from the result. See
 * `docs/VALIDATION.md#the-standard-schema-transformation-boundary`.
 */
export function fromStandardSchema(schema: StandardSchemaV1Like): ToolInputValidator {
  assertStandardSchemaV1(schema);
  const standard = schema["~standard"];
  return {
    validate(value: unknown): ToolValidationResult {
      const result: unknown = standard.validate(value);
      if (isThenable(result)) {
        throw new Error(
          "prefix-safe-json: fromStandardSchema() only supports synchronous Standard Schema validators. " +
            "This schema's validate() returned a Promise - implement ToolInputValidator directly if you " +
            "need async validation, and resolve it before the call reaches this coordinator.",
        );
      }
      // The Standard Schema v1 contract: SuccessResult = { value, issues?:
      // undefined }; FailureResult = { issues: ReadonlyArray<Issue> }. Both
      // fields are checked explicitly rather than assumed from the
      // (compile-time-only) declared return type - a real vendor's
      // validate() is trusted no further than any other external input.
      // `issues === undefined` is checked FIRST: a present `issues` (any
      // array, including empty) always means failure, even if `value` also
      // happens to be present on the same object.
      if (!isRecord(result)) {
        throw new Error(
          "prefix-safe-json: fromStandardSchema()'s wrapped validator returned a result that is not a " +
            `Standard Schema SuccessResult or FailureResult object. Received: ${describeForError(result)}`,
        );
      }
      if (result.issues !== undefined) {
        if (!Array.isArray(result.issues)) {
          throw new Error(
            "prefix-safe-json: fromStandardSchema()'s wrapped validator returned a non-array `issues` " +
              `field, which is not a valid Standard Schema FailureResult. Received: ${describeForError(result.issues)}`,
          );
        }
        return { valid: false, errors: (result.issues as StandardSchemaV1Issue[]).map(formatIssue) };
      }
      if (!("value" in result)) {
        throw new Error(
          "prefix-safe-json: fromStandardSchema()'s wrapped validator returned an object with neither " +
            '"value" nor "issues" - not a valid Standard Schema SuccessResult or FailureResult. Received: ' +
            describeForError(result),
        );
      }
      return { valid: true };
    },
  };
}
