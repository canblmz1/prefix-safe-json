// ---------------------------------------------------------------------------
// prefix-safe-json/ajv — explicit Ajv adapter entry point.
//
// `ajv` is a hard runtime dependency of the core execution-authority path
// (`.`) today, not an optional or lazy one: `coordinator.ts` statically
// imports `buildValidatorMap` from `./validation/types.js`, which statically
// imports `createAjvValidator` from `./ajv-validator.js`, which statically
// imports `ajv` itself - so merely importing the package root loads `ajv`
// into memory, whether or not a caller ever registers a `schemas` entry.
// See docs/VALIDATION.md's "Ajv loading" section for why this static-import
// shape was deliberately kept over a lazy-load alternative.
//
// Importing from here instead of the root is only useful if you want an
// explicit, discoverable Ajv entry point - e.g. to compile one validator up
// front and reuse it across multiple coordinators/gates. See
// docs/VALIDATION.md.
// ---------------------------------------------------------------------------

export { createAjvValidator } from "./validation/ajv-validator.js";
