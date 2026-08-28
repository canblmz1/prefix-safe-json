// ---------------------------------------------------------------------------
// AI SDK v5 / v6 / v7 compatibility evidence.
//
// AiSdkStreamAdapter (and createAiSdkExecutionGuard, which composes it) is
// deliberately hand-rolled against the `ai` package's fullStream part
// *shape*, not its types (see providers/ai-sdk.ts's own header comment) - so
// "compatible" is a claim about the wire shape, not about importing a
// specific version.
//
// That shape was verified directly against the published type declarations
// for the latest patch of each of the three currently-supported majors,
// downloaded and inspected (not recalled from memory) while building this
// test file:
//
//   ai@5.0.240  ai@6.0.259  ai@7.0.70
//
// Findings that justify the fixtures below:
//
// - `tool-input-start` / `tool-input-delta` / `tool-input-end` on
//   `fullStream` (the `TextStreamPart<TOOLS>` union) use `id: string` as the
//   correlator field in ALL THREE majors - identical shape. (A *different*,
//   `toolCallId`-keyed shape exists for the separate UI-message-stream
//   protocol in v6/v7, which this adapter does not and should not target -
//   fullStream is the documented low-level stream this library integrates
//   with.)
// - The `finish` part's `finishReason` is the literal union
//   `'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'`
//   in all three majors, word-for-word identical.
// - An `'abort'` part (`{ type: 'abort', reason?: string }`) exists in all
//   three majors' fullStream union.
//
// Because the wire shape and finish-reason vocabulary are identical across
// all three majors, a single fixture set genuinely demonstrates cross-version
// compatibility - it is not merely convenient to write it once. Vercel's own
// vercel/ai#19063 fix (never executing tool calls on an unsafe finish
// reason) landed across v5/v6/v7, most recently v7 in ai@7.0.70 - this test
// file exists to prove this library's *independent*, provider-agnostic
// guard reaches the same safe outcome without relying on that upstream fix
// at all (see docs/EXECUTION_GATE.md and README.md for the framing: this
// library does not assume any particular SDK/provider already gates
// execution correctly).
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

describe("AI SDK v5/v6/v7 compatibility matrix — safe terminal states", () => {
  const safeReasons = ["stop", "tool-calls"] as const;

  for (const finishReason of safeReasons) {
    it(`finishReason "${finishReason}" + complete generate-like input (single chunk) -> execute`, () => {
      const guard = createAiSdkExecutionGuard();
      for (const part of toolInputParts("c1", "read_file", ['{"path":"a.txt"}'])) guard.push(part);
      guard.push({ type: "finish", finishReason });
      const decision = expectDefined(guard.finish().decisions[0]);
      expect(decision.action).toBe("execute");
    });

    it(`finishReason "${finishReason}" + complete streamed multi-chunk input -> execute`, () => {
      const guard = createAiSdkExecutionGuard();
      const chunks = ['{"path":"conf', "ig/db.yml\",\"cont", 'ent":"prod"}'];
      for (const part of toolInputParts("c1", "write_file", chunks)) guard.push(part);
      guard.push({ type: "finish", finishReason });
      const decision = expectDefined(guard.finish().decisions[0]);
      expect(decision.action).toBe("execute");
      if (decision.action === "execute") {
        expect(decision.value).toEqual({ path: "config/db.yml", content: "prod" });
      }
    });
  }
});

describe("AI SDK v5/v6/v7 compatibility matrix — unsafe terminal states", () => {
  const unsafeCases: Array<{ label: string; finishPart: Record<string, unknown> }> = [
    { label: "length", finishPart: { type: "finish", finishReason: "length" } },
    { label: "content-filter", finishPart: { type: "finish", finishReason: "content-filter" } },
    { label: "error (finish part)", finishPart: { type: "finish", finishReason: "error" } },
    { label: "error (error part)", finishPart: { type: "error", error: new Error("boom") } },
    { label: "other/unrecognized", finishPart: { type: "finish", finishReason: "other" } },
    { label: "abort", finishPart: { type: "abort", reason: "user cancelled" } },
  ];

  for (const { label, finishPart } of unsafeCases) {
    it(`${label}: syntactically complete generate-like input never executes`, () => {
      const guard = createAiSdkExecutionGuard();
      for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
      guard.push(finishPart);
      const decision = expectDefined(guard.finish().decisions[0]);
      expect(decision.action).not.toBe("execute");
      expect(decision.executable).toBe(false);
      expect("value" in decision).toBe(false);
    });

    it(`${label}: container truncated after syntactically valid members never executes`, () => {
      // ["npm install","npm test" — the array itself is closeable (no open
      // string/literal), but the closing bracket never arrived. This is
      // exactly the case docs/EXECUTION_GATE.md calls out: JSON shape alone
      // is not the deciding factor.
      const guard = createAiSdkExecutionGuard();
      for (const part of toolInputParts("c1", "run_commands", ['{"commands":["npm install","npm test"'])) {
        guard.push(part);
      }
      guard.push(finishPart);
      const decision = expectDefined(guard.finish().decisions[0]);
      expect(decision.action).not.toBe("execute");
    });

    it(`${label}: string truncated mid-value never executes`, () => {
      const guard = createAiSdkExecutionGuard();
      for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt","content":"hel'])) {
        guard.push(part);
      }
      guard.push(finishPart);
      const decision = expectDefined(guard.finish().decisions[0]);
      expect(decision.action).not.toBe("execute");
    });
  }

  it("stream ending with no terminal confirmation at all (bare end, no finish/error/abort part) never executes", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
    // fullStream simply stops - no finish, no error, no abort.
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
  });
});

