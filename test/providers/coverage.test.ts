/**
 * Provider adapter coverage tests — targeting uncovered branches identified
 * by v8 coverage: anthropic error events, gemini MAX_TOKENS/SAFETY/OTHER,
 * openai Responses API full flow, openrouter error path,
 * openai-compatible post-finish event, coordinator limits and edge cases.
 */
import { describe, it, expect } from "vitest";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { DefaultToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import type { ProviderStreamAdapter } from "../../src/providers/adapter.js";
import { TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE, DUPLICATE_TOOL_END_DIAGNOSTIC_CODE } from "../../src/coordinator/diagnostic-codes.js";
import { expectDefined } from "../utils/expect-defined.js";

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic
// ─────────────────────────────────────────────────────────────────────────────
describe("AnthropicStreamAdapter — uncovered branches", () => {
  it("handles non-object raw event", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push(null);
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it("ignores unknown event types silently", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_start", message: {} });
    expect(events).toHaveLength(0);
  });

  it("handles error event type", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "error", error: { type: "overloaded_error" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("provider_error");
  });

  it("handles message_delta with max_tokens stop_reason", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("length");
  });

  it("handles message_delta with unknown stop_reason", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_delta", delta: { stop_reason: "some_future_reason" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
  });

  it("handles message_delta with tool_use stop_reason", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("complete");
  });

  it("still forwards a post-terminal event's real content instead of silently discarding it (GHSA-3xpw-9694-2xxp class)", () => {
    // Pre-fix, this adapter's own `finished` flag short-circuited push() with
    // `return []` before the coordinator ever saw the event - so the
    // coordinator's own post-terminal authority-revocation diagnostic
    // (EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE) could never fire on evidence
    // it was never shown. The adapter's job is to normalize what the
    // provider actually sent, not to pre-judge whether it still matters;
    // see test/security/post-terminal-adapter-evidence.test.ts for the
    // end-to-end authority-revocation proof through a real gate.
    const a = new AnthropicStreamAdapter();
    a.push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    const events = a.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("tool_call_arguments_delta");
  });

  it("handles content_block_start with non-tool_use type", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "content_block_start", index: 0, content_block: { type: "text", id: "id1", name: "unused" } });
    expect(events).toHaveLength(0);
  });

  it("handles content_block_delta with wrong delta type", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } });
    expect(events).toHaveLength(0);
  });

  it("an input_json_delta whose partial_json is not a string (e.g. a raw number, from a malformed provider) fabricates no argument evidence", () => {
    // The type discriminator alone (delta.type === "input_json_delta") is
    // tested above via a DIFFERENT wrong type; this proves the second
    // conjunct - the payload itself must actually be a string - independently.
    const gate = createToolCallExecutionGate();
    const a = new AnthropicStreamAdapter();
    for (const e of a.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "f" } })) gate.push(e);
    const malformedEvents = a.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 12345 } });
    expect(malformedEvents).toHaveLength(0);
    for (const e of malformedEvents) gate.push(e);
    for (const e of a.push({ type: "content_block_stop", index: 0 })) gate.push(e);
    for (const e of a.push({ type: "message_delta", delta: { stop_reason: "tool_use" } })) gate.push(e);
    const final = gate.finish();
    // No argument bytes were ever received - the call closes with no
    // stableValue (never reaches a fabricated/incorrect "executable" state).
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).not.toBe("execute");
  });

  it("content_block_start with no content_block field at all does not throw", () => {
    // Every existing test always supplies `content_block`. The raw chunk is
    // untrusted provider input.
    const a = new AnthropicStreamAdapter();
    expect(() => a.push({ type: "content_block_start", index: 0 })).not.toThrow();
  });

  it("content_block_delta with no delta field at all does not throw", () => {
    const a = new AnthropicStreamAdapter();
    expect(() => a.push({ type: "content_block_delta", index: 0 })).not.toThrow();
  });

  it("finish() emits stream_end if not yet finished", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.finish({ reason: "cancelled" });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("cancelled");
  });

  it("finish() is idempotent after already finished", () => {
    const a = new AnthropicStreamAdapter();
    a.push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    const events = a.finish({ reason: "cancelled" });
    expect(events).toHaveLength(0);
  });

  it("finish() called directly twice (no push in between) is idempotent - the second call produces nothing", () => {
    const a = new AnthropicStreamAdapter();
    const first = a.finish({ reason: "cancelled" });
    const second = a.finish({ reason: "cancelled" });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("handles message_delta with end_turn stop_reason (maps to complete, same as tool_use)", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("complete");
  });

  it("finish() with no arguments at all does not throw and defaults reason to 'unknown'", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.finish();
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
  });

  it("sequence numbers are strictly increasing across a realistic multi-branch stream (public contract: NormalizedEventBase.sequence is documented as a 'deterministic sequence number')", () => {
    const a = new AnthropicStreamAdapter();
    const events = [
      ...a.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "f" } }),
      ...a.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }),
      ...a.push({ type: "content_block_stop", index: 0 }),
      ...a.push({ type: "message_delta", delta: { stop_reason: "tool_use" } }),
    ];
    for (let i = 1; i < events.length; i++) {
      expect(expectDefined(events[i]).sequence, `event ${i} sequence`).toBeGreaterThan(expectDefined(events[i - 1]).sequence);
    }
    expect(events.length).toBeGreaterThan(1);
  });

  // ---------------------------------------------------------------------
  // P4.2 / F-1: block-local post-terminal evidence hardening.
  // ---------------------------------------------------------------------
  describe("block-local post-terminal evidence (content_block_stop) is hardened, not silently merged", () => {
    it("A. existing block, INCOMPLETE before stop: a later delta that closes the JSON with injected content is rejected, not executed", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new AnthropicStreamAdapter();
      for (const e of adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1' } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_stop", index: 0 })) gate.push(e);

      const lateEvents = adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ',"evil":true}' } });
      const diag = expectDefined(lateEvents.find((e) => e.type === "provider_diagnostic"));
      expect((diag as { code?: string }).code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect((diag as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("content-block:0");
      expect(lateEvents.some((e) => e.type === "tool_call_arguments_delta")).toBe(false); // never merged as normal evidence
      for (const e of lateEvents) gate.push(e);

      for (const e of adapter.push({ type: "message_delta", delta: { stop_reason: "tool_use" } })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });

    it("B. existing block, ALREADY structurally complete before stop: a later delta is rejected via the actual diagnostic, not merely by coincidental JSON trailing-data failure", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new AnthropicStreamAdapter();
      for (const e of adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1}' } })) gate.push(e); // already closed
      for (const e of adapter.push({ type: "content_block_stop", index: 0 })) gate.push(e);

      const lateEvents = adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"more":true}' } });
      // Assert the actual protocol-violation diagnostic exists - not merely
      // that the call ends up non-executable, which trailing-data parse
      // failure alone would also produce.
      const diag = expectDefined(lateEvents.find((e) => e.type === "provider_diagnostic"));
      expect((diag as { code?: string }).code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect(lateEvents.some((e) => e.type === "tool_call_arguments_delta")).toBe(false);
      for (const e of lateEvents) gate.push(e);

      for (const e of adapter.push({ type: "message_delta", delta: { stop_reason: "tool_use" } })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });

    it("C. multiple tool-use blocks: A stop + late A evidence does not poison B, which remains executable (exact attribution, not stream-wide)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new AnthropicStreamAdapter();
      for (const e of adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_A", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_B", name: "toolB" } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1' } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_stop", index: 0 })) gate.push(e);

      // Late evidence for the already-stopped A.
      for (const e of adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ',"evil":true}' } })) gate.push(e);

      // B continues and finishes completely normally, unaffected.
      for (const e of adapter.push({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"b":2}' } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_stop", index: 1 })) gate.push(e);
      for (const e of adapter.push({ type: "message_delta", delta: { stop_reason: "tool_use" } })) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });

    it("D. a delta for a NEVER-STARTED block index is NOT conflated with late evidence for an already-terminal block - existing unknown-before-start behavior (unconditional emission, phantom identity, coordinator no-op) is preserved unchanged", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new AnthropicStreamAdapter();
      for (const e of adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_A", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1}' } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_stop", index: 0 })) gate.push(e);

      // A delta for a DIFFERENT, never-started block index - not "late
      // evidence for A", a genuinely distinct identity that simply never
      // received a content_block_start. terminatedBlockIndices only ever
      // contains 0 - index 5 is not in it, so this must NOT be attributed
      // to A's TOOL_ARGUMENTS_AFTER_END path. Existing behavior (no
      // before-start check in this adapter at all, unlike AiSdkStreamAdapter)
      // is deliberately preserved unchanged here, not widened.
      const events = adapter.push({ type: "content_block_delta", index: 5, delta: { type: "input_json_delta", partial_json: "{}" } });
      expect(events.map((e) => e.type)).toEqual(["tool_call_arguments_delta"]); // unchanged pre-existing behavior
      expect((events[0] as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("content-block:5");
      for (const e of events) gate.push(e);

      for (const e of adapter.push({ type: "message_delta", delta: { stop_reason: "tool_use" } })) gate.push(e);
      const final = gate.finish();
      // A's own clean, legitimate authority is unaffected by the unrelated
      // never-started identity's delta; no phantom "block 5" call exists.
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      expect(final.decisions.some((d) => (d as { toolIndex?: number }).toolIndex === 5)).toBe(false);
    });

    it("duplicate content_block_stop for the same index: PHASE 7 - pre-fix this was authority-safe but silently tolerated (a harmless idempotent second tool_call_end, since handleCallEnd() only re-sets already-true booleans - it did not create or increase execution authority, but it also did not itself disqualify the call, so an otherwise-valid call could still execute once a later, genuine terminal arrived); now DUPLICATE_TOOL_END records the protocol anomaly and fails the real call closed", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new AnthropicStreamAdapter();
      for (const e of adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1}' } })) gate.push(e);
      const firstStop = adapter.push({ type: "content_block_stop", index: 0 });
      expect(firstStop.map((e) => e.type)).toEqual(["tool_call_end"]);
      for (const e of firstStop) gate.push(e);

      const secondStop = adapter.push({ type: "content_block_stop", index: 0 });
      expect(secondStop.map((e) => e.type)).toEqual(["provider_diagnostic"]); // never a second tool_call_end
      const diag = expectDefined(secondStop[0]);
      expect((diag as { code?: string }).code).toBe(DUPLICATE_TOOL_END_DIAGNOSTIC_CODE);
      expect((diag as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("content-block:0");
      for (const e of secondStop) gate.push(e);

      for (const e of adapter.push({ type: "message_delta", delta: { stop_reason: "tool_use" } })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });

    it("PHASE 9: a block that never receives its own content_block_stop does not gain execution authority merely because message_delta terminates the stream and its JSON happens to be syntactically complete (E_STREAM_ENDED_WITH_OPEN_CALL forces reject/malformed - existing coordinator-level safety net, not adapter-specific)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new AnthropicStreamAdapter();
      for (const e of adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "toolA" } })) gate.push(e);
      // Syntactically COMPLETE already - but content_block_stop never fires.
      for (const e of adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1}' } })) gate.push(e);
      for (const e of adapter.push({ type: "message_delta", delta: { stop_reason: "tool_use" } })) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────────────────────────────────────
