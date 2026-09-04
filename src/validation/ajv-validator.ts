import { Ajv } from "ajv";
import type { ToolInputValidator, ToolValidationResult } from "./types.js";

/**
 * @public (Experimental)
 * Compiles a JSON Schema (draft-07) into a {@link ToolInputValidator} using
 * `ajv`. This is the same adapter the `schemas` registration option uses
 * internally - calling it directly is only useful if you want an explicit,
 * discoverable Ajv entry point, e.g. to compile one validator once and
 * reuse it across multiple coordinators/gates.
 *
 * `ajv` is imported statically here and remains an ordinary runtime
 * dependency of this package for 0.5.x - see
 * `docs/VALIDATION.md#ajv-loading` for why deferring that import bought
 * little real value against real portability risk, and is not done here.
 * The `validators` registration option (`ToolInputValidator`) has no
 * dependency on this module or on `ajv` at all.
 *
 * Throws synchronously if `schema` fails to compile (malformed JSON
 * Schema), matching the coordinator's existing fail-fast-at-construction
 * guarantee.
 */
export function createAjvValidator(schema: object): ToolInputValidator {
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
