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
    it("a finish_reason chunk with NO prior function_call ever seen emits no spurious tool_call_end for a call that was never started", () => {
      const adapter = new OpenAIStreamAdapter();
      const events = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      expect(events.map((e) => e.type)).toEqual(["provider_stream_end"]);
    });

    it("a second, duplicate finish_reason chunk after the first already closed the call does not emit a second tool_call_end", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      const secondEvents = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      // Still forwarded (post-terminal evidence must reach the coordinator -
      // GHSA-3xpw-9694-2xxp), but as provider_stream_end only, no duplicate
      // tool_call_end for a call already closed on the first pass.
      expect(secondEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
    });

    it("a late finish_reason chunk arriving after a direct finish() already closed the call does not emit a second tool_call_end", () => {
      // The mirror case of the one above, for the OTHER real close path:
      // finish() must also clear the open flag it consumes, or a
      // subsequent push() (still forwarded per GHSA-3xpw-9694-2xxp) would
      // find it still set and duplicate the close.
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "{}" } } }] });
      adapter.finish({ reason: "complete" });
      const lateEvents = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      expect(lateEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
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
    it("finish() called after finish_reason already terminated the stream does not emit duplicate call-end/authority-changing evidence", () => {
      const adapter = new OpenAIStreamAdapter();
      const firstEvents: unknown[] = [];
      for (const raw of [validCallChunk, { choices: [{ index: 0, finish_reason: "stop" }] }]) {
        firstEvents.push(...adapter.push(raw));
      }
      const secondEvents = adapter.finish({ reason: "complete" });
      expect(secondEvents).toHaveLength(0);
      expect(firstEvents.filter((e) => (e as { type?: string }).type === "tool_call_end")).toHaveLength(1);
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
