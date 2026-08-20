import { describe, it, expect } from "vitest";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { AiSdkStreamAdapter } from "../../src/providers/ai-sdk.js";
import { expectDefined } from "../utils/expect-defined.js";

const completeWriteFileParts = [
  { type: "tool-input-start", id: "call_1", toolName: "write_file" },
  { type: "tool-input-delta", id: "call_1", delta: '{"path":"a.txt",' },
  { type: "tool-input-delta", id: "call_1", delta: '"content":"hello"}' },
  { type: "tool-input-end", id: "call_1" },
  { type: "finish", finishReason: "tool-calls" },
];

const truncatedWriteFileParts = [
  { type: "tool-input-start", id: "call_1", toolName: "write_file" },
  { type: "tool-input-delta", id: "call_1", delta: '{"path":"a.txt","content":"hel' },
  { type: "tool-input-end", id: "call_1" },
  { type: "finish", finishReason: "length" },
];

describe("createAiSdkExecutionGuard — basic API surface", () => {
  it("a genuinely complete call is reported action: execute, with value present", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of completeWriteFileParts) guard.push(part);
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    if (decision.action === "execute") {
      expect(decision.value).toEqual({ path: "a.txt", content: "hello" });
      expect(decision.name).toBe("write_file");
    }
  });

  it("a truncated call cut off by finishReason length never executes", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of truncatedWriteFileParts) guard.push(part);
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.executable).toBe(false);
    expect("value" in decision).toBe(false);
  });

  it("produces the exact same decisions as manually composing AiSdkStreamAdapter + createToolCallExecutionGate", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of truncatedWriteFileParts) guard.push(part);
    const guardResult = guard.finish();

    const adapter = new AiSdkStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const part of truncatedWriteFileParts) {
      for (const normalized of adapter.push(part)) gate.push(normalized);
    }
    const manualResult = gate.finish();

    expect(guardResult.decisions).toEqual(manualResult.decisions);
    expect(guardResult.diagnostics).toEqual(manualResult.diagnostics);
  });

  it("passes schemas through to the underlying coordinator", () => {
    const guard = createAiSdkExecutionGuard({
      schemas: {
        write_file: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content", "mode"],
        },
      },
    });
    for (const part of completeWriteFileParts) guard.push(part);
    const decision = expectDefined(guard.finish().decisions[0]);
    // "mode" was never provided - schema-valid but structurally-complete
    // arguments must reject, not execute, once a schema is registered.
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("schema_invalid");
  });

  it("passes limits through to the underlying coordinator", () => {
    const guard = createAiSdkExecutionGuard({ limits: { maxToolCalls: 1 } });
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "a" });
    guard.push({ type: "tool-input-start", id: "call_2", toolName: "b" });
    guard.push({ type: "finish", finishReason: "stop" });
    const { diagnostics } = guard.finish();
    expect(diagnostics.some((d) => d.code === "E_COORDINATOR_LIMIT_CALLS")).toBe(true);
  });

  it("snapshot() gives an in-flight view where nothing is ever action: execute before finish()", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "call_1", delta: '{"path":"a.txt","content":"hi"}' });
    guard.push({ type: "tool-input-end", id: "call_1" });
    // No "finish" part yet - stream-end reason is not yet known.
    const inFlight = guard.snapshot();
    expect(inFlight.every((d) => d.action !== "execute")).toBe(true);
  });

  it("push() after the stream's own finish part does not reopen or change the decision", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of completeWriteFileParts) guard.push(part);
    const before = guard.finish();
    // A stray extra part arriving after the stream has already reported its
    // own terminal event (e.g. a bug upstream, or a re-entrant call).
    guard.push({ type: "tool-input-delta", id: "call_1", delta: "malicious-late-data" });
    const after = guard.finish();
    expect(after.decisions).toEqual(before.decisions);
  });

  it("finish() is idempotent - calling it twice returns the same decisions", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of completeWriteFileParts) guard.push(part);
    const first = guard.finish();
    const second = guard.finish();
    expect(second.decisions).toEqual(first.decisions);
  });

  it("a stream that ends without ever emitting finish/error/abort fails closed via finish()'s meta backstop", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "call_1", delta: '{"path":"a.txt","content":"hi"}' });
    guard.push({ type: "tool-input-end", id: "call_1" });
    // fullStream iterator simply ended - no terminal part of any kind.
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.reason).toBe("stream_incomplete");
  });
});
