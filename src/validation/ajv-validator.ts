import { Ajv } from "ajv";
import type { ValidateFunction } from "ajv";
import type { ToolInputValidator, ToolValidationResult } from "./types.js";

function wrapAjvValidateFn(validateFn: ValidateFunction): ToolInputValidator {
  return {
    validate(value: unknown): ToolValidationResult {
      if (validateFn(value) === true) return { valid: true };
      const errors = (validateFn.errors ?? []).map((e) => `${e.instancePath || "<root>"} ${e.message ?? ""}`.trim());
      return { valid: false, errors };
    },
  };
}

/**
 * @public (Experimental)
 * Compiles a JSON Schema (draft-07) into a {@link ToolInputValidator} using
 * its own, standalone `ajv` instance - calling it directly is only useful if
 * you want an explicit, discoverable Ajv entry point, e.g. to compile one
 * validator once and reuse it across multiple coordinators/gates.
 *
 * This is a *different* internal path than the `schemas` registration
 * option uses (see {@link buildSharedAjvValidators}): each call here gets
 * its own Ajv instance, so schemas compiled through *separate*
 * `createAjvValidator()` calls cannot `$ref` each other via a shared `$id`
 * registry. If you need that, register them together via `schemas` instead
 * of calling this once per schema.
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
  return wrapAjvValidateFn(ajv.compile(schema));
}

/**
 * @internal
 * Compiles every entry in `schemas` through **one shared** Ajv instance -
 * restoring the pre-0.5 `toolSchemas` behavior, where a single
 * `createToolCallStreamCoordinator()` call's schemas could `$ref` one
 * another through a shared `$id` registry (verified directly: two schemas,
 * one with `$id`, the other `$ref`-ing it, compile and validate correctly
 * through one shared instance; the same two schemas compiled through
 * `createAjvValidator()` called once per schema throw "can't resolve
 * reference" instead, since each gets its own isolated instance).
 * `buildValidatorMap` (validation/types.ts) is the only caller - a caller
 * who wants a standalone, explicit, single-schema Ajv adapter should use
 * the public {@link createAjvValidator} above instead.
 */
export function buildSharedAjvValidators(schemas: Record<string, object>): Map<string, ToolInputValidator> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const map = new Map<string, ToolInputValidator>();
  for (const [toolName, schema] of Object.entries(schemas)) {
    map.set(toolName, wrapAjvValidateFn(ajv.compile(schema)));
  }
  return map;
}
