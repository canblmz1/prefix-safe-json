import { describe, it, expect } from "vitest";
import { jsonSchema as jsonSchemaV5 } from "ai-v5";
import { jsonSchema as jsonSchemaV6 } from "ai-v6";
import { jsonSchema as jsonSchemaV7 } from "ai-v7";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import { fromStandardSchema } from "../../src/standard-schema.js";

const WRITE_FILE_SCHEMA = {
  type: "object" as const,
  properties: { path: { type: "string" as const }, content: { type: "string" as const } },
  required: ["path", "content"],
  additionalProperties: false,
};

const VALID_ARGS = '{"path":"a.txt","content":"hi"}';
// Wrong type, missing required field, unknown key - every constraint above is violated.
const INVALID_ARGS = '{"path":123,"extra":true}';

function decide(options: Parameters<typeof createAiSdkExecutionGuard>[0], argsJson: string) {
  const guard = createAiSdkExecutionGuard(options);
  for (const part of [
    { type: "tool-input-start", id: "call-1", toolName: "write_file" },
    { type: "tool-input-delta", id: "call-1", delta: argsJson },
    { type: "tool-input-end", id: "call-1" },
    { type: "finish", finishReason: "tool-calls" },
  ]) {
    guard.push(part);
  }
  const [decision] = guard.finish().decisions;
  return { action: decision?.action, reason: decision?.reason };
}

function standardSchema(): object {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
    },
  };
}

const WRAPPER_ERROR = /schemas\["write_file"\] is an AI SDK jsonSchema\(\)\/zodSchema\(\) wrapper/;
const STANDARD_ERROR = /schemas\["write_file"\] is a Standard Schema/;

