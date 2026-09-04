import { describe, it, expect } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import type { ToolInputValidator } from "../../src/validation/types.js";
import { createAjvValidator } from "../../src/ajv.js";
import { fromStandardSchema } from "../../src/standard-schema.js";

function runToolCall(
  coord: ReturnType<typeof createToolCallStreamCoordinator>,
  name: string,
  argsJson: string,
) {
  const ref = { sourceKey: "call-0" };
  coord.push({ type: "tool_call_start", callRef: ref, name, provider: "openai" } as unknown as NormalizedToolStreamEvent);
  coord.push({
    type: "tool_call_arguments_delta",
    callRef: ref,
    delta: argsJson,
    provider: "openai",
  } as unknown as NormalizedToolStreamEvent);
  coord.push({ type: "tool_call_end", callRef: ref, reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);
  coord.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);
  return coord.snapshot().calls[0];
}

describe("Validator independence: ToolInputValidator", () => {
  it("accepts a hand-written ToolInputValidator directly, with no JSON Schema involved", () => {
    const validator: ToolInputValidator = {
      validate(value) {
        const v = value as { path?: unknown };
        return typeof v.path === "string" ? { valid: true } : { valid: false, errors: ["path must be a string"] };
      },
    };
    const coord = createToolCallStreamCoordinator(undefined, undefined, { write_file: validator });

    const ok = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    expect(ok?.schemaValid).toBe(true);
  });

  it("reports a custom validator's own error strings verbatim on failure", () => {
    const validator: ToolInputValidator = {
      validate: () => ({ valid: false, errors: ["custom: nope", "custom: also nope"] }),
    };
    const coord = createToolCallStreamCoordinator(undefined, undefined, { write_file: validator });

    runToolCall(coord, "write_file", '{"path":"a.txt"}');
    const diag = coord.snapshot().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag?.message).toContain("custom: nope");
    expect(diag?.message).toContain("custom: also nope");
  });

  it("a caller-owned validator can appear alongside a raw JSON Schema entry in the same registration map", () => {
    const validateFn: ToolInputValidator = { validate: () => ({ valid: true }) };
    const schemas = {
      tool_a: validateFn,
      tool_b: { type: "object", properties: { x: { type: "string" } }, required: ["x"] },
    };

    expect(runToolCall(createToolCallStreamCoordinator(undefined, undefined, schemas), "tool_a", "{}")?.schemaValid).toBe(true);
    expect(
      runToolCall(createToolCallStreamCoordinator(undefined, undefined, schemas), "tool_b", '{"x":1}')?.schemaValid,
    ).toBe(false);
  });

  it("a null toolSchemas entry is treated as a (malformed) schema, not misread as a validator", () => {
    // TypeScript's own `object` type already excludes null, so a well-typed
    // caller cannot hit this - the runtime guard is for JS callers or code
    // that bypasses the type system. typeof null === "object" is JS's
    // well-known quirk; the entry-detection guard's explicit `!== null`
    // check exists specifically so this falls through to schema compilation
    // instead of being mistaken for a ToolInputValidator (which would then
    // throw a much more confusing "validate is not a function" error at
    // call time instead of failing fast, here, at registration).
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { bad_tool: null as never })).toThrow();
  });

  it("a non-object toolSchemas entry (neither a validator nor a schema) still fails fast, not silently", () => {
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { bad_tool: "not a schema" as never })).toThrow();
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { bad_tool: 42 as never })).toThrow();
  });
});

describe("Validator independence: prefix-safe-json/ajv", () => {
  it("createAjvValidator() compiles a schema once, reusable across coordinators", () => {
    const validator = createAjvValidator({ type: "object", required: ["x"] });

    const first = createToolCallStreamCoordinator(undefined, undefined, { t: validator });
    const second = createToolCallStreamCoordinator(undefined, undefined, { t: validator });

    expect(runToolCall(first, "t", '{"x":1}')?.schemaValid).toBe(true);
    expect(runToolCall(second, "t", "{}")?.schemaValid).toBe(false);
  });

  it("createAjvValidator() throws synchronously on a malformed schema", () => {
    expect(() => createAjvValidator({ type: "not-a-real-type" })).toThrow();
  });
});

describe("Validator independence: prefix-safe-json/standard-schema", () => {
  function fakeStandardSchema(check: (value: unknown) => boolean) {
    return {
      "~standard": {
        validate: (value: unknown) =>
          check(value)
            ? { value }
            : { issues: [{ message: "failed the fake check", path: ["path"] }] },
      },
    };
  }

  it("adapts a synchronous Standard Schema-shaped validator's success case", () => {
    const validator = fromStandardSchema(fakeStandardSchema((v) => typeof (v as { path?: unknown }).path === "string"));
    const coord = createToolCallStreamCoordinator(undefined, undefined, { write_file: validator });

    expect(runToolCall(coord, "write_file", '{"path":"a.txt"}')?.schemaValid).toBe(true);
  });

  it("adapts a synchronous Standard Schema-shaped validator's failure case, formatting issues as strings", () => {
    const validator = fromStandardSchema(fakeStandardSchema(() => false));
    const coord = createToolCallStreamCoordinator(undefined, undefined, { write_file: validator });

    runToolCall(coord, "write_file", "{}");
    const diag = coord.snapshot().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag?.message).toContain("path failed the fake check");
  });

  it("throws a clear error for an async Standard Schema validator rather than silently mishandling it", () => {
    const asyncSchema = { "~standard": { validate: async () => ({ value: {} }) } };
    const validator = fromStandardSchema(asyncSchema);
    expect(() => validator.validate({})).toThrow(/synchronous/);
  });
});
