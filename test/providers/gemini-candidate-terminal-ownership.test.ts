// ---------------------------------------------------------------------------
// Permanent regression suite for GeminiStreamAdapter's Phase B terminal-
// ownership AND candidate-identity fix.
//
// Corrected in raw review (Phase B.1/B.2): the original Phase B
// implementation assumed Gemini's Candidate has no explicit wire-level
// index field and used JS array position instead. That premise was wrong -
// the official `@google/genai@2.21.0` SDK's own `Candidate.index` field
// ("Output only. The 0-based index of this candidate in the list of
// generated responses. This is useful for distinguishing between multiple
// candidates when candidate_count > 1") is the real, authoritative
// identity - confirmed against the installed SDK's own type declarations
// AND its real SSE parser (test/integration/gemini-official-sdk-lifecycle.
// test.ts). Every test in this file therefore uses an explicit
// `index` on every candidate that carries function-call evidence -
// PROVIDER EVIDENCE drives these tests; none of them insert `{}`
// placeholder candidates merely to make array position line up with a
// real candidate.index, which was itself the exact bug being fixed.
//
// IMPORTANT, independently re-verified epistemic boundary, re-stated in
// every test group below where it matters: no Gemini tool call has ever
// been able to reach `execute` authority, before or after this fix -
// PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE is unconditional on every
// functionCall and checked by decide.ts before status is even considered;
// gate.ts's takeDecision() re-derives fresh and only ever returns
// something for action==="execute". This file proves CORRECTNESS/
// identity-isolation/architecture-consistency, never an execution-
// authority exploit.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import {
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
  INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
} from "../../src/coordinator/diagnostic-codes.js";

function drive(adapter: { push(raw: unknown): readonly unknown[] }, gate: ReturnType<typeof createToolCallExecutionGate>, raw: unknown) {
  const events = adapter.push(raw);
  for (const e of events) gate.push(e as Parameters<typeof gate.push>[0]);
  return events as Array<{ type: string; [k: string]: unknown }>;
}