describe("GeminiStreamAdapter — uncovered branches", () => {
  it("handles non-object event", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push("bad string");
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it("handles candidate with MAX_TOKENS finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("length");
  });

  it("handles candidate with SAFETY finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "SAFETY" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("handles candidate with RECITATION finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "RECITATION" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("handles candidate with OTHER finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "OTHER" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("handles candidate with unknown finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "SOMETHING_NEW" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("unknown");
  });

  it("handles functionCall without args", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{
        content: { parts: [{ functionCall: { name: "my_tool" } }] },
      }],
    });
    // Should have start + end but no arguments_delta
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_call_start");
    expect(types).toContain("tool_call_end");
    expect(types).not.toContain("tool_call_arguments_delta");
  });

  // Group 9 (P1 final review): the `fc.args !== undefined` check, classified.
  // Traced both public paths: with `args` present, and with it entirely
  // absent (as above). Real code: absent args -> the whole
  // JSON.stringify/try-catch block is skipped, producing exactly 3 events
  // (start, PROJECTION_ONLY diagnostic, end) - no 4th event. A weakened
  // check that treated "absent" the same as "present but unserializable"
  // would instead ALSO enter the try/catch, and JSON.stringify(undefined)
  // itself returns undefined, hitting the function's own existing
  // `if (projected === undefined) throw` guard - producing a 4th event, a
  // provider_diagnostic (E_GEMINI_ARGUMENT_PROJECTION_FAILED) instead of
  // silence. That difference is real and observable in the adapter's own
  // returned events / coordinator diagnostics. It is NOT observable at the
  // execution-authority boundary: verified below that both paths reach the
  // identical gate decision (reject/projection_only) - every Gemini call
  // unconditionally carries PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE
  // regardless of args, and decide.ts rejects on that before status is ever
  // considered. Per the classification rule (equivalent at the
  // execution-authority boundary, but changes normalized observability):
  // BEHAVIORAL BUT NON-SECURITY, not EQUIVALENT.
  it("functionCall with vs without args reach the IDENTICAL gate decision (reject/projection_only) - the extra diagnostic event some inputs produce is observability-only, never execution-authority-relevant", () => {
    for (const fc of [{ name: "f", args: { a: 1 } }, { name: "f" }]) {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      for (const e of adapter.push({ candidates: [{ content: { parts: [{ functionCall: fc }] } }] })) gate.push(e);
      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action, JSON.stringify(fc)).toBe("reject");
      expect((decision as { reason?: string }).reason, JSON.stringify(fc)).toBe("projection_only");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    }
  });

  it("handles empty candidates array", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({ candidates: [] });
    expect(events).toHaveLength(0);
  });

  it.each([
    ["candidates: absent entirely", {}],
    ["candidates: null", { candidates: null }],
    ["candidates: wrong type (string)", { candidates: "wrong" }],
  ])("malformed .candidates (%s) does not crash, fabricate a tool call, or grant executable authority", (_label, raw) => {
    const gate = createToolCallExecutionGate();
    const adapter = new GeminiStreamAdapter();
    let events: readonly ReturnType<typeof adapter.push>[number][] = [];
    expect(() => { events = adapter.push(raw); }).not.toThrow();
    expect(events).toHaveLength(0);
    for (const e of events) gate.push(e);
    expect(gate.finish().decisions).toHaveLength(0);
  });

  it("a content part with no functionCall at all does not crash, fabricate a tool call, or grant executable authority", () => {
    const gate = createToolCallExecutionGate();
    const adapter = new GeminiStreamAdapter();
    const raw = { candidates: [{ content: { parts: [{ text: "hello" }] } }] };
    let events: readonly ReturnType<typeof adapter.push>[number][] = [];
    expect(() => { events = adapter.push(raw); }).not.toThrow();
    expect(events).toHaveLength(0);
    for (const e of events) gate.push(e);
    expect(gate.finish().decisions).toHaveLength(0);
  });

  it("ignores events after finished", () => {
    const g = new GeminiStreamAdapter();
    g.push({ candidates: [{ finishReason: "STOP" }] });
    const events = g.push({ candidates: [{ finishReason: "STOP" }] });
    expect(events).toHaveLength(0);
  });

  it("finish() returns stream_end event", () => {
    const g = new GeminiStreamAdapter();
    const events = g.finish({ reason: "network_error" });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("network_error");
  });

  it("finish() is idempotent", () => {
    const g = new GeminiStreamAdapter();
    g.push({ candidates: [{ finishReason: "STOP" }] });
    const events = g.finish();
    expect(events).toHaveLength(0);
  });

  it("finish() with no arguments at all does not throw and defaults reason to 'unknown'", () => {
    const g = new GeminiStreamAdapter();
    const events = g.finish();
    expect((events[0] as { reason?: string })?.reason).toBe("unknown");
  });

  it("sequence numbers are strictly increasing across a realistic multi-branch stream (public contract: NormalizedEventBase.sequence is documented as a 'deterministic sequence number')", () => {
    const g = new GeminiStreamAdapter();
    const events = [
      ...g.push({ candidates: [{ content: { parts: [{ functionCall: { name: "f", args: { a: 1 } } }] } }] }),
      ...g.finish({ reason: "complete" }),
    ];
    for (let i = 1; i < events.length; i++) {
      expect(expectDefined(events[i]).sequence, `event ${i} sequence`).toBeGreaterThan(expectDefined(events[i - 1]).sequence);
    }
    expect(events.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI — Responses API
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenAIStreamAdapter — Responses API", () => {
  it("handles response.output_item.added with function_call type", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: "item-1", call_id: "call-abc", name: "search" },
    });
    expect(events[0]?.type).toBe("tool_call_start");
  });

  it("does NOT treat a non-function_call output item as a tool call (tool identity negative case)", () => {
    // Nothing in the existing suite ever sends a `response.output_item.added`
    // with an item.type other than "function_call" - the Responses API also
    // emits `message`, `file_search_call`, `web_search_call`, `reasoning`,
    // etc. output items on the same event type. A regression that treats
    // every output item as a function call would fabricate a phantom tool
    // call for plain assistant text.
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "item-1" },
    });
    expect(events).toHaveLength(0);
  });

  it("response.output_item.added with no item field at all does not throw", () => {
    // Every existing test always supplies `item`. The raw chunk is untrusted
    // provider input; a provider (or a future refactor removing the `?.`
    // chain) could omit it entirely.
    const a = new OpenAIStreamAdapter();
    expect(() => a.push({ type: "response.output_item.added", output_index: 0 })).not.toThrow();
  });

  it("response.output_item.done with no item field at all does not throw", () => {
    const a = new OpenAIStreamAdapter();
    expect(() => a.push({ type: "response.output_item.done" })).not.toThrow();
  });

  it("handles response.function_call_arguments.delta", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    const events = a.push({
      type: "response.function_call_arguments.delta",
      item_id: "item-1",
      delta: '{"q":',
    });
    expect(events[0]?.type).toBe("tool_call_arguments_delta");
    // Exact byte evidence - not merely the right event type.
    expect((events[0] as { delta?: string })?.delta).toBe('{"q":');
  });

  it("accumulates multiple argument deltas as exact, unmodified concatenated bytes", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    const e1 = a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":' });
    const e2 = a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '"x"}' });
    // Each individual delta must carry exactly its own bytes, never
    // pre-concatenated, truncated, or padded.
    expect((e1[0] as { delta?: string })?.delta).toBe('{"q":');
    expect((e2[0] as { delta?: string })?.delta).toBe('"x"}');
  });

  it("handles response.function_call_arguments.done with no prior deltas", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    const events = a.push({
      type: "response.function_call_arguments.done",
      item_id: "item-1",
      arguments: '{"q":"test"}',
    });
    expect(events[0]?.type).toBe("tool_call_arguments_delta");
    expect((events[0] as { delta?: string })?.delta).toBe('{"q":"test"}');
  });

  it("response.function_call_arguments.done with no prior deltas AND an empty-string arguments value reaches the same non-executable outcome whether or not it emits an event (0 bytes either way)", () => {
    // `!hasDeltas && chunk.arguments.length > 0` gates whether an
    // empty-string .done is even worth emitting as a delta. Verified: real
    // code skips it entirely (0 events); either way, 0 bytes ever reach the
    // parser, so the call ends up identically non-executable regardless.
    const gate = createToolCallExecutionGate();
    const a = new OpenAIStreamAdapter();
    for (const e of a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(e);
    const doneEvents = a.push({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: "" });
    expect(doneEvents).toHaveLength(0);
    for (const e of doneEvents) gate.push(e);
    for (const e of a.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
    for (const e of a.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).not.toBe("execute");
  });

  it("response.function_call_arguments.done whose arguments MATCH prior deltas exactly is a confirmatory no-op (already fully streamed, not re-emitted or duplicated)", () => {
    const gate = createToolCallExecutionGate();
    const a = new OpenAIStreamAdapter();
    for (const e of a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":' })) gate.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '"x"}' })) gate.push(e);
    const doneEvents = a.push({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: '{"q":"x"}' });
    expect(doneEvents).toHaveLength(0);
    for (const e of doneEvents) gate.push(e);
    for (const e of a.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
    for (const e of a.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    // Exactly the concatenated delta bytes - not duplicated, not replaced.
    expect(authority.value).toEqual({ q: "x" });
  });

  it("a .done-with-no-prior-deltas arguments event actually correlates to the same call in a real coordinator", () => {
    const a = new OpenAIStreamAdapter();
    const coord = new DefaultToolCallStreamCoordinator();
    for (const e of a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) coord.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: '{"q":"test"}' })) coord.push(e);
    const snap = coord.snapshot();
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.parser.receivedBytes).toBeGreaterThan(0);
  });

  it("a conflicting .done's callRef correlates to the correct call in a multi-call stream: only the conflicted call fails closed, the other, clean, concurrent call still executes with its own correct value", () => {
    const a = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const e of a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "conflicted" } })) gate.push(e);
    for (const e of a.push({ type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "item-2", call_id: "call-2", name: "clean" } })) gate.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"' })) gate.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.delta", item_id: "item-2", delta: '{"ok":true}' })) gate.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: '{"q":"different"}' })) gate.push(e);
    for (const e of a.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
    for (const e of a.push({ type: "response.output_item.done", item: { id: "item-2" } })) gate.push(e);
    for (const e of a.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
    const final = gate.finish();
    expect(final.decisions).toHaveLength(2);
    const conflicted = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "conflicted"));
    const clean = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "clean"));
    expect(conflicted.action).not.toBe("execute");
    expect(gate.takeDecision(conflicted.internalId)).toBeUndefined();
    expect(clean.action).toBe("execute");
    const cleanAuthority = expectDefined(gate.takeDecision(clean.internalId));
    expect(cleanAuthority.value).toEqual({ ok: true });
  });

  it("handles response.function_call_arguments.done with conflicting accumulated", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"' });
    const events = a.push({
      type: "response.function_call_arguments.done",
      item_id: "item-1",
      arguments: '{"q":"different"}',
    });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect(diag).toBeDefined();
    expect((diag as {code: string})?.code).toBe("E_FINAL_ARGUMENTS_CONFLICT");
  });

  it("the conflict diagnostic's callRef correctly attributes E_FINAL_ARGUMENTS_CONFLICT to the SAME call's internalId in a real coordinator (not left globally-unattributed)", () => {
    // Classified BEHAVIORAL BUT NON-SECURITY, not execution-integrity: the
    // conflict branch never calls this.accumulatedArguments.set(...) (unlike
    // the no-prior-deltas branch), so the parser only ever received the
    // original, still-open delta - it independently fails closed via
    // truncation when the stream ends regardless of this diagnostic's own
    // attribution. This test documents the real, correct attribution
    // behavior on its own terms (coordinator diagnostics quality), not as an
    // execution-authority claim.
    const a = new OpenAIStreamAdapter();
    const coord = new DefaultToolCallStreamCoordinator();
    for (const e of a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) coord.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"' })) coord.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: '{"q":"different"}' })) coord.push(e);
    const snap = coord.snapshot();
    expect(snap.calls).toHaveLength(1);
    const call = expectDefined(snap.calls[0]);
    const diag = expectDefined(snap.diagnostics.find((d) => d.code === "E_FINAL_ARGUMENTS_CONFLICT"));
    expect(diag.internalId).toBe(call.internalId);
  });

  // --- Group 1: argument-evidence dispatch on malformed/deviant Responses API
  // shapes. Every one of these raw shapes is missing exactly one field the
  // real, unmutated adapter's own if/else-if chain requires (chunk.type,
  // item_id, delta/arguments) - verified empirically (not assumed) that the
  // adapter falls through the WHOLE chain (there is no final `else`) and
  // returns [] for each, never fabricating a tool_call_start/arguments_delta
  // and never touching this.accumulatedArguments (that map is only written
  // inside the same three-way `&&` this exact input fails).
  const malformedResponsesShapes: Array<[string, unknown]> = [
    ["delta: empty string (falsy)", { type: "response.function_call_arguments.delta", item_id: "x", delta: "" }],
    ["delta: no item_id", { type: "response.function_call_arguments.delta", delta: "{}" }],
    ["delta: no delta field", { type: "response.function_call_arguments.delta", item_id: "x" }],
    ["done: no item_id", { type: "response.function_call_arguments.done", item_id: undefined, arguments: "{}" }],
    ["done: no arguments", { type: "response.function_call_arguments.done", item_id: "x" }],
    ["output_item.added: non-function_call item type", { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "x" } }],
    ["output_item.added: no item at all", { type: "response.output_item.added", output_index: 0 }],
    ["output_item.added: wrong chunk.type, otherwise-valid item", { type: "response.wrong", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } }],
    ["delta: wrong chunk.type, otherwise-valid item_id/delta", { type: "response.wrong", item_id: "item-1", delta: "{}" }],
    ["done: wrong chunk.type, otherwise-valid item_id/arguments", { type: "response.wrong", item_id: "item-1", arguments: "{}" }],
  ];

  it.each(malformedResponsesShapes)("malformed/deviant shape (%s) fabricates no tool call and reaches no executable authority", (_label, raw) => {
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAIStreamAdapter();
    const events = adapter.push(raw);
    expect(events).toHaveLength(0);
    for (const e of events) gate.push(e);
    const final = gate.finish();
    expect(final.decisions).toHaveLength(0);
  });

  it("a malformed delta (missing .delta) targeting an EXISTING call leaves its accumulated argument bytes completely unchanged, and it still executes with exactly the original value", () => {
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAIStreamAdapter();
    for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(e);
    for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"real"}' })) gate.push(e);
    const malformedEvents = adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1" }); // no .delta
    expect(malformedEvents).toHaveLength(0);
    for (const e of malformedEvents) gate.push(e);
    for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
    for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({ q: "real" });
  });

  it("a delta whose item_id targets NO known call (a stray/wrong identity) does not attach to a real call's evidence and creates no phantom call", () => {
    // The adapter itself still normalizes a stray item_id into a real event
    // (it has no way to know identities it was never told about) - the
    // coordinator's own handleArgumentsDelta() is what refuses to attribute
    // an unregistered sourceKey (`if (!internalId) return;`). This proves
    // that defense holds end-to-end: exactly one decision exists, and its
    // value is the real call's own bytes, uncontaminated.
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAIStreamAdapter();
    for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(e);
    for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"real"}' })) gate.push(e);
    for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-999", delta: '{"evil":true}' })) gate.push(e);
    for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
    for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
    const final = gate.finish();
    expect(final.decisions).toHaveLength(1);
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({ q: "real" });
  });

  // --- Group 2: response-prefix dispatch (chunk.type?.startsWith("response.")).
  it("response-prefix dispatch: a valid Responses API type creates a call, an arbitrary non-response type creates nothing, and a legacy Chat-Completions-shaped event (no .type at all) routes to the legacy path instead - never cross-wired", () => {
    const validAdapter = new OpenAIStreamAdapter();
    const validEvents = validAdapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    expect(validEvents[0]?.type).toBe("tool_call_start");

    const arbitraryAdapter = new OpenAIStreamAdapter();
    const arbitraryEvents = arbitraryAdapter.push({ type: "some.other.type", item_id: "x", delta: "{}" });
    expect(arbitraryEvents).toHaveLength(0);

    const legacyAdapter = new OpenAIStreamAdapter();
    const legacyEvents = legacyAdapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }] } }] });
    const legacyStart = expectDefined(legacyEvents.find((e) => e.type === "tool_call_start"));
    // The legacy path's sourceKey shape ("choice:N/tool-index:N") proves this
    // went through OpenAICompatibleStreamAdapter delegation, not the
    // Responses API branch (which would use "output-item:...").
    expect((legacyStart as { callRef: { sourceKey: string } }).callRef.sourceKey).toBe("choice:0/tool-index:0");
  });

  it("a raw event carrying BOTH a non-Responses-API .type AND a legacy-shaped .choices array still routes to the legacy path - the response-prefix check does not silently swallow it", () => {
    // The "arbitrary non-response type" case above proves nothing was
    // fabricated; this proves the inverse failure mode - that a wrongly-
    // permissive prefix check couldn't make the adapter incorrectly consume
    // and discard a raw event that actually carries real, valid legacy
    // tool-call evidence merely because it also has an unrelated .type field.
    const adapter = new OpenAIStreamAdapter();
    const events = adapter.push({
      type: "not_a_response_type",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }] } }],
    });
    expect(events.map((e) => e.type)).toEqual(["tool_call_start", "tool_call_arguments_delta"]);
  });

  it("handles response.output_item.done", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    const events = a.push({ type: "response.output_item.done", item: { id: "item-1" } });
    expect(events[0]?.type).toBe("tool_call_end");
  });

  it("handles response.completed", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ type: "response.completed", response: { status: "completed" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("complete");
  });

  it("response.completed with no response field at all does not throw", () => {
    const a = new OpenAIStreamAdapter();
    expect(() => a.push({ type: "response.completed" })).not.toThrow();
  });

  it("response.incomplete with no response field at all does not throw", () => {
    // Every existing test always supplies `response` (at minimum
    // {status:...}). The optional chain protecting `chunk.response` itself
    // is otherwise untested.
    const a = new OpenAIStreamAdapter();
    expect(() => a.push({ type: "response.incomplete" })).not.toThrow();
  });

  it("handles response.incomplete with max_output_tokens as a length/truncation signal", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("length");
    expect((end as { providerReason?: string })?.providerReason).toBe("max_output_tokens");
  });

  it("P4.1 Phase 9: response.incomplete/max_output_tokens cannot execute a SYNTACTICALLY COMPLETE tool call - JSON shape alone is never sufficient, provider-confirmed length truncation must still fail closed", () => {
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAIStreamAdapter();
    for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "toolA" } })) gate.push(e);
    // Genuinely, syntactically COMPLETE - not truncated JSON.
    for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"a":1}' })) gate.push(e);
    for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
    // The provider itself confirms the WHOLE response was cut short by its
    // own output budget - even though this one item's JSON happens to look
    // complete, that completeness was never confirmed as genuine intent.
    for (const e of adapter.push({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } })) gate.push(e);

    const final = gate.finish();
    const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
    expect(a.evidence.structurallyComplete).toBe(true); // the JSON really is valid and closed
    expect(a.action).not.toBe("execute"); // but never executable under a length-truncated stream
    expect(gate.takeDecision(a.internalId)).toBeUndefined();
  });

  it("handles response.incomplete with content_filter as a content-filtered diagnostic", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
    });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect((diag as { code?: string })?.code).toBe("E_CONTENT_FILTERED");
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("cancelled");
    expect((end as { providerReason?: string })?.providerReason).toBe("content_filter");
  });

  it("handles response.incomplete with an unrecognized reason by failing closed as unknown", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "some_future_reason" } },
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
    expect((end as { providerReason?: string })?.providerReason).toBe("some_future_reason");
  });

  it("handles response.incomplete with missing incomplete_details by failing closed as unknown", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ type: "response.incomplete", response: { status: "incomplete" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
    expect((end as { providerReason?: string })?.providerReason).toBe("incomplete");
  });

  it("handles error type in Responses API", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ type: "error" });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("provider_error");
  });

  it("response.failed with no response field at all does not throw", () => {
    const a = new OpenAIStreamAdapter();
    expect(() => a.push({ type: "response.failed" })).not.toThrow();
  });

  it("handles response.failed as a provider_error (was previously dropped entirely)", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.failed",
      response: { status: "failed", error: { code: "server_error", message: "boom" } },
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("provider_error");
    expect((end as { providerReason?: string })?.providerReason).toBe("server_error");
  });

  it("handles response.failed with no error.code by falling back to a fixed providerReason", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ type: "response.failed", response: { status: "failed" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { providerReason?: string })?.providerReason).toBe("response.failed");
  });

  it("handles legacy function_call format name delta", () => {
    const a = new OpenAIStreamAdapter();
    // first push creates the call
    a.push({ choices: [{ index: 0, delta: { function_call: { name: "search" } } }] });
    // second push with name delta (rare but valid)
    const events = a.push({ choices: [{ index: 0, delta: { function_call: { name: "_v2" } } }] });
    expect(events[0]?.type).toBe("tool_call_name_delta");
  });

  it("a legacy name delta's callRef correlates to the SAME call as its own start, not a phantom or an unrelated concurrent Responses API call", () => {
    // The legacy singular `function_call` format has no per-call index of
    // its own (this.legacySourceKey is one fixed string) - a genuine
    // multi-LEGACY-call scenario isn't something this format can represent,
    // so the meaningful isolation proof is against a *different*,
    // concurrently-tracked Responses API call instead: the fixed legacy
    // sourceKey must never collide with or leak into a real
    // "output-item:..." call. Checked structurally (coordinator snapshot),
    // not through to a gate decision: pushing a Responses API terminal
    // (response.completed) into a coordinator that also has an open legacy
    // call triggers a separate, real, already-reported production gap
    // (E_STREAM_ENDED_WITH_OPEN_CALL on the never-tool_call_end'd legacy
    // call - see the P1 report's NEW PRODUCTION BUG CANDIDATE) that is not
    // what this test is about; asserting gate-level executability here
    // would incorrectly launder that bug into an intended assertion.
    const a = new OpenAIStreamAdapter();
    const coord = new DefaultToolCallStreamCoordinator();
    for (const e of a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "responses_call" } })) coord.push(e);
    for (const e of a.push({ choices: [{ index: 0, delta: { function_call: { name: "search" } } }] })) coord.push(e);
    for (const e of a.push({ choices: [{ index: 0, delta: { function_call: { name: "_v2" } } }] })) coord.push(e);
    const snap = coord.snapshot();
    expect(snap.calls).toHaveLength(2);
    const responsesCall = expectDefined(snap.calls.find((c) => c.name === "responses_call"));
    const legacyCall = expectDefined(snap.calls.find((c) => c.name === "search_v2"));
    expect(responsesCall.internalId).not.toBe(legacyCall.internalId);
  });

  it("the FIRST legacy function_call push (before any hasLegacyFunctionCall state exists) produces tool_call_start, not a name delta", () => {
    // The test above only inspects the SECOND push's result, which is
    // "tool_call_name_delta" either way whether or not the adapter's
    // internal `hasLegacyFunctionCall` flag correctly started false - it
    // never proves the FIRST push actually started the call's lifecycle.
    const a = new OpenAIStreamAdapter();
    const events = a.push({ choices: [{ index: 0, delta: { function_call: { name: "search" } } }] });
    expect(events[0]?.type).toBe("tool_call_start");
  });

  it("a full legacy function_call sequence (start, arguments) correlates to one call with the correct merged name and arguments in a real coordinator", () => {
    // Proves the callRef.sourceKey used across handleStart/handleArgumentsDelta
    // for the legacy singular function_call path stays consistent - not just
    // that each individually-returned event has the right .type.
    const a = new OpenAIStreamAdapter();
    const coord = new DefaultToolCallStreamCoordinator();
    for (const e of a.push({ choices: [{ index: 0, delta: { function_call: { name: "search" } } }] })) coord.push(e);
    for (const e of a.push({ choices: [{ index: 0, delta: { function_call: { arguments: '{"q":"x"}' } } }] })) coord.push(e);
    const snap = coord.snapshot();
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.name).toBe("search");
    expect(snap.calls[0]?.parser.receivedBytes).toBeGreaterThan(0);
  });

  it("handles legacy function_call finish_reason cancelled", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ choices: [{ index: 0, finish_reason: "cancelled" }] });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("an UNRECOGNIZED legacy finish_reason maps to 'unknown', not a mislabeled 'cancelled' (the trailing else-if's own comparison, checked at the raw normalized-event level)", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ choices: [{ index: 0, finish_reason: "content_filter" }] });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
  });

  it("handles legacy function_call finish_reason stop/function_call/tool_calls/length", () => {
    for (const [finish_reason, expected] of [["stop", "complete"], ["function_call", "complete"], ["tool_calls", "complete"], ["length", "length"]] as const) {
      const a = new OpenAIStreamAdapter();
      const events = a.push({ choices: [{ index: 0, finish_reason }] });
      const end = events.find((e) => e.type === "provider_stream_end");
      expect((end as { reason?: string })?.reason, `finish_reason ${finish_reason}`).toBe(expected);
    }
  });

  it("handles legacy function_call arguments delta", () => {
    const a = new OpenAIStreamAdapter();
    // first push creates the call (name only, no arguments yet)
    a.push({ choices: [{ index: 0, delta: { function_call: { name: "search" } } }] });
    // second push carries only arguments - exercises the `if (fc.arguments)` branch
    // independently of the name-delta branch above it.
    const events = a.push({ choices: [{ index: 0, delta: { function_call: { arguments: '{"q":"x"}' } } }] });
    const delta = events.find((e) => e.type === "tool_call_arguments_delta");
    expect((delta as { delta?: string })?.delta).toBe('{"q":"x"}');
  });

  it("finish() on a legacy function_call stream (no finish_reason chunk ever pushed) closes the open call and synthesizes its own provider_stream_end", () => {
    const a = new OpenAIStreamAdapter();
    // Only the raw legacy singular `function_call` path is used, which never
    // touches the internal compatibleAdapter - so compatibleAdapter.finish()
    // has nothing to report, and finish() must fall through to its own
    // synthesis branch rather than an empty/compatible one. That branch must
    // also close the still-open legacy call (tool_call_end) before its own
    // provider_stream_end - see the OpenAI legacy function_call termination
    // bug fix (src/providers/openai.ts's legacyCallOpen).
    a.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] });
    const events = a.finish({ reason: "complete", providerReason: "stop" });
    expect(events.map((e) => e.type)).toEqual(["tool_call_end", "provider_stream_end"]);
    expect((events[0] as { reason?: string })?.reason).toBe("complete");
    expect((events[1] as { reason?: string })?.reason).toBe("complete");
    expect((events[1] as { providerReason?: string })?.providerReason).toBe("stop");
  });

  it("finish() with no arguments at all does not throw and defaults reason to 'unknown'", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.finish();
    expect(events.some((e) => e.type === "provider_stream_end" && (e as { reason?: string }).reason === "unknown")).toBe(true);
  });

  it("finish() with no arguments on a legacy function_call stream also defaults reason to 'unknown', on both the tool_call_end and the provider_stream_end", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] });
    const events = a.finish();
    expect(events.map((e) => e.type)).toEqual(["tool_call_end", "provider_stream_end"]);
    expect((events[0] as { reason?: string })?.reason).toBe("unknown");
    expect((events[1] as { reason?: string })?.reason).toBe("unknown");
  });

  // --- Group 6: finish()'s delegation-branch-selection
  // (`compatibleEvents.length > 0 && !this.hasLegacyFunctionCall`). Each
  // scenario proves BOTH the correct normalized event shape AND the correct
  // final gate decision for the exact call path that reaches finish()
  // without ever inspecting the private flags that select the branch.
  it("finish() branch selection 1: an in-progress Responses API call synthesizes its own terminal (compatibleAdapter has nothing to report) and executes", () => {
    const gate = createToolCallExecutionGate();
    const a = new OpenAIStreamAdapter();
    for (const e of a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(e);
    for (const e of a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: "{}" })) gate.push(e);
    for (const e of a.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
    const finishEvents = a.finish({ reason: "complete" });
    expect(finishEvents).toHaveLength(1);
    expect(finishEvents[0]?.type).toBe("provider_stream_end");
    for (const e of finishEvents) gate.push(e);
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeDefined();
  });

  it("finish() branch selection 2: an in-progress legacy tool_calls (compatible-format) call delegates - compatibleAdapter's own tool_call_end + provider_stream_end are forwarded - and executes", () => {
    const gate = createToolCallExecutionGate();
    const a = new OpenAIStreamAdapter();
    for (const e of a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }] } }] })) gate.push(e);
    const finishEvents = a.finish({ reason: "complete" });
    expect(finishEvents.map((e) => e.type)).toEqual(["tool_call_end", "provider_stream_end"]);
    for (const e of finishEvents) gate.push(e);
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeDefined();
  });

  it("finish() branch selection 3: an in-progress legacy singular function_call call synthesizes its own terminal via the legacy-synthesis fallback (not the compatible-forwarding branch), closes the call, and executes", () => {
    const gate = createToolCallExecutionGate();
    const a = new OpenAIStreamAdapter();
    for (const e of a.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] })) gate.push(e);
    const finishEvents = a.finish({ reason: "complete" });
    // Correct branch selected (the legacy-synthesis fallback, not the
    // compatible-forwarding branch): both branches now produce a
    // [tool_call_end, provider_stream_end] pair after the termination fix,
    // so the distinguishing signal is the tool_call_end's own callRef -
    // the fixed legacy sourceKey, not compatible-forwarding's
    // "choice:N/tool-index:N" shape (compare scenario 2 above).
    expect(finishEvents.map((e) => e.type)).toEqual(["tool_call_end", "provider_stream_end"]);
    expect((finishEvents[0] as { callRef?: { sourceKey?: string } })?.callRef?.sourceKey).toBe("legacy-function-call");
    for (const e of finishEvents) gate.push(e);
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({});
  });

  it("finish() branch selection 4: no active call at all produces only a terminal event and no decisions", () => {
    const gate = createToolCallExecutionGate();
    const a = new OpenAIStreamAdapter();
    const finishEvents = a.finish({ reason: "complete" });
    expect(finishEvents).toHaveLength(1);
    expect(finishEvents[0]?.type).toBe("provider_stream_end");
    for (const e of finishEvents) gate.push(e);
    expect(gate.finish().decisions).toHaveLength(0);
  });

  it("finish() called directly twice (no push in between) is idempotent - the second call produces nothing", () => {
    const a = new OpenAIStreamAdapter();
    const first = a.finish({ reason: "cancelled" });
    const second = a.finish({ reason: "cancelled" });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  // --- Group 7: finished-flag lifecycle. push() itself never gates on
  // `this.finished` (by P0 design - GHSA-3xpw-9694-2xxp - every one of these
  // termination mechanisms still forwards a genuine SECOND push of the same
  // shape rather than silently dropping it, verified above and in
  // test/security/post-terminal-adapter-evidence.test.ts). The observable
  // consequence of each termination mechanism actually setting
  // `this.finished = true` is narrower and specific: whether a SUBSEQUENT
  // finish() call correctly no-ops instead of firing again.
  const finishedFlagCases: Array<[string, () => ProviderStreamAdapter<unknown>, (a: ProviderStreamAdapter<unknown>) => void]> = [
    ["Anthropic: error event", () => new AnthropicStreamAdapter(), (a) => { a.push({ type: "error", error: { type: "overloaded_error" } }); }],
    ["OpenAI: error-type event", () => new OpenAIStreamAdapter(), (a) => { a.push({ type: "error" }); }],
    ["OpenAI: response.failed", () => new OpenAIStreamAdapter(), (a) => { a.push({ type: "response.failed", response: { error: { code: "x" } } }); }],
    ["OpenAI: response.incomplete", () => new OpenAIStreamAdapter(), (a) => { a.push({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }); }],
    ["OpenAI: legacy finish_reason", () => new OpenAIStreamAdapter(), (a) => { a.push({ choices: [{ index: 0, finish_reason: "stop" }] }); }],
  ];

  it.each(finishedFlagCases)("after %s fires, a subsequent finish() call is idempotent (produces nothing)", (_label, makeAdapter, trigger) => {
    const adapter = makeAdapter();
    trigger(adapter);
    const events = adapter.finish({ reason: "cancelled" });
    expect(events).toHaveLength(0);
  });

  it("handles non-object event", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push(42);
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it.each([
    ["no choices field at all", {}],
    ["choices: empty array", { choices: [] }],
    ["choices: null", { choices: null }],
    ["choices: wrong type (string)", { choices: "wrong" }],
  ])("empty/absent/malformed .choices (%s) does not crash, fabricate a tool call, or grant executable authority", (_label, raw) => {
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAIStreamAdapter();
    let events: readonly ReturnType<typeof adapter.push>[number][] = [];
    expect(() => { events = adapter.push(raw); }).not.toThrow();
    expect(events).toHaveLength(0);
    for (const e of events) gate.push(e);
    expect(gate.finish().decisions).toHaveLength(0);
  });

  it("sequence numbers are strictly increasing across a realistic multi-branch stream (public contract: NormalizedEventBase.sequence is documented as a 'deterministic sequence number')", () => {
    const a = new OpenAIStreamAdapter();
    const events = [
      ...a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } }),
      ...a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"x"}' }),
      ...a.push({ type: "response.output_item.done", item: { id: "item-1" } }),
      ...a.push({ type: "response.completed", response: { status: "completed" } }),
    ];
    for (let i = 1; i < events.length; i++) {
      expect(expectDefined(events[i]).sequence, `event ${i} sequence`).toBeGreaterThan(expectDefined(events[i - 1]).sequence);
    }
    expect(events.length).toBeGreaterThan(1);
  });

  // ---------------------------------------------------------------------
  // P4.1 / F-2: item-local post-terminal evidence hardening.
  // ---------------------------------------------------------------------
  describe("item-local post-terminal evidence (response.output_item.done) is hardened, not silently merged", () => {
    it("A. existing item, INCOMPLETE before done: a later delta that closes the JSON with injected content is rejected, not executed", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"a":1' })) gate.push(e);
      for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);

      const lateEvents = adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: ',"evil":true}' });
      const diag = expectDefined(lateEvents.find((e) => e.type === "provider_diagnostic"));
      expect((diag as { code?: string }).code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect((diag as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("output-item:item-1");
      expect(lateEvents.some((e) => e.type === "tool_call_arguments_delta")).toBe(false); // never merged as normal evidence
      for (const e of lateEvents) gate.push(e);

      for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });

    it("B. existing item, ALREADY structurally complete before done: a later delta is rejected via the actual diagnostic, not merely by coincidental JSON trailing-data failure", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"a":1}' })) gate.push(e); // already closed
      for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);

      const lateEvents = adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"more":true}' });
      // Assert the actual protocol-violation diagnostic exists - not merely
      // that the call ends up non-executable, which trailing-data parse
      // failure alone would also produce.
      const diag = expectDefined(lateEvents.find((e) => e.type === "provider_diagnostic"));
      expect((diag as { code?: string }).code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect(lateEvents.some((e) => e.type === "tool_call_arguments_delta")).toBe(false);
      for (const e of lateEvents) gate.push(e);

      for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });

    it("C. multiple output items: A done + late A evidence does not poison B, which remains executable (exact attribution, not stream-wide)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-A", call_id: "call-A", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "item-B", call_id: "call-B", name: "toolB" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-A", delta: '{"a":1' })) gate.push(e);
      for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-A" } })) gate.push(e);

      // Late evidence for the already-done A.
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-A", delta: ',"evil":true}' })) gate.push(e);

      // B continues and finishes completely normally, unaffected.
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-B", delta: '{"b":2}' })) gate.push(e);
      for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-B" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });

    it("A2. same hardening applies to response.function_call_arguments.done (the final-arguments shape), not only .delta", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"a":1}' })) gate.push(e);
      for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);

      const lateEvents = adapter.push({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: '{"a":1,"evil":true}' });
      const diag = expectDefined(lateEvents.find((e) => e.type === "provider_diagnostic"));
      expect((diag as { code?: string }).code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect((diag as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("output-item:item-1");
      expect(lateEvents.some((e) => e.type === "tool_call_arguments_delta")).toBe(false);
      for (const e of lateEvents) gate.push(e);

      for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });

    it("D. a NEW, never-started item_id after another item is done is NOT conflated with late evidence for the done item - existing before-start identity behavior is preserved", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-A", call_id: "call-A", name: "toolA" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-A", delta: '{"a":1}' })) gate.push(e);
      for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-A" } })) gate.push(e);

      // A delta for a DIFFERENT, never-added item_id - not "late evidence
      // for A", a genuinely distinct identity that was simply never started.
      const events = adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-never-started", delta: "{}" });
      // doneOutputItemIds only ever contains item-A - item-never-started is
      // not in it, so this must NOT be attributed to A's TOOL_ARGUMENTS_AFTER_END
      // path. It is still not tracked as a real call (no tool_call_start
      // ever preceded it) - the coordinator resolves it to nothing.
      expect(events.some((e) => (e as { callRef?: { sourceKey?: string } }).callRef?.sourceKey === "output-item:item-A")).toBe(false);
      for (const e of events) gate.push(e);

      for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      // A's own clean, legitimate authority is unaffected by the unrelated
      // never-started identity's delta.
      expect(a.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Compatible
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenAICompatibleStreamAdapter — uncovered branches", () => {
  it("emits diagnostic on event after stream end", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ index: 0, finish_reason: "tool_calls" }] });
    // choice.finish_reason alone is choice-local and does not set the
    // adapter's global `finished` state (see the class-level lifecycle
    // doc) - an explicit finish() is what this W_EVENT_AFTER_STREAM_END
    // guard actually gates on. Post-terminal evidence for a single
    // already-terminal CHOICE without a global finish() is a distinct,
    // separately-covered path (E_TOOL_ARGUMENTS_AFTER_END - see
    // openai-compatible-choice-lifecycle.test.ts's own
    // "CHOICE-LOCAL POST-TERMINAL EVIDENCE" group).
    a.finish();
    const events = a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] });
    expect(events[0]?.type).toBe("provider_diagnostic");
    expect((events[0] as { code?: string })?.code).toBe("W_EVENT_AFTER_STREAM_END");
  });

  it("push(null) and push(undefined) do not throw - the malformed-raw-event guard runs before any property access on rawEvent", () => {
    for (const raw of [null, undefined]) {
      const a = new OpenAICompatibleStreamAdapter();
      let events: readonly ReturnType<typeof a.push>[number][] = [];
      expect(() => { events = a.push(raw); }, String(raw)).not.toThrow();
      expect(events[0]?.type, String(raw)).toBe("provider_diagnostic");
      expect((events[0] as { code?: string })?.code, String(raw)).toBe("E_PROVIDER_EVENT_MALFORMED");
    }
  });

  it("handles tool_call with missing index", () => {
    const a = new OpenAICompatibleStreamAdapter();
    const events = a.push({ choices: [{ index: 0, delta: { tool_calls: [{ function: { name: "test" } }] } }] });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect(diag).toBeDefined();
    expect((diag as { code?: string })?.code).toBe("E_PROVIDER_EVENT_MALFORMED");
  });

  it("handles late identity update (toolCallId on existing index)", () => {
    const a = new OpenAICompatibleStreamAdapter();
    // First: start with no id
    a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "test" } }] } }] });
    // Then: send id separately
    const events = a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-xyz" }] } }] });
    expect(events[0]?.type).toBe("tool_call_identity");
  });

  // --- Group 8: remaining security-relevant survivors specific to
  // OpenAI-Compatible.
  it("terminal mapping: finish_reason 'stop' maps to StreamEndReason 'complete' (authority-boundaries.test.ts's own terminal-reasons test covers 'length'/'cancelled' but not 'stop')", () => {
    // choice.finish_reason is choice-local; finish() aggregates it onto the
    // one real provider_stream_end (see class-level lifecycle-contract doc).
    const adapter = new OpenAICompatibleStreamAdapter();
    adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
    const events = adapter.finish();
    expect(events.find((e) => e.type === "provider_stream_end")?.reason).toBe("complete");
  });

  it("an UNRECOGNIZED finish_reason maps to 'unknown', not a mislabeled 'cancelled' (the trailing else-if's own comparison, checked at the raw normalized-event level)", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    adapter.push({ choices: [{ index: 0, finish_reason: "content_filter" }] });
    const events = adapter.finish();
    expect(events.find((e) => e.type === "provider_stream_end")?.reason).toBe("unknown");
  });

  it("an UNRECOGNIZED finish_reason still reaches the identical safe gate outcome as literal 'cancelled' - neither ever fabricates executable authority", () => {
    // Belt-and-suspenders beyond the raw-event-level check above: even
    // though "unknown" and "cancelled" ARE genuinely distinct
    // StreamEndReason values (proven above), both independently fail closed
    // at the gate - coordinator.ts's finishCall() forces status "cancelled"
    // for a literal "cancelled" reason, while "unknown" instead falls
    // through to the parser's own outcome, whose own executable contract
    // also requires reason === "complete" specifically. Neither path can
    // ever produce a fabricated "execute".
    for (const finish_reason of ["cancelled", "content_filter"]) {
      const gate = createToolCallExecutionGate();
      const a = new OpenAICompatibleStreamAdapter();
      for (const e of a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "f", arguments: "{}" } }] } }] })) gate.push(e);
      for (const e of a.push({ choices: [{ index: 0, finish_reason }] })) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action, finish_reason).toBe("retry");
      expect((decision as { reason?: string }).reason, finish_reason).toBe("stream_incomplete");
    }
  });

  it("a tool_call entry carrying an id but no function field at all does not throw and does not fabricate a name/arguments", () => {
    // Every existing test always supplies `function` alongside `id`; a real
    // provider's late-identity-only delta (id arriving with no function
    // object at all, as opposed to a function object with a missing name)
    // is untested and `tc.function?.name` protects exactly this case.
    const adapter = new OpenAICompatibleStreamAdapter();
    let events: readonly ReturnType<typeof adapter.push>[number][] = [];
    expect(() => { events = adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-xyz" }] } }] }); }).not.toThrow();
    const start = expectDefined(events.find((e) => e.type === "tool_call_start"));
    expect((start as { name?: string }).name).toBeUndefined();
  });

  it("a late identity update's callRef actually correlates to the same call in a real coordinator, not just the right event type", () => {
    // The test above only checks the returned event's `.type` - not that its
    // `callRef.sourceKey` still correctly names the SAME call it was meant
    // for. A wrong/blanked sourceKey here would make handleIdentity() silently
    // no-op (coordinator.ts: `if (!internalId) return;`) instead of throwing
    // or otherwise announcing itself - this proves the correlation survives.
    const a = new OpenAICompatibleStreamAdapter();
    const coord = new DefaultToolCallStreamCoordinator();
    for (const e of a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "test" } }] } }] })) coord.push(e);
    for (const e of a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call-xyz" }] } }] })) coord.push(e);
    const snap = coord.snapshot();
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.toolCallId).toBe("call-xyz");
  });

  it("handles name delta on known index", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "search" } }] } }] });
    const events = a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "_v2" } }] } }] });
    const nameDelta = events.find((e) => e.type === "tool_call_name_delta");
    expect(nameDelta).toBeDefined();
  });

  it("a late name delta's callRef actually correlates to the same call in a real coordinator, not just the right event type", () => {
    const a = new OpenAICompatibleStreamAdapter();
    const coord = new DefaultToolCallStreamCoordinator();
    for (const e of a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "search" } }] } }] })) coord.push(e);
    for (const e of a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "_v2" } }] } }] })) coord.push(e);
    const snap = coord.snapshot();
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.name).toBe("search_v2");
  });

  it("finish() emits end events for known source keys", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { name: "search", arguments: '{"' } }] } }] });
    const events = a.finish({ reason: "network_error" });
    expect(events.some((e) => e.type === "tool_call_end")).toBe(true);
    expect(events.some((e) => e.type === "provider_stream_end")).toBe(true);
  });

  it("finish() is idempotent", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ index: 0, finish_reason: "tool_calls" }] });
    a.finish();
    const events = a.finish();
    expect(events).toHaveLength(0);
  });

  it("finish() with no arguments at all does not throw and defaults reason to 'unknown'", () => {
    const a = new OpenAICompatibleStreamAdapter();
    const events = a.finish();
    expect((events[0] as { reason?: string })?.reason).toBe("unknown");
  });

  it("finish() with no arguments closes a known in-progress call with reason 'unknown'", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }] } }] });
    const events = a.finish();
    const end = events.find((e) => e.type === "tool_call_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
  });

  it("handles non-object event", () => {
    const a = new OpenAICompatibleStreamAdapter();
    const events = a.push(null);
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it.each([
    ["no choices field at all", {}],
    ["choices: empty array", { choices: [] }],
    ["choices: null", { choices: null }],
    ["choices: wrong type (string)", { choices: "wrong" }],
  ])("empty/absent/malformed .choices (%s) does not crash, fabricate a tool call, or grant executable authority", (_label, raw) => {
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAICompatibleStreamAdapter();
    let events: readonly ReturnType<typeof adapter.push>[number][] = [];
    expect(() => { events = adapter.push(raw); }).not.toThrow();
    expect(events).toHaveLength(0);
    for (const e of events) gate.push(e);
    expect(gate.finish().decisions).toHaveLength(0);
  });

  it("sequence numbers are strictly increasing across a realistic multi-branch stream (public contract: NormalizedEventBase.sequence is documented as a 'deterministic sequence number')", () => {
    const a = new OpenAICompatibleStreamAdapter();
    const events = [
      ...a.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }] } }] }),
      ...a.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    ];
    for (let i = 1; i < events.length; i++) {
      expect(expectDefined(events[i]).sequence, `event ${i} sequence`).toBeGreaterThan(expectDefined(events[i - 1]).sequence);
    }
    expect(events.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenRouterStreamAdapter — uncovered branches", () => {
  it("handles non-object event", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.push("bad");
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it("handles null specifically (typeof null === 'object', the one falsy value the !rawEvent-only check doesn't catch on its own) without throwing", () => {
    // A string like "bad" doesn't distinguish `!rawEvent || typeof rawEvent
    // !== "object"` from a weakened `!rawEvent && typeof rawEvent !== "object"`
    // - a truthy non-object value satisfies the second clause either way, and
    // even a bypassed check here still safely falls through to the delegated
    // compatibleAdapter's own malformed-event guard. `null` is different:
    // `!null` is true but `typeof null === "object"`, so it is the one input
    // where the two clauses actually diverge - a weakened check would let it
    // reach `(rawEvent as OpenRouterEvent).error`, a direct property access
    // on `null`, which throws.
    const r = new OpenRouterStreamAdapter();
    let events: unknown[] = [];
    expect(() => { events = [...r.push(null)]; }).not.toThrow();
    expect((events[0] as { type?: string })?.type).toBe("provider_diagnostic");
  });

  it("handles chunk with error field", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.push({ error: "rate_limit_exceeded" });
    expect(events.some((e) => e.type === "provider_diagnostic")).toBe(true);
    expect(events.some((e) => e.type === "provider_stream_end")).toBe(true);
  });

  it("a provider error forces reject('provider_error') at the gate, not merely 'some diagnostic exists' (provider-error semantics)", () => {
    // The compatibleAdapter.finish() call this delegates to is passed a
    // literal { reason: "provider_error", providerReason: "error" } object.
    // If that object's `reason` field were ever lost, the delegated
    // adapter's own `meta?.reason ?? "unknown"` fallback would silently
    // downgrade the terminal reason to "unknown" - and decide.ts's universal
    // `streamEndReason === "provider_error"` fail-closed check would then
    // never fire, potentially letting an otherwise-structurally-valid call
    // execute despite the provider having reported an error.
    const gate = createToolCallExecutionGate();
    const r = new OpenRouterStreamAdapter();
    for (const e of r.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }] } }] })) gate.push(e);
    for (const e of r.push({ error: "rate_limit" })) gate.push(e);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("reject");
    expect((decision as { reason?: string }).reason).toBe("provider_error");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("handles chunk with error as object", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.push({ error: { code: 429, message: "Too many requests" } });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect(diag).toBeDefined();
    expect((diag as { message: string })?.message).toContain("429");
  });

  it("still forwards the delegated adapter's own post-terminal diagnostic instead of silently discarding it (GHSA-3xpw-9694-2xxp class)", () => {
    // This adapter's own outer `finished` flag no longer short-circuits
    // push() (see push()'s own comment) - so a push after the provider-error
    // shortcut below now falls through to the normal delegated path, where
    // the internal OpenAICompatibleStreamAdapter's own (untouched, still
    // guarded) push() recognizes it is itself already finished and returns
    // its real "W_EVENT_AFTER_STREAM_END" diagnostic rather than nothing.
    // That diagnostic is real, coordinator-meaningful content - not a
    // discarded event - which is exactly the invariant this suite covers.
    const r = new OpenRouterStreamAdapter();
    r.push({ error: "rate_limit" });
    const events = r.push({ choices: [{ index: 0, delta: { tool_calls: [] } }] });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("provider_diagnostic");
    expect((events[0] as { code?: string })?.code).toBe("W_EVENT_AFTER_STREAM_END");
  });

  it("finish() delegates to compatible adapter", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.finish({ reason: "cancelled" });
    expect(events.some((e) => e.type === "provider_stream_end")).toBe(true);
  });

  it("finish() is idempotent after error", () => {
    const r = new OpenRouterStreamAdapter();
    r.push({ error: "some error" });
    const events = r.finish();
    expect(events).toHaveLength(0);
  });

  it("finish() with no arguments at all does not throw and defaults reason to 'unknown'", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.finish();
    expect(events.some((e) => e.type === "provider_stream_end" && (e as { reason?: string }).reason === "unknown")).toBe(true);
  });

  it("sequence numbers are strictly increasing across a realistic multi-branch stream (public contract: NormalizedEventBase.sequence is documented as a 'deterministic sequence number')", () => {
    const r = new OpenRouterStreamAdapter();
    const events = [
      ...r.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{}" } }] } }] }),
      ...r.finish({ reason: "complete" }),
    ];
    for (let i = 1; i < events.length; i++) {
      expect(expectDefined(events[i]).sequence, `event ${i} sequence`).toBeGreaterThan(expectDefined(events[i - 1]).sequence);
    }
    expect(events.length).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator — uncovered branches
// ─────────────────────────────────────────────────────────────────────────────
describe("DefaultToolCallStreamCoordinator — uncovered branches", () => {
  function makeStartEvent(sourceKey: string, name = "search") {
    return {
      type: "tool_call_start" as const,
      sequence: 1,
      provider: "openai-compatible" as const,
      callRef: { sourceKey },
      name,
    };
  }

  function makeArgsEvent(sourceKey: string, delta: string) {
    return {
      type: "tool_call_arguments_delta" as const,
      sequence: 2,
      provider: "openai-compatible" as const,
      callRef: { sourceKey },
      delta,
    };
  }

  function makeEndEvent(sourceKey: string) {
    return {
      type: "tool_call_end" as const,
      sequence: 3,
      provider: "openai-compatible" as const,
      callRef: { sourceKey },
      reason: "complete" as const,
    };
  }

  function makeStreamEnd(reason = "complete" as const) {
    return {
      type: "provider_stream_end" as const,
      sequence: 99,
      provider: "openai-compatible" as const,
      reason,
    };
  }

  it("rejects events after stream end", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStreamEnd());
    const result = c.push(makeStartEvent("k1"));
    expect(result.accepted).toBe(false);
  });

  it("handles duplicate tool_call_start for same sourceKey", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1"));
    c.push(makeStartEvent("k1")); // duplicate
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect(diag).toBeDefined();
  });

  it("handles maxToolCalls limit", () => {
    const c = new DefaultToolCallStreamCoordinator({ maxToolCalls: 1 });
    c.push(makeStartEvent("k1"));
    c.push(makeStartEvent("k2")); // exceeds limit
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect(diag).toBeDefined();
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_COORDINATOR_LIMIT_CALLS");
  });

  it("handles maxNormalizedEvents limit", () => {
    const c = new DefaultToolCallStreamCoordinator({ maxNormalizedEvents: 2 });
    c.push(makeStartEvent("k1"));
    c.push(makeArgsEvent("k1", "{}"));
    const result = c.push(makeEndEvent("k1")); // 3rd event
    expect(result.accepted).toBe(false);
  });

  it("handles identity update with conflicting toolCallId", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push({ ...makeStartEvent("k1"), toolCallId: "id-1" });
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolCallId: "id-2", // conflicts
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_PROVIDER_IDENTITY_CONFLICT");
  });

  it("handles identity update with conflicting toolIndex", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push({ ...makeStartEvent("k1"), toolIndex: 0 });
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolIndex: 1, // conflicts
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_PROVIDER_INDEX_CONFLICT");
  });

  it("handles name_delta after call ended", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1"));
    c.push(makeEndEvent("k1"));
    c.push(makeStreamEnd());
    c.drainEvents();
    // try name delta after stream ended
    const result = c.push({
      type: "tool_call_name_delta",
      sequence: 5,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      delta: "_extra",
    });
    expect(result.accepted).toBe(false); // stream is finished
  });

  it("handles argument_delta after call ended", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1"));
    c.push(makeEndEvent("k1"));
    c.push(makeStreamEnd());
    const result = c.push(makeArgsEvent("k1", "{}"));
    expect(result.accepted).toBe(false); // stream is finished
  });

  it("handles tool_call_end for call with no name → E_TOOL_NAME_MISSING", () => {
    const c = new DefaultToolCallStreamCoordinator();
    // Start with no name
    c.push({
      type: "tool_call_start",
      sequence: 1,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
    });
    c.push(makeArgsEvent("k1", "{}"));
    c.push(makeEndEvent("k1"));
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_TOOL_NAME_MISSING");
  });

  it("handles stream end with open (not closed) call", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push(makeArgsEvent("k1", '{"q":"test"}'));
    // No tool_call_end before stream ends
    c.push(makeStreamEnd());
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_STREAM_ENDED_WITH_OPEN_CALL");
  });

  it("handles cancelled stream end reason", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push(makeArgsEvent("k1", '{"q":"test"}'));
    c.push({ type: "provider_stream_end", sequence: 99, provider: "openai-compatible", reason: "cancelled" });
    const events = c.drainEvents();
    const finished = events.find((e) => e.type === "tool_call_finished");
    expect((finished as { outcome: string })?.outcome).toBe("cancelled");
  });

  it("handles provider_diagnostic event with callRef", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push({
      type: "provider_diagnostic",
      sequence: 5,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      code: "E_SOMETHING",
      severity: "warning",
      message: "Provider-level warning",
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect(diag).toBeDefined();
  });

  it("snapshot() reflects current state", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    const snap = c.snapshot();
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.name).toBe("search");
    expect(snap.isFinished).toBe(false);
  });

  it("finish() with reason closes open calls", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push(makeArgsEvent("k1", '{"q":"test"}'));
    c.push(makeEndEvent("k1")); // close it
    const result = c.finish({ reason: "complete" });
    expect(result.calls).toHaveLength(1);
  });

  it("identity update on unknown sourceKey is a no-op", () => {
    const c = new DefaultToolCallStreamCoordinator();
    // No start for "k-unknown"
    c.push({
      type: "tool_call_identity",
      sequence: 1,
      provider: "openai-compatible",
      callRef: { sourceKey: "k-unknown" },
      toolCallId: "id-x",
    });
    const events = c.drainEvents();
    // no diagnostic expected for unknown identity with no start
    expect(events).toHaveLength(0);
  });

  it("tool_name exceeding limit marks call invalid", () => {
    const c = new DefaultToolCallStreamCoordinator({ maxToolNameBytes: 5 });
    c.push(makeStartEvent("k1"));
    c.push({
      type: "tool_call_name_delta",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      delta: "a_very_long_tool_name_exceeding_limit",
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as { diagnostic: { code: string } })?.diagnostic?.code).toBe("E_TOOL_NAME_LIMIT");
  });

  it("identity update providing new toolCallId emits identity_updated event", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1")); // no toolCallId or toolIndex initially
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolCallId: "new-id",
    });
    const events = c.drainEvents();
    const identity = events.find((e) => e.type === "tool_call_identity_updated");
    expect(identity).toBeDefined();
  });

  it("identity update for same id and index is a no-op (no changed event)", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push({ ...makeStartEvent("k1"), toolCallId: "same-id", toolIndex: 0 });
    c.drainEvents(); // clear
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolCallId: "same-id",
      toolIndex: 0,
    });
    const events = c.drainEvents();
    // No identity_updated since nothing changed
    const identity = events.find((e) => e.type === "tool_call_identity_updated");
    expect(identity).toBeUndefined();
  });
});
