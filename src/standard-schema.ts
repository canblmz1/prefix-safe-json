// ---------------------------------------------------------------------------
// prefix-safe-json/standard-schema — Standard Schema adapter entry point.
//
// Wraps any Standard Schema (https://standardschema.dev)-compliant
// validator - Zod 4+, Valibot, ArkType, and others already implement this -
// as a ToolInputValidator. No dependency on @standard-schema/spec or any
// specific validator library: this only reads the `~standard.validate`
// property the spec itself defines. See docs/VALIDATION.md.
// ---------------------------------------------------------------------------

export { fromStandardSchema } from "./validation/standard-schema-validator.js";
