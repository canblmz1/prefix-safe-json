// ---------------------------------------------------------------------------
// Regression suite: OpenAIStreamAdapter's legacy singular `function_call`
// path must close its own tracked call (emit tool_call_end) before the
// provider stream terminates, through BOTH real public termination paths -
// a `finish_reason` field on a legacy-shaped chunk, and a direct
// `adapter.finish(...)` call. Before the fix, neither path ever emits
// tool_call_end for this call (unlike its sibling OpenAICompatibleStreamAdapter,
// which explicitly closes every tracked sourceKey first - see
// openai-compatible.ts's own finish_reason handling and finish()). As a
// direct result, coordinator.ts's handleStreamEnd() always raises
// E_STREAM_ENDED_WITH_OPEN_CALL (severity "error", attributed to the call),
// which trips hasCallConflict() and forces the call's outcome to "invalid"
// - even when its JSON arguments are perfectly complete and valid. This is
// a correctness/compatibility bug, not a security bypass: it makes every
// legacy singular function_call permanently non-executable, never the
// opposite.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import { DUPLICATE_TOOL_END_DIAGNOSTIC_CODE } from "../../src/coordinator/diagnostic-codes.js";

function pushAll(adapter: OpenAIStreamAdapter, gate: ReturnType<typeof createToolCallExecutionGate>, raws: readonly unknown[]) {
  for (const raw of raws) {
    for (const event of adapter.push(raw)) gate.push(event);
  }
}

const validCallChunk = {
  choices: [{
    index: 0,
    delta: {
      function_call: {
        name: "search",
        arguments: '{"q":"test"}',
      },
    },
  }],
};

