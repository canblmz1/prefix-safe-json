import { createAiSdkExecutionGuard } from "./ai-sdk.js";
import type { ExecutionGuardOptions, AiSdkExecutionGuard } from "./types.js";
import type { ExecuteDecision, ExecutionDecision } from "../gate/types.js";
import type { JsonValue } from "../types.js";
import { createStandardSchemaValidator, type StandardSchemaV1Like } from "../validation/standard-schema-validator.js";

/** @public (Experimental) Synchronous Standard Schema input registry. */
export type ToolInputSchemas = Record<string, StandardSchemaV1Like>;

type SchemaOutput<T> = T extends {
  readonly "~standard": { readonly types?: { readonly output: infer Output } };
} ? Output : unknown;

/**
 * @public (Experimental)
 * A discriminated union of registered tool names and their validated raw
 * inputs. Schema outputs that change the raw JSON value are refused at runtime.
 */
export type TypedExecuteDecision<TSchemas extends ToolInputSchemas> = {
  [Name in keyof TSchemas & string]: Omit<ExecuteDecision, "name" | "value"> & {
    readonly name: Name;
    readonly value: SchemaOutput<TSchemas[Name]> & JsonValue;
  };
}[keyof TSchemas & string];

/** @public (Experimental) Typed authority consumption; snapshots remain observations. */
export type TypedAiSdkExecutionGuard<TSchemas extends ToolInputSchemas> = Omit<AiSdkExecutionGuard, "takeDecision"> & {
  takeDecision(internalId: string): TypedExecuteDecision<TSchemas> | undefined;
};

/** @public (Experimental) Only registered, unchanged schema inputs can execute. */
export interface TypedAiSdkExecutionGuardOptions<TSchemas extends ToolInputSchemas>
  extends Omit<ExecutionGuardOptions, "schemas" | "validators"> {
  readonly inputSchemas: TSchemas;
}

/**
 * @public (Experimental)
 * Retains Standard Schema output types without substituting transformed
 * values for raw arguments. Validation is synchronous and must preserve JSON
 * structure (including keys); use strict or passthrough object schemas.
 * Unknown tool names receive no authority. Existing untyped guard behavior
 * and fromStandardSchema's validation-only semantics are unchanged.
 */
export function createTypedAiSdkExecutionGuard<const TSchemas extends ToolInputSchemas>(
  options: TypedAiSdkExecutionGuardOptions<TSchemas>,
): TypedAiSdkExecutionGuard<TSchemas> {
  // Extra properties survive structural typing and object spreads. Never
  // silently ignore a caller's additional validation policy at runtime.
  if ("schemas" in options || "validators" in options) {
    throw new Error("createTypedAiSdkExecutionGuard: use inputSchemas only; schemas and validators cannot be combined with the typed guard.");
  }
  // Snapshot the registry: later caller mutations cannot change which names
  // are allowed without changing the validators already held by the gate.
  const validators = Object.fromEntries(Object.entries(options.inputSchemas).map(
    ([name, schema]) => [name, createStandardSchemaValidator(schema, true)],
  ));
  const names = new Set(Object.keys(validators));
  const guard = createAiSdkExecutionGuard({
    validators, limits: options.limits, parserOptions: options.parserOptions,
  });
  const registered = (decision: ExecutionDecision): boolean =>
    decision.name !== undefined && names.has(decision.name);
  const observe = (decision: ExecutionDecision): ExecutionDecision => {
    if (decision.action !== "execute" || registered(decision)) return decision;
    const { value: _value, ...rest } = decision;
    return { ...rest, action: "reject", executable: false, reason: "schema_invalid" };
  };
  return {
    push: part => guard.push(part),
    snapshot: () => guard.snapshot().map(observe),
    finish(meta) {
      const final = guard.finish(meta);
      const unknown = final.decisions.filter(d => !registered(d));
      return {
        decisions: final.decisions.map(observe),
        diagnostics: [...final.diagnostics, ...unknown.map(d => ({
          code: "E_UNREGISTERED_TOOL", severity: "error" as const,
          internalId: d.internalId,
          message: "Typed guard has no input schema for this tool name.",
        }))],
      };
    },
    takeDecision(internalId) {
      const decision = guard.takeDecision(internalId);
      if (!decision || !registered(decision) || decision.evidence.schemaValid !== true) return undefined;
      // The registered validator checked the schema AND equality with raw
      // input, and the underlying gate has consumed authority exactly once.
      return decision as TypedExecuteDecision<TSchemas>;
    },
  };
}
