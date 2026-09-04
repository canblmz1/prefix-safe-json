// ---------------------------------------------------------------------------
// Regression suite: meaningful post-terminal provider evidence must reach
// the coordinator, not be silently discarded by the provider adapter, when
// doing so could preserve unconsumed execution authority.
//
// This is the same invariant class as GHSA-3xpw-9694-2xxp
// (test/security/ghsa-3xpw-9694-2xxp.test.ts). That prior fix closed the gap
// inside AiSdkStreamAdapter and at the coordinator/gate boundary itself -
// see AiSdkStreamAdapter.push()'s own comment ("No `finished` early return
// here: silently dropping every event after the first terminal ... meant
// ... evidence that arrived even one raw event late never reached the
// coordinator at all - not even as a diagnostic").
//
// SECURITY INVARIANT (precise, not overstated):
//   Meaningful post-terminal evidence that the adapter recognizes must not
//   be silently discarded when doing so could preserve unconsumed execution
//   authority. This is NOT the claim that every raw event after a terminal
//   is normalized and forwarded - an adapter is still free to treat a
//   genuinely unrecognized/malformed raw event as a no-op, and several
//   still do. What must never happen is a blanket `if (this.finished)
//   return [];` at the very top of push() that drops evidence the adapter
//   WOULD otherwise have recognized (a real argument delta, a real
//   provider error, a real conflicting/duplicate terminal) purely because
//   it arrived after this adapter instance's own terminal, before the
//   coordinator - which DOES correctly turn any event it receives after its
//   own isFinished into a sticky, stream-wide, authority-disqualifying
//   diagnostic (coordinator.ts's push(), decide.ts's global-diagnostics
//   check) - ever gets a chance to see it.
//
//   The authority this protects is also bounded: a decision the caller has
//   not yet consumed via takeDecision() (GHSA-3xpw-9694-2xxp's own boundary
//   - see gate.ts's takeDecision() doc comment). It cannot and does not
//   claim to undo a side effect from an already-consumed/already-executed
//   decision; that is outside what any of this code observes.
//
// Confirmed for OpenAIStreamAdapter, AnthropicStreamAdapter, and
// OpenRouterStreamAdapter (each below, with real red-before/green-after
// evidence recorded in the P0 report). NOT applied to GeminiStreamAdapter
// (every Gemini function call unconditionally carries
// PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE, so decideExecution() always
// rejects it before status is even considered - no call is ever executable
// in the first place, so there is no executable authority for a post-
// terminal event to threaten) or OpenAICompatibleStreamAdapter (its
// existing "W_EVENT_AFTER_STREAM_END" diagnostic is itself real,
// coordinator-visible content - not a member of
// AUTHORITY_PROTOCOL_VIOLATION_CODES, but the coordinator's own isFinished
// handling converts ANY event it receives post-terminal into its own
// recognized, stream-wide-disqualifying diagnostic regardless of the
// incoming event's own code, so the pre-existing behavior already satisfied
// this invariant).
//
// Every case below proves TWO things, not one:
//   (a) BEFORE the late event, a specific decision is a genuinely live,
//       unconsumed "execute" authority (both `.action` and `.executable`,
//       not merely that `final.decisions` is non-empty) - via
//       expectExecutableBeforeLateEvidence(), which reads gate.finish()'s
//       returned decisions WITHOUT calling takeDecision() (which would
//       consume it and make (b) meaningless).
//   (b) AFTER the late event is pushed into the SAME gate, that EXACT
//       decision's authority (`gate.takeDecision(sameInternalId)`) is gone.
// A helper that only checked (b) can pass vacuously if no decision was ever
// executable to begin with (empty `decisions`, or already-rejected for an
// unrelated reason) - that flaw is why this suite has both phases.
// ---------------------------------------------------------------------------
import { describe, expect, it } from "vitest";
import { expectDefined } from "../utils/expect-defined.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { AiSdkStreamAdapter } from "../../src/providers/ai-sdk.js";
import type { ProviderStreamAdapter } from "../../src/providers/adapter.js";
import type { ExecuteDecision } from "../../src/gate/types.js";
import type { ToolCallExecutionGateFinalResult } from "../../src/gate/types.js";

