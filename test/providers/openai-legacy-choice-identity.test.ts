// ---------------------------------------------------------------------------
// Permanent regression suite for OpenAIStreamAdapter's P4.3 choice-scoped
// legacy `function_call` identity fix.
//
// Companion to test/providers/openai-legacy-function-call-termination.test.ts
// (which owns the n=1 single-choice termination-closing lifecycle, unchanged
// in shape by this fix) - this file owns everything specific to a genuine
// multi-choice (n>1) legacy stream: independent choice identity (E-1),
// terminal-authority isolation between siblings (E-2), missing/invalid/
// duplicate choice-index handling, and stream-wide reason aggregation across
// more than one legacy choice.
//
// Pre-fix (see openai.ts's own class-level doc comment on
// OpenAIStreamAdapter), every choice shared ONE fixed, global sourceKey
// ("legacy-function-call"): independent choices' name/arguments evidence
// could merge into a single parser/identity (E-1, confirmed empirically:
// name "toolAtoolB", value {"a":1,"evil":true}), and a later, unrelated
// choice's evidence could collide with and poison an earlier, already-
// legitimate choice's call (E-2). Real-SDK-parser reachability and the
// genuine pre-fix RED for the adversarial-merge case specifically are
// established in test/integration/openai-official-sdk-lifecycle.test.ts's
// "P4.3 E-1: legacy function_call from TWO DIFFERENT choices must never
// merge into one call/parser" test - not repeated here. This file is
// synthetic adapter-to-gate coverage of the full resulting correctness
// matrix, including the POSITIVE case that fixture's own adversarial payload
// could not demonstrate (both choices cleanly executing with independent
// values).
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import {
  INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
} from "../../src/coordinator/diagnostic-codes.js";

function drive(adapter: { push(raw: unknown): readonly unknown[] }, gate: ReturnType<typeof createToolCallExecutionGate>, raw: unknown) {
  const events = adapter.push(raw);
  for (const e of events) gate.push(e as Parameters<typeof gate.push>[0]);
  return events as Array<{ type: string; [k: string]: unknown }>;
}

