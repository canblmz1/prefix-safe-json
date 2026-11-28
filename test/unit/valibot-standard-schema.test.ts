import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createTypedAiSdkExecutionGuard, fromStandardSchema } from "../../src/standard-schema.js";
import type { ToolInputSchemas } from "../../src/standard-schema.js";
import { expectDefined } from "../utils/expect-defined.js";

const messageSchema = v.object({ message: v.string() });

function finishCall<Schema extends ToolInputSchemas[string]>(inputSchema: Schema, raw: string) {
  const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { send_message: inputSchema } });
  guard.push({ type: "tool-input-start", id: "original-call-id", toolName: "send_message" });
  guard.push({ type: "tool-input-delta", id: "original-call-id", delta: raw });
  guard.push({ type: "tool-input-end", id: "original-call-id" });
  guard.push({ type: "finish", finishReason: "tool-calls" });
  return { guard, final: guard.finish() };
}

describe("Valibot Standard Schema values", () => {
  it("accepts the real Valibot 1.5.0 object schema and validates both outcomes", () => {
    expect(typeof messageSchema).toBe("object");
    expect(messageSchema["~standard"]).toMatchObject({ version: 1, vendor: "valibot" });
    const validator = fromStandardSchema(messageSchema);
    const input = { message: "original" };
    expect(validator.validate(input)).toEqual({ valid: true });
    expect(input).toEqual({ message: "original" });
    const invalid = validator.validate({ message: 123 });
    expect(invalid.valid).toBe(false);
    if (invalid.valid) throw new Error("Expected invalid Valibot input");
    expect(invalid.errors).toEqual([expect.stringContaining("message")]);
  });

  it("preserves raw Valibot input and consumes typed authority once", () => {
    const { guard, final } = finishCall(messageSchema, '{"message":"original"}');
    const decision = expectDefined(final.decisions[0]);
    expect(decision).toMatchObject({ action: "execute", executable: true });
    const authority = guard.takeDecision(decision.internalId);
    expect(authority?.value).toEqual({ message: "original" });
    if (!authority) throw new Error("Expected typed Valibot authority");
    expectTypeOf(authority.value.message).toEqualTypeOf<string>();
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("does not grant typed authority for invalid Valibot input", () => {
    const { guard, final } = finishCall(messageSchema, '{"message":123}');
    const decision = expectDefined(final.decisions[0]);
    expect(decision).toMatchObject({ executable: false, reason: "schema_invalid" });
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("keeps Valibot transforms as evidence only and refuses changed output in the typed guard", () => {
    const transform = v.pipe(
      messageSchema,
      v.transform((value) => ({ message: value.message.toUpperCase() })),
    );
    const input = { message: "original" };
    expect(fromStandardSchema(transform).validate(input)).toEqual({ valid: true });
    expect(input).toEqual({ message: "original" });
    const { guard, final } = finishCall(transform, '{"message":"original"}');
    const decision = expectDefined(final.decisions[0]);
    expect(decision).toMatchObject({ executable: false, reason: "schema_invalid", stableValue: input });
    expect(final.diagnostics.some((d) => d.message.includes("preserve the raw JSON"))).toBe(true);
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });
});
