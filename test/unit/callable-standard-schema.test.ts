import { type } from "arktype";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createTypedAiSdkExecutionGuard, fromStandardSchema } from "../../src/standard-schema.js";
import type { ToolInputSchemas } from "../../src/standard-schema.js";
import { expectDefined } from "../utils/expect-defined.js";

const messageSchema = type({ message: "string" });

function finishCall<Schema extends ToolInputSchemas[string]>(inputSchema: Schema, raw: string) {
  const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { send_message: inputSchema } });
  guard.push({ type: "tool-input-start", id: "original-call-id", toolName: "send_message" });
  guard.push({ type: "tool-input-delta", id: "original-call-id", delta: raw });
  guard.push({ type: "tool-input-end", id: "original-call-id" });
  guard.push({ type: "finish", finishReason: "tool-calls" });
  return { guard, final: guard.finish() };
}

describe("callable Standard Schema values", () => {
  it("accepts the real ArkType v2.2.8 callable interface and validates both outcomes", () => {
    expect(typeof messageSchema).toBe("function");
    expect(messageSchema["~standard"]).toMatchObject({ version: 1, vendor: "arktype" });
    const validator = fromStandardSchema(messageSchema);
    const input = { message: "original" };
    expect(validator.validate(input)).toEqual({ valid: true });
    expect(input).toEqual({ message: "original" });
    const invalid = validator.validate({ message: 123 });
    expect(invalid.valid).toBe(false);
    if (invalid.valid) throw new Error("Expected invalid ArkType input");
    expect(invalid.errors).toEqual([expect.stringContaining("message")]);
  });

  it("preserves raw ArkType input and consumes typed authority once", () => {
    const { guard, final } = finishCall(messageSchema, '{"message":"original"}');
    const decision = expectDefined(final.decisions[0]);
    expect(decision).toMatchObject({ action: "execute", executable: true });
    const authority = guard.takeDecision(decision.internalId);
    expect(authority?.value).toEqual({ message: "original" });
    if (!authority) throw new Error("Expected typed ArkType authority");
    expectTypeOf(authority.value.message).toEqualTypeOf<string>();
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("does not grant typed authority for invalid ArkType input", () => {
    const { guard, final } = finishCall(messageSchema, '{"message":123}');
    const decision = expectDefined(final.decisions[0]);
    expect(decision).toMatchObject({ executable: false, reason: "schema_invalid" });
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("validates through ~standard without invoking the callable schema itself", () => {
    const schema = Object.assign(() => { throw new Error("Do not call the schema"); }, {
      "~standard": { version: 1 as const, vendor: "callable-fixture", validate: (value: unknown) => ({ value }) },
    });
    expect(fromStandardSchema(schema).validate({ message: "original" })).toEqual({ valid: true });
  });

  it("keeps ArkType morphs as evidence only and refuses changed output in the typed guard", () => {
    const morph = messageSchema.pipe(value => ({ message: value.message.toUpperCase() }));
    const input = { message: "original" };
    expect(fromStandardSchema(morph).validate(input)).toEqual({ valid: true });
    expect(input).toEqual({ message: "original" });
    const { guard, final } = finishCall(morph, '{"message":"original"}');
    const decision = expectDefined(final.decisions[0]);
    expect(decision).toMatchObject({ executable: false, reason: "schema_invalid", stableValue: input });
    expect(final.diagnostics.some(d => d.message.includes("preserve the raw JSON"))).toBe(true);
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("does not add async support for callable schemas", () => {
    const schema = Object.assign(() => undefined, {
      "~standard": { version: 1 as const, vendor: "callable-fixture", validate: async (value: unknown) => ({ value }) },
    });
    expect(() => fromStandardSchema(schema).validate({ message: "original" })).toThrow(/only supports synchronous/);
  });

  it.each([
    [null, /requires schema\["~standard"\] to be an object/],
    [() => undefined, /requires schema\["~standard"\] to be an object/],
    [{}, /only supports Standard Schema v1/],
    [{ version: 2, vendor: "fixture", validate: () => ({ value: 1 }) }, /only supports Standard Schema v1/],
    [{ version: 1, validate: () => ({ value: 1 }) }, /vendor to be a string/],
    [{ version: 1, vendor: 42, validate: () => ({ value: 1 }) }, /vendor to be a string/],
    [{ version: 1, vendor: "fixture" }, /validate to be a function/],
    [{ version: 1, vendor: "fixture", validate: "invalid" }, /validate to be a function/],
  ])("refuses a callable with malformed ~standard metadata %#", (standard, message) => {
    const schema = Object.assign(() => undefined, { "~standard": standard });
    expect(() => fromStandardSchema(schema as never)).toThrow(message);
  });
});
