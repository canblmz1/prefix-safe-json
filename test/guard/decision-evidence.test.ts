import { describe, it, expect } from "vitest";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import { expectDefined } from "../utils/expect-defined.js";

describe("DecisionEvidence", () => {
  it("is present on every decision, execute and non-execute alike", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "c1", toolName: "read_file" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "stop" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence).toBeDefined();
    expect(decision.evidence.provider).toBe("ai-sdk");
  });

  it("never alters the decision itself - execute + evidence-implied-unsafe never both true", () => {
    // Sanity/regression guard against evidence ever becoming a second
    // decision input: a call whose evidence would look "unsafe" by any
    // single field can still only be non-execute.
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "c1", toolName: "delete_widget" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"widget.txt"}' });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "length" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.structurallyComplete).toBe(true); // the JSON IS closed
    expect(decision.evidence.parserExecutable).toBe(false); // but not trusted
    expect(decision.action).not.toBe("execute"); // and the decision agrees
  });

  it("the illustrative length scenario: terminalConfirmed true, structurallyComplete false, parserExecutable false, schemaValid undefined", () => {
    // A genuinely truncated (open string) case, matching the shape used as
    // this feature's own worked example.
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "c1", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"widget.txt","content":"hel' });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "length" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence).toMatchObject({
      provider: "ai-sdk",
      providerReason: "length",
      streamEndReason: "length",
      terminalConfirmed: true,
      structurallyComplete: false,
      parserExecutable: false,
      schemaValid: undefined,
    });
  });

  it("terminalConfirmed is false when the stream never reports a classified reason", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "c1", toolName: "read_file" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-end", id: "c1" });
    // No finish/error/abort part - genuinely unclassified.
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.terminalConfirmed).toBe(false);
    expect(decision.evidence.streamEndReason).toBe("unknown");
  });

  it("terminalConfirmed is true even for an unsafe-but-classified reason (length is a real signal, not an absence of one)", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "c1", toolName: "read_file" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "length" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.terminalConfirmed).toBe(true);
  });

  it("schemaValid reflects the registered schema's verdict once complete", () => {
    const guard = createAiSdkExecutionGuard({
      schemas: {
        write_file: {
          type: "object",
          properties: { path: { type: "string" }, content: { type: "string" } },
          required: ["path", "content"],
        },
      },
    });
    guard.push({ type: "tool-input-start", id: "c1", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: '{"path":"a.txt"}' });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "stop" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.schemaValid).toBe(false);
    expect(decision.action).toBe("reject");
  });

  it("receivedBytes reflects actual bytes pushed for the call", () => {
    const guard = createAiSdkExecutionGuard();
    const arg = '{"path":"a.txt","content":"hello"}';
    guard.push({ type: "tool-input-start", id: "c1", toolName: "write_file" });
    guard.push({ type: "tool-input-delta", id: "c1", delta: arg });
    guard.push({ type: "tool-input-end", id: "c1" });
    guard.push({ type: "finish", finishReason: "stop" });
    const decision = expectDefined(guard.finish().decisions[0]);
    expect(decision.evidence.receivedBytes).toBe(new TextEncoder().encode(arg).length);
  });
});
