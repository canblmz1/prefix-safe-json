// ---------------------------------------------------------------------------
// Permanent regression suite for OpenAICompatibleStreamAdapter's corrected
// choice/provider-stream lifecycle contract.
//
// SUPERSEDES the prior "investigation only" test file on this branch, which
// documented the PRE-FIX behavior as ground truth (a single choice's
// finish_reason closed EVERY tracked call, regardless of choice, and
// unconditionally emitted a real provider_stream_end - the root of both the
// duplicate-terminal poisoning bug and the more serious premature
// cross-choice execution-authority exposure). That behavior is intentionally
// changed here, per explicit maintainer design decision:
//
//   choice.finish_reason
//     -> closes ONLY calls belonging to that exact choice
//     -> records that choice's own terminal reason
//     -> does NOT emit provider_stream_end
//     -> does NOT set the adapter's global `finished` flag
//
//   adapter.finish(meta?)
//     -> the ONE provider_stream_end for the whole adapter lifetime,
//        aggregating every recorded choice reason (see REASON AGGREGATION
//        below) with `meta.reason`, called after the caller has drained the
//        raw provider iterator.
//
// This is a deliberate, disclosed lifecycle change to the Experimental raw
// OpenAI-compatible adapter surface (see docs/COMPATIBILITY.md's
// Experimental-tier policy): a single choice's finish_reason is no longer
// sufficient, by itself, to prove the whole provider stream is exhausted -
// it never was, for a genuine multi-choice (n>1) stream; the adapter simply
// could not previously distinguish that case from a single-choice one.
//
// Single-choice callers (by far the common case, and the entirety of what
// 593a581/2f4f76f/cd7be51 exercise) are NOT expected to change anything
// about their own usage - only the exact normalized-event SHAPE from a
// finish_reason chunk changes (tool_call_end only, not tool_call_end +
// provider_stream_end); the FINAL decision, once the caller completes the
// documented for-await-then-finish() lifecycle including the now-required
// `adapter.finish()` call, is unchanged.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach } from "vitest";
import OpenAI from "openai";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import { sseFrame, startSseFixtureServer, type RunningFixtureServer } from "../integration/support/sse-fixture-server.js";
import { TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE } from "../../src/coordinator/diagnostic-codes.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";

function drive(adapter: { push(raw: unknown): readonly unknown[] }, gate: ReturnType<typeof createToolCallExecutionGate>, raw: unknown) {
  const events = adapter.push(raw);
  for (const e of events) gate.push(e as Parameters<typeof gate.push>[0]);
  return events as Array<{ type: string; [k: string]: unknown }>;
}

