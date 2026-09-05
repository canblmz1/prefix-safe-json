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

  it("a schema/validator collision is reported deterministically even when the colliding schema is ALSO malformed", () => {
    // Collision detection must run before any schema is compiled - otherwise
    // whichever check happens to run first (schema compilation vs. collision
    // detection) decides which error surfaces, for reasons unrelated to
    // which problem is actually more fundamental.
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    expect(() =>
      createToolCallStreamCoordinator(undefined, undefined, { write_file: { type: "not-a-real-json-schema-type" } }, { write_file: validator }),
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

  describe("malformed validators[toolName] registrations are rejected at construction (never silently equivalent to 'no validator')", () => {
    // Runtime-shaped bad values a plain-JS caller (or an `as` cast) can hand
    // in - TypeScript's ToolInputValidator type does not stop any of these
    // at compile time for such a caller.
    const badValues: Array<[string, unknown]> = [
      ["null", null],
      ["undefined", undefined],
      ["false", false],
      ["0", 0],
      ["empty string", ""],
      ["empty object", {}],
      ["{ validate: null }", { validate: null }],
      ["{ validate: 1 }", { validate: 1 }],
    ];

    for (const [label, badValue] of badValues) {
      it(`rejects ${label} at construction`, () => {
        expect(() =>
          createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: badValue as ToolInputValidator }),
        ).toThrow(/is not a valid ToolInputValidator/);
      });
    }

    it("critical invariant: a null validator cannot reach execution by being skipped as falsy - construction fails before any call is ever pushed", () => {
      // The failure mode this guards against: coordinator.ts's internal
      // `if (validator) { ... }` truthiness check would otherwise treat a
      // registered `null` exactly like "no validator was ever registered"
      // for this tool - schemaValid stays undefined, and executable's
      // `schemaValid !== false` check lets the call through with zero
      // diagnostic. Proven here by construction itself throwing, so there
      // is no coordinator instance left to push a call into at all.
      let coordinatorConstructed = false;
      expect(() => {
        const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: null as unknown as ToolInputValidator });
        coordinatorConstructed = true;
        void coord;
      }).toThrow(/is not a valid ToolInputValidator/);
      expect(coordinatorConstructed).toBe(false);
    });
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

  it("PRE-0.5 COMPATIBILITY: schemas registered together in one `schemas` object can still $ref each other via a shared $id registry", () => {
    // Regression test against pre-0.5 behavior (one shared Ajv instance per
    // coordinator construction, verified directly against the pre-0.5
    // source): 0.5.0's per-schema createAjvValidator() call broke this - two
    // schemas compiled through two SEPARATE Ajv instances cannot resolve a
    // $ref between them ("can't resolve reference address from id #").
    // buildValidatorMap's schemas path must compile every entry in the SAME
    // `schemas` object through one shared instance to restore it.
    const addressSchema = { $id: "address", type: "object", required: ["city"], properties: { city: { type: "string" } } };
    const personSchema = { type: "object", required: ["home"], properties: { home: { $ref: "address" } } };
    const coord = createToolCallStreamCoordinator(undefined, undefined, { address: addressSchema, person: personSchema });
    expect(runToolCall(coord, "person", '{"home":{"city":"x"}}')?.schemaValid).toBe(true);
    expect(runToolCall(createToolCallStreamCoordinator(undefined, undefined, { address: addressSchema, person: personSchema }), "person", '{"home":{}}')?.schemaValid).toBe(false);
  });

  it("createAjvValidator() called standalone, once per schema, does NOT share a $ref registry (documented, narrower scope than the shared `schemas` path)", () => {
    const addressSchema = { $id: "address-standalone", type: "object", required: ["city"], properties: { city: { type: "string" } } };
    const personSchema = { type: "object", required: ["home"], properties: { home: { $ref: "address-standalone" } } };
    createAjvValidator(addressSchema);
    expect(() => createAjvValidator(personSchema)).toThrow(/resolve/);
  });
});