describe("OpenAIStreamAdapter legacy singular function_call: termination must close the call", () => {
  describe("Case A: provider finish_reason", () => {
    it("a complete, valid call becomes executable after finish_reason terminates the stream", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      pushAll(adapter, gate, [
        validCallChunk,
        { choices: [{ index: 0, finish_reason: "stop" }] },
      ]);
      // P4.3: choice.finish_reason is choice-local only now - the ONE real
      // provider_stream_end comes from adapter.finish(), per the universal
      // documented lifecycle every adapter in this library shares.
      for (const event of adapter.finish()) gate.push(event);
      const final = gate.finish();
      // Ground truth, always true regardless of the bug: a call exists,
      // with valid JSON argument evidence, and terminal evidence was
      // received.
      const decision = expectDefined(final.decisions[0]);
      expect(decision.name).toBe("search");
      expect(decision.evidence.structurallyComplete).toBe(true);
      expect(decision.evidence.terminalConfirmed).toBe(true);
      // The actual, intended-behavior assertion.
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ q: "test" });
    });
  });

  describe("Case B: direct adapter.finish()", () => {
    it("a complete, valid call becomes executable after a direct finish() call terminates the stream", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      pushAll(adapter, gate, [validCallChunk]);
      for (const event of adapter.finish({ reason: "complete" })) gate.push(event);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.name).toBe("search");
      expect(decision.evidence.structurallyComplete).toBe(true);
      expect(decision.evidence.terminalConfirmed).toBe(true);
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ q: "test" });
    });
  });

  describe("Negative regressions - must remain fail-closed", () => {
    it("truncated arguments never execute, via either termination path", () => {
      for (const terminate of [
        (a: OpenAIStreamAdapter, g: ReturnType<typeof createToolCallExecutionGate>) => pushAll(a, g, [{ choices: [{ index: 0, finish_reason: "stop" }] }]),
        (a: OpenAIStreamAdapter, g: ReturnType<typeof createToolCallExecutionGate>) => { for (const e of a.finish({ reason: "complete" })) g.push(e); },
      ]) {
        const gate = createToolCallExecutionGate();
        const adapter = new OpenAIStreamAdapter();
        pushAll(adapter, gate, [
          { choices: [{ index: 0, delta: { function_call: { name: "search", arguments: '{"q":' } } }] },
        ]);
        terminate(adapter, gate);
        const final = gate.finish();
        const decision = expectDefined(final.decisions[0]);
        expect(decision.action).not.toBe("execute");
        expect(gate.takeDecision(decision.internalId)).toBeUndefined();
      }
    });

    it("a missing tool name never executes, via either termination path", () => {
      for (const terminate of [
        (a: OpenAIStreamAdapter, g: ReturnType<typeof createToolCallExecutionGate>) => pushAll(a, g, [{ choices: [{ index: 0, finish_reason: "stop" }] }]),
        (a: OpenAIStreamAdapter, g: ReturnType<typeof createToolCallExecutionGate>) => { for (const e of a.finish({ reason: "complete" })) g.push(e); },
      ]) {
        const gate = createToolCallExecutionGate();
        const adapter = new OpenAIStreamAdapter();
        pushAll(adapter, gate, [
          { choices: [{ index: 0, delta: { function_call: { arguments: "{}" } } }] },
        ]);
        terminate(adapter, gate);
        const final = gate.finish();
        const decision = expectDefined(final.decisions[0]);
        expect(decision.action).not.toBe("execute");
        expect(gate.takeDecision(decision.internalId)).toBeUndefined();
      }
    });

    it("cancelled termination never executes, regardless of otherwise-valid JSON", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      pushAll(adapter, gate, [
        { choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] },
        { choices: [{ index: 0, finish_reason: "cancelled" }] },
      ]);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).not.toBe("execute");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });

    it("length termination never executes, regardless of otherwise-valid JSON", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      pushAll(adapter, gate, [
        { choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] },
        { choices: [{ index: 0, finish_reason: "length" }] },
      ]);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).not.toBe("execute");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });
  });

  describe("The new tool_call_end must only fire for a genuinely open legacy call - never spuriously, never duplicated", () => {
    it("a finish_reason chunk with NO prior function_call ever seen emits nothing (P4.3: no provider_stream_end from push() at all anymore - choice.finish_reason is choice-local only) for a call that was never started", () => {
      const adapter = new OpenAIStreamAdapter();
      const events = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      expect(events).toEqual([]);
    });

    it("a second, duplicate finish_reason chunk after the first already closed the call: P4.3 now hardens this via DUPLICATE_TOOL_END_DIAGNOSTIC_CODE (choice-local, exact attribution), not a silently-repeated provider_stream_end - never a second tool_call_end either way", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] });
      const firstClose = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      expect(firstClose.map((e) => e.type)).toEqual(["tool_call_end"]);
      const secondEvents = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      // Still forwarded (post-terminal evidence must reach the coordinator -
      // GHSA-3xpw-9694-2xxp), but as a choice-local protocol-violation
      // diagnostic, never a duplicate tool_call_end and never a
      // provider_stream_end (push() no longer emits one for the legacy
      // path at all - see the universal-lifecycle regressions).
      expect(secondEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect((secondEvents[0] as { code?: string }).code).toBe(DUPLICATE_TOOL_END_DIAGNOSTIC_CODE);
    });

    it("a late finish_reason chunk arriving after a direct finish() already closed the call does not emit a second tool_call_end - but is NOT silently dropped either (P0 blocker fix)", () => {
      // The mirror case of the one above, for the OTHER real close path:
      // finish() must also clear the open flag it consumes, or a
      // subsequent push() (still forwarded per GHSA-3xpw-9694-2xxp) would
      // find it still set and duplicate the close.
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] });
      adapter.finish({ reason: "complete" });
      // P4.3: this late finish_reason is not "alreadyTerminal" from this
      // choice's own perspective (finish() closed the call without ever
      // touching legacyChoiceTerminalReasons - only push()'s own
      // choice.finish_reason handling does that), and legacyChoiceOpen was
      // correctly cleared by finish() above, so no normal tool_call_end
      // fires. Post-blocker-fix, this is NOT the same as returning []:
      // this.finished is already true and this exact choice had prior
      // tracked activity, so push() now emits a
      // DUPLICATE_TOOL_END_DIAGNOSTIC_CODE provider_diagnostic instead -
      // see the dedicated "P0 BLOCKER FIX" describe block in
      // openai-legacy-choice-identity.test.ts for the full RED/GREEN
      // regression this was found and fixed against (a late finish_reason
      // here used to vanish entirely, leaving an already-computed,
      // unconsumed execute decision silently un-revocable).
      const lateEvents = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      expect(lateEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect((lateEvents[0] as { code?: string })?.code).toBe(DUPLICATE_TOOL_END_DIAGNOSTIC_CODE);
    });
  });

  describe("Post-terminal evidence (the fix must not create a new GHSA-3xpw-9694-2xxp-class gap)", () => {
    it("a late argument delta arriving after finish_reason already closed the call does not corrupt or preserve its execution authority", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      pushAll(adapter, gate, [
        validCallChunk,
        { choices: [{ index: 0, finish_reason: "stop" }] },
      ]);
      // Universal documented lifecycle: the ONE real provider_stream_end
      // comes from adapter.finish() now.
      for (const event of adapter.finish()) gate.push(event);
      // Real, unconsumed authority must exist BEFORE the late evidence -
      // read via finish()'s returned decisions, never takeDecision(), which
      // would consume it and make the second half of this test meaningless.
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
      // Late evidence, pushed into the SAME gate.
      for (const event of adapter.push({ choices: [{ index: 0, delta: { function_call: { arguments: '{"evil":true}' } } }] })) {
        gate.push(event);
      }
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });
  });

  describe("Idempotency", () => {
    it("P4.3: choice.finish_reason alone no longer terminates the stream (choice-local only) - adapter.finish() afterward is the ONE real, required provider_stream_end call, not a no-op; it still never duplicates the tool_call_end already emitted choice-locally", () => {
      const adapter = new OpenAIStreamAdapter();
      const firstEvents: unknown[] = [];
      for (const raw of [validCallChunk, { choices: [{ index: 0, finish_reason: "stop" }] }]) {
        firstEvents.push(...adapter.push(raw));
      }
      const secondEvents = adapter.finish({ reason: "complete" });
      expect(secondEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
      expect(firstEvents.filter((e) => (e as { type?: string }).type === "tool_call_end")).toHaveLength(1);
      // A further, direct finish() call IS the genuine no-op.
      expect(adapter.finish({ reason: "complete" })).toHaveLength(0);
    });

    it("finish() called twice directly does not emit duplicate call-end/authority-changing evidence", () => {
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push(validCallChunk)) void e;
      const first = adapter.finish({ reason: "complete" });
      const second = adapter.finish({ reason: "complete" });
      expect(first.filter((e) => e.type === "tool_call_end")).toHaveLength(1);
      expect(second).toHaveLength(0);
    });
  });
});