describe("OpenAICompatibleStreamAdapter: corrected choice/provider-stream lifecycle", () => {
  describe("SINGLE-CHOICE LIFECYCLE: push(finish_reason) closes the call only; adapter.finish() is the sole provider_stream_end", () => {
    it("push() on a finish_reason chunk emits ONLY tool_call_end - never provider_stream_end", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });

      const terminalEvents = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      expect(terminalEvents.map((e) => e.type)).toEqual(["tool_call_end"]);
      expect(terminalEvents.some((e) => e.type === "provider_stream_end")).toBe(false);

      // Not yet finished from the gate/coordinator's point of view. Use
      // snapshot() for this peek, never finish() - gate.finish() locks its
      // own cached stream-end reason on its FIRST call (streamEndCaptured),
      // so calling it prematurely here would permanently pin the gate to
      // reason:"unknown" and break the real finish() call below. snapshot()
      // is the documented side-effect-free in-flight view specifically
      // because of this: "execute is only ever returned once the stream
      // has genuinely finished" (gate/types.ts).
      const midStream = gate.snapshot();
      expect(midStream.some((d) => d.action === "execute")).toBe(false);

      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);

      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).toBe("execute");
      const authority = expectDefined(gate.takeDecision(decision.internalId));
      expect(authority.value).toEqual({ a: 1 });
      expect(gate.takeDecision(decision.internalId)).toBeUndefined(); // exactly once
    });

    it("adapter.finish() is idempotent - exactly one provider_stream_end per adapter lifetime", () => {
      const adapter = new OpenAICompatibleStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: "{}" } }] } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "tool_calls" }] });
      const first = adapter.finish({ reason: "complete" });
      const second = adapter.finish({ reason: "complete" });
      expect(first.filter((e) => e.type === "provider_stream_end")).toHaveLength(1);
      expect(second).toHaveLength(0);
    });
  });

  describe("MULTI-CHOICE LIFECYCLE: no cross-choice premature authority", () => {
    it("choice 0's finish_reason closes ONLY choice 0's call; choice 1's call is untouched and not executable until ITS OWN terminal, then adapter.finish() produces the sole provider_stream_end", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });

      const afterA = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      expect(afterA.map((e) => e.type)).toEqual(["tool_call_end"]);
      // Exactly A's own sourceKey - never B's.
      expect((afterA[0] as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("choice:0/tool-index:0");

      // B must not be executable merely because A finished - no
      // provider_stream_end has fired at all. snapshot(), not finish() -
      // finish() locks the gate's own cached stream-end reason on first
      // call, which would break the real finish() call further below.
      const midStream = gate.snapshot();
      expect(midStream.some((d) => d.action === "execute")).toBe(false);

      const afterB = drive(adapter, gate, { choices: [{ index: 1, finish_reason: "tool_calls" }] });
      expect(afterB.map((e) => e.type)).toEqual(["tool_call_end"]);
      expect((afterB[0] as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("choice:1/tool-index:0");
      expect(afterB.some((e) => e.type === "provider_stream_end")).toBe(false);

      // Only now does the caller signal the raw iterator is exhausted.
      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).toBe("execute");
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });

    it("multiple tool calls within the SAME choice are all closed together by that choice's own finish_reason, never touching another choice", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_A1", type: "function", function: { name: "toolA1", arguments: '{"a":1}' } },
                { index: 1, id: "call_A2", type: "function", function: { name: "toolA2", arguments: '{"a":2}' } },
              ],
            },
          },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":9}' } }] } },
        ],
      });
      const afterChoice0 = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      expect(afterChoice0.map((e) => e.type)).toEqual(["tool_call_end", "tool_call_end"]);
      const closedKeys = afterChoice0.map((e) => (e as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).sort();
      expect(closedKeys).toEqual(["choice:0/tool-index:0", "choice:0/tool-index:1"]);

      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "tool_calls" }] });
      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      expect(final.decisions.filter((d) => d.action === "execute")).toHaveLength(3);
    });
  });

  describe("CHOICE TERMINAL STATE: duplicate/conflicting terminal for the same choice (BLOCKER 2: the second-terminal condition itself is never represented as TOOL_ARGUMENTS_AFTER_END - that code means tool-ARGUMENT evidence arrived late, and a second finish_reason is not argument evidence. No existing coordinator diagnostic code represents a duplicate/conflicting CHOICE-level terminal either (DUPLICATE_TOOL_END is call-scoped; TERMINAL_REASON_CONFLICT/EVENT_AFTER_STREAM_END are scoped to a second provider_stream_end, which this adapter deliberately never emits from one choice) - so this is solved entirely inside the adapter: a sticky choiceTerminalProtocolViolation flag forces adapter.finish()'s aggregated reason to the fail-closed 'provider_error', which decide.ts's decision table rejects UNCONDITIONALLY for every call in the stream, before any per-call status check", () => {
    it("same choice, SAME reason twice (tool_calls -> tool_calls): does not silently overwrite the first terminal, does not re-close, and the call is non-executable once the protocol violation is observed", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      const first = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      expect(first.map((e) => e.type)).toEqual(["tool_call_end"]);

      // Duplicate, same-reason terminal for the SAME already-finished choice.
      const duplicate = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      expect(duplicate.some((e) => e.type === "tool_call_end")).toBe(false); // no phantom second close
      expect((duplicate.find((e) => e.type === "provider_diagnostic") as { code?: string } | undefined)?.code).toBe("E_CHOICE_TERMINAL_PROTOCOL_VIOLATION"); // exact code - not argument evidence

      const finishEvents = adapter.finish({ reason: "complete" }); // caller optimistically claims complete
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      // The protocol violation forces fail-closed regardless of the
      // caller's own optimistic claim.
      expect((streamEnd as { reason?: string }).reason).toBe("provider_error");
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect((a as { reason?: string }).reason).toBe("provider_error");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
    });

    it("same choice, CONFLICTING reasons, MORE severe first (length -> stop): never silently overwrites the first-recorded reason with the second, less severe claim; non-executable", () => {
      // If the choiceAlreadyTerminal guard were ever bypassed, this would
      // silently launder an already-recorded unsafe "length" into
      // "complete" - the failure would be a genuinely fabricated
      // "execute", not merely a wrong reason string.
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      const firstClose = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "length" }] });
      expect(firstClose.map((e) => e.type)).toEqual(["tool_call_end"]);
      expect((firstClose[0] as { reason?: string }).reason).toBe("length");

      // Conflicting second report for the SAME choice, claiming "stop".
      const secondReport = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      expect(secondReport.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect((secondReport[0] as { code?: string }).code).toBe("E_CHOICE_TERMINAL_PROTOCOL_VIOLATION");
      // No phantom re-close of the already-closed call.
      expect(secondReport.some((e) => e.type === "tool_call_end")).toBe(false);

      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      // Fail-closed via provider_error, NOT "length" and NOT "complete" -
      // the protocol violation itself, not a comparison between the two
      // claimed reasons, is what must win.
      expect((streamEnd as { reason?: string }).reason).toBe("provider_error");
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).not.toBe("execute");
      expect((decision as { reason?: string }).reason).toBe("provider_error");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });

    it("same choice, CONFLICTING reasons, LESS severe first (stop -> length): starting with the most permissive possible reason does not make the stream safe once a second terminal contradicts it", () => {
      // The mirror-image ordering of the previous test: the FIRST report is
      // the most permissive possible claim ("stop"/complete). Proves the
      // fail-closed guarantee does not depend on which reason arrived
      // first being severe - ANY second terminal for an already-terminal
      // choice is itself the violation, regardless of ordering.
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      const firstClose = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      expect(firstClose.map((e) => e.type)).toEqual(["tool_call_end"]);
      expect((firstClose[0] as { reason?: string }).reason).toBe("complete");

      const secondReport = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "length" }] });
      expect(secondReport.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect((secondReport[0] as { code?: string }).code).toBe("E_CHOICE_TERMINAL_PROTOCOL_VIOLATION");
      expect(secondReport.some((e) => e.type === "tool_call_end")).toBe(false);

      const finishEvents = adapter.finish({ reason: "complete" }); // caller still optimistically claims complete
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      // The FIRST-recorded reason ("complete", rank 5 - the single most
      // permissive value REASON_PRIORITY has) must never be what survives
      // here - that would be the exact "silently overwritten into a more
      // permissive one" failure mode this blocker exists to close. Nor
      // does the second claim ("length") win by ordinary REASON_PRIORITY
      // comparison - the protocol violation itself always wins.
      expect((streamEnd as { reason?: string }).reason).toBe("provider_error");
      expect((streamEnd as { reason?: string }).reason).not.toBe("complete");
      expect((streamEnd as { reason?: string }).reason).not.toBe("length");
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).not.toBe("execute");
      expect((decision as { reason?: string }).reason).toBe("provider_error");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });

    it("a duplicate/conflicting terminal for ONE choice fails the WHOLE stream closed, including an entirely separate, cleanly-finished sibling choice - a deliberate, disclosed trade-off of this specific fix (see the describe block's own doc comment: no per-choice diagnostic code exists for this condition)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      // Choice 1 finishes once, cleanly - no protocol violation of its own.
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "tool_calls" }] });
      // Choice 0 finishes, then reports a second, conflicting terminal.
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "length" }] });

      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(b.action).not.toBe("execute");
      expect((b as { reason?: string }).reason).toBe("provider_error");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(gate.takeDecision(b.internalId)).toBeUndefined();
    });
  });

  describe("CHOICE-LOCAL POST-TERMINAL EVIDENCE: hardened", () => {
    it("a late argument delta for an already-choice-terminal call fails that call closed via TOOL_ARGUMENTS_AFTER_END, without touching the other, still-open choice", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1' } }] } }, // deliberately unclosed
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });

      // Late evidence for A's own choice (0), after choice 0 already
      // recorded its terminal.
      const lateEvents = drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ',"evil":true}' } }] } }] });
      const diag = expectDefined(lateEvents.find((e) => e.type === "provider_diagnostic"));
      expect((diag as { code?: string }).code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect(lateEvents.some((e) => e.type === "tool_call_arguments_delta")).toBe(false); // never merged as normal evidence

      // Choice 1 continues and finishes completely normally, unaffected.
      drive(adapter, gate, { choices: [{ index: 1, delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] } }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "tool_calls" }] });
      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      // A must never execute with the late-mutated value - the diagnostic
      // must actually disqualify it, not just exist as an FYI.
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      // B, an entirely different, unrelated choice, is unaffected.
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: "test" });
    });

    it("a brand-new tool_call_start attempt under an already-choice-terminal choice never becomes a tracked, executable call, AND revokes that choice's own already-closed call's authority (BLOCKER 1: a diagnostic attached only to the new, never-resolvable sourceKey disqualifies nothing)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      // A valid, complete call A in choice 0.
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      // choice 0 finishes normally.
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });

      // A genuinely NEW tool call (different, never-before-seen tool-index)
      // injected into the already-finished choice 0.
      const injected = drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "call_evil", type: "function", function: { name: "evil", arguments: "{}" } }] } }] });
      expect(injected.some((e) => e.type === "tool_call_start")).toBe(false);

      // A sibling choice, for the "must not poison unrelated choices"
      // half of the invariant - attribution to choice 1 remains possible
      // and must be unaffected by choice 0's post-terminal contamination.
      drive(adapter, gate, { choices: [{ index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "tool_calls" }] });

      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();

      expect(final.decisions.some((d) => (d as { name?: string }).name === "evil")).toBe(false);

      // BLOCKER 1's actual required invariant: the new tool-index evidence
      // must revoke call A's OWN execution authority too - not merely fail
      // to introduce "evil". A diagnostic attached only to the phantom,
      // never-started sourceKey (choice:0/tool-index:1) can never resolve
      // to a real coordinator call, so on the pre-fix adapter this
      // assertion is expected to FAIL (A still executes) - that failure IS
      // the required RED proof.
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();

      // Sibling choice 1's call B must remain genuinely unaffected -
      // choice-local revocation, not stream-wide.
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });

    it("MULTIPLE tool calls in the SAME already-terminal choice are ALL revoked by late evidence, not merely the most-recently-added one", () => {
      // Targets allSourceKeysByChoice specifically retaining EVERY call
      // added to a choice, not just the last one - if the Map entry were
      // ever replaced rather than reused/appended to (e.g. across multiple
      // tool_calls entries), an earlier call in the same choice could
      // silently escape choice-local revocation.
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      // Two DIFFERENT tool calls in choice 0, added in the SAME chunk.
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [
        { index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } },
        { index: 1, id: "call_C", type: "function", function: { name: "toolC", arguments: '{"c":3}' } },
      ] } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });

      // Late evidence for a THIRD, brand-new tool index under the
      // already-terminal choice 0.
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 2, id: "call_evil", type: "function", function: { name: "evil", arguments: "{}" } }] } }] });

      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const c = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolC"));
      // BOTH must be revoked - not only whichever was added last.
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(c.action).not.toBe("execute");
      expect(gate.takeDecision(c.internalId)).toBeUndefined();
    });

    it("a spurious tool_calls delta for a TEXT-ONLY choice that already finished (no call ever tracked for it) is recorded for forensic visibility, disqualifies nothing (there is nothing to disqualify), and never starts a call", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      // Choice 0 finishes with no tool calls at all - a plain text response.
      const closeEvents = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      expect(closeEvents).toEqual([]); // nothing to close - no calls were ever open

      // A spurious tool_calls delta arrives afterward, for a choice that
      // never tracked any call in the first place.
      const spurious = drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_evil", type: "function", function: { name: "evil", arguments: "{}" } }] } }] });
      expect(spurious.some((e) => e.type === "tool_call_start")).toBe(false);
      const diag = expectDefined(spurious.find((e) => e.type === "provider_diagnostic"));
      expect((diag as { code?: string }).code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect((diag as { callRef?: { sourceKey?: string } }).callRef?.sourceKey).toBe("choice:0/tool-index:0");

      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      expect(final.decisions.some((d) => (d as { name?: string }).name === "evil")).toBe(false);
    });

    it("a spurious tool_calls delta with a MALFORMED index for a text-only already-terminal choice is silently skipped (no forensic diagnostic can name a real index), never crashes, and still starts no call", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] }); // text-only, no calls ever tracked

      const spurious = drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: -1, function: { name: "evil" } }] } }] });
      expect(spurious).toEqual([]); // malformed index - not even a forensic record can name it
      expect(spurious.some((e) => e.type === "tool_call_start")).toBe(false);

      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      expect(final.decisions).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // NON-TOOL EVIDENCE AFTER CHOICE TERMINAL: recognized-evidence contract
  // boundary.
  //
  // Investigated (not assumed): OpenAIChoiceDelta declares exactly one
  // field, `tool_calls` (see src/providers/openai-compatible.ts's own type
  // definitions), and push()'s runtime code reads exactly three fields off
  // a raw choice - `choice.index`, `choice.delta.tool_calls` (and its
  // nested index/id/function.name/function.arguments), and
  // `choice.finish_reason` - confirmed by grepping the entire file for
  // every `choice.`/`delta.` access. No `content`, `reasoning`, `role`, or
  // any other field is read anywhere in this file.
  //
  // Classification:
  //   TOOL EXECUTION EVIDENCE     - delta.tool_calls (only)
  //   NON-TOOL GENERATION EVIDENCE - NONE. This adapter's contract has no
  //                                  field that constitutes recognized
  //                                  proof a choice is still generating,
  //                                  other than tool_calls itself (already
  //                                  fully covered by the choice-local
  //                                  revocation mechanism above).
  //   INERT / METADATA            - everything else, including a
  //                                  hypothetical delta.content,
  //                                  delta.reasoning, or choice.role: never
  //                                  read, so silently, uniformly ignored
  //                                  regardless of WHEN it arrives.
  //
  // Conclusion: the invariant "later meaningful generation evidence must
  // contradict a stale choice-terminal claim" is satisfied VACUOUSLY, not
  // via a defense mechanism - this adapter never extends trust based on
  // such a field's presence or absence in the first place, so there is no
  // trust for later evidence to contradict. Empirically confirmed below:
  // fabricating a real-shaped-but-unrecognized "still generating" content
  // delta after a choice's own finish_reason produces zero normalized
  // events and does not touch that choice's already-decided authority -
  // the identical, correct behavior an entirely unrelated unknown field
  // would get. No production change was made for this investigation.
  // ---------------------------------------------------------------------
  describe("NON-TOOL EVIDENCE AFTER CHOICE TERMINAL: this adapter's recognized-evidence contract is tool_calls only - unrecognized fields (content/reasoning/role/other) are uniformly inert, before or after a choice's own finish_reason", () => {
    it("late UNRECOGNIZED non-tool evidence (delta.content, delta.reasoning, choice.role together) after choice 0's finish_reason produces zero events and does not touch choice 0's already-decided authority; sibling choice 1 is unaffected either way (INVARIANT ALREADY SATISFIED - vacuously, not via a defense: this adapter's push() never reads these fields at all, confirmed by exhaustive source grep)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });

      // A later raw chunk: choice 0 carries only fields this adapter's own
      // type/runtime contract does not recognize at all - not a JSON shape
      // this adapter was ever built to interpret as generation evidence.
      const lateEvents = drive(adapter, gate, {
        choices: [{ index: 0, delta: { content: "still generating", reasoning: "thinking more" }, role: "assistant" }],
      });
      expect(lateEvents).toEqual([]); // silently, uniformly inert - not specially detected, not specially ignored

      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "tool_calls" }] });
      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      // A's authority, already legitimately decided before the late
      // unrecognized evidence arrived, is untouched by it.
      expect(a.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      // B, the sibling, was never in question - included as the explicit
      // isolation control the maintainer's spec requires either way.
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });

    it("SAME-CHUNK CONTROL: tool_calls and finish_reason arriving together in ONE raw choice object is pre-terminal evidence, never treated as post-terminal - choiceAlreadyTerminal is read from state BEFORE this chunk, not mutated mid-chunk", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      const events = drive(adapter, gate, {
        choices: [{
          index: 0,
          delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] },
          finish_reason: "tool_calls",
        }],
      });
      // Normal start + immediate close - never a TOOL_ARGUMENTS_AFTER_END
      // diagnostic, even though both pieces of evidence share one chunk
      // with the terminal marker.
      expect(events.map((e) => e.type)).toEqual(["tool_call_start", "tool_call_arguments_delta", "tool_call_end"]);
      expect(events.some((e) => (e as { code?: string }).code === TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE)).toBe(false);

      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
    });

    it("EMPTY-DELTA CONTROL: a later choice event shaped as delta: {} (no recognized evidence at all) after finish_reason produces zero events and never revokes authority merely because an empty object arrived", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });

      const emptyDeltaEvents = drive(adapter, gate, { choices: [{ index: 0, delta: {} }] });
      expect(emptyDeltaEvents).toEqual([]);

      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
    });
  });

  describe("GLOBAL finished RESERVATION: reserved for genuine provider-stream-wide termination, not a single choice finishing", () => {
    it("an OpenAI-compatible top-level provider error remains genuinely global and fail-closed", () => {
      // OpenAICompatibleStreamAdapter itself has no top-level error field
      // (unlike OpenRouterStreamAdapter) - its own provider-error path is
      // exercised indirectly through the wrapper tests below. This test
      // instead proves the NEGATIVE: an ordinary single-choice finish_reason
      // alone must never set the adapter's own global `finished` the way a
      // real stream-wide error would - confirmed by the adapter still
      // accepting (and correctly routing) a SECOND choice's independent
      // evidence afterward, which a prematurely-global `finished` flag
      // would have blocked via the pre-existing W_EVENT_AFTER_STREAM_END path.
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: "{}" } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: "{}" } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      const afterB = drive(adapter, gate, { choices: [{ index: 1, delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] });
      expect(afterB.some((e) => e.type === "provider_diagnostic" && (e as { code?: string }).code === "W_EVENT_AFTER_STREAM_END")).toBe(false);
    });
  });

  describe("REASON AGGREGATION: adapter.finish() computes one stream-wide reason from every recorded choice reason", () => {
    it("complete + complete -> complete (all choices genuinely finished normally)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "stop" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("complete");
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      expect(final.decisions.filter((d) => d.action === "execute")).toHaveLength(2);
    });

    it("complete + length -> length, never complete - the length choice's own truncation must not be laundered into a clean overall result", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] }); // -> complete
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "length" }] }); // -> length
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("length");
      expect((streamEnd as { reason?: string }).reason).not.toBe("complete");
    });

    it("cancelled + complete -> cancelled", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: "{}" } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: "{}" } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "cancelled" }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "tool_calls" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("cancelled");
    });

    it("no choice ever reported a finish_reason at all - adapter.finish() falls back to meta.reason (or 'unknown')", () => {
      const adapter = new OpenAICompatibleStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: "{}" } }] } }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
      // Any call never closed by its own choice must also be closed now.
      expect(finishEvents.some((e) => e.type === "tool_call_end")).toBe(true);
    });

    it("complete + unknown -> unknown - an UNRECOGNIZED finish_reason from one choice must dominate an otherwise-clean sibling, never get silently dropped from the aggregation", () => {
      // Targets REASON_PRIORITY's own "unknown" entry specifically: unknown
      // outranks complete (rank 1 vs rank 5), so if it were ever excluded
      // from consideration - e.g. an indexOf() lookup that fails to match
      // the literal string "unknown" - the less-severe "complete" would
      // incorrectly win instead.
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "some_future_provider_reason" }] }); // -> unknown (mapFinishReason's own fallback)
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
      expect((streamEnd as { reason?: string }).reason).not.toBe("complete");
    });

    it("a caller-supplied 'unknown' dominates an otherwise-complete choice reason (distinct from a CHOICE's own unrecognized finish_reason above - this exercises the caller-reason branch's own indexOf/-1-sentinel check specifically)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      const finishEvents = adapter.finish({ reason: "unknown" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
    });

    it("a caller-supplied 'network_error' dominates an otherwise-complete choice reason (REASON_PRIORITY's own 'network_error' entry, caller-only - no choice.finish_reason ever maps to it)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      const finishEvents = adapter.finish({ reason: "network_error" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("network_error");
    });

    // BLOCKER 3 (verify, do not expand scope): characterization of the
    // relative ordering among unknown/network_error/length/cancelled -
    // driven through the REAL gate, reporting aggregate reason,
    // decision.action, decision.reason, and takeDecision for each, per
    // maintainer instruction. Findings (see FINAL REPORT's MIXED UNSAFE
    // REASON CHARACTERIZATION table for the authoritative summary): in
    // every case below, both calls are non-executable regardless of which
    // of these four specific reasons wins the aggregation - decide.ts's
    // decision table (src/gate/decide.ts) checks
    // `ctx.streamEndReason === "provider_error"` as its ONLY direct read of
    // the aggregate reason; none of unknown/network_error/length/cancelled
    // is checked anywhere else in that function. What actually determines
    // each INDIVIDUAL call's decision.reason is that call's OWN status,
    // set by the coordinator from ITS OWN choice's tool_call_end.reason
    // (never the later stream-wide aggregate) - so the aggregate's exact
    // value among these four changes only the aggregate figure itself
    // (observability / forensic classification), never whether any call
    // here is executable.
    it("length + cancelled -> length wins the aggregate (REASON_PRIORITY rank 3 vs 4); both calls remain non-executable regardless", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "length" }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "cancelled" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("length");
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(b.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(gate.takeDecision(b.internalId)).toBeUndefined();
    });

    it("network_error (caller-supplied) + length (choice) -> network_error wins the aggregate (REASON_PRIORITY rank 2 vs 3); both calls remain non-executable regardless", () => {
      // network_error is caller-only - no choice.finish_reason ever maps
      // to it (see mapFinishReason) - so it is supplied via meta.reason on
      // adapter.finish() here, the only way it can ever appear.
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "length" }] });
      // Choice 0 never reports its own finish_reason - the raw iterator
      // was cut off by a network failure before it could.
      const finishEvents = adapter.finish({ reason: "network_error", providerReason: "ECONNRESET" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("network_error");
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(b.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(gate.takeDecision(b.internalId)).toBeUndefined();
    });

    it("unknown + cancelled -> unknown wins the aggregate (REASON_PRIORITY rank 1 vs 4); both calls remain non-executable regardless", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } },
          { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "some_future_provider_reason" }] }); // -> unknown
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "cancelled" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(b.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(gate.takeDecision(b.internalId)).toBeUndefined();
    });

    it("aggregation is order-independent: the more-severe choice reason wins regardless of whether it is recorded before or after the less-severe one", () => {
      // Proves REASON_PRIORITY comparison is a genuine strict "worse wins"
      // (rank < worstRank), not an unconditional last-write-wins across
      // choices - both insertion orders must reach the identical, correct
      // aggregate.
      const worseFirst = new OpenAICompatibleStreamAdapter();
      worseFirst.push({ choices: [{ index: 0, finish_reason: "length" }] }); // rank 3
      worseFirst.push({ choices: [{ index: 1, finish_reason: "stop" }] }); // rank 5 (complete)
      const worseFirstEnd = expectDefined(worseFirst.finish().find((e) => e.type === "provider_stream_end"));
      expect((worseFirstEnd as { reason?: string }).reason).toBe("length");

      const worseSecond = new OpenAICompatibleStreamAdapter();
      worseSecond.push({ choices: [{ index: 0, finish_reason: "stop" }] }); // rank 5 (complete)
      worseSecond.push({ choices: [{ index: 1, finish_reason: "length" }] }); // rank 3
      const worseSecondEnd = expectDefined(worseSecond.finish().find((e) => e.type === "provider_stream_end"));
      expect((worseSecondEnd as { reason?: string }).reason).toBe("length");
    });
  });

  describe("META.REASON INTERACTION", () => {
    it("a caller-provided 'complete' must NOT override an already-recorded unsafe choice reason (length)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "length" }] });
      const finishEvents = adapter.finish({ reason: "complete" }); // caller optimistically claims complete
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("length"); // the real, recorded reason wins
    });

    it("a caller-provided unsafe reason (provider_error) still makes the aggregate unsafe even if every recorded choice reason was complete", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "tool_calls" }] }); // -> complete
      const finishEvents = adapter.finish({ reason: "provider_error", providerReason: "connection_reset" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("provider_error");
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(a.action).not.toBe("execute");
      expect((a as { reason?: string }).reason).toBe("provider_error");
    });
  });

  describe("OPENAI WRAPPER (no production modification to src/providers/openai.ts): the lifecycle change propagates through unmodified", () => {
    it("OpenAIStreamAdapter.push(finish_reason) for plural tool_calls emits tool_call_end only; OpenAIStreamAdapter.finish() produces the provider_stream_end", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      const terminalEvents = drive(adapter, gate, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      expect(terminalEvents.map((e) => e.type)).toEqual(["tool_call_end"]);

      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(decision.internalId)).value).toEqual({ a: 1 });
    });

    it("Responses API behavior is completely unchanged: push(response.completed) still emits provider_stream_end directly, no adapter.finish() needed", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
      drive(adapter, gate, { type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"test"}' });
      drive(adapter, gate, { type: "response.output_item.done", item: { id: "item-1" } });
      const completedEvents = drive(adapter, gate, { type: "response.completed", response: { status: "completed" } });
      expect(completedEvents.some((e) => e.type === "provider_stream_end")).toBe(true);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
    });

    it("P4.3: legacy singular function_call behavior is NO LONGER the 2f4f76f direct-terminal shortcut - it now follows the SAME choice-local lifecycle as the plural tool_calls case above: push(finish_reason) emits tool_call_end only, and a separate adapter.finish() produces the provider_stream_end", () => {
      // Pre-P4.3, a choice's own legacy finish_reason directly ended the
      // WHOLE provider stream (this adapter's global `finished`), exactly
      // the "first choice to finish wrongly ends every choice" defect
      // OpenAICompatibleStreamAdapter's own class-level doc comment
      // describes for the plural path (see the sibling test immediately
      // above) - fatal for a genuine n>1 legacy stream, since a SECOND,
      // still-open choice's independent function_call evidence could
      // never be reached (E-1/E-2). P4.3 ports the identical choice-local
      // fix onto the legacy path: this choice's finish_reason now closes
      // only its own call, and the ONE stream-wide provider_stream_end
      // comes solely from adapter.finish().
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "search", arguments: '{"q":"test"}' } } }] });
      const terminalEvents = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      expect(terminalEvents.map((e) => e.type)).toEqual(["tool_call_end"]);

      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(decision.internalId)).value).toEqual({ q: "test" });
    });
  });

  describe("OPENROUTER WRAPPER (no production modification to src/providers/openrouter.ts): the lifecycle change propagates through unmodified", () => {
    it("OpenRouterStreamAdapter.push(finish_reason) emits tool_call_end only; OpenRouterStreamAdapter.finish() produces the provider_stream_end", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenRouterStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      const terminalEvents = drive(adapter, gate, { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      expect(terminalEvents.map((e) => e.type)).toEqual(["tool_call_end"]);

      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).toBe("execute");
    });

    it("OpenRouter's own top-level error field remains a genuinely global, immediate termination (unaffected by the choice-scoping change)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenRouterStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: "{}" } }] } }] });
      const errorEvents = drive(adapter, gate, { error: "upstream failure" });
      expect(errorEvents.some((e) => e.type === "provider_stream_end")).toBe(true);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).not.toBe("execute");
      expect((decision as { reason?: string }).reason).toBe("provider_error");
    });
  });

  describe("OFFICIAL SDK PARSER PROOF (openai@7.8.0 only - SDK-parser lifecycle compatibility, NOT live-provider behavior; no network, no credentials)", () => {
    let server: RunningFixtureServer | undefined;
    afterEach(async () => {
      await server?.close();
      server = undefined;
    });

    it("choice 0 and choice 1 finish on separate real SDK-parsed chunks, then [DONE]: no premature close/authority during the stream; adapter.finish() after iterator exhaustion produces the sole provider_stream_end and both calls execute", async () => {
      server = await startSseFixtureServer({
        chunks: [
          sseFrame(null, {
            id: "chatcmpl-lc1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini",
            choices: [
              { index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] }, finish_reason: null },
              { index: 1, delta: { tool_calls: [{ index: 0, id: "call_B", type: "function", function: { name: "toolB", arguments: '{"b":2}' } }] }, finish_reason: null },
            ],
          }),
          sseFrame(null, {
            id: "chatcmpl-lc1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini",
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          }),
          sseFrame(null, {
            id: "chatcmpl-lc1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini",
            choices: [{ index: 1, delta: {}, finish_reason: "tool_calls" }],
          }),
          sseFrame(null, "[DONE]"),
        ],
      });

      const client = new OpenAI({ apiKey: "sk-test-dummy-not-a-real-key", baseURL: server.baseUrl, maxRetries: 0 });
      const stream = await client.chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });

      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();

      for await (const chunk of stream) {
        const events = drive(adapter, gate, chunk);
        // At no point DURING the real SDK-driven loop does a
        // provider_stream_end appear - not on chunk 1 (no finish_reason at
        // all), not on chunk 2 (choice 0 only), not on chunk 3 (choice 1 -
        // the SDK iterator has not exhausted yet either way).
        expect(events.some((e) => e.type === "provider_stream_end")).toBe(false);
      }
      // The raw provider iterator is now genuinely exhausted.
      const finishEvents = adapter.finish({ reason: "complete" });
      expect(finishEvents.map((e) => e.type)).toEqual(["provider_stream_end"]);
      for (const e of finishEvents) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).toBe("execute");
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });
  });

  // ---------------------------------------------------------------------
  // UNIVERSAL LIFECYCLE: proves the ONE documented pattern (see
  // docs/EXECUTION_GATE.md#example) - push every raw event, then ALWAYS
  // call adapter.finish() once the raw source is exhausted, THEN
  // gate.finish() - is safe and correct across every adapter this
  // OpenAICompatibleStreamAdapter redesign touches, and does not require
  // memorizing a provider-specific exception for adapters whose push() can
  // legitimately observe a genuine global terminal on its own.
  // ---------------------------------------------------------------------
  describe("UNIVERSAL LIFECYCLE: adapter.push() ... adapter.finish() ... gate.finish() is the one safe documented pattern for every adapter", () => {
    it("OpenAICompatibleStreamAdapter: push tool delta, push choice finish_reason, adapter.finish(), gate.finish() -> exactly one provider_stream_end and one executable authority", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAICompatibleStreamAdapter();
      const allEvents: NormalizedToolStreamEvent[] = [];
      const startEvents = adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      allEvents.push(...startEvents);
      for (const e of startEvents) gate.push(e);
      const closeEvents = adapter.push({ choices: [{ index: 0, finish_reason: "tool_calls" }] });
      allEvents.push(...closeEvents);
      for (const e of closeEvents) gate.push(e);
      const finishEvents = adapter.finish();
      allEvents.push(...finishEvents);
      for (const e of finishEvents) gate.push(e);

      expect(allEvents.filter((e) => e.type === "provider_stream_end")).toHaveLength(1);
      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(decision.internalId)).value).toEqual({ a: 1 });
    });

    it("OpenRouterStreamAdapter: the same universal lifecycle -> exactly one provider_stream_end", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenRouterStreamAdapter();
      const allEvents: NormalizedToolStreamEvent[] = [];
      const startEvents = adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      allEvents.push(...startEvents);
      for (const e of startEvents) gate.push(e);
      const closeEvents = adapter.push({ choices: [{ index: 0, finish_reason: "tool_calls" }] });
      allEvents.push(...closeEvents);
      for (const e of closeEvents) gate.push(e);
      const finishEvents = adapter.finish();
      allEvents.push(...finishEvents);
      for (const e of finishEvents) gate.push(e);

      expect(allEvents.filter((e) => e.type === "provider_stream_end")).toHaveLength(1);
      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(decision.internalId)).value).toEqual({ a: 1 });
    });

    it("OpenAIStreamAdapter - plural tool_calls: the same universal lifecycle -> exactly one provider_stream_end and normal authority", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      const allEvents: NormalizedToolStreamEvent[] = [];
      const startEvents = adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_A", type: "function", function: { name: "toolA", arguments: '{"a":1}' } }] } }] });
      allEvents.push(...startEvents);
      for (const e of startEvents) gate.push(e);
      const closeEvents = adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      allEvents.push(...closeEvents);
      for (const e of closeEvents) gate.push(e);
      const finishEvents = adapter.finish();
      allEvents.push(...finishEvents);
      for (const e of finishEvents) gate.push(e);

      expect(allEvents.filter((e) => e.type === "provider_stream_end")).toHaveLength(1);
      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(decision.internalId)).value).toEqual({ a: 1 });
    });

    it("ALREADY-GLOBALLY-FINISHED CONTROL: an adapter whose push() itself legitimately emitted a genuine global terminal (OpenAI Responses API response.completed) stays safe when the universal pattern's adapter.finish() is still called afterward - no second provider_stream_end, no authority poisoning, no duplicate-terminal diagnostic", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      const allEvents: NormalizedToolStreamEvent[] = [];

      const startEvents = adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "toolA" } });
      allEvents.push(...startEvents);
      for (const e of startEvents) gate.push(e);
      const deltaEvents = adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"a":1}' });
      allEvents.push(...deltaEvents);
      for (const e of deltaEvents) gate.push(e);
      const doneEvents = adapter.push({ type: "response.output_item.done", item: { id: "item-1" } });
      allEvents.push(...doneEvents);
      for (const e of doneEvents) gate.push(e);
      // push() itself observes the genuine global terminal here - a real,
      // complete provider_stream_end, with adapter.finished already true.
      const completedEvents = adapter.push({ type: "response.completed", response: { status: "completed" } });
      allEvents.push(...completedEvents);
      for (const e of completedEvents) gate.push(e);
      expect(completedEvents.some((e) => e.type === "provider_stream_end")).toBe(true);

      // The universal documented pattern still calls adapter.finish() here,
      // unconditionally - this must be a safe, idempotent no-op.
      const finishEvents = adapter.finish();
      allEvents.push(...finishEvents);
      for (const e of finishEvents) gate.push(e);
      expect(finishEvents).toHaveLength(0);

      expect(allEvents.filter((e) => e.type === "provider_stream_end")).toHaveLength(1);
      expect(allEvents.some((e) => e.type === "provider_diagnostic")).toBe(false);

      const final = gate.finish();
      const decision = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect(decision.action).toBe("execute"); // not poisoned by the later finish() call
      expect(expectDefined(gate.takeDecision(decision.internalId)).value).toEqual({ a: 1 });
    });
  });
});
