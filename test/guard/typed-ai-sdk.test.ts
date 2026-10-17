import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { createTypedAiSdkExecutionGuard } from "../../src/standard-schema.js";
import { expectDefined } from "../utils/expect-defined.js";

const schema = z.object({ path: z.string(), content: z.string() }).strict();
function call(name = "write_file", input = '{"path":"a.txt","content":"hello"}', reason = "tool-calls") {
  return [
    { type: "tool-input-start", id: "call-1", toolName: name },
    { type: "tool-input-delta", id: "call-1", delta: input },
    { type: "tool-input-end", id: "call-1" },
    { type: "finish", finishReason: reason },
  ];
}
function run(inputSchema: typeof schema | z.ZodType, input: string, reason = "tool-calls") {
  const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { write_file: inputSchema } });
  for (const part of call("write_file", input, reason)) guard.push(part);
  const final = guard.finish();
  const id = expectDefined(final.decisions[0]).internalId;
  return { guard, final, id };
}

describe("typed raw-input guard", () => {
  it.each(["schemas", "validators"])("refuses an extra %s policy instead of silently ignoring it", key => {
    // Object spreads/variables can legally carry additional fields in TS.
    const options = { inputSchemas: { write_file: schema }, [key]: { write_file: {} } };
    expect(() => createTypedAiSdkExecutionGuard(options)).toThrow(/use inputSchemas only/);
  });

  it("infers the registered tool's input fields and consumes authority once", () => {
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { write_file: schema } });
    for (const part of call()) guard.push(part);
    expect(guard.takeDecision("call-1")).toBeUndefined();
    const final = guard.finish();
    expect(final.decisions[0]).toMatchObject({ action: "execute", executable: true, reason: "complete" });
    expect(guard.snapshot()[0]).toMatchObject({ action: "execute", executable: true, reason: "complete" });
    expect(final.diagnostics.filter(d => d.code === "E_UNREGISTERED_TOOL")).toEqual([]);
    const id = expectDefined(final.decisions[0]).internalId;
    const authority = guard.takeDecision(id);
    expect(authority?.value).toEqual({ path: "a.txt", content: "hello" });
    if (authority) {
      expectTypeOf(authority.name).toEqualTypeOf<"write_file">();
      expectTypeOf(authority.value.path).toEqualTypeOf<string>();
      expectTypeOf(authority.value.content).toEqualTypeOf<string>();
      // @ts-expect-error the schema does not declare a number-valued path
      const invalid: number = authority.value.path;
      void invalid;
    }
    expect(guard.takeDecision(id)).toBeUndefined();
  });

  it("narrows a multi-tool union by the actual tool name", () => {
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: {
      write_file: schema, count: z.object({ amount: z.number() }).strict(),
    } });
    for (const part of call("count", '{"amount":2}')) guard.push(part);
    const id = expectDefined(guard.finish().decisions[0]).internalId;
    const authority = guard.takeDecision(id);
    if (authority?.name === "count") {
      expectTypeOf(authority.value.amount).toEqualTypeOf<number>();
      expect(authority.value.amount).toBe(2);
      // @ts-expect-error count's value has no path field
      void authority.value.path;
    } else throw new Error("Expected count authority");
  });

  it.each([
    [z.coerce.number(), '"2"'],
    [z.object({ count: z.number().default(1) }), '{}'],
    [z.object({ path: z.string() }), '{"path":"a","extra":1}'],
    [z.string().transform(value => value.length), '"hello"'],
    [z.string().transform(() => new Date()), '"2026-10-17"'],
  ])("refuses transformed/defaulted/stripped input %#", (inputSchema, input) => {
    const { guard, final, id } = run(inputSchema, input);
    expect(final.decisions[0]?.reason).toBe("schema_invalid");
    expect(guard.takeDecision(id)).toBeUndefined();
    expect(final.diagnostics.some(d => d.message.includes("preserve the raw JSON"))).toBe(true);
  });

  it("accepts object key reordering and nested JSON without requiring reference identity", () => {
    const inputSchema = z.object({ a: z.number(), b: z.array(z.object({ c: z.boolean() })) }).strict();
    const { guard, id } = run(inputSchema, '{"b":[{"c":true}],"a":1}');
    expect(guard.takeDecision(id)?.value).toEqual({ b: [{ c: true }], a: 1 });
  });

  it.each(["length", "error"])("cannot authorize valid input with unsafe termination %s", reason => {
    const { guard, id } = run(schema, '{"path":"a.txt","content":"hello"}', reason);
    expect(guard.takeDecision(id)).toBeUndefined();
  });

  it("rejects unregistered tool names, including inherited object property names", () => {
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { write_file: schema } });
    for (const part of call("toString", '{}')) guard.push(part);
    const final = guard.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.executable).toBe(false);
    expect(decision.reason).toBe("schema_invalid");
    expect("value" in decision).toBe(false);
    const diagnostic = expectDefined(final.diagnostics.find(d => d.code === "E_UNREGISTERED_TOOL"));
    expect(diagnostic.severity).toBe("error");
    expect(diagnostic.internalId).toBe(decision.internalId);
    expect(diagnostic.message.trim().length).toBeGreaterThan(0);
    expect(guard.snapshot()[0]).toMatchObject({ action: "reject", executable: false, reason: "schema_invalid" });
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("preserves retry observations for a registered call cut off by the provider", () => {
    const { guard, final } = run(schema, '{"path":"a.txt","content":"hello"}', "length");
    expect(final.decisions[0]).toMatchObject({ action: "retry", executable: false, reason: "stream_incomplete" });
    expect(guard.snapshot()[0]).toMatchObject({ action: "retry", executable: false, reason: "stream_incomplete" });
    expect(final.diagnostics.filter(d => d.code === "E_UNREGISTERED_TOOL")).toEqual([]);
  });

  it("retains incomplete-stream evidence for an unknown name without granting authority", () => {
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { write_file: schema } });
    for (const part of call("other", "{}", "length")) guard.push(part);
    const final = guard.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision).toMatchObject({ action: "retry", executable: false, reason: "stream_incomplete" });
    expect(final.diagnostics.some(d => d.code === "E_UNREGISTERED_TOOL")).toBe(true);
    expect(guard.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("reports only the unknown member of a mixed tool batch as unregistered", () => {
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { write_file: schema } });
    for (const part of call().slice(0, -1)) guard.push(part);
    guard.push({ type: "tool-input-start", id: "call-2", toolName: "other" });
    guard.push({ type: "tool-input-delta", id: "call-2", delta: "{}" });
    guard.push({ type: "tool-input-end", id: "call-2" });
    guard.push({ type: "finish", finishReason: "tool-calls" });
    const final = guard.finish();
    const registered = expectDefined(final.decisions.find(d => d.name === "write_file"));
    const unknown = expectDefined(final.decisions.find(d => d.name === "other"));
    expect(registered).toMatchObject({ action: "execute", executable: true });
    expect(unknown).toMatchObject({ action: "reject", executable: false });
    const unregistered = final.diagnostics.filter(d => d.code === "E_UNREGISTERED_TOOL");
    expect(unregistered).toHaveLength(1);
    expect(unregistered[0]?.internalId).toBe(unknown.internalId);
    expect(guard.takeDecision(registered.internalId)?.name).toBe("write_file");
    expect(guard.takeDecision(unknown.internalId)).toBeUndefined();
  });

  it("does not change registration when the caller mutates the original map", () => {
    const inputSchemas: Record<string, typeof schema> = { write_file: schema };
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas });
    inputSchemas["other"] = schema;
    delete inputSchemas["write_file"];
    for (const part of call()) guard.push(part);
    expect(guard.takeDecision(expectDefined(guard.finish().decisions[0]).internalId)?.name).toBe("write_file");
  });

  it("keeps late evidence revocation even after a positive finish snapshot", () => {
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { write_file: schema } });
    for (const part of call()) guard.push(part);
    const id = expectDefined(guard.finish().decisions[0]).internalId;
    guard.push({ type: "tool-input-delta", id: "call-1", delta: "late" });
    expect(guard.takeDecision(id)).toBeUndefined();
  });

  it("rejects asynchronous and thrown validation rather than granting a typed value", () => {
    for (const inputSchema of [z.string().refine(async () => true), z.string().transform(() => { throw new Error("broken"); })]) {
      const { guard, final, id } = run(inputSchema, '"hello"');
      expect(final.decisions[0]?.reason).toBe("schema_invalid");
      expect(guard.takeDecision(id)).toBeUndefined();
    }
  });

  it("rejects mutation-based transforms while leaving the authorized raw source intact", () => {
    const inputSchema = z.object({ path: z.string() }).transform(value => { value.path = "changed"; return value; });
    const { guard, final, id } = run(inputSchema, '{"path":"original"}');
    expect(final.decisions[0]?.stableValue).toEqual({ path: "original" });
    expect(guard.takeDecision(id)).toBeUndefined();
  });

  it.each([
    ['{}', new Date()],
    ['{}', []],
    ['{"a":1}', { b: 1 }],
    ['[1]', Object.assign(new Array<unknown>(2), { 0: 1 })],
    ['{"a":1}', null],
  ])("refuses schema outputs that are not the same raw JSON structure %#", (raw, output) => {
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { write_file: {
      "~standard": { version: 1, vendor: "fixture", validate: () => ({ value: output }) },
    } } });
    for (const part of call("write_file", raw)) guard.push(part);
    const final = guard.finish();
    expect(final.decisions[0]?.reason).toBe("schema_invalid");
    expect(guard.takeDecision(expectDefined(final.decisions[0]).internalId)).toBeUndefined();
  });

  it("accepts unchanged primitive JSON and forwards explicit coordinator limits", () => {
    const guard = createTypedAiSdkExecutionGuard({
      inputSchemas: { write_file: z.number() }, limits: { maxToolCalls: 1 },
    });
    for (const part of call("write_file", "3")) guard.push(part);
    const decision = guard.takeDecision(expectDefined(guard.finish().decisions[0]).internalId);
    expect(decision?.value).toBe(3);
    if (decision) expectTypeOf(decision.value).toMatchTypeOf<number>();
  });

  it("preserves negative zero when passing a copy to the schema", () => {
    const { guard, id } = run(z.number().refine(value => Object.is(value, -0)), "-0");
    expect(Object.is(guard.takeDecision(id)?.value, -0)).toBe(true);
  });
});