describe("schemas entries that are not JSON Schema documents are refused at construction", () => {
  describe.each([
    ["ai@5", jsonSchemaV5],
    ["ai@6", jsonSchemaV6],
    ["ai@7", jsonSchemaV7],
  ])("AI SDK %s jsonSchema() wrapper", (_label, wrap) => {
    it("is refused instead of compiling to an accept-everything validator", () => {
      expect(() => createAiSdkExecutionGuard({ schemas: { write_file: wrap(WRITE_FILE_SCHEMA) as object } })).toThrow(
        WRAPPER_ERROR,
      );
    });

    it("the raw schema it wraps (.jsonSchema) is accepted and actually enforced", () => {
      const raw = wrap(WRITE_FILE_SCHEMA).jsonSchema as object;
      expect(decide({ schemas: { write_file: raw } }, INVALID_ARGS)).toEqual({ action: "reject", reason: "schema_invalid" });
      expect(decide({ schemas: { write_file: raw } }, VALID_ARGS)).toEqual({ action: "execute", reason: "complete" });
    });
  });

  it("the wrapper error tells the caller exactly what to register instead", () => {
    expect(() => createAiSdkExecutionGuard({ schemas: { write_file: jsonSchemaV7(WRITE_FILE_SCHEMA) as object } })).toThrow(
      'would validate nothing. Register the raw schema it wraps instead, e.g. schemas: { "write_file": wrapper.jsonSchema }.',
    );
  });

  it("a Standard Schema object is refused, pointing at validators + fromStandardSchema", () => {
    expect(() => createAiSdkExecutionGuard({ schemas: { write_file: standardSchema() } })).toThrow(STANDARD_ERROR);
    expect(() => createAiSdkExecutionGuard({ schemas: { write_file: standardSchema() } })).toThrow(
      'Register it through "validators" instead: validators: { "write_file": fromStandardSchema(schema) }, ' +
        'with fromStandardSchema imported from "prefix-safe-json/standard-schema".',
    );
  });

  it("a callable Standard Schema (ArkType's shape) is refused the same way", () => {
    const callable = Object.assign(() => true, standardSchema());
    expect(() => createAiSdkExecutionGuard({ schemas: { write_file: callable } })).toThrow(STANDARD_ERROR);
  });

  it("null and primitive entries still reach Ajv's own error, not one from the marker checks", () => {
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { write_file: null as never })).toThrow(
      "Cannot read properties of null (reading '$id')",
    );
    for (const bad of [undefined, "not a schema", 1]) {
      expect(() => createToolCallStreamCoordinator(undefined, undefined, { write_file: bad as never })).toThrow(
        "schema must be object or boolean",
      );
    }
  });

  it("an unserializable malformed validator is still named in the error (JSON.stringify fallback)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => createToolCallStreamCoordinator(undefined, undefined, undefined, { write_file: circular as never })).toThrow(
      'validators["write_file"] is not a valid ToolInputValidator - expected an object with a "validate" function, received: [object Object]',
    );
  });

  it("the same Standard Schema object is accepted through validators", () => {
    expect(() => createAiSdkExecutionGuard({ validators: { write_file: fromStandardSchema(standardSchema() as never) } })).not.toThrow();
  });

  it("the refusal applies to every construction path, not just the AI SDK guard", () => {
    const wrapper = jsonSchemaV7(WRITE_FILE_SCHEMA) as object;
    expect(() => createToolCallExecutionGate(undefined, undefined, { write_file: wrapper })).toThrow(WRAPPER_ERROR);
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { write_file: wrapper })).toThrow(WRAPPER_ERROR);
    expect(() => createToolCallStreamCoordinator(undefined, undefined, { write_file: standardSchema() })).toThrow(STANDARD_ERROR);
  });

  it("every entry is checked, not just the first one", () => {
    expect(() =>
      createAiSdkExecutionGuard({ schemas: { read_file: WRITE_FILE_SCHEMA, write_file: jsonSchemaV7(WRITE_FILE_SCHEMA) as object } }),
    ).toThrow(WRAPPER_ERROR);
  });

  it("the error names the offending tool exactly as a JSON string", () => {
    expect(() => createAiSdkExecutionGuard({ schemas: { 'odd"name': standardSchema() } })).toThrow('schemas["odd\\"name"]');
  });

  it("a schemas/validators collision is still reported as a collision, even when the schemas entry is also refusable", () => {
    expect(() =>
      createToolCallStreamCoordinator(
        undefined,
        undefined,
        { write_file: jsonSchemaV7(WRITE_FILE_SCHEMA) as object },
        { write_file: { validate: () => ({ valid: true }) } },
      ),
    ).toThrow(/registered in both "schemas" and "validators"/);
  });

  describe("real JSON Schema documents are unaffected", () => {
    it("a plain JSON Schema object is compiled and enforced exactly as before", () => {
      expect(decide({ schemas: { write_file: WRITE_FILE_SCHEMA } }, INVALID_ARGS)).toEqual({ action: "reject", reason: "schema_invalid" });
      expect(decide({ schemas: { write_file: WRITE_FILE_SCHEMA } }, VALID_ARGS)).toEqual({ action: "execute", reason: "complete" });
    });

    it("a TypeBox-style schema (JSON Schema plus symbol keys) is compiled and enforced", () => {
      const typeboxLike = { ...WRITE_FILE_SCHEMA, [Symbol.for("TypeBox.Kind")]: "Object" };
      expect(decide({ schemas: { write_file: typeboxLike } }, INVALID_ARGS)).toEqual({ action: "reject", reason: "schema_invalid" });
    });

    it("a falsy AI SDK marker does not trigger the wrapper refusal", () => {
      const notAWrapper = { ...WRITE_FILE_SCHEMA, [Symbol.for("vercel.ai.schema")]: false };
      expect(decide({ schemas: { write_file: notAWrapper } }, INVALID_ARGS)).toEqual({ action: "reject", reason: "schema_invalid" });
    });

    it.each([
      ["null", null],
      ["a number", 1],
      ["an object without validate", { version: 1 }],
      ["an object with a non-function validate", { validate: "no" }],
    ])("a ~standard property that is %s is not treated as a Standard Schema", (_label, standard) => {
      const schema = { ...WRITE_FILE_SCHEMA, "~standard": standard };
      expect(decide({ schemas: { write_file: schema } }, INVALID_ARGS)).toEqual({ action: "reject", reason: "schema_invalid" });
    });
  });
});
