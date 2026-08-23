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
// the caller's hands. The first describe block below proves the guard
// treats *attributed* evidence (a real toolCallId) as a permanent,
// call-scoped, un-overridable disqualification from `execute`, with
// absolute priority over every other rejection reason. The second describe
// block proves *unattributable* evidence (no usable toolCallId) - where the
// guard cannot know which in-flight call the SDK actually ran - fails
// closed for the entire stream instead of guessing, including calls that
// start after the evidence arrives. Both simulate the real documented
// dispatch loop with a counted fake side effect, not just
// `decision.action`.
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

  it("J: an unattributable tool-result (no toolCallId) fails the whole stream closed, not just one guessed call, but is visible in diagnostics", async () => {
    const guard = createAiSdkExecutionGuard();
    const write_file = vi.fn();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    // No toolCallId on this part at all - cannot be attributed to call c1 or
    // anything else. c1's own evidence is otherwise genuinely safe, but with
    // no way to know whether c1 (or some other call) is the one the SDK
    // already ran, it must fail closed too rather than be evaluated as if
    // nothing happened.
    guard.push({ type: "tool-result", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions, diagnostics } = guard.finish();
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("sdk_execution_observed");
    expect(diagnostics.some((d) => d.code === "E_SDK_EXECUTION_OBSERVED" && d.internalId === undefined)).toBe(true);

    await dispatch(decisions, { write_file });
    expect(write_file).not.toHaveBeenCalled();
  });

  it("K: tool-result attributed to c1, AND finishReason 'error' (provider_error) - sdk_execution_observed wins over provider_error too", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "tool-result", toolCallId: "c1", toolName: "write_file" });
    guard.push({ type: "finish", finishReason: "error" });

    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("sdk_execution_observed");
  });
});

describe("createAiSdkExecutionGuard — unattributable (stream-wide) SDK execution-observed evidence", () => {
  it("single valid call + unattributable tool-result + safe finish => reject, zero manual side effects", async () => {
    const guard = createAiSdkExecutionGuard();
    const write_file = vi.fn();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "tool-result", toolName: "write_file" }); // no toolCallId
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.action).toBe("reject");
    expect(decisions[0]?.reason).toBe("sdk_execution_observed");

    await dispatch(decisions, { write_file });
    expect(write_file).not.toHaveBeenCalled();
  });

  it("two valid calls + unattributable tool-result + safe finish => BOTH reject, zero manual side effects for both", async () => {
    const guard = createAiSdkExecutionGuard();
    const read_file = vi.fn();
    const write_file = vi.fn();
    for (const part of toolInputParts("call_a", "read_file", ['{"path":"a.txt"}'])) guard.push(part);
    for (const part of toolInputParts("call_b", "write_file", ['{"path":"b.txt","content":"hi"}'])) guard.push(part);
    // Some tool's execute() already ran via the SDK - we don't know which.
    guard.push({ type: "tool-result" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision.action).toBe("reject");
      expect(decision.reason).toBe("sdk_execution_observed");
    }

    await dispatch(decisions, { read_file, write_file });
    expect(read_file).not.toHaveBeenCalled();
    expect(write_file).not.toHaveBeenCalled();
  });

  it("two valid calls + unattributable tool-error => BOTH reject", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("call_a", "read_file", ['{"path":"a.txt"}'])) guard.push(part);
    for (const part of toolInputParts("call_b", "write_file", ['{"path":"b.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "tool-error", error: "boom" }); // no toolCallId
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision.action).toBe("reject");
      expect(decision.reason).toBe("sdk_execution_observed");
    }
  });

  it("global evidence arriving before a LATER call even starts still disqualifies that later call - a safe finish never upgrades it", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("call_a", "read_file", ['{"path":"a.txt"}'])) guard.push(part);
    // Unattributable evidence arrives before call_b has even started.
    guard.push({ type: "tool-result" });
    // call_b starts and completes cleanly AFTER the global evidence.
    for (const part of toolInputParts("call_b", "write_file", ['{"path":"b.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision.action).toBe("reject");
      expect(decision.reason).toBe("sdk_execution_observed");
    }
  });

  it("global evidence in one guard instance leaves a second, independent guard instance completely unaffected", () => {
    const poisonedGuard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) poisonedGuard.push(part);
    poisonedGuard.push({ type: "tool-result" }); // unattributable
    poisonedGuard.push({ type: "finish", finishReason: "tool-calls" });

    const cleanGuard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) cleanGuard.push(part);
    cleanGuard.push({ type: "finish", finishReason: "tool-calls" });

    expect(expectDefined(poisonedGuard.finish().decisions[0]).action).toBe("reject");
    expect(expectDefined(cleanGuard.finish().decisions[0]).action).toBe("execute");
  });

  it("a normal request with no SDK execution evidence at all is completely unaffected by this mechanism", async () => {
    const guard = createAiSdkExecutionGuard();
    const write_file = vi.fn();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    expect(decisions[0]?.action).toBe("execute");

    await dispatch(decisions, { write_file });
    expect(write_file).toHaveBeenCalledTimes(1);
  });
});
