// ---------------------------------------------------------------------------
// Regression suite for GHSA-3xpw-9694-2xxp.
//
// Invariant under test: no ExecuteDecision may be released if any relevant
// lifecycle or identity evidence is missing, unsafe, contradictory,
// ambiguous, duplicated, reordered in an authority-invalidating way, or
// arrives after the state on which a positive decision was based. Once
// execution authority becomes unsafe, it must never be upgraded back to
// executable during that stream.
//
// Every case below proves execution authority ITSELF is unavailable
// (`takeDecision()` returns `undefined`, or the settled decision's `action`
// is not `"execute"`) - not merely that a diagnostic was recorded. Before the
// fix in this same commit, every "late evidence" and "conflicting identity"
// case here obtained a live `execute` decision from `takeDecision()`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { AiSdkStreamAdapter } from "../../src/providers/ai-sdk.js";

/** Pushes a clean, complete "danger" call and returns the guard pre-finish. */
function guardWithCompleteCall() {
  const guard = createAiSdkExecutionGuard();
  guard.push({ type: "tool-input-start", id: "c1", toolName: "danger" });
  guard.push({ type: "tool-input-delta", id: "c1", delta: '{"x":1}' });
  guard.push({ type: "tool-input-end", id: "c1" });
  guard.push({ type: "finish", finishReason: "tool-calls" });
  return guard;
}