type Gate = ReturnType<typeof createToolCallExecutionGate>;

/** Drives one adapter's raw events through a real gate. Mirrors the
 * documented createToolCallExecutionGate() usage pattern (push every
 * normalized event, finish()). Does NOT call takeDecision() - callers do
 * that themselves, after asserting phase 1 below, so consuming a decision
 * is never accidentally hidden inside a shared helper. */
function runThroughGate(adapter: ProviderStreamAdapter<unknown>, rawEvents: readonly unknown[]) {
  const gate = createToolCallExecutionGate();
  for (const raw of rawEvents) {
    for (const event of adapter.push(raw)) gate.push(event);
  }
  const final = gate.finish();
  return { gate, final };
}

/** Phase 1: from a `final` result captured BEFORE any late/post-terminal
 * event was pushed, asserts at least one decision is a genuinely live
 * "execute" authority (both `.action` and `.executable`, not merely the
 * table label) and returns it - via `final.decisions`, never
 * `gate.takeDecision()`, which would consume it and make phase 2
 * meaningless. Fails loudly (not silently/vacuously) if no such decision
 * exists, since that would mean this test proves nothing was ever at risk. */
function expectExecutableBeforeLateEvidence(final: ToolCallExecutionGateFinalResult): ExecuteDecision {
  const decision = final.decisions.find(
    (d): d is ExecuteDecision => d.action === "execute" && d.executable === true,
  );
  return expectDefined(
    decision,
    "setup must produce a genuinely executable decision before the late event - otherwise this test cannot prove anything was revoked",
  );
}

/** Phase 2: after late/post-terminal evidence has been pushed into the SAME
 * gate, the EXACT decision proven live in phase 1 must no longer be
 * takeable - the real security outcome, not just the decision table's own
 * `.action` label (which could theoretically still say "execute" in a
 * snapshot while takeDecision() correctly refuses to hand out authority).
 */
function expectAuthorityRevoked(gate: Gate, decision: ExecuteDecision) {
  expect(
    gate.takeDecision(decision.internalId),
    `internalId ${decision.internalId} must not retain executable authority after late evidence`,
  ).toBeUndefined();
}

