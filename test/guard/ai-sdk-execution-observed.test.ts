// ---------------------------------------------------------------------------
// Guarding against the one gap the AI SDK compatibility matrix
// (ai-sdk-compatibility.test.ts) doesn't cover: this library's own decision
// logic is only ever consulted by a caller who follows the documented
// "consume fullStream, dispatch manually after finish()" pattern. Nothing
// stopped a caller from *also* wiring a native `execute` callback on their
// AI SDK tool definition - in that misuse configuration, the SDK's own tool
// loop can invoke the real side effect before this guard ever reaches a
// decision, and the guard previously had no way to know.
//
// `tool-result` (the SDK's execute() succeeded) and `tool-error` (it threw)
// are both direct, observable proof that execution authority already left
// the caller's hands. Every test below proves the guard treats that as a
// permanent, call-scoped, un-overridable disqualification from `execute` -
// simulating the real documented dispatch loop with a counted fake side
// effect, not just inspecting `decision.action`.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import { expectDefined } from "../utils/expect-defined.js";

function toolInputParts(callId: string, toolName: string, argChunks: string[]) {
  return [
    { type: "tool-input-start", id: callId, toolName },
    ...argChunks.map((delta) => ({ type: "tool-input-delta", id: callId, delta })),
    { type: "tool-input-end", id: callId },
  ];
}

// Mirrors the documented dispatch loop verbatim (README.md / EXECUTION_GATE.md
// / examples/ai-sdk-guard.mjs) against a fake, counted tool registry - this
// is what "manual sideEffect invocation" actually means in every test below.
async function dispatch(decisions: readonly { action: string; name?: string; value?: unknown }[], tools: Record<string, ReturnType<typeof vi.fn>>) {
  for (const decision of decisions) {
    if (decision.action === "execute") {
      await tools[decision.name as string]?.(decision.value);
    }
  }
}

describe("createAiSdkExecutionGuard — SDK execution-observed (tool-result/tool-error before this guard's own decision)", () => {
  it("A: tool-result observed, otherwise-safe finish -> reject sdk_execution_observed, zero manual side effects", async () => {
    const guard = createAiSdkExecutionGuard();
    const write_file = vi.fn();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("sdk_execution_observed");

    await dispatch(decisions, { write_file });
    expect(write_file).not.toHaveBeenCalled();
  });

  it("B: tool-error observed, otherwise-safe finish -> reject sdk_execution_observed, zero manual side effects", async () => {
    const guard = createAiSdkExecutionGuard();
    const write_file = vi.fn();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "tool-error", toolCallId: "c1", toolName: "write_file", error: new Error("disk full") });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("sdk_execution_observed");

    await dispatch(decisions, { write_file });
    expect(write_file).not.toHaveBeenCalled();
  });

  it("C: tool-result observed AND finishReason length - sdk_execution_observed wins the reason (not masked by the unrelated disqualifier)", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"cut off mi'])) guard.push(part);
    guard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "length" });

    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.reason).toBe("sdk_execution_observed");
  });

  it("D: duplicate tool-result for the same call -> still never executes, decision is deterministic", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    guard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const first = guard.finish();
    const second = guard.finish();
    expect(first.decisions[0]?.action).toBe("reject");
    expect(first.decisions[0]?.reason).toBe("sdk_execution_observed");
    expect(second.decisions).toEqual(first.decisions);
  });

  it("E: tool-error then tool-result for the same call -> never executes", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "tool-error", toolCallId: "c1", toolName: "write_file", error: "boom" });
    guard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.reason).toBe("sdk_execution_observed");
  });

  it("F: two concurrent calls, only one receives SDK tool-result - it is rejected, the other is evaluated independently and executes", async () => {
    const guard = createAiSdkExecutionGuard();
    const read_file = vi.fn();
    const write_file = vi.fn();

    guard.push({ type: "tool-input-start", id: "call_a", toolName: "read_file" });
    guard.push({ type: "tool-input-start", id: "call_b", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "call_a", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-delta", id: "call_b", delta: '{"path":"b.txt","content":"hi"}' });
    guard.push({ type: "tool-input-end", id: "call_a" });
    guard.push({ type: "tool-input-end", id: "call_b" });
    // Only call_b's execute() already ran via the SDK.
    guard.push({ type: "tool-result", toolCallId: "call_b", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    expect(decisions).toHaveLength(2);
    const decisionA = expectDefined(decisions.find((d) => d.name === "read_file"));
    const decisionB = expectDefined(decisions.find((d) => d.name === "write_file"));
    expect(decisionA.action).toBe("execute");
    expect(decisionB.action).toBe("reject");
    expect(decisionB.reason).toBe("sdk_execution_observed");

    await dispatch(decisions, { read_file, write_file });
    expect(read_file).toHaveBeenCalledTimes(1);
    expect(write_file).not.toHaveBeenCalled();
  });

  it("G: the same provider call ID in two independent guard instances - evidence does not leak across guards", () => {
    const poisonedGuard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) poisonedGuard.push(part);
    poisonedGuard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    poisonedGuard.push({ type: "finish", finishReason: "tool-calls" });

    const cleanGuard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) cleanGuard.push(part);
    // No tool-result pushed to this guard at all - same call ID string, independent instance.
    cleanGuard.push({ type: "finish", finishReason: "tool-calls" });

    expect(expectDefined(poisonedGuard.finish().decisions[0]).action).toBe("reject");
    expect(expectDefined(cleanGuard.finish().decisions[0]).action).toBe("execute");
  });

  it("H: SDK execution evidence arrives after tool-input-end but before the stream's finish part - still correctly attributed", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    // tool-input-end has already fired above; finish has not yet.
    const inFlight = guard.snapshot();
    expect(inFlight[0]?.action).not.toBe("execute"); // pre-finish, nothing is ever "execute"

    guard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("sdk_execution_observed");
  });

  it("I: the ordinary manual-dispatch pattern with no SDK tool-result/tool-error is completely unaffected - execute remains possible", async () => {
    const guard = createAiSdkExecutionGuard();
    const write_file = vi.fn();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("execute");
    if (decision.action === "execute") {
      expect(decision.value).toEqual({ path: "a.txt", content: "hi" });
    }

    await dispatch(decisions, { write_file });
    expect(write_file).toHaveBeenCalledTimes(1);
    expect(write_file).toHaveBeenCalledWith({ path: "a.txt", content: "hi" });
  });

  it("J: an unattributable tool-result (no toolCallId) does not authorize or poison any specific call, but is visible in diagnostics", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    // No toolCallId on this part at all - cannot be attributed to call c1 or anything else.
    guard.push({ type: "tool-result", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions, diagnostics } = guard.finish();
    // c1's own evidence is genuinely safe and is evaluated on its own merits,
    // unaffected by an unattributable diagnostic that names no call.
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("execute");
    expect(diagnostics.some((d) => d.code === "E_SDK_EXECUTION_OBSERVED" && d.internalId === undefined)).toBe(true);
  });
});
