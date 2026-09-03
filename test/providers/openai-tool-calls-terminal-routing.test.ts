// ---------------------------------------------------------------------------
// Regression suite: OpenAIStreamAdapter's plural, new-style Chat Completions
// `tool_calls` format must continue routing through OpenAICompatibleStreamAdapter
// for the REST of a stream's lifetime once genuinely observed - not just on
// whichever single chunk happens to carry `delta.tool_calls` itself.
//
// Before this fix, `push()`'s delegation gate
// (`chunk.choices?.[0]?.delta?.tool_calls !== undefined`) was evaluated fresh
// on every single chunk. A separate empty-delta finish_reason terminal
// shape - accepted and exposed by the real openai@7.8.0 SDK parser in the
// deterministic P2 fixture (see
// test/integration/openai-official-sdk-lifecycle.test.ts; this harness
// proves SDK-parser compatibility with the shape, not that every current
// live OpenAI model/request emits this exact sequence) - is a SEPARATE,
// later chunk carrying `finish_reason` with an EMPTY `delta: {}` - no
// `tool_calls` key at all. That chunk failed the per-chunk
// check and fell through into the adapter's own hand-rolled legacy
// function_call loop, which reacts to `finish_reason` generically but never
// calls into OpenAICompatibleStreamAdapter - so the tracked call's own
// tool_call_end was never emitted. coordinator.ts's handleStreamEnd() then
// found the call still status:"collecting", raised
// E_STREAM_ENDED_WITH_OPEN_CALL, and forced outcome:"invalid" even for
// perfectly valid, complete JSON (see
// test/integration/openai-official-sdk-lifecycle.test.ts's real-official-SDK
// proof of the same defect, formerly reported as a NEW OFFICIAL-SDK
// MISMATCH). This is a fail-closed correctness/compatibility bug, not a
// security bypass: it made every plural tool_calls stream whose terminal
// chunk has an empty delta permanently non-executable, never the opposite.
//
// Fixed with a sticky `hasCompatibleToolCalls` stream-mode flag: once a
// genuine plural tool_calls delta is observed (checked across every choice,
// not only choices[0] - see the CHOICE ROUTING group below), every later
// Chat Completions chunk continues through the compatible adapter for the
// rest of the stream's lifetime, including chunks whose own delta carries no
// tool_calls.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";