describe("OpenAIStreamAdapter legacy function_call: P4.3 multi-choice (n>1) identity, isolation, and reason aggregation", () => {
  describe("SAME-CHUNK TWO-CHOICE (E-1): independent choices delivered in ONE chunk never merge", () => {
    it("clean same-chunk two-choice: both choices execute with independently correct values", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, {
        choices: [
          { index: 0, delta: { function_call: { name: "toolA", arguments: '{"a":1}' } } },
          { index: 1, delta: { function_call: { name: "toolB", arguments: '{"b":2}' } } },
        ],
      });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      expect(final.decisions).toHaveLength(2);
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).toBe("execute");
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });
  });

  describe("INTERLEAVED MULTI-CHUNK CHOICES (E-1): evidence for two choices arriving in alternating separate pushes reconstructs correctly", () => {
    it("choice 0 and choice 1's name+argument deltas interleaved across multiple separate pushes each reconstruct their own correct, independent, nested value (no cross-choice byte contamination)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      // Every push targets exactly one choice - each choice's OWN evidence
      // is split across three separate arguments-only deltas, alternating
      // with the other choice's own pushes, so a shared/leaked parser would
      // either interleave garbage bytes into both values or silently
      // "complete" one from the other's fragments.
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA" } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB" } } }] });
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { arguments: '{"x":{"nested":1}' } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { arguments: '{"other":"value"' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { arguments: ',"y":true' } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { arguments: ',"z":[1,2,3]' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { arguments: "}" } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { arguments: "}" } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      expect(final.decisions).toHaveLength(2);
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).toBe("execute");
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ x: { nested: 1 }, y: true });
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ other: "value", z: [1, 2, 3] });
    });
  });

  describe("E-2 SIBLING ISOLATION: one choice's own existence/lifecycle must never revoke an unrelated, already-legitimate sibling's authority", () => {
    it("choice 0 completes cleanly and fully (start, arguments, finish_reason) BEFORE choice 1 ever starts; choice 1 starting later does not revoke or otherwise affect choice 0's already-recorded terminal authority", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: '{"a":1}' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      // Choice 1 starts only NOW, well after choice 0 already fully
      // terminated on its own.
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: '{"b":2}' } } }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).toBe("execute");
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });

    it("choice 1 never receives its own finish_reason chunk but IS structurally complete; adapter.finish({reason:'complete'}) still lets it execute (Case B's single-choice direct-finish() guarantee generalizes correctly to one specific choice inside an n>1 stream) - choice 0's own outcome is unaffected either way", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: '{"a":1}' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      // Choice 1's own bytes are genuinely complete, but the raw iterator
      // ends without ever delivering a finish_reason chunk for it - only
      // the caller's own adapter.finish({reason:"complete"}) confirms the
      // underlying stream ended normally.
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: '{"b":2}' } } }] });
      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).toBe("execute");
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });

    it("choice 1 never receives its own finish_reason chunk AND is left genuinely structurally incomplete; it correctly stays non-executable via independent structural truncation (defense-in-depth, not merely because the aggregate happens to end up unsafe) - choice 0's own clean execute outcome is unaffected", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: '{"a":1}' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      // Choice 1 starts but its own arguments are deliberately left
      // unclosed - genuinely truncated, not merely "never explicitly
      // finished". A force-closed choice contributes no entry to
      // legacyChoiceTerminalReasons (only push()'s own choice.finish_reason
      // handling does that - see finish()'s force-close loop), so the
      // aggregate reason here is driven entirely by choice 0's own
      // "complete" - choice 1 must still fail on its own structural merits.
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: '{"b":2' } } }] });
      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(a.internalId)).value).toEqual({ a: 1 });
      expect(b.action).not.toBe("execute");
      expect(gate.takeDecision(b.internalId)).toBeUndefined();
    });
  });

  describe("MID-STREAM POST-TERMINAL EVIDENCE: a closed choice's own guard must independently protect it while a SIBLING choice is still open and the stream has not ended (no coordinator-level isFinished/P0 backstop active yet)", () => {
    // openai-legacy-function-call-termination.test.ts's own "Post-terminal
    // evidence" test drives this same class of guard, but only AFTER
    // gate.finish() has already been called - at that point the
    // coordinator's OWN isFinished-based post-terminal protocol
    // (GHSA-3xpw-9694-2xxp) is ALSO already active and independently
    // revokes late evidence, so that test cannot, by itself, prove this
    // choice-local guard (openai.ts's own `isKnownChoice &&
    // legacyChoiceOpen.get(choiceIndex) === false` check) is doing
    // anything - only that SOME layer catches it. This test isolates the
    // choice-local guard specifically: choice 1 is still genuinely open
    // and the stream has not ended (no adapter.finish()/gate.finish() at
    // all), so the coordinator's own isFinished is still false and cannot
    // be the thing catching choice 0's late evidence - only this exact
    // guard can.
    it("late arguments for an ALREADY-CLOSED choice 0 arrive while choice 1 is still genuinely open (stream not ended) - the choice-local guard alone must flag it via TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE, attributed to choice 0's own real sourceKey; choice 1 is completely unaffected", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: '{"a":1}' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] }); // choice 0 closes
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB" } } }] }); // choice 1 starts, still open
      const lateEvents = drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { arguments: '{"evil":true}' } } }] });

      expect(lateEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      expect(lateEvents[0]?.code).toBe(TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE);
      expect(lateEvents[0]?.callRef).toEqual({ sourceKey: "legacy-choice:0" });

      // Choice 1 finishes cleanly afterward, completely unaffected.
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { arguments: '{"b":2}' } } }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(b.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({ b: 2 });
    });
  });

  describe("P0 BLOCKER FIX: post-global-finish late evidence must still reach the coordinator (GHSA-3xpw-9694-2xxp-class regression)", () => {
    // Maintainer-identified regression (found in raw-review, not by any
    // test in this file): once adapter.finish() has already produced the
    // ONE provider_stream_end for the whole adapter lifetime, a LATER,
    // SAME-choice finish_reason chunk - a genuine, recognized raw shape,
    // not garbage - used to silently return [] from push(). That meant it
    // never reached the coordinator at all: not even as a diagnostic. An
    // already-computed, still-UNCONSUMED execute decision could therefore
    // never be revoked by it - directly contradicting this file's own
    // push() doc comment ("No `finished` early return here: silently
    // dropping every event after the first terminal meant ... an
    // already-decided call's authority could never be revoked by it").
    //
    // Root cause: this specific choice had been force-closed by
    // finish()'s OWN synthetic loop (never by its own choice.finish_reason),
    // so legacyChoiceTerminalReasons never recorded anything for it -
    // `alreadyTerminal` read false, and the "not yet terminal" branch
    // recorded the reason (pointlessly, after the fact) and found
    // legacyChoiceOpen already false, emitting nothing.
    //
    // Genuine pre-fix RED, captured empirically (not inferred) for all
    // three variants below via a throwaway probe before this fix was
    // written: adapter.push(...) returned exactly [], and the
    // already-computed decision's own value ({ name: "toolA", value: {},
    // action: "execute" }) remained fully retrievable via takeDecision()
    // afterward - a live, unrevoked authority window.
    it.each(["length", "cancelled", "stop"])(
      "a late SAME-choice finish_reason ('%s') arriving after adapter.finish() already globally terminated is NOT silently dropped - it reaches the coordinator (via DUPLICATE_TOOL_END_DIAGNOSTIC_CODE) and revokes the already-computed, unconsumed execute authority",
      (lateFinishReason) => {
        const gate = createToolCallExecutionGate();
        const adapter = new OpenAIStreamAdapter();
        drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
        for (const e of adapter.finish({ reason: "complete" })) gate.push(e);

        // Unconsumed execute authority genuinely exists BEFORE the late
        // evidence - read via finish()'s returned decisions, never
        // takeDecision(), which would consume it and make the second
        // half of this test meaningless.
        const final = gate.finish();
        const decision = expectDefined(final.decisions[0]);
        expect(decision.action).toBe("execute");

        const lateEvents = adapter.push({ choices: [{ index: 0, finish_reason: lateFinishReason }] });
        expect(lateEvents.length).toBeGreaterThan(0);
        expect(lateEvents[0]?.type).toBe("provider_diagnostic");
        expect((lateEvents[0] as { code?: string } | undefined)?.code).toBe(DUPLICATE_TOOL_END_DIAGNOSTIC_CODE);
        for (const e of lateEvents) gate.push(e);

        expect(gate.takeDecision(decision.internalId)).toBeUndefined();
      },
    );

    it("CONTROL: a finish_reason for a choice index that was NEVER referenced at all, arriving after adapter.finish(), is still silently ignored - there is no existing authority to protect and no real identity to attribute a diagnostic to (deliberately narrower than the SAME-choice fix above)", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      for (const e of adapter.finish({ reason: "complete" })) gate.push(e);

      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");

      // choice 1 was never referenced anywhere in this stream.
      const lateEvents = adapter.push({ choices: [{ index: 1, finish_reason: "stop" }] });
      expect(lateEvents).toEqual([]);
      // choice 0's own, unrelated authority is naturally unaffected.
      expect(gate.takeDecision(decision.internalId)).toBeDefined();
    });

    it("CONTROL: the normal, documented lifecycle (no late evidence at all) is unaffected by this fix - a clean, complete legacy call still executes end to end", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: '{"a":1}' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");
      expect(expectDefined(gate.takeDecision(decision.internalId)).value).toEqual({ a: 1 });
    });
  });

  describe("DUPLICATE/CONFLICTING TERMINAL FOR ONE CHOICE (Phase 10): choice-local attribution, not stream-wide poisoning", () => {
    it("a duplicate/conflicting finish_reason for choice 0 is attributed to CHOICE 0's OWN sourceKey (not a global/unattributed diagnostic) - this is the deliberate design choice this fix makes for the legacy path (distinct from openai-compatible.ts's stream-wide precedent for the analogous plural-path anomaly): it must poison ONLY choice 0's own call, never a genuinely separate, clean sibling choice 1", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: "{}" } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      // A second, duplicate finish_reason for the SAME choice 0.
      const dupEvents = drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      expect(dupEvents.map((e) => e.type)).toEqual(["provider_diagnostic"]);
      // Attributed specifically - not {} / unattributed, which would
      // otherwise make this a GLOBAL diagnostic and poison every call in
      // the stream, including the untouched sibling below.
      expect(dupEvents[0]?.callRef).toEqual({ sourceKey: "legacy-choice:0" });

      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute"); // choice 0's own duplicate poisons ITSELF
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(b.action).toBe("execute"); // genuinely unrelated sibling is unaffected
      expect(expectDefined(gate.takeDecision(b.internalId)).value).toEqual({});
    });
  });

  describe("MISSING/INVALID CHOICE INDEX (Phase 12): fail-closed, never guessed as choice 0", () => {
    it("every invalid index shape (missing/negative/non-integer/NaN) with function_call evidence fails closed via INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE - being stream-wide/unattributable (no callRef at all), it poisons the WHOLE stream including an otherwise-valid sibling choice 0", () => {
      for (const index of [undefined, -1, 1.5, Number.NaN]) {
        const gate = createToolCallExecutionGate();
        const adapter = new OpenAIStreamAdapter();
        drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "good", arguments: "{}" } } }] });
        const badEvents = drive(adapter, gate, { choices: [{ index, delta: { function_call: { name: "ambiguous", arguments: "{}" } } }] });
        expect(badEvents.map((e) => e.type), `index ${index}`).toEqual(["provider_diagnostic"]);
        expect(badEvents[0]?.code, `index ${index}`).toBe(INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE);
        expect(badEvents[0]?.callRef, `index ${index}`).toBeUndefined();
        drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
        for (const e of adapter.finish()) gate.push(e);

        const final = gate.finish();
        // The ambiguous choice never became a tracked call at all.
        expect(final.decisions, `index ${index}`).toHaveLength(1);
        const good = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "good"));
        expect(good.action, `index ${index}`).not.toBe("execute");
        expect((good as { reason?: string }).reason, `index ${index}`).toBe("protocol_violation");
      }
    });

    it("an invalid-index choice with NO function_call evidence at all (a bare finish_reason, or a fully empty choice) is silently skipped - not diagnosed, and its finish_reason is not recorded, by design (there is no legacy identity to protect)", () => {
      for (const rawChoice of [
        { finish_reason: "stop" }, // no index at all, just a finish_reason
        {}, // completely empty
        { index: -1, finish_reason: "stop" }, // explicit invalid index, still no function_call
      ]) {
        const adapter = new OpenAIStreamAdapter();
        const events = adapter.push({ choices: [rawChoice] });
        expect(events, JSON.stringify(rawChoice)).toEqual([]);
      }
    });

    it("a duplicated index with NO function_call evidence on either copy (bare finish_reason, or fully empty choices, or a choice with no `delta` key at all) is silently skipped - not diagnosed, and never throws, mirroring the invalid-index case's own design", () => {
      // Also exercises optional chaining on `choice.delta?.function_call`
      // specifically: a duplicate copy with NO `delta` key at all (not
      // even an empty object) must not throw when `choice.delta` itself is
      // undefined.
      for (const raw of [
        { choices: [{ index: 1, finish_reason: "stop" }, { index: 1, finish_reason: "stop" }] },
        { choices: [{ index: 1 }, { index: 1 }] },
      ]) {
        const adapter = new OpenAIStreamAdapter();
        let events: readonly unknown[] = [];
        expect(() => { events = adapter.push(raw); }, JSON.stringify(raw)).not.toThrow();
        expect(events, JSON.stringify(raw)).toEqual([]);
      }
    });

    it("a chunk duplicating an ALREADY-STARTED choice's own index poisons that SAME call (protocol_violation) via DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE, without touching a genuinely separate sibling choice", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "collided", arguments: "{}" } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "sibling", arguments: "{}" } } }] });
      // A later chunk duplicates choice 0's own index within itself - this
      // collides with the REAL, already-started "collided" call, unlike the
      // "never a real call" case below.
      const dupEvents = drive(adapter, gate, {
        choices: [
          { index: 0, delta: { function_call: { arguments: "more" } } },
          { index: 0, delta: { function_call: { arguments: "more" } } },
        ],
      });
      expect(dupEvents.every((e) => e.type === "provider_diagnostic")).toBe(true);
      expect(dupEvents.every((e) => e.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE)).toBe(true);
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      const collided = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "collided"));
      const sibling = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "sibling"));
      expect(collided.action).not.toBe("execute");
      expect((collided as { reason?: string }).reason).toBe("protocol_violation");
      expect(sibling.action).toBe("execute");
    });

    it("a duplicated index that was NEVER a real call (both copies in the same chunk, no prior evidence at that coordinate) never becomes a tracked call, and does not poison a genuinely unrelated sibling choice", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "good", arguments: "{}" } } }] });
      const dupEvents = drive(adapter, gate, {
        choices: [
          { index: 1, delta: { function_call: { name: "dupA", arguments: "{}" } } },
          { index: 1, delta: { function_call: { name: "dupB", arguments: "{}" } } },
        ],
      });
      expect(dupEvents.every((e) => e.type === "provider_diagnostic" && e.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE)).toBe(true);
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      for (const e of adapter.finish()) gate.push(e);

      const final = gate.finish();
      // Neither dupA nor dupB ever became a tracked call.
      expect(final.decisions).toHaveLength(1);
      const good = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "good"));
      expect(good.action).toBe("execute");
    });
  });

  describe("TERMINATION REASON AGGREGATION (Phase 9/14, legacy-specific): adapter.finish() computes one stream-wide reason from every recorded legacy choice reason", () => {
    // aggregateLegacyTermination()/LEGACY_REASON_PRIORITY is a deliberate,
    // self-contained port of OpenAICompatibleStreamAdapter's own
    // aggregateTermination()/REASON_PRIORITY (see openai.ts's own doc
    // comment on LEGACY_REASON_PRIORITY for why it is duplicated rather than
    // cross-imported) - a byte-identical algorithm, so the exhaustive
    // per-combination REASON_PRIORITY matrix is not re-enumerated here (see
    // that adapter's own "REASON AGGREGATION" describe block in
    // openai-compatible-choice-lifecycle.test.ts for the full case table).
    // This section covers the legacy wire shape's own reason-recording path
    // plus one precise mechanism characterization: verified directly against
    // src/coordinator/coordinator.ts and src/parser.ts (not assumed) -
    // coordinator.ts's handleCallEnd() (fired by each choice's own
    // tool_call_end) never reads that event's own `reason` field at all;
    // only handleStreamEnd() (fired once, by the ONE provider_stream_end)
    // calls finishCall(call, event.reason) for every call still
    // "collecting", passing the SAME stream-wide reason to each one's own
    // parser.finish({reason}) - and parser.ts's isExecutable() requires
    // that reason to be exactly "complete" before a structurally-valid call
    // can ever be executable (see its own doc comment: "the reason only
    // affects executable(), never outcome"). So a stream-wide aggregate
    // worse than "complete" denies `executable` to EVERY still-collecting
    // call, not only whichever choice actually reported the worse reason.
    it("complete + complete -> complete, both calls execute", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: "{}" } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] });
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "function_call" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("complete");
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      expect(final.decisions.filter((d) => d.action === "execute")).toHaveLength(2);
    });

    it("complete + length -> length, never complete - and BOTH calls become non-executable, not only the choice that actually reported length", () => {
      const gate = createToolCallExecutionGate();
      const adapter = new OpenAIStreamAdapter();
      drive(adapter, gate, { choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: '{"a":1}' } } }] });
      drive(adapter, gate, { choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: '{"b":2}' } } }] });
      drive(adapter, gate, { choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      drive(adapter, gate, { choices: [{ index: 1, finish_reason: "length" }] }); // -> length
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("length");
      expect((streamEnd as { reason?: string }).reason).not.toBe("complete");
      for (const e of finishEvents) gate.push(e);
      const final = gate.finish();
      const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
      const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
      expect(a.action).not.toBe("execute");
      expect(b.action).not.toBe("execute");
      expect(gate.takeDecision(a.internalId)).toBeUndefined();
      expect(gate.takeDecision(b.internalId)).toBeUndefined();
    });

    it("cancelled + complete -> cancelled (order-independence: the worse reason recorded FIRST still wins over a more permissive one recorded later)", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "cancelled" }] });
      adapter.push({ choices: [{ index: 1, finish_reason: "stop" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("cancelled");
    });

    it("complete + cancelled -> cancelled (order-independence: the worse reason recorded SECOND still wins over a more permissive one recorded first)", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] });
      adapter.push({ choices: [{ index: 1, finish_reason: "cancelled" }] });
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("cancelled");
    });

    it("complete + unknown -> unknown - an UNRECOGNIZED finish_reason from one choice must dominate an otherwise-clean sibling, never get silently dropped from the aggregation (targets LEGACY_REASON_PRIORITY's own \"unknown\" entry and mapLegacyFinishReason's own fallback specifically: unknown outranks complete - rank 1 vs rank 5 - so either one being corrupted would incorrectly let the less-severe \"complete\" win)", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 1, delta: { function_call: { name: "toolB", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      adapter.push({ choices: [{ index: 1, finish_reason: "some_future_provider_reason" }] }); // -> unknown (mapLegacyFinishReason's own fallback)
      const finishEvents = adapter.finish();
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
      expect((streamEnd as { reason?: string }).reason).not.toBe("complete");
    });
  });

  describe("META.REASON INTERACTION (legacy-specific): adapter.finish()'s caller-supplied meta.reason must correctly interact with recorded legacy choice reasons", () => {
    it("a caller-provided 'complete' must NOT override an already-recorded unsafe choice reason (length)", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "length" }] });
      const finishEvents = adapter.finish({ reason: "complete" }); // caller optimistically claims complete
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("length"); // the real, recorded reason wins
    });

    it("a caller-supplied 'unknown' dominates an otherwise-complete choice reason (distinct from a CHOICE's own unrecognized finish_reason above - this exercises the caller-reason branch's own indexOf/-1-sentinel check specifically)", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      const finishEvents = adapter.finish({ reason: "unknown" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("unknown");
    });

    it("a caller-supplied 'network_error' dominates an otherwise-complete choice reason (LEGACY_REASON_PRIORITY's own 'network_error' entry, caller-only - no choice.finish_reason ever maps to it)", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      const finishEvents = adapter.finish({ reason: "network_error" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("network_error");
    });

    it("a caller-supplied 'provider_error' dominates an otherwise-complete choice reason (LEGACY_REASON_PRIORITY's own top-ranked entry)", () => {
      const adapter = new OpenAIStreamAdapter();
      adapter.push({ choices: [{ index: 0, delta: { function_call: { name: "toolA", arguments: "{}" } } }] });
      adapter.push({ choices: [{ index: 0, finish_reason: "stop" }] }); // -> complete
      const finishEvents = adapter.finish({ reason: "provider_error", providerReason: "connection_reset" });
      const streamEnd = expectDefined(finishEvents.find((e) => e.type === "provider_stream_end"));
      expect((streamEnd as { reason?: string }).reason).toBe("provider_error");
    });
  });
});
