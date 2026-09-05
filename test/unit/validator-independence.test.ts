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
    // Exact match, not just substring containment: a weakened condition on
    // this branch (e.g. matching any non-true result rather than
    // specifically valid===false) would misroute a genuine {valid:false}
    // result into the "malformed result" branch instead - whose message
    // also happens to contain these same substrings via JSON.stringify,
    // so only pinning the full message (and its "do not match its schema"
    // prefix specifically) actually distinguishes the two branches.
    expect(diag?.message).toBe(
      'Tool call arguments for "write_file" do not match its schema: custom: nope; custom: also nope',
    );
    expect(diag?.severity).toBe("error");
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
    expect(diag?.severity).toBe("error");
  });

  it("a validator that returns a malformed result (neither {valid:true} nor {valid:false,...}) fails that one call closed", () => {
    const validator = { validate: () => undefined as never } as ToolInputValidator;
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    let call: ReturnType<typeof runToolCall> | undefined;
    expect(() => {
      call = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    }).not.toThrow();
    expect(call?.schemaValid).toBe(false);
    expect(call?.parser.executable).toBe(true); // structurally complete - the malformed *validator* result is the only reason this rejects
    const diag = coord.snapshot().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag?.message ?? "").toContain("returned a malformed result");
    expect(diag?.severity).toBe("error");
  });

  it("a validator that returns a truthy but non-conforming object (no boolean valid field) also fails closed, not routed to the valid=false branch", () => {
    // {} is truthy - unlike undefined, this specifically exercises whether
    // the valid===false check is doing real, exact work, or whether a
    // weakened check (e.g. "any truthy result not already valid===true")
    // would misroute it into the wrong branch with the wrong message.
    const validator = { validate: () => ({}) as unknown } as ToolInputValidator;
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    const call = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    expect(call?.schemaValid).toBe(false);
    const diag = coord.snapshot().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag?.message).toBe('Validator for "write_file" returned a malformed result instead of {valid: true} or {valid: false, ...}: {}');
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

  it("compiles with allErrors:true - a value violating two required fields reports both, not just the first", () => {
    const validator = createAjvValidator({
      type: "object",
      required: ["a", "b"],
      properties: { a: { type: "string" }, b: { type: "string" } },
    });
    const result = validator.validate({});
    expect(result.valid).toBe(false);
    const errors = (result as { valid: false; errors?: readonly string[] }).errors ?? [];
    expect(errors).toHaveLength(2);
  });

  it("compiles with strict:false - a schema using an unrecognized/vendor keyword compiles instead of throwing", () => {
    // Ajv's own default (strict mode) rejects this exact schema at compile
    // time with "strict mode: unknown keyword" - verified directly. This
    // pins down that createAjvValidator() deliberately opts out of strict
    // mode, not just that it happens to accept ordinary schemas.
    expect(() =>
      createAjvValidator({ type: "object", properties: { x: { type: "string" } }, "x-vendor-extension": true }),
    ).not.toThrow();
  });

  it("validate() on an invalid value returns exactly {valid:false, errors} with real Ajv message text, not a placeholder", () => {
    const validator = createAjvValidator({
      type: "object",
      required: ["x"],
      properties: { x: { type: "string" } },
      additionalProperties: false,
    });
    const typeMismatch = validator.validate({ x: 1 });
    expect(typeMismatch).toEqual({ valid: false, errors: ["/x must be string"] });

    // Ajv reports a missing required property at the object root, where
    // instancePath is "" - this is exactly the case the "<root>" fallback
    // in ajv-validator.ts exists for; asserting the literal string (not
    // just presence of *an* error) is what actually pins that fallback down.
    const missingRequired = validator.validate({});
    expect(missingRequired).toEqual({ valid: false, errors: ["<root> must have required property 'x'"] });
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

  it("an empty issues array (present, but zero-length) is treated as success, same as issues being absent entirely", () => {
    const validator = fromStandardSchema({ "~standard": { validate: (value: unknown) => ({ value, issues: [] }) } });
    expect(validator.validate({ path: "a.txt" })).toEqual({ valid: true });
  });

  it("an issue with no path formats as \"<root> <message>\" instead of crashing (path is documented as optional)", () => {
    const validator = fromStandardSchema({
      "~standard": { validate: () => ({ issues: [{ message: "whole value is invalid" }] }) },
    });
    expect(validator.validate({})).toEqual({ valid: false, errors: ["<root> whole value is invalid"] });
  });

  it("a multi-segment issue path is joined with \".\", not concatenated bare", () => {
    const validator = fromStandardSchema({
      "~standard": { validate: () => ({ issues: [{ message: "nested failure", path: ["a", "b"] }] }) },
    });
    expect(validator.validate({})).toEqual({ valid: false, errors: ["a.b nested failure"] });
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
