import type { ToolInputValidator, ToolValidationResult } from "./types.js";

/**
 * @internal
 * Minimal structural shape of the Standard Schema spec
 * (https://standardschema.dev) this adapter duck-types against. Not a
 * dependency on `@standard-schema/spec` - just its documented `~standard`
 * property shape, which Zod 4+, Valibot, ArkType, and others already
 * implement without any package of ours needing to know that.
 */
interface StandardSchemaLike {
  readonly "~standard": {
    readonly validate: (value: unknown) => StandardSchemaResult | Promise<StandardSchemaResult>;
  };
}

interface StandardSchemaResult {
  readonly value?: unknown;
  readonly issues?: ReadonlyArray<{ readonly message: string; readonly path?: ReadonlyArray<unknown> }>;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === "object" && value !== null && typeof (value as { then?: unknown }).then === "function";
}

function formatIssue(issue: StandardSchemaResult["issues"] extends ReadonlyArray<infer I> | undefined ? I : never): string {
  const path = issue.path?.length ? issue.path.map(String).join(".") : "<root>";
  return `${path} ${issue.message}`.trim();
}

/**
 * @public (Stable)
 * Wraps any Standard Schema (https://standardschema.dev)-compliant
 * validator - Zod 4+, Valibot, ArkType, and others already implement this
 * without any adapter of their own - as a {@link ToolInputValidator}. Adds
 * no dependency on `@standard-schema/spec` or any specific validator
 * library; it only reads the `~standard.validate` property the spec itself
 * defines.
 *
 * Only synchronous Standard Schema validators are supported here, matching
 * this package's synchronous, deterministic validation contract - see
 * `docs/VALIDATION.md#standard-schema`. An async validator throws a clear
 * error rather than silently stalling or being awaited implicitly.
 */
export function fromStandardSchema(schema: StandardSchemaLike): ToolInputValidator {
  return {
    validate(value: unknown): ToolValidationResult {
      const result = schema["~standard"].validate(value);
      if (isThenable(result)) {
        throw new Error(
          "prefix-safe-json: fromStandardSchema() only supports synchronous Standard Schema validators. " +
            "This schema's validate() returned a Promise - implement ToolInputValidator directly if you " +
            "need async validation, and resolve it before the call reaches this coordinator.",
        );
      }
      if (!result.issues || result.issues.length === 0) return { valid: true };
      return { valid: false, errors: result.issues.map(formatIssue) };
    },
  };
}