describe("prefix-safe-json/standard-schema", () => {
  function fakeStandardSchema(check: (value: unknown) => boolean) {
    return {
      "~standard": {
        version: 1 as const,
        vendor: "test-vendor",
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

  describe("construction-time v1 shape validation (fromStandardSchema itself)", () => {
    it("version === 1 is accepted", () => {
      expect(() => fromStandardSchema({ "~standard": { version: 1, vendor: "v", validate: () => ({ value: 1 }) } })).not.toThrow();
    });

    it("version !== 1 is a construction error", () => {
      expect(() =>
        fromStandardSchema({ "~standard": { version: 2, vendor: "v", validate: () => ({ value: 1 }) } } as never),
      ).toThrow(/only supports Standard Schema v1/);
    });

    it("missing version is a construction error", () => {
      expect(() =>
        fromStandardSchema({ "~standard": { vendor: "v", validate: () => ({ value: 1 }) } } as never),
      ).toThrow(/only supports Standard Schema v1/);
    });

    it("missing vendor is a construction error", () => {
      expect(() =>
        fromStandardSchema({ "~standard": { version: 1, validate: () => ({ value: 1 }) } } as never),
      ).toThrow(/vendor to be a string/);
    });

    it("non-string vendor is a construction error", () => {
      expect(() =>
        fromStandardSchema({ "~standard": { version: 1, vendor: 42, validate: () => ({ value: 1 }) } } as never),
      ).toThrow(/vendor to be a string/);
    });

    it("missing validate is a construction error", () => {
      expect(() => fromStandardSchema({ "~standard": { version: 1, vendor: "v" } } as never)).toThrow(
        /validate to be a function/,
      );
    });

    it("non-function validate is a construction error", () => {
      expect(() =>
        fromStandardSchema({ "~standard": { version: 1, vendor: "v", validate: "nope" } } as never),
      ).toThrow(/validate to be a function/);
    });

    it("a non-object schema (e.g. a bare validate function with no ~standard) is a construction error", () => {
      expect(() => fromStandardSchema((() => {}) as never)).toThrow(/requires an object with a "~standard" property/);
    });

    it("a schema with no ~standard property at all is a construction error", () => {
      expect(() => fromStandardSchema({} as never)).toThrow(/requires an object with a "~standard" property/);
    });
  });

  describe("v1 result semantics (validate() return value)", () => {
    function schemaReturning(validate: (value: unknown) => unknown) {
      return { "~standard": { version: 1 as const, vendor: "test-vendor", validate } };
    }

    it("{ value: x } is valid", () => {
      const validator = fromStandardSchema(schemaReturning(() => ({ value: "x" })));
      expect(validator.validate({})).toEqual({ valid: true });
    });

    it("{ value: x, issues: undefined } is valid", () => {
      const validator = fromStandardSchema(schemaReturning(() => ({ value: "x", issues: undefined })));
      expect(validator.validate({})).toEqual({ valid: true });
    });

    it("{ issues: [issue] } is invalid", () => {
      const validator = fromStandardSchema(schemaReturning(() => ({ issues: [{ message: "bad" }] })));
      expect(validator.validate({})).toEqual({ valid: false, errors: ["<root> bad"] });
    });

    it("{ issues: [] } is INVALID, never valid - an empty issues array is still a present FailureResult, not success", () => {
      const validator = fromStandardSchema(schemaReturning(() => ({ issues: [] })));
      expect(validator.validate({})).toEqual({ valid: false, errors: [] });
    });

    it("{} (neither value nor issues) is malformed and fails closed, not treated as success", () => {
      const validator = fromStandardSchema(schemaReturning(() => ({})));
      expect(() => validator.validate({})).toThrow(/neither "value" nor "issues"/);
    });

    it("a null result is malformed and fails closed", () => {
      const validator = fromStandardSchema(schemaReturning(() => null));
      expect(() => validator.validate({})).toThrow(/not a\s+Standard Schema SuccessResult or FailureResult/);
    });

    it("a primitive result (string) is malformed and fails closed", () => {
      const validator = fromStandardSchema(schemaReturning(() => "not a result object"));
      expect(() => validator.validate({})).toThrow(/not a\s+Standard Schema SuccessResult or FailureResult/);
    });

    it("a primitive result (number) is malformed and fails closed", () => {
      const validator = fromStandardSchema(schemaReturning(() => 42));
      expect(() => validator.validate({})).toThrow(/not a\s+Standard Schema SuccessResult or FailureResult/);
    });

    it("a non-array `issues` field is malformed and fails closed", () => {
      const validator = fromStandardSchema(schemaReturning(() => ({ issues: "not an array" })));
      expect(() => validator.validate({})).toThrow(/non-array `issues`/);
    });

    it("an empty issues array is treated the same way through the full coordinator, not just the raw adapter", () => {
      const validator = fromStandardSchema(schemaReturning(() => ({ issues: [] })));
      const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
      expect(runToolCall(coord, "write_file", '{"path":"a.txt"}')?.schemaValid).toBe(false);
    });
  });

  it("does not substitute the Standard Schema result's (possibly transformed/coerced) value into the coordinator's own parsed arguments", () => {
    // fromStandardSchema()'s job is validation evidence only - a schema that
    // reports success with a completely different `value` than what was
    // passed in must not cause that different value to appear anywhere in
    // the coordinator's own stableValue for the call.
    const validator = fromStandardSchema({
      "~standard": {
        version: 1,
        vendor: "test-vendor",
        validate: () => ({ value: { path: "SUBSTITUTED-NOT-REAL", content: "SUBSTITUTED-NOT-REAL" } }),
      },
    });
    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    const call = runToolCall(coord, "write_file", '{"path":"a.txt","content":"hi"}');
    expect(call?.schemaValid).toBe(true);
    expect(call?.parser.stableValue).toEqual({ path: "a.txt", content: "hi" });
  });

  it("an issue path using bare PropertyKey segments (string/number) formats normally", () => {
    const validator = fromStandardSchema({
      "~standard": {
        version: 1,
        vendor: "test-vendor",
        validate: () => ({ issues: [{ message: "nested failure", path: ["a", 0, "b"] }] }),
      },
    });
    expect(validator.validate({})).toEqual({ valid: false, errors: ["a.0.b nested failure"] });
  });

  it("an issue path using official PathSegment objects ({ key }) formats the key, not \"[object Object]\"", () => {
    const validator = fromStandardSchema({
      "~standard": {
        version: 1,
        vendor: "test-vendor",
        validate: () => ({ issues: [{ message: "nested failure", path: [{ key: "a" }, { key: "b" }] }] }),
      },
    });
    expect(validator.validate({})).toEqual({ valid: false, errors: ["a.b nested failure"] });
  });

  it("a mixed path of bare PropertyKey and { key } segments formats correctly", () => {
    const validator = fromStandardSchema({
      "~standard": {
        version: 1,
        vendor: "test-vendor",
        validate: () => ({ issues: [{ message: "nested failure", path: ["a", { key: "b" }, 0] }] }),
      },
    });
    expect(validator.validate({})).toEqual({ valid: false, errors: ["a.b.0 nested failure"] });
  });

  it("an empty issues array (present, but zero-length) is treated as failure now, matching the official v1 contract (not success as an earlier draft of this adapter had it)", () => {
    const validator = fromStandardSchema({ "~standard": { version: 1, vendor: "test-vendor", validate: (value: unknown) => ({ value, issues: [] }) } });
    expect(validator.validate({ path: "a.txt" })).toEqual({ valid: false, errors: [] });
  });

  it("an issue with no path formats as \"<root> <message>\" instead of crashing (path is documented as optional)", () => {
    const validator = fromStandardSchema({
      "~standard": { version: 1, vendor: "test-vendor", validate: () => ({ issues: [{ message: "whole value is invalid" }] }) },
    });
    expect(validator.validate({})).toEqual({ valid: false, errors: ["<root> whole value is invalid"] });
  });

  it("a multi-segment issue path is joined with \".\", not concatenated bare", () => {
    const validator = fromStandardSchema({
      "~standard": { version: 1, vendor: "test-vendor", validate: () => ({ issues: [{ message: "nested failure", path: ["a", "b"] }] }) },
    });
    expect(validator.validate({})).toEqual({ valid: false, errors: ["a.b nested failure"] });
  });

  it("an async Standard Schema validator fails loudly and closed: the adapter throws, the coordinator catches it as valid:false rather than crashing", () => {
    const asyncSchema = { "~standard": { version: 1 as const, vendor: "test-vendor", validate: async () => ({ value: {} }) } };
    const validator = fromStandardSchema(asyncSchema);
    expect(() => validator.validate({})).toThrow(/synchronous/);

    const coord = createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: validator });
    const call = runToolCall(coord, "write_file", '{"path":"a.txt"}');
    expect(call?.schemaValid).toBe(false);
  });
});
