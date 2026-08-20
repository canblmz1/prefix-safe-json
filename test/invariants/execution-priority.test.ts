// ---------------------------------------------------------------------------
// Cross-product execution-safety invariants + red-team scenarios.
//
// These are not new decision logic - decideExecution()'s priority-ordered
// checks (src/gate/decide.ts) already guarantee every invariant below by
// construction. This file exists to prove that guarantee holds through the
// full push()/finish() pipeline (via createAiSdkExecutionGuard, not
// hand-built ToolCallState fixtures), so a future change to the pipeline
// wiring - not just the decision table itself - cannot silently violate one.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import { expectDefined } from "../utils/expect-defined.js";

function toolInputParts(callId: string, toolName: string, argChunks: string[]) {
  return [
    { type: "tool-input-start", id: callId, toolName },
    ...argChunks.map((delta) => ({ type: "tool-input-delta", id: callId, delta })),
    { type: "tool-input-end", id: callId },
  ];
}

describe("invariant: NonExecutableDecision has no `value` property at all (type-level)", () => {
  it("does not compile-time expose `value` on retry/reject", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "read_file", ['{"path":"a.txt"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "length" });
    const decision = expectDefined(guard.finish().decisions[0]);
    if (decision.action !== "execute") {
      // @ts-expect-error - NonExecutableDecision has no `value` field at all,
      // not an optional one. If this ever stops erroring, `pnpm run
      // typecheck` fails the build.
      const _v = decision.value;
      void _v;
    }
    expect("value" in decision).toBe(false);
  });
});

describe("invariant: schema validation cannot override unsafe provider termination", () => {
  it("a schema-valid, structurally complete call still never executes under an unsafe finish reason", () => {
    const guard = createAiSdkExecutionGuard({
      schemas: {
        write_file: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    });
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hi"}'])) {
      guard.push(part);
    }
    guard.push({ type: "finish", finishReason: "length" });
    const decision = expectDefined(guard.finish().decisions[0]);
    // Would be schema-valid if reached, but the priority order in decide.ts
    // means the unsafe-terminal-state disqualifiers never even reach the
    // schema check.
    expect(decision.action).not.toBe("execute");
    expect(decision.reason).not.toBe("schema_invalid");
  });
});

describe("invariant: a safe provider reason cannot override parser incompleteness", () => {
  it("finishReason stop, but the argument stream was genuinely truncated mid-string -> still retry, not execute", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hel'])) {
      guard.push(part);
    }
    guard.push({ type: "finish", finishReason: "stop" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.reason).toBe("truncated");
  });
});

describe("invariant: a complete parser state cannot override unsafe provider termination", () => {
  it("syntactically complete JSON + finishReason length -> still never executes", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "length" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.structurallyComplete).toBe(true);
    expect(decision.action).not.toBe("execute");
  });
});

describe("invariant: an unknown future finish reason fails closed", () => {
  it("a literal this adapter has never seen falls through to unknown, not complete", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "some_future_reason_the_sdk_has_not_added_yet" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.evidence.streamEndReason).toBe("unknown");
  });
});

describe("invariant: the adapter ignores the SDK's own resolved/repaired tool-call input", () => {
  it("a 'tool-call' part carrying a different (repaired) input than the raw deltas does not change the decision", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hel'])) {
      guard.push(part);
    }
    // The SDK's own "tool-call" part, as it would appear after e.g.
    // experimental_repairToolCall silently closes the truncated string -
    // this must never be read by the adapter (see ai-sdk.ts's "tool-call"
    // case).
    guard.push({
      type: "tool-call",
      toolCallId: "c1",
      toolName: "write_file",
      input: { path: "a.txt", content: "hel" }, // SDK-repaired, looks "complete"
    });
    guard.push({ type: "finish", finishReason: "length" });
    const decision = expectDefined(guard.finish().decisions[0]);
    // If the adapter had trusted the SDK-resolved input, this could read as
    // a complete object. It must not - the raw delta stream never closed
    // the "content" string, and finishReason "length" additionally
    // disqualifies it regardless.
    expect(decision.action).not.toBe("execute");
    expect(decision.reason).toBe("truncated");
  });
});

describe("red-team: attempted execution paths that must all still fail closed", () => {
  it("provider error arriving after tool-input-end, on otherwise-complete args", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
    guard.push({ type: "error", error: new Error("mid-stream failure") });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("provider_error");
  });

  it("content filter arriving after structurally complete arguments", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "send_email", ['{"to":"a@example.com"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "content-filter" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("content_filtered");
  });

  it("multi-tool stream where one call completes cleanly before a later stream-wide unsafe finish - the early call still does not execute", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "early", toolName: "read_file" });
    guard.push({ type: "tool-input-delta", id: "early", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-end", id: "early" });
    // "early" looks fully done here - but the stream itself is not over yet.
    guard.push({ type: "tool-input-start", id: "late", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "late", delta: '{"path":"b.txt","content":"cut' });
    guard.push({ type: "finish", finishReason: "length" });

    const { decisions } = guard.finish();
    const early = expectDefined(decisions.find((d) => d.toolCallId === "early"));
    expect(early.action).not.toBe("execute");
  });

  it("duplicate tool call identity (same id started twice) never executes either instance", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "c1", toolName: "read_file" });
    guard.push({ type: "tool-input-start", id: "c1", toolName: "read_file" }); // duplicate start
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "stop" });
    const { decisions, diagnostics } = guard.finish();
    expect(decisions.every((d) => d.action !== "execute")).toBe(true);
    expect(diagnostics.some((d) => d.code === "E_DUPLICATE_TOOL_CALL_START")).toBe(true);
  });

  it("malformed provider event (not an object) does not crash and does not execute", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push(null);
    guard.push("not an event");
    guard.push(42);
    guard.push({ type: "tool-input-start", id: "c1", toolName: "read_file" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "stop" });
    // Malformed events are diagnostics, not tool calls - the real call
    // still resolves normally and independently.
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("execute");
  });

  it("resource-limit breach (oversized argument stream) never executes", () => {
    const guard = createAiSdkExecutionGuard({ parserOptions: { limits: { maxInputBytes: 16 } } });
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"this is way over sixteen bytes"}'])) {
      guard.push(part);
    }
    guard.push({ type: "finish", finishReason: "stop" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("resource_limit");
  });
});