describe("Post-terminal provider evidence must reach the coordinator when it could preserve unconsumed execution authority (adapter-level GHSA-3xpw-9694-2xxp coverage)", () => {
  describe("OpenAI adapter (Responses API)", () => {
    const completeStreamEvents = [
      { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "danger" } },
      { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"x":1}' },
      { type: "response.output_item.done", item: { id: "fc_1" } },
      { type: "response.completed", response: { status: "completed" } },
    ];

    it("control: a clean OpenAI Responses stream is executable", () => {
      const { gate, final } = runThroughGate(new OpenAIStreamAdapter(), completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      expect(gate.takeDecision(decision.internalId)).toBeDefined();
    });

    it("1: a late argument delta after response.completed revokes authority", () => {
      const adapter = new OpenAIStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "response.function_call_arguments.delta", item_id: "fc_1", delta: '{"x":999}' });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("2: a late provider error after response.completed revokes authority", () => {
      const adapter = new OpenAIStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "error" });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("3: a conflicting second terminal (completed, then response.failed) revokes authority", () => {
      const adapter = new OpenAIStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "response.failed", response: { error: { code: "late_failure" } } });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("4: a duplicate identical response.completed also revokes authority (sticky, not merely non-conflicting)", () => {
      const adapter = new OpenAIStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "response.completed", response: { status: "completed" } });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("5: a late tool_call_start-equivalent (new function_call after completion) revokes authority", () => {
      const adapter = new OpenAIStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc_2", call_id: "call_2", name: "danger" } });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("6: an unrelated/no-op event after completion (malformed raw event) does not itself grant anything, and authority is still gone", () => {
      const adapter = new OpenAIStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      // Genuinely malformed raw input - provider semantics justify producing
      // only a diagnostic, not new call evidence - but it must still not
      // silently vanish before the coordinator can see "something arrived
      // after termination".
      const lateEvents = adapter.push(null);
      expect(lateEvents.length).toBeGreaterThan(0);
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });
  });

  describe("Anthropic adapter", () => {
    const completeStreamEvents = [
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_1", name: "danger" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"x":1}' } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ];

    it("control: a clean Anthropic stream is executable", () => {
      const { gate, final } = runThroughGate(new AnthropicStreamAdapter(), completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      expect(gate.takeDecision(decision.internalId)).toBeDefined();
    });

    it("1: a late argument delta after message_delta(stop_reason) revokes authority", () => {
      const adapter = new AnthropicStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"x":999}' } });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("2: a late stream error after the terminal revokes authority", () => {
      const adapter = new AnthropicStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "error" });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("3: a conflicting second terminal (tool_use, then max_tokens) revokes authority", () => {
      const adapter = new AnthropicStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("4: a duplicate identical message_delta terminal also revokes authority", () => {
      const adapter = new AnthropicStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("5: a late tool-lifecycle event (new content_block_start) after the terminal revokes authority", () => {
      const adapter = new AnthropicStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "call_2", name: "danger" } });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("6: a late duplicate content_block_stop for the same index revokes authority", () => {
      const adapter = new AnthropicStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "content_block_stop", index: 0 });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });

    it("7: an unrelated ping-style event after completion does not silently vanish before the gate can see it", () => {
      const adapter = new AnthropicStreamAdapter();
      const { gate, final } = runThroughGate(adapter, completeStreamEvents);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push(null);
      expect(lateEvents.length).toBeGreaterThan(0);
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });
  });

  describe("OpenRouter adapter", () => {
    // Unlike OpenAI/Anthropic above, OpenRouterStreamAdapter's own `finished`
    // flag is set ONLY on its own provider-level error shortcut in push(),
    // or unconditionally inside its own finish() method - normal tool-call/
    // finish_reason traffic delegates straight to the internal
    // OpenAICompatibleStreamAdapter and never touches this adapter's OWN
    // outer flag. So the removed guard is exercised only once this
    // adapter's own finish() has actually been called through a legitimate
    // public lifecycle path - NOT by a finish_reason arriving inside a
    // normal push(). This scenario, and only this scenario, was verified
    // (real red-before/green-after run, recorded in the P0 report) to
    // distinguish pre-fix from post-fix behavior for this adapter.
    it("a late provider error after adapter.finish() revokes authority", () => {
      const adapter = new OpenRouterStreamAdapter();
      const gate = createToolCallExecutionGate();

      for (const event of adapter.push({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "danger", arguments: '{"x":1}' } }] } }],
      })) {
        gate.push(event);
      }

      // Legitimate public lifecycle finish - sets the OUTER
      // OpenRouterStreamAdapter `finished` flag (a finish_reason chunk
      // through push() alone never does) and propagates a real
      // provider_stream_end to the gate.
      for (const event of adapter.finish({ reason: "complete" })) {
        gate.push(event);
      }

      const final = gate.finish();
      const decision = expectExecutableBeforeLateEvidence(final);

      const lateEvents = adapter.push({ error: "late transport failure" });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });
  });

  describe("AI SDK adapter (control only - already fixed prior to this P0 patch, not part of it)", () => {
    it("a late argument delta after finish still revokes authority", () => {
      const adapter = new AiSdkStreamAdapter();
      const complete = [
        { type: "tool-input-start", id: "call_1", toolName: "danger" },
        { type: "tool-input-delta", id: "call_1", delta: '{"x":1}' },
        { type: "tool-input-end", id: "call_1" },
        { type: "finish", finishReason: "tool-calls" },
      ];
      const { gate, final } = runThroughGate(adapter, complete);
      const decision = expectExecutableBeforeLateEvidence(final);
      const lateEvents = adapter.push({ type: "tool-input-delta", id: "call_1", delta: '{"x":999}' });
      for (const event of lateEvents) gate.push(event);
      expectAuthorityRevoked(gate, decision);
    });
  });
});