describe("AI SDK v5/v6/v7 compatibility matrix — malformed and schema-invalid input", () => {
  it("malformed JSON (unterminated structure at a syntax level even after stream close) never executes", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt", "path":"b.txt"}'])) {
      guard.push(part);
    }
    guard.push({ type: "finish", finishReason: "stop" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("malformed");
  });

  it("schema-invalid but structurally complete JSON rejects, not executes", () => {
    const guard = createAiSdkExecutionGuard({
      schemas: {
        write_file: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    });
    for (const part of toolInputParts("c1", "write_file", ['{"path":"a.txt"}'])) guard.push(part);
    guard.push({ type: "finish", finishReason: "stop" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("schema_invalid");
  });
});

describe("AI SDK v5/v6/v7 compatibility matrix — concurrent tool calls", () => {
  it("two concurrent calls, one complete and one truncated, sharing an unsafe finish reason: only the complete one ever could execute, and even it does not", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "call_a", toolName: "read_file" });
    guard.push({ type: "tool-input-start", id: "call_b", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "call_a", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-delta", id: "call_b", delta: '{"path":"b.txt","content":"cut off mi' });
    guard.push({ type: "tool-input-end", id: "call_a" });
    guard.push({ type: "tool-input-end", id: "call_b" });
    guard.push({ type: "finish", finishReason: "length" });

    const { decisions } = guard.finish();
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision.action).not.toBe("execute");
    }
  });

  it("two concurrent calls, both complete, safe finish reason: both execute independently", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "call_a", toolName: "read_file" });
    guard.push({ type: "tool-input-start", id: "call_b", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "call_a", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-delta", id: "call_b", delta: '{"path":"b.txt","content":"hi"}' });
    guard.push({ type: "tool-input-end", id: "call_a" });
    guard.push({ type: "tool-input-end", id: "call_b" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const { decisions } = guard.finish();
    expect(decisions).toHaveLength(2);
    expect(decisions.every((d) => d.action === "execute")).toBe(true);
  });
});

describe("AiSdkStreamAdapter 'abort' part — exact field mapping", () => {
  it("normalizes to streamEndReason 'cancelled' and propagates the abort's own reason string as providerReason", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
    guard.push({ type: "abort", reason: "user cancelled the request" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.streamEndReason).toBe("cancelled");
    expect(decision.evidence.providerReason).toBe("user cancelled the request");
    expect(decision.evidence.terminalConfirmed).toBe(true);
  });

  it("an abort part with no reason string still terminates the stream with providerReason undefined", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
    guard.push({ type: "abort" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.streamEndReason).toBe("cancelled");
    expect(decision.evidence.providerReason).toBeUndefined();
  });

  it("a conflicting 'finish' pushed after 'abort' does not reopen the call - and now permanently disqualifies it (GHSA-3xpw-9694-2xxp)", () => {
    const guard = createAiSdkExecutionGuard();
    for (const part of toolInputParts("c1", "delete_widget", ['{"path":"widget.txt"}'])) guard.push(part);
    guard.push({ type: "abort", reason: "stopped" });
    const before = guard.finish();
    expect(before.decisions[0]?.action).not.toBe("execute");
    expect(before.decisions[0]?.reason).toBe("stream_incomplete");
    // Before the fix, the adapter's own `finished` flag silently dropped
    // this event, so it never reached the coordinator at all - "a no-op"
    // was true only because the event was discarded, not because it was
    // evaluated and found harmless. The adapter now normalizes it; the
    // coordinator records the conflicting terminal reason ("tool-calls"
    // i.e. "complete", contradicting the earlier "cancelled") as
    // E_TERMINAL_REASON_CONFLICT, which now actually disqualifies the
    // decision instead of merely being observable.
    guard.push({ type: "finish", finishReason: "tool-calls" });
    const after = guard.finish();
    expect(after.decisions[0]?.action).not.toBe("execute");
    expect(after.decisions[0]?.reason).toBe("protocol_violation");
  });
});
