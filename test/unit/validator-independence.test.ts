import { describe, it, expect } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import type { ToolInputValidator } from "../../src/validation/types.js";
import { createAjvValidator } from "../../src/ajv.js";
import { fromStandardSchema } from "../../src/standard-schema.js";

const WRITE_FILE_SCHEMA = {
  type: "object",
  properties: { path: { type: "string" }, content: { type: "string" } },
  required: ["path", "content"],
  additionalProperties: false,
};

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

describe("Explicit schemas/validators split - no structural discrimination", () => {
  it("schemas only: raw JSON Schema entries work exactly as before 0.5.0's hardening pass", () => {
    const coord = createToolCallStreamCoordinator(undefined, undefined, { write_file: WRITE_FILE_SCHEMA });
    expect(runToolCall(coord, "write_file", '{"path":"a.txt","content":"hi"}')?.schemaValid).toBe(true);
    expect(runToolCall(createToolCallStreamCoordinator(undefined, undefined, { write_file: WRITE_FILE_SCHEMA }), "write_file", '{"path":"a.txt"}')?.schemaValid).toBe(false);
  });

  it("validators only: a ToolInputValidator registered via the validators option, with no schemas at all", () => {
    const validator: ToolInputValidator = { validate: (v) => (typeof (v as { path?: unknown }).path === "string" ? { valid: true } : { valid: false }) };
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    expect(runToolCall(coord, "write_file", '{"path":"a.txt"}')?.schemaValid).toBe(true);
  });

  it("neither schemas nor validators: fully backward compatible, no validation performed", () => {
    const coord = createToolCallStreamCoordinator();
    const call = runToolCall(coord, "write_file", '{"path":"a.txt","content":"hello"}');
    expect(call?.schemaValid).toBeUndefined();
    expect(call?.parser.executable).toBe(true);
  });

  it("different tools split across schemas and validators in the same construction", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    const coord = createToolCallStreamCoordinator(
      undefined,
      undefined,
      { tool_b: { type: "object", properties: { x: { type: "string" } }, required: ["x"] } },
      { tool_a: validator },
    );
    expect(runToolCall(coord, "tool_a", "{}")?.schemaValid).toBe(true);
    expect(runToolCall(createToolCallStreamCoordinator(undefined, undefined, { tool_b: { type: "object", properties: { x: { type: "string" } }, required: ["x"] } }, { tool_a: validator }), "tool_b", '{"x":1}')?.schemaValid).toBe(false);
  });

  it("the same tool name in both schemas and validators fails loudly and deterministically at construction, not silently resolved by precedence", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    expect(() =>
      createToolCallStreamCoordinator(undefined, undefined, { write_file: WRITE_FILE_SCHEMA }, { write_file: validator }),
    ).toThrow(/registered in both "schemas" and "validators"/);
  });

  it("invalid validator configuration (a malformed schemas entry) still fails fast at construction, not mid-stream", () => {
    expect(() =>
      createToolCallStreamCoordinator(undefined, undefined, { bad_tool: { type: "not-a-real-json-schema-type" } }),
    ).toThrow();
  });

  it("valid=false from a custom validator marks the call not executable and reports the validator's own error strings", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: false, errors: ["custom: nope", "custom: also nope"] }) };
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    const call = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    expect(call?.schemaValid).toBe(false);
    expect(call?.parser.executable).toBe(true); // structurally complete - schema/validator failure is a separate, independent concern
    const diag = coord.snapshot().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag).toBeDefined();
    expect(diag?.message ?? "").toContain("custom: nope");
    expect(diag?.message ?? "").toContain("custom: also nope");
  });

  it("valid=true from a custom validator marks the call executable", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    const call = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    expect(call?.schemaValid).toBe(true);
    expect(call?.parser.executable).toBe(true);
  });

  it("a validator that throws fails that one call closed, without crashing the whole stream", () => {
    const validator: ToolInputValidator = {
      validate: () => {
        throw new Error("boom: this validator is broken");
      },
    };
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    let call: ReturnType<typeof runToolCall> | undefined;
    expect(() => {
      call = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    }).not.toThrow();
    expect(call?.schemaValid).toBe(false);
    const diag = coord.snapshot().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag?.message ?? "").toContain("threw instead of returning a result");
    expect(diag?.message ?? "").toContain("boom: this validator is broken");
  });

  it("a null/non-object schemas entry still fails fast at construction (typeof null === \"object\" guarded correctly)", () => {
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { bad_tool: null as never })).toThrow();
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { bad_tool: "not a schema" as never })).toThrow();
  });
});

describe("prefix-safe-json/ajv", () => {
  it("createAjvValidator() compiles a schema once, reusable across coordinators", () => {
    const validator = createAjvValidator({ type: "object", required: ["x"], properties: { x: { type: "number" } } });
    const first = createToolCallStreamCoordinator(undefined, undefined, undefined, { t: validator });
    expect(runToolCall(first, "t", '{"x":1}')?.schemaValid).toBe(true);
    const second = createToolCallStreamCoordinator(undefined, undefined, undefined, { t: validator });
    expect(runToolCall(second, "t", "{}")?.schemaValid).toBe(false);
  });

  it("createAjvValidator() throws synchronously on a malformed schema", () => {
    expect(() => createAjvValidator({ type: "not-a-real-type" })).toThrow();
  });
});

describe("prefix-safe-json/standard-schema", () => {
  function fakeStandardSchema(check: (value: unknown) => boolean) {
    return {
      "~standard": {
        validate: (value: unknown) =>
          check(value) ? { value } : { issues: [{ message: "failed the fake check", path: ["path"] }] },
      },
    };
  }

  it("adapts a synchronous Standard Schema-shaped validator's success case", () => {
    const validator = fromStandardSchema(fakeStandardSchema((v) => typeof (v as { path?: unknown }).path === "string"));
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    expect(runToolCall(coord, "write_file", '{"path":"a.txt"}')?.schemaValid).toBe(true);
  });

  it("adapts a synchronous Standard Schema-shaped validator's failure case, formatting issues as strings", () => {
    const validator = fromStandardSchema(fakeStandardSchema(() => false));
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    runToolCall(coord, "write_file", "{}");
    const diag = coord.snapshot().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag?.message ?? "").toContain("path failed the fake check");
  });

  it("an async Standard Schema validator fails loudly and closed: the adapter throws, the coordinator catches it as valid:false rather than crashing", () => {
    const asyncSchema = { "~standard": { validate: async () => ({ value: {} }) } };
    const validator = fromStandardSchema(asyncSchema);
    expect(() => validator.validate({})).toThrow(/synchronous/);

    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    const call = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    expect(call?.schemaValid).toBe(false);
  });
});