describe("OpenAIStreamAdapter: plural tool_calls terminal routing", () => {
  describe("A. plural tool_calls + separate empty-delta finish_reason chunk", () => {
    it("closes the call (tool_call_end then provider_stream_end) and executes with the correct value", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] }, finish_reason: null }],
      })) gate.push(e);

      const terminalEvents = adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      expect(terminalEvents.map((e) => e.type)).toEqual(["tool_call_end", "provider_stream_end"]);
      for (const e of terminalEvents) gate.push(e);

      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.name).toBe("search");
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ q: "test" });
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });
  });

  describe("B. plural tool_calls with finish_reason on the SAME chunk (pre-existing working path, unaffected by the fix)", () => {
    it("remains valid and executable", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] }, finish_reason: "tool_calls" }],
      })) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ q: "test" });
    });
  });

  describe("C. plural tool_calls with no terminal chunk at all", () => {
    it("a direct finish() still closes through the compatible adapter and produces correct authority", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] } }],
      })) gate.push(e);
      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents.map((e) => e.type)).toEqual(["tool_call_end", "provider_stream_end"]);
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ q: "test" });
    });
  });

  describe("CHOICE ROUTING: the delegation predicate must not only inspect choices[0]", () => {
    it("a plural tool_calls delta in a NON-ZERO choice (choice 0 has no tool call) still routes to the compatible adapter and executes", () => {
      // Only choice 1 (the one carrying the tool call) ever reports
      // finish_reason - this isolates the choice-index routing question
      // from a separate, pre-existing, orthogonal defect this investigation
      // also surfaced: OpenAICompatibleStreamAdapter emits one
      // provider_stream_end PER finish_reason-bearing choice within a
      // single chunk, so two choices terminating in the SAME chunk trips
      // the coordinator's own post-terminal "event after stream end"
      // global diagnostic and wrongly poisons every call, including
      // choice 1's otherwise-valid one. Confirmed reproducible with
      // OpenAICompatibleStreamAdapter alone (no involvement of this file's
      // routing fix) - reported separately in the final report, not fixed
      // here per the production-scope boundary (src/providers/openai-compatible.ts
      // is out of scope for this patch).
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({
        choices: [
          { index: 0, delta: { content: "hello" }, finish_reason: null },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] }, finish_reason: null },
        ],
      })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 1, delta: {}, finish_reason: "tool_calls" }] })) gate.push(e);

      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "search"));
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ q: "test" });
    });
  });

  describe("Negative regressions: must remain fail-closed", () => {
    it("Responses API is unaffected by the plural-tool_calls routing fix (spot check - full coverage lives in coverage.test.ts and the official-SDK integration suite)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"test"}' })) gate.push(e);
      for (const e of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(e);
      for (const e of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
    });

    it("legacy singular function_call + separate finish_reason remains on the legacy path (2f4f76f behavior unaffected) - never routed to the compatible adapter", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "search", arguments: '{"q":"test"}' } } }] })) gate.push(e);
      const terminalEvents = adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      expect(terminalEvents.map((e) => e.type)).toEqual(["tool_call_end", "provider_stream_end"]);
      // The fixed legacy sourceKey - not "choice:0/tool-index:0" - proves
      // this stayed on the legacy-synthesis path, not the compatible one.
      expect((terminalEvents[0] as { callRef?: { sourceKey?: string } })?.callRef?.sourceKey).toBe("legacy-function-call");
      for (const e of terminalEvents) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ q: "test" });
    });

    it("a bare finish_reason chunk with NO prior plural tool_calls evidence never synthesizes a phantom compatible tool_call_end (the sticky flag requires real prior evidence, never inferred from finish_reason alone)", () => {
      const adapter = new OpenAIStreamAdapter();
      const events = adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      expect(events.map((e) => e.type)).toEqual(["provider_stream_end"]);
    });

    it("truncated plural tool_calls arguments (separate terminal chunk) remain non-executable", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":' } }] } }] })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).not.toBe("execute");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });

    it("missing tool name (plural tool_calls, separate terminal chunk) remains non-executable", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { arguments: "{}" } }] } }] })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).not.toBe("execute");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });

    it.each(["length", "cancelled", "content_filter"])(
      "plural tool_calls + separate terminal chunk with finish_reason '%s' remains non-executable, regardless of otherwise-valid JSON",
      (finish_reason) => {
        const gate = createToolCallExecutionGate();
        const adapter = new OpenAIStreamAdapter();
        for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] } }] })) gate.push(e);
        for (const e of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason }] })) gate.push(e);
        const final = gate.finish();
        const decision = expectDefined(final.decisions[0]);
        expect(decision.action).not.toBe("execute");
        expect(gate.takeDecision(decision.internalId)).toBeUndefined();
      },
    );

    it("a top-level Responses-API-shaped error chunk arriving after plural tool_calls mode was entered is still handled by the Responses API branch, not swallowed by the sticky compatible-mode flag", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] } }] });
      const events = adapter.push({ type: "error" });
      expect(events.map((e) => e.type)).toEqual(["provider_stream_end"]);
      expect((events[0] as { reason?: string })?.reason).toBe("provider_error");
    });
  });

  describe("FORMAT-CONFLICT: once a stream shows conflicting Chat Completions tool-call formats, it must become entirely non-executable - not merely 'the conflicting call is absent'", () => {
    it("plural tool_calls observed, then later singular function_call evidence arrives mid-stream: the ORIGINAL plural call ALSO loses authority, not only the injected one", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "good", arguments: '{"a":1}' } }] } }] })) gate.push(e);
      // Conflicting singular function_call evidence, after plural mode was
      // already committed to.
      for (const e of adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "evil", arguments: "{}" } } }] })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })) gate.push(e);

      const final = gate.finish();
      // No decision named "evil" is required (its absence is fine per the
      // task spec), but the REQUIRED invariant is that "good" - the
      // original, otherwise-perfectly-valid call - must ALSO be
      // non-executable once the conflict was observed.
      expect(final.decisions.some((d) => (d as { name?: string }).name === "evil" && d.action === "execute")).toBe(false);
      const good = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "good"));
      expect(good.action).not.toBe("execute");
      expect(gate.takeDecision(good.internalId)).toBeUndefined();
    });

    it("SYMMETRIC CASE: legacy singular function_call observed FIRST, then later plural tool_calls evidence arrives mid-stream - the ORIGINAL legacy call ALSO loses authority, not only the injected one", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "legacyGood", arguments: '{"legacy":true}' } } }] })) gate.push(e);
      // Conflicting plural tool_calls evidence, after legacy mode was
      // already committed to.
      for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "pluralInjected", arguments: '{"plural":true}' } }] } }] })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] })) gate.push(e);

      const final = gate.finish();
      expect(final.decisions.some((d) => (d as { name?: string }).name === "pluralInjected" && d.action === "execute")).toBe(false);
      const legacyGood = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "legacyGood"));
      expect(legacyGood.action).not.toBe("execute");
      expect(gate.takeDecision(legacyGood.internalId)).toBeUndefined();
    });

    it("SAME-CHUNK CONFLICT: one raw chunk carrying BOTH delta.function_call AND delta.tool_calls produces ZERO executable authorities", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({
        choices: [{
          index: 0,
          delta: {
            function_call: { name: "sameChunkLegacy", arguments: '{"a":1}' },
            tool_calls: [{ index: 0, id: "call_3", type: "function", function: { name: "sameChunkPlural", arguments: '{"b":2}' } }],
          },
        }],
      })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })) gate.push(e);

      const final = gate.finish();
      // The conflict is detected on this very first chunk, before either
      // shape could ever become its own tracked call - zero decisions of
      // any kind, not merely zero executable ones.
      expect(final.decisions).toHaveLength(0);
    });

    it("CHOICE-INDEX CONFLICT DETECTION: conflicting legacy evidence in a NON-ZERO, NON-ALL choice (choice 0 unrelated, choice 1 carries function_call) still triggers the fail-closed conflict terminal while compatible mode is active", () => {
      // Mirrors the CHOICE ROUTING group's own reasoning above, applied to
      // conflict detection specifically: hasLegacyEvidence must be true if
      // ANY choice carries function_call, not only if EVERY choice does -
      // a chunk where the conflicting evidence lives in a choice other
      // than 0, alongside an unrelated/plain choice 0, must not let the
      // conflict go undetected.
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "good", arguments: '{"a":1}' } }] } }] })) gate.push(e);
      for (const e of adapter.push({
        choices: [
          { index: 0, delta: { content: "hello" } },
          { index: 1, delta: { function_call: { name: "evil", arguments: "{}" } } },
        ],
      })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })) gate.push(e);

      const final = gate.finish();
      const good = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "good"));
      expect(good.action).not.toBe("execute");
      expect(gate.takeDecision(good.internalId)).toBeUndefined();
    });

    it("the fail-closed conflict terminal is reason:'provider_error', providerReason:'mixed_tool_call_formats' - not a misleading 'complete'", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_6", type: "function", function: { name: "good", arguments: "{}" } }] } }] });
      const events = adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "evil", arguments: "{}" } } }] });
      expect(events).toEqual([
        expect.objectContaining({ type: "provider_stream_end", reason: "provider_error", providerReason: "mixed_tool_call_formats" }),
      ]);
    });

    it("IDEMPOTENCY: a direct finish() call after a push()-detected conflict is a correct no-op - the local `finished` flag set by the conflict branch must not leave a gap for finish() to resurrect the original call's authority", () => {
      // Belt-and-suspenders beyond the coordinator's own post-terminal
      // protocol (which independently also catches this - see the
      // POST-TERMINAL MIXED EVIDENCE group below): finish() itself must
      // stay correctly idempotent once push() has already detected and
      // terminated a format conflict, exactly like every other terminal
      // path in this adapter (compare the pre-existing "finish() called
      // directly twice is idempotent" coverage for the ordinary paths).
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "good", arguments: "{}" } }] } }] });
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "evil", arguments: "{}" } } }] });
      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents).toHaveLength(0);
    });
  });

  describe("POST-TERMINAL MIXED EVIDENCE: the P0 invariant applied to cross-format evidence (synthetic adapter-to-gate proof - official-SDK reachability of mixed-format streams has not been established)", () => {
    it("a plural call reaches a clean, legitimate 'execute' terminal; late singular function_call evidence arriving afterward still revokes the unconsumed authority", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_7", type: "function", function: { name: "pluralClean", arguments: '{"q":"test"}' } }] } }] })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })) gate.push(e);

      // Real, unconsumed authority must exist BEFORE the late evidence -
      // read via finish()'s returned decisions, never takeDecision().
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");

      // Late, conflicting-format evidence, pushed into the SAME gate.
      for (const e of adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "lateEvil", arguments: "{}" } } }] })) gate.push(e);
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });

    it("SYMMETRIC CASE: a legacy call reaches a clean, legitimate 'execute' terminal; late plural tool_calls evidence arriving afterward still revokes the unconsumed authority", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      for (const e of adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "legacyClean", arguments: '{"q":"test"}' } } }] })) gate.push(e);
      for (const e of adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] })) gate.push(e);

      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");

      for (const e of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_8", type: "function", function: { name: "lateEvilPlural", arguments: "{}" } }] } }] })) gate.push(e);
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });
  });
});
