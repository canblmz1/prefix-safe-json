// ---------------------------------------------------------------------------
// prefix-safe-json/ajv — explicit Ajv adapter entry point.
//
// The package's core execution-authority path (`.`) never imports `ajv` at
// module top level; a raw JSON Schema value passed to `toolSchemas`/
// `schemas` is still compiled through this exact adapter, lazily, on
// demand. Importing from here instead is only useful if you want an
// explicit, discoverable Ajv entry point - e.g. to compile one validator up
// front and reuse it across multiple coordinators/gates. See
// docs/VALIDATION.md.
// ---------------------------------------------------------------------------

export { createAjvValidator } from "./validation/ajv-validator.js";