describe("GHSA-3xpw-9694-2xxp — stream-termination authority survives late/ambiguous evidence", () => {
  describe("late evidence after a complete terminal, before takeDecision()", () => {
    it("1: a final argument delta after the terminal revokes authority", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "tool-input-delta", id: "c1", delta: '{"y":2}' });

      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("2: a provider error after the terminal revokes authority", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "error", error: new Error("late provider failure") });

      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("3: an abort after the terminal revokes authority", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "abort", reason: "user_cancelled" });

      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("4a: SDK tool-result evidence after the terminal revokes authority", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "tool-result", toolCallId: "c1", toolName: "danger" });

      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("4b: SDK tool-error evidence after the terminal revokes authority", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "tool-error", toolCallId: "c1", toolName: "danger", error: "boom" });

      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("5: a conflicting second terminal (tool-calls then error) revokes authority", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "error", error: new Error("contradicts the prior clean finish") });

      const final = guard.finish();
      expect(final.decisions[0]?.action).not.toBe("execute");
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("5b: a duplicate identical second terminal also revokes authority (sticky, not just non-conflicting)", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "finish", finishReason: "tool-calls" });

      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("6: evidence normalized by the coordinator after finish() but pushed at the raw gate layer before takeDecision() also revokes authority", () => {
      // Lower-level API, bypassing the adapter entirely - proves the fix
      // lives at the coordinator/gate boundary, not only in the adapter.
      const gate = createToolCallExecutionGate();
      const adapter = new AiSdkStreamAdapter();
      for (const raw of [
        { type: "tool-input-start", id: "c1", toolName: "danger" },
        { type: "tool-input-delta", id: "c1", delta: '{"x":1}' },
        { type: "tool-input-end", id: "c1" },
        { type: "finish", finishReason: "tool-calls" },
      ]) {
        for (const event of adapter.push(raw)) gate.push(event);
      }
      const final = gate.finish();
      expect(final.decisions[0]?.action).toBe("execute"); // control: clean stream still executes

      // Push a normalized post-terminal event directly at the gate, after
      // finish() has already frozen a result, before takeDecision() consumes it.
      gate.push({
        type: "provider_stream_end",
        sequence: 999,
        provider: "ai-sdk",
        reason: "provider_error",
      });

      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(gate.takeDecision(internalId)).toBeUndefined();
    });

    it("6b: the same pattern through the documented high-level guard API, isolated from a second finish() call", () => {
      // Unlike every other case in this describe block (which call finish()
      // exactly once, AFTER the late push, so finish()'s own always-fresh
      // recomputation already reflects it) this specifically freezes a
      // genuinely-executable decision at finish() time FIRST, and only then
      // pushes late evidence, calling takeDecision() with no second finish()
      // in between - the one call that can only observe the frozen
      // `finalResult` unless takeDecision() itself re-derives.
      const guard = createAiSdkExecutionGuard();
      guard.push({ type: "tool-input-start", id: "c1", toolName: "danger" });
      guard.push({ type: "tool-input-delta", id: "c1", delta: '{"x":1}' });
      guard.push({ type: "tool-input-end", id: "c1" });
      guard.push({ type: "finish", finishReason: "tool-calls" });
      const final = guard.finish();
      expect(final.decisions[0]?.action).toBe("execute"); // control: genuinely executable at finish() time

      guard.push({ type: "tool-result", toolCallId: "c1", toolName: "danger" });

      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("the exact advisory reproduction: complete terminal, late tool-result, then finish() and takeDecision()", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({ type: "tool-input-start", id: "c1", toolName: "danger" });
      guard.push({ type: "tool-input-delta", id: "c1", delta: '{"x":1}' });
      guard.push({ type: "tool-input-end", id: "c1" });
      guard.push({ type: "finish", finishReason: "tool-calls" });
      guard.push({ type: "tool-result", toolCallId: "c1", toolName: "danger" });

      const final = guard.finish();
      const decision = final.decisions[0];
      expect(decision?.action).not.toBe("execute");
      expect(guard.takeDecision(decision?.internalId ?? "missing")).toBeUndefined();
    });
  });

  describe("conflicting id/toolCallId identity on a single raw event", () => {
    it("7: conflicting id and toolCallId on tool-input-start never becomes executable", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({
        type: "tool-input-start",
        id: "a",
        toolCallId: "b",
        toolName: "danger",
      } as unknown as Record<string, unknown>);
      guard.push({ type: "tool-input-delta", id: "a", delta: '{"x":1}' });
      guard.push({ type: "tool-input-end", id: "a" });
      guard.push({ type: "finish", finishReason: "tool-calls" });

      const final = guard.finish();
      expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
      for (const decision of final.decisions) {
        expect(guard.takeDecision(decision.internalId)).toBeUndefined();
      }
    });

    it("8: conflicting id and toolCallId on tool-input-delta never becomes executable", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({ type: "tool-input-start", id: "a", toolName: "danger" });
      guard.push({
        type: "tool-input-delta",
        id: "a",
        toolCallId: "b",
        delta: '{"x":1}',
      } as unknown as Record<string, unknown>);
      guard.push({ type: "tool-input-end", id: "a" });
      guard.push({ type: "finish", finishReason: "tool-calls" });

      const final = guard.finish();
      expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
    });

    it("9: conflicting id and toolCallId on tool-input-end never becomes executable", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({ type: "tool-input-start", id: "a", toolName: "danger" });
      guard.push({ type: "tool-input-delta", id: "a", delta: '{"x":1}' });
      guard.push({
        type: "tool-input-end",
        id: "a",
        toolCallId: "b",
      } as unknown as Record<string, unknown>);
      guard.push({ type: "finish", finishReason: "tool-calls" });

      const final = guard.finish();
      expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
    });

    it("conflicting id/toolCallId is stream-wide: an unrelated clean sibling call is also disqualified", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({
        type: "tool-input-start",
        id: "a",
        toolCallId: "b",
        toolName: "danger",
      } as unknown as Record<string, unknown>);
      guard.push({ type: "tool-input-end", id: "a" });
      guard.push({ type: "tool-input-start", id: "clean", toolName: "safe" });
      guard.push({ type: "tool-input-delta", id: "clean", delta: "{}" });
      guard.push({ type: "tool-input-end", id: "clean" });
      guard.push({ type: "finish", finishReason: "tool-calls" });

      const final = guard.finish();
      const clean = final.decisions.find((d) => d.internalId !== final.decisions[0]?.internalId);
      // The whole stream is treated as identity-ambiguous, matching the
      // advisory's "fail closed globally for the affected stream" requirement.
      expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
      if (clean) expect(guard.takeDecision(clean.internalId)).toBeUndefined();
    });
  });

  describe("control cases — must remain unaffected by the fix", () => {
    it("a clean single call still executes and its authority is still consumable exactly once", () => {
      const guard = guardWithCompleteCall();
      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)?.action).toBe("execute");
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("id and toolCallId present and equal is accepted normally", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({
        type: "tool-input-start",
        id: "same",
        toolCallId: "same",
        toolName: "danger",
      } as unknown as Record<string, unknown>);
      guard.push({ type: "tool-input-delta", id: "same", delta: '{"x":1}' });
      guard.push({ type: "tool-input-end", id: "same" });
      guard.push({ type: "finish", finishReason: "tool-calls" });
      const final = guard.finish();
      expect(final.decisions[0]?.action).toBe("execute");
      expect(guard.takeDecision(final.decisions[0]?.internalId ?? "missing")?.action).toBe("execute");
    });

    it("harmless unrelated SDK stream parts after the terminal do not break compatibility", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "text-delta", id: "t1", delta: "trailing narration" });
      guard.push({ type: "reasoning-delta", id: "r1", delta: "trailing thought" });
      guard.push({ type: "start-step" });
      guard.push({ type: "finish-step" });

      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)?.action).toBe("execute");
    });

    it("missing tool-input-end still fails closed (pre-existing control, unaffected)", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({ type: "tool-input-start", id: "c1", toolName: "danger" });
      guard.push({ type: "tool-input-delta", id: "c1", delta: '{"x":1}' });
      guard.push({ type: "finish", finishReason: "tool-calls" });
      const final = guard.finish();
      expect(final.decisions[0]?.action).not.toBe("execute");
    });

    it("abort before the first terminal still fails closed (pre-existing control, unaffected)", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({ type: "tool-input-start", id: "c1", toolName: "danger" });
      guard.push({ type: "tool-input-delta", id: "c1", delta: '{"x":1}' });
      guard.push({ type: "tool-input-end", id: "c1" });
      guard.push({ type: "abort", reason: "user_cancelled" });
      const final = guard.finish();
      expect(final.decisions[0]?.action).not.toBe("execute");
    });
  });

  describe("regression review — variations beyond the minimal repro", () => {
    it("interleaved calls: late evidence for one call does not silently spare the other when identity is unattributable", () => {
      const guard = createAiSdkExecutionGuard();
      guard.push({ type: "tool-input-start", id: "a", toolName: "danger_a" });
      guard.push({ type: "tool-input-delta", id: "a", delta: "{}" });
      guard.push({ type: "tool-input-end", id: "a" });
      guard.push({ type: "tool-input-start", id: "b", toolName: "danger_b" });
      guard.push({ type: "tool-input-delta", id: "b", delta: "{}" });
      guard.push({ type: "tool-input-end", id: "b" });
      guard.push({ type: "finish", finishReason: "tool-calls" });

      const cleanFinal = guard.finish();
      expect(cleanFinal.decisions.every((d) => d.action === "execute")).toBe(true);

      // Unattributable SDK execution evidence (no id at all) arrives late.
      guard.push({ type: "tool-result", toolName: "danger_a" });

      for (const decision of cleanFinal.decisions) {
        expect(guard.takeDecision(decision.internalId)).toBeUndefined();
      }
    });

    it("SDK execution evidence with a resolvable call id still revokes authority when it arrives late", () => {
      const guard = guardWithCompleteCall();
      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      guard.push({ type: "tool-result", toolCallId: "c1", toolName: "danger" });
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });

    it("finish() called again after a provider terminal is a no-op and does not itself revoke authority", () => {
      const guard = guardWithCompleteCall();
      const final = guard.finish();
      const secondFinal = guard.finish();
      expect(secondFinal.decisions).toEqual(final.decisions);
      expect(guard.takeDecision(final.decisions[0]?.internalId ?? "missing")?.action).toBe("execute");
    });

    it("a provider terminal followed by natural iterator completion (adapter.finish() as backstop) stays executable", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new AiSdkStreamAdapter();
      for (const raw of [
        { type: "tool-input-start", id: "c1", toolName: "danger" },
        { type: "tool-input-delta", id: "c1", delta: "{}" },
        { type: "tool-input-end", id: "c1" },
        { type: "finish", finishReason: "tool-calls" },
      ]) {
        for (const event of adapter.push(raw)) gate.push(event);
      }
      // Simulates a caller's for-await loop ending naturally and always
      // calling a backstop finish() - already-finished adapter/gate must
      // treat this as an inert no-op, not a fresh (and here contradictory)
      // "unknown" terminal.
      for (const event of adapter.finish({ reason: "unknown" })) gate.push(event);
      const final = gate.finish({ reason: "unknown" });
      expect(final.decisions[0]?.action).toBe("execute");
      expect(gate.takeDecision(final.decisions[0]?.internalId ?? "missing")?.action).toBe("execute");
    });

    it("duplicate conflicting terminal after an already-conflicting terminal stays permanently disqualified", () => {
      const guard = guardWithCompleteCall();
      guard.push({ type: "error", error: new Error("first contradiction") });
      guard.push({ type: "abort", reason: "second contradiction" });
      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
    });
  });
});
