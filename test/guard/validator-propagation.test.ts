// The `validators` registration option must not exist only on the
// low-level coordinator - this file proves it actually reaches the
// preferred high-level boundaries (createToolCallExecutionGate,
// createAiSdkExecutionGuard) that most callers use instead of the
// coordinator directly.
import { describe, it, expect } from "vitest";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import type { ToolInputValidator } from "../../src/validation/types.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import type { ExecutionDecision } from "../../src/gate/types.js";
import { expectDefined } from "../utils/expect-defined.js";

function pushCleanCall(gate: ReturnType<typeof createToolCallExecutionGate>, toolName: string, argsJson: string) {
  const ref = { sourceKey: "s" };
  gate.push({ type: "tool_call_start", callRef: ref, name: toolName, provider: "openai" } as unknown as NormalizedToolStreamEvent);
  gate.push({ type: "tool_call_arguments_delta", callRef: ref, delta: argsJson, provider: "openai" } as unknown as NormalizedToolStreamEvent);
  gate.push({ type: "tool_call_end", callRef: ref, reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);
  gate.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);
}

const completeWriteFileParts = [
  { type: "tool-input-start", id: "call_1", toolName: "write_file" },
  { type: "tool-input-delta", id: "call_1", delta: '{"path":"a.txt","content":"hello"}' },
  { type: "tool-input-end", id: "call_1" },
  { type: "finish", finishReason: "tool-calls" },
];

describe("createToolCallExecutionGate + validators (4th positional argument)", () => {
  it("valid=true from a custom validator lets an otherwise-authorized call execute", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    const gate = createToolCallExecutionGate(undefined, undefined, undefined, { write_file: validator });
    pushCleanCall(gate, "write_file", '{"path":"a.txt","content":"hi"}');
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    if (decision.action === "execute") expect(decision.value).toEqual({ path: "a.txt", content: "hi" });
  });

  it("valid=false from a custom validator rejects with reason schema_invalid", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: false, errors: ["nope"] }) };
    const gate = createToolCallExecutionGate(undefined, undefined, undefined, { write_file: validator });
    pushCleanCall(gate, "write_file", '{"path":"a.txt","content":"hi"}');
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("schema_invalid");
  });

  it("a throwing validator fails that call closed instead of crashing gate.finish()", () => {
    const validator: ToolInputValidator = {
      validate: () => {
        throw new Error("boom");
      },
    };
    const gate = createToolCallExecutionGate(undefined, undefined, undefined, { write_file: validator });
    pushCleanCall(gate, "write_file", '{"path":"a.txt","content":"hi"}');
    let decision: ExecutionDecision | undefined;
    expect(() => {
      decision = gate.finish().decisions[0];
    }).not.toThrow();
    expect(decision?.action).not.toBe("execute");
    expect(decision?.reason).toBe("schema_invalid");
  });

  it("a malformed validator registration is a construction error at the gate, same as at the coordinator", () => {
    expect(() =>
      createToolCallExecutionGate(undefined, undefined, undefined, { write_file: null as unknown as ToolInputValidator }),
    ).toThrow(/is not a valid ToolInputValidator/);
  });

  it("a schema/validator same-name collision is a construction error at the gate", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    expect(() =>
      createToolCallExecutionGate(undefined, undefined, { write_file: { type: "object" } }, { write_file: validator }),
    ).toThrow(/registered in both "schemas" and "validators"/);
  });
});

describe("createAiSdkExecutionGuard + validators (ExecutionGuardOptions)", () => {
  it("valid=true from a custom validator lets an otherwise-authorized call execute", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    const guard = createAiSdkExecutionGuard({ validators: { write_file: validator } });
    for (const part of completeWriteFileParts) guard.push(part);
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    if (decision.action === "execute") expect(decision.value).toEqual({ path: "a.txt", content: "hello" });
  });

  it("valid=false from a custom validator rejects with reason schema_invalid", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: false, errors: ["custom rejection"] }) };
    const guard = createAiSdkExecutionGuard({ validators: { write_file: validator } });
    for (const part of completeWriteFileParts) guard.push(part);
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("schema_invalid");
    const diag = guard.finish().diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag?.message ?? "").toContain("custom rejection");
  });

  it("a schema/validator same-name collision is a construction error through ExecutionGuardOptions too", () => {
    const validator: ToolInputValidator = { validate: () => ({ valid: true }) };
    expect(() =>
      createAiSdkExecutionGuard({ schemas: { write_file: { type: "object" } }, validators: { write_file: validator } }),
    ).toThrow(/registered in both "schemas" and "validators"/);
  });
});