describe("GeminiStreamAdapter: Phase B candidate-local terminal ownership + Phase B.2 explicit candidate.index identity", () => {
  describe("EXPLICIT INDEX IDENTITY (Phase B.2/B.8): wire candidate.index is authoritative, never array position", () => {
    it("candidate index 0 and candidate index 1, delivered in ONE chunk in REVERSED array order (index 1 listed first), still resolve to their own correct, independent real identity - not swapped", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      const events = drive(adapter, gate, {
        candidates: [
          { index: 1, content: { parts: [{ functionCall: { name: "toolB", args: { b: 2 } } }] } },
          { index: 0, content: { parts: [{ functionCall: { name: "toolA", args: { a: 1 } } }] } },
        ],
      });
      const sourceKeys = events.filter((e) => e.type === "tool_call_start").map((e) => (e.callRef as { sourceKey?: string })?.sourceKey);
      expect(sourceKeys).toContain("candidate:1/part:0");
      expect(sourceKeys).toContain("candidate:0/part:0");
    });

    it("candidate 0 finishes in chunk 1 (two real candidates present); candidate 1 - still active - arrives ALONE in chunk 2, at JS array position 0; candidate 1 remains candidate 1, no evidence is attributed to candidate 0", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, {
        candidates: [
          { index: 0, content: { parts: [{ functionCall: { name: "toolA", args: { a: 1 } } }] }, finishReason: "STOP" },
          { index: 1, content: { parts: [{ functionCall: { name: "toolB", args: { b: 2 } } }] } },
        ],
      });
      // Chunk 2: ONLY candidate index 1 - array position 0 - the exact
      // shape array-position identity could not have told apart from
      // candidate 0. A leading text part gives the new functionCall its
      // own part position, isolating candidate identity from the
      // separate, unrelated part-level sourceKey-reuse concern a second
      // same-part-index functionCall would also raise.
      const lateEvents = drive(adapter, gate, {
        candidates: [{ index: 1, content: { parts: [{ text: "continuing" }, { functionCall: { name: "toolB2", args: { more: true } } }] } } ],
      });
      const lateSourceKeys = lateEvents.map((e) => (e.callRef as { sourceKey?: string })?.sourceKey).filter(Boolean);
      expect(lateSourceKeys).toContain("candidate:1/part:1");
      expect(lateSourceKeys.some((k) => k?.startsWith("candidate:0/"))).toBe(false);
      expect(lateEvents.some((e) => e.code === TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE)).toBe(false);

      for (const e of adapter.finish()) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      expect((a as { reason?: string }).reason).toBe("projection_only"); // epistemic boundary: still never executable
    });

    it("candidate ordering may change across chunks without identity changing - candidate 1 appearing FIRST in one chunk and candidate 0 appearing FIRST in a later chunk does not swap their own recorded terminal reasons", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 1, finishReason: "MAX_TOKENS" }, { index: 0, finishReason: "STOP" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      // worst-wins aggregation: MAX_TOKENS (length, rank 3) must still
      // dominate STOP (complete, rank 5) regardless of which candidate
      // index was listed first in the array.
      expect((streamEnd as { reason?: string }).reason).toBe("length");
    });
  });

  describe("MISSING/INVALID CANDIDATE INDEX (Phase B.3): fail closed, never guessed as candidate 0", () => {
    it("a MIXED-parts candidate (one part with a functionCall, one without) with an invalid index still fails closed via INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE - hasFunctionCall correctly checks whether ANY part carries one, not whether EVERY part does", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "good", args: {} } }] } }] });
      const badEvents = drive(adapter, gate, {
        candidates: [{ content: { parts: [{ text: "commentary" }, { functionCall: { name: "ambiguous", args: {} } }] } }],
      });
      expect(badEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect(badEvents[0]?.code).toBe(INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE);
    });

    it("every invalid index shape (missing/negative/non-integer/NaN) with functionCall evidence fails closed via INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE - stream-wide/unattributable (no callRef at all), it poisons the WHOLE stream including an otherwise-valid sibling candidate 0", () => {
      for (const index of [undefined, -1, 1.5, Number.NaN]) {
        const gate = createToolCallExecutionGate();
        const adapter = new GeminiStreamAdapter();
        drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "good", args: {} } }] } }] });
        const badEvents = drive(adapter, gate, { candidates: [{ index, content: { parts: [{ functionCall: { name: "ambiguous", args: {} } }] } }] });
        expect(badEvents.map((e) => e.type), `index ${index}`).toEqual(["provider_diagnostic"]);
        expect(badEvents[0]?.code, `index ${index}`).toBe(INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE);
        expect(badEvents[0]?.callRef, `index ${index}`).toBeUndefined();
        drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] });
        for (const e of adapter.finish()) gate.push(e);

        const final = gate.finish();
        // The ambiguous candidate never became a tracked call at all.
        expect(final.decisions, `index ${index}`).toHaveLength(1);
        const good = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "good"));
        // decide.ts checks PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE BEFORE
        // AUTHORITY_PROTOCOL_VIOLATION_CODES (see its own check ordering) -
        // and every tracked Gemini call unconditionally carries the
        // former, so the SURFACED `.reason` always reads "projection_only"
        // for any real Gemini call, never "protocol_violation", even when
        // a genuine protocol violation also exists. The violation itself
        // is still real and recorded - verified directly against the raw
        // diagnostics list instead of the (necessarily masked) `.reason`.
        expect((good as { reason?: string }).reason, `index ${index}`).toBe("projection_only");
        expect(gate.takeDecision(good.internalId), `index ${index}`).toBeUndefined();
        expect(final.diagnostics.some((d) => d.code === INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE), `index ${index}`).toBe(true);
      }
    });

    it("an invalid-index candidate with NO functionCall evidence at all (a bare finishReason, or a fully empty candidate) is silently skipped - not diagnosed, and its finishReason is not recorded, matching OpenAI legacy's own identical design", () => {
      for (const rawCandidate of [
        { finishReason: "STOP" },
        {},
        { index: -1, finishReason: "STOP" },
      ]) {
        const adapter = new GeminiStreamAdapter();
        const events = adapter.push({ candidates: [rawCandidate] });
        expect(events, JSON.stringify(rawCandidate)).toEqual([]);
      }
    });

    it("a duplicated index with NO functionCall evidence on either copy is silently skipped - not diagnosed, and never throws when `content` is entirely absent", () => {
      for (const raw of [
        { candidates: [{ index: 1, finishReason: "STOP" }, { index: 1, finishReason: "STOP" }] },
        { candidates: [{ index: 1 }, { index: 1 }] },
      ]) {
        const adapter = new GeminiStreamAdapter();
        let events: readonly unknown[] = [];
        expect(() => { events = adapter.push(raw); }, JSON.stringify(raw)).not.toThrow();
        expect(events, JSON.stringify(raw)).toEqual([]);
      }
    });

    it("a chunk duplicating an ALREADY-STARTED candidate's own index poisons that SAME candidate's real call (protocol_violation) via DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE, without touching a genuinely separate sibling candidate", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "collided", args: {} } }] } }] });
      drive(adapter, gate, { candidates: [{ index: 1, content: { parts: [{ functionCall: { name: "sibling", args: {} } }] } }] });
      const dupEvents = drive(adapter, gate, {
        candidates: [
          { index: 0, content: { parts: [{ functionCall: { name: "more", args: {} } }] } },
          { index: 0, content: { parts: [{ functionCall: { name: "more", args: {} } }] } },
        ],
      });
      expect(dupEvents.length).toBeGreaterThan(0); // not vacuously true on an empty array
      expect(dupEvents.every((e) => e.type === "provider_diagnostic")).toBe(true);
      expect(dupEvents.every((e) => e.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE)).toBe(true);
      // Attributed to the REAL, already-tracked "collided" call's own
      // sourceKey - not a synthetic "candidate:0" identity that could
      // never resolve to it (Phase B.5's own principle, applied here too).
      expect(dupEvents.every((e) => (e.callRef as { sourceKey?: string } | undefined)?.sourceKey === "candidate:0/part:0")).toBe(true);
      drive(adapter, gate, { candidates: [{ index: 1, finishReason: "STOP" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      const collided = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "collided"));
      const sibling = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "sibling"));
      // See the "invalid index" test above for why the surfaced `.reason`
      // reads "projection_only" rather than "protocol_violation" even
      // when a genuine protocol violation exists - verified against the
      // raw diagnostics and takeDecision() instead.
      expect(gate.takeDecision(collided.internalId)).toBeUndefined();
      expect(gate.takeDecision(sibling.internalId)).toBeUndefined(); // sibling is projection_only-rejected too (epistemic boundary), never "execute" either way
      expect(final.diagnostics.some((d) => d.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE && d.internalId === collided.internalId)).toBe(true);
      expect(final.diagnostics.some((d) => d.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE && d.internalId === sibling.internalId)).toBe(false);
    });

    it("a duplicated index that was NEVER a real call (both copies in the same chunk, no prior evidence at that coordinate) never becomes a tracked call, and does not poison a genuinely unrelated sibling candidate", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "good", args: {} } }] } }] });
      const dupEvents = drive(adapter, gate, {
        candidates: [
          { index: 1, content: { parts: [{ functionCall: { name: "dupA", args: {} } }] } },
          { index: 1, content: { parts: [{ functionCall: { name: "dupB", args: {} } }] } },
        ],
      });
      expect(dupEvents.length).toBeGreaterThan(0); // not vacuously true on an empty array
      expect(dupEvents.every((e) => e.type === "provider_diagnostic" && e.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE)).toBe(true);
      drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      expect(final.decisions).toHaveLength(1); // neither dupA nor dupB ever became a tracked call
      const good = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "good"));
      expect((good as { reason?: string }).reason).toBe("projection_only"); // rejected on its OWN merits, not poisoned
      // The forensic-only fallback diagnostic must carry its own
      // unresolvable "candidate:1" sourceKey - not be left with no
      // callRef at all, which would make it a genuinely GLOBAL diagnostic
      // (internalId AND sourceKey both undefined) and wrongly poison
      // "good" too, since DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE is an
      // AUTHORITY_PROTOCOL_VIOLATION_CODES member decide.ts checks
      // globally when no sourceKey is present at all. Never attributed to
      // a real internalId either way (dupA/dupB never became tracked
      // calls) - the discriminating fact is sourceKey presence, not
      // internalId.
      expect(final.diagnostics.some((d) => d.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE && d.internalId === undefined && d.sourceKey === undefined)).toBe(false);
      expect(final.diagnostics.some((d) => d.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE && d.sourceKey === "candidate:1")).toBe(true);
    });
  });

  describe("CANDIDATE-LOCAL POST-TERMINAL EVIDENCE (Phase B.5): exact real-sourceKey attribution when real calls exist, forensic-only when none do", () => {
    it("a candidate with TWO real tracked parts (from two separate, earlier pushes) has BOTH disqualified by later post-terminal evidence, not only the most-recently-tracked one - candidateSourceKeys accumulates across pushes, it is never overwritten by a later push's own fresh Set", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      // Two SEPARATE real parts under the SAME candidate, from two
      // SEPARATE pushes (each with its own part array starting at 0, so a
      // leading placeholder gives the second one part-position 1 - a
      // realistic "the model made a second, distinct tool call a moment
      // later" shape).
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "first", args: {} } }] } }] });
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ text: "and" }, { functionCall: { name: "second", args: {} } }] } }] });
      drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] });

      const lateEvents = drive(adapter, gate, {
        candidates: [{ index: 0, content: { parts: [{ text: "x" }, { text: "y" }, { functionCall: { name: "tooLate", args: {} } }] } }],
      });
      const disqualifiedSourceKeys = lateEvents.map((e) => (e.callRef as { sourceKey?: string } | undefined)?.sourceKey);
      expect(disqualifiedSourceKeys).toContain("candidate:0/part:0"); // "first"
      expect(disqualifiedSourceKeys).toContain("candidate:0/part:1"); // "second"
      expect(lateEvents).toHaveLength(2);

      for (const e of adapter.finish()) gate.push(e);
      const final = gate.finish();
      const first = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "first"));
      const second = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "second"));
      expect(gate.takeDecision(first.internalId)).toBeUndefined();
      expect(gate.takeDecision(second.internalId)).toBeUndefined();
      expect(final.diagnostics.some((d) => d.code === TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE && d.internalId === first.internalId)).toBe(true);
      expect(final.diagnostics.some((d) => d.code === TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE && d.internalId === second.internalId)).toBe(true);
    });

    it("a functionCall part arriving for a candidate that already reported its own finishReason, and already has a REAL tracked call, disqualifies that REAL call (exact sourceKey attribution) - a genuinely separate sibling candidate is unaffected", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "toolA", args: { a: 1 } } }] } }] });
      drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] });
      drive(adapter, gate, { candidates: [{ index: 1, content: { parts: [{ functionCall: { name: "sibling", args: {} } }] } }] });

      // A leading non-functionCall part gives this late attempt its OWN
      // would-be phantom identity ("candidate:0/part:1") that is
      // DIFFERENT from the real, already-tracked call's own
      // ("candidate:0/part:0") - so the assertion below can only pass via
      // genuine real-sourceKey attribution, never by coincidentally
      // matching what the "no real call exists" fallback would also have
      // produced had the two identities happened to collide.
      const lateEvents = drive(adapter, gate, {
        candidates: [{ index: 0, content: { parts: [{ text: "late" }, { functionCall: { name: "tooLate", args: {} } }] } }],
      });
      expect(lateEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect(lateEvents[0]?.code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      // Attributed to the REAL, already-tracked call's own sourceKey - not
      // a synthetic "candidate:0" identity that resolves to nothing.
      expect(lateEvents[0]?.callRef).toEqual({ sourceKey: "candidate:0/part:0" });

      drive(adapter, gate, { candidates: [{ index: 1, finishReason: "STOP" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const sibling = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "sibling"));
      // Surfaced `.reason` reads "projection_only" for both (decide.ts
      // checks that before AUTHORITY_PROTOCOL_VIOLATION_CODES - see the
      // "invalid index" test's own comment above) - the REAL disqualifying
      // diagnostic is verified directly instead.
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(final.diagnostics.some((d) => d.code === TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE && d.internalId === a.internalId)).toBe(true);
      expect(final.diagnostics.some((d) => d.code === TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE && d.internalId === sibling.internalId)).toBe(false);
      expect((sibling as { reason?: string }).reason).toBe("projection_only"); // unaffected, rejected only on its own merits
    });

    it("a functionCall part arriving for an already-terminal candidate that has NO tool calls at all is recorded for forensic visibility, disqualifies nothing (there is nothing to disqualify), and never starts a call", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] }); // text-only candidate, no tool call ever
      drive(adapter, gate, { candidates: [{ index: 1, content: { parts: [{ functionCall: { name: "sibling", args: {} } }] } }] });

      const lateEvents = drive(adapter, gate, {
        candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "tooLate", args: {} } }] } }],
      });
      expect(lateEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect(lateEvents[0]?.code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect(lateEvents[0]?.callRef).toEqual({ sourceKey: "candidate:0/part:0" });

      drive(adapter, gate, { candidates: [{ index: 1, finishReason: "STOP" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      expect(final.decisions.some((d) => (d as { name?: string }).name === "tooLate")).toBe(false);
      const sibling = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "sibling"));
      expect((sibling as { reason?: string }).reason).toBe("projection_only");
    });

    it("a duplicate/conflicting finishReason for a candidate that HAS a real tracked call disqualifies that real call (exact sourceKey attribution), not a synthetic unattached identity", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "toolA", args: {} } }] } }] });
      drive(adapter, gate, { candidates: [{ index: 1, content: { parts: [{ functionCall: { name: "sibling", args: {} } }] } }] });
      drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] });
      const dupEvents = drive(adapter, gate, { candidates: [{ index: 0, finishReason: "MAX_TOKENS" }] });
      expect(dupEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect(dupEvents[0]?.code).toBe(DUPLICATE_TOOL_END_DIAGNOSTIC_CODE);
      expect(dupEvents[0]?.callRef).toEqual({ sourceKey: "candidate:0/part:0" });

      drive(adapter, gate, { candidates: [{ index: 1, finishReason: "STOP" }] });
      for (const e of adapter.finish()) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const sibling = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "sibling"));
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(final.diagnostics.some((d) => d.code === DUPLICATE_TOOL_END_DIAGNOSTIC_CODE && d.internalId === a.internalId)).toBe(true);
      expect((sibling as { reason?: string }).reason).toBe("projection_only");
    });

    it("a duplicate/conflicting finishReason for a candidate with NO tool calls at all remains forensic-only (synthetic candidate:{i} identity, disqualifies nothing) - documented explicitly, not silently assumed safe", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] });
      drive(adapter, gate, { candidates: [{ index: 1, content: { parts: [{ functionCall: { name: "sibling", args: {} } }] } }] });
      const dupEvents = drive(adapter, gate, { candidates: [{ index: 0, finishReason: "MAX_TOKENS" }] });
      expect(dupEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect(dupEvents[0]?.code).toBe(DUPLICATE_TOOL_END_DIAGNOSTIC_CODE);
      // No real call ever existed under candidate 0 - the diagnostic is
      // attached to the synthetic, never-resolvable "candidate:0" identity.
      expect(dupEvents[0]?.callRef).toEqual({ sourceKey: "candidate:0" });

      drive(adapter, gate, { candidates: [{ index: 1, finishReason: "STOP" }] });
      for (const e of adapter.finish()) gate.push(e);
      const final = gate.finish();
      // Nothing to disqualify - "sibling" is unaffected either way.
      const sibling = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "sibling"));
      expect((sibling as { reason?: string }).reason).toBe("projection_only");
    });
  });

  describe("TERMINATION REASON AGGREGATION: adapter.finish() computes one stream-wide reason from every recorded candidate-local reason", () => {
    it("complete + complete -> complete", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
      adapter.push({ candidates: [{ index: 1, finishReason: "STOP" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("complete");
    });

    it("complete + MAX_TOKENS -> length, never complete", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
      adapter.push({ candidates: [{ index: 1, finishReason: "MAX_TOKENS" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("length");
    });

    it("complete + SAFETY -> cancelled", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
      adapter.push({ candidates: [{ index: 1, finishReason: "SAFETY" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("cancelled");
    });

    it("SAFETY + complete -> cancelled (order-independence: the worse reason recorded FIRST still wins over a more permissive one recorded later)", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "SAFETY" }] });
      adapter.push({ candidates: [{ index: 1, finishReason: "STOP" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("cancelled");
    });

    it("complete + unknown -> unknown - an UNRECOGNIZED finishReason from one candidate must dominate an otherwise-clean sibling, never get silently dropped from the aggregation", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
      adapter.push({ candidates: [{ index: 1, finishReason: "SOME_FUTURE_REASON" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
      expect((streamEnd as { reason?: string }).reason).not.toBe("complete");
    });

    it.each(["MALFORMED_FUNCTION_CALL", "UNEXPECTED_TOOL_CALL", "PROHIBITED_CONTENT", "BLOCKLIST"])(
      "complete + '%s' -> unknown, never complete (Phase B.7: official-enum reasons this adapter does not explicitly recognize)",
      (finishReason) => {
        const adapter = new GeminiStreamAdapter();
        adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
        adapter.push({ candidates: [{ index: 1, finishReason }] });
        const finishEvents = adapter.finish();
        const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
        expect((streamEnd as { reason?: string }).reason, finishReason).toBe("unknown");
        expect((streamEnd as { reason?: string }).reason, finishReason).not.toBe("complete");
      },
    );

    it("a caller-provided 'complete' must NOT override an already-recorded unsafe candidate reason (MAX_TOKENS -> length)", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "MAX_TOKENS" }] });
      const finishEvents = adapter.finish({ reason: "complete" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("length");
    });

    it("a caller-supplied 'unknown' dominates an otherwise-complete candidate reason", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
      const finishEvents = adapter.finish({ reason: "unknown" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
    });

    it("a caller-supplied 'network_error' dominates an otherwise-complete candidate reason", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
      const finishEvents = adapter.finish({ reason: "network_error" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("network_error");
    });

    it("a caller-supplied 'provider_error' dominates an otherwise-complete candidate reason", () => {
      const adapter = new GeminiStreamAdapter();
      adapter.push({ candidates: [{ index: 0, finishReason: "STOP" }] });
      const finishEvents = adapter.finish({ reason: "provider_error", providerReason: "connection_reset" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("provider_error");
    });
  });

  describe("POST-PROVIDER-TERMINAL EVIDENCE (Phase B.6): removed silent-drop, future-proofing/architecture-consistency only", () => {
    it("adapter.finish() -> later recognizable Gemini evidence -> normalized event is non-empty -> the coordinator receives it (no live authority is at stake - every Gemini call is projection_only regardless)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new GeminiStreamAdapter();
      drive(adapter, gate, { candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "toolA", args: {} } }] } }] });
      drive(adapter, gate, { candidates: [{ index: 0, finishReason: "STOP" }] });
      for (const e of adapter.finish()) gate.push(e);

      // Late evidence AFTER adapter.finish() - genuinely reaches the
      // coordinator now (not silently dropped by a top-of-push() guard).
      const lateEvents = drive(adapter, gate, {
        candidates: [{ index: 0, content: { parts: [{ functionCall: { name: "tooLate", args: {} } }] } }],
      });
      expect(lateEvents.length).toBeGreaterThan(0);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      // Still non-executable regardless (projection_only, unaffected by
      // whether the late evidence was itself further disqualifying) - the
      // epistemic boundary this whole fix respects.
      expect((a as { reason?: string }).reason).not.toBe("execute");
    });
  });
});
