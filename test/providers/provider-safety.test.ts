import { describe, it, expect } from "vitest";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import { expectDefined } from "../utils/expect-defined.js";

describe("Provider Safety Regressions", () => {
  it("Anthropic content_block_stop followed by max_tokens", () => {
    const adapter = new AnthropicStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "f" } }));
    events.push(...adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }));
    events.push(...adapter.push({ type: "content_block_stop", index: 0 }));
    events.push(...adapter.finish({ reason: "length", providerReason: "max_tokens" }));
    const endEvent = events.find(e => e.type === "tool_call_end");
    expect(endEvent).toBeDefined();
    const streamEnd = events.find(e => e.type === "provider_stream_end");
    expect((streamEnd as { reason?: string })?.reason).toBe("length");
  });

  it("Anthropic normal tool-use completion", () => {
    const adapter = new AnthropicStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "f" } }));
    events.push(...adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }));
    events.push(...adapter.push({ type: "content_block_stop", index: 0 }));
    expect(events.some(e => e.type === "tool_call_end")).toBe(true);
  });

  it("OpenAI-compatible normal tool_calls finish", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "f", arguments: "{}" } }] } }] }));
    events.push(...adapter.finish({ reason: "complete", providerReason: "stop" }));
    expect(events.some(e => e.type === "tool_call_end")).toBe(true);
  });

  it("OpenAI Responses response.function_call_arguments.delta", () => {
    // Real Responses API shape (test/providers/coverage.test.ts already proves
    // the adapter emits the right normalized EVENT TYPE for this raw event;
    // this proves the complementary, execution-relevant claim - that the
    // delta's actual CONTENT survives, unmodified, all the way to a live,
    // takeable execute() authority through the real adapter -> gate path).
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAIStreamAdapter();
    for (const ev of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(ev);
    for (const ev of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"test"}' })) gate.push(ev);
    for (const ev of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(ev);
    for (const ev of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(ev);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({ q: "test" });
  });

  it("OpenAI Responses final arguments conflict", () => {
    // Real Responses API shape: response.function_call_arguments.done's own
    // `arguments` disagreeing with what was actually accumulated from prior
    // .delta events (test/providers/coverage.test.ts proves the adapter
    // raises E_FINAL_ARGUMENTS_CONFLICT for this; this proves the
    // security-relevant consequence - the call must fail closed, not
    // silently resolve to either the accumulated or the conflicting value).
    const gate = createToolCallExecutionGate();
    const adapter = new OpenAIStreamAdapter();
    for (const ev of adapter.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } })) gate.push(ev);
    for (const ev of adapter.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"' })) gate.push(ev);
    for (const ev of adapter.push({ type: "response.function_call_arguments.done", item_id: "item-1", arguments: '{"q":"different"}' })) gate.push(ev);
    for (const ev of adapter.push({ type: "response.output_item.done", item: { id: "item-1" } })) gate.push(ev);
    for (const ev of adapter.push({ type: "response.completed", response: { status: "completed" } })) gate.push(ev);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("OpenAI legacy chat-completions tool_calls delegates through OpenAICompatibleStreamAdapter, remapped to provider 'openai'", () => {
    // OpenAIStreamAdapter.push() has a distinct dispatch branch (separate
    // from both the Responses API branch above and the legacy singular
    // `function_call` branch) for the plural, chat-completions-style
    // `choices[].delta.tool_calls` shape: it delegates the raw event
    // wholesale to an internal OpenAICompatibleStreamAdapter and then
    // remaps every returned event's `provider`/`sequence`. That glue code
    // - not OpenAICompatibleStreamAdapter's own internals, which are
    // already covered directly elsewhere - is what this proves: delegation
    // actually happens, and the outer adapter's identity/sequence counter
    // wins, not the inner adapter's.
    const adapter = new OpenAIStreamAdapter();
    const events = adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "danger", arguments: "{}" } }] } }] });
    const start = expectDefined(events.find(e => e.type === "tool_call_start"));
    expect(start.provider).toBe("openai");
  });

  it("Provider error after a complete JSON root", () => {
    // A call whose own arguments are structurally complete must still fail
    // closed once the provider stream itself reports an error - proven
    // through the real coordinator -> gate -> decision -> takeDecision()
    // path, not merely that push() didn't throw.
    const gate = createToolCallExecutionGate();
    const callRef = { sourceKey: "id0" };
    gate.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai", name: "f" } as unknown as NormalizedToolStreamEvent);
    gate.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    gate.push({ type: "tool_call_end", callRef, toolIndex: 0, reason: "complete" } as unknown as NormalizedToolStreamEvent);
    const final = gate.finish({ reason: "provider_error", providerReason: "Timeout" });
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("reject");
    expect((decision as { reason?: string }).reason).toBe("provider_error");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("Cancellation after a complete JSON root", () => {
    // A cancelled stream must never yield execute authority either, even
    // when the call's own JSON looked complete - proven the same way.
    const gate = createToolCallExecutionGate();
    const callRef = { sourceKey: "id1" };
    gate.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai", name: "f" } as unknown as NormalizedToolStreamEvent);
    gate.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    gate.push({ type: "tool_call_end", callRef, toolIndex: 0, reason: "cancelled" } as unknown as NormalizedToolStreamEvent);
    const final = gate.finish({ reason: "cancelled" });
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("Gemini repeated structured function-call event stays fail-closed (projection-only, never raw-authority-equivalent)", () => {
    // Gemini's structured function-call arguments are a projection, never
    // raw streamed evidence (PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE,
    // unconditional on every Gemini functionCall - see gemini.ts). This
    // proves that invariant survives all the way to takeDecision(): no
    // amount of repeated/duplicated Gemini function-call evidence can ever
    // become a live execute() authority.
    const gate = createToolCallExecutionGate();
    const adapter = new GeminiStreamAdapter();
    for (const ev of adapter.push({ candidates: [{ content: { parts: [{ functionCall: { name: "f", args: { a: 1 } } }] } }] })) gate.push(ev);
    for (const ev of adapter.push({ candidates: [{ content: { parts: [{ functionCall: { name: "f", args: { a: 1 } } }] } }] })) gate.push(ev);
    const final = gate.finish({ reason: "complete" });
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("reject");
    expect((decision as { reason?: string }).reason).toBe("projection_only");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("OpenRouter reasoning content between argument deltas does not corrupt the accumulated arguments", () => {
    // A `reasoning` delta chunk sandwiched between two argument-bearing
    // chunks must be inert with respect to argument evidence - not merely
    // "some tool_call_end event eventually appears", but that the two
    // argument fragments ("{" and "}") still concatenate into exactly "{}"
    // and reach real, takeable execute authority.
    const gate = createToolCallExecutionGate();
    const adapter = new OpenRouterStreamAdapter();
    for (const ev of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "f", arguments: "{" } }] } }] })) gate.push(ev);
    for (const ev of adapter.push({ choices: [{ index: 0, delta: { reasoning: "thinking..." } }] })) gate.push(ev);
    for (const ev of adapter.push({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] })) gate.push(ev);
    for (const ev of adapter.push({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })) gate.push(ev);
    // choice.finish_reason closes the call but is choice-local; the ONE
    // provider_stream_end for this adapter's lifetime comes from finish(),
    // called once the caller has drained the raw provider iterator - see
    // OpenAICompatibleStreamAdapter's class-level lifecycle-contract doc.
    for (const ev of adapter.finish()) gate.push(ev);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({});
  });

  // RESOLVED (P1 final review, Blocker 1). History: `git log --follow` shows
  // exactly 2 commits ever touched this file - 661ea8f ("feat: initial
  // release candidate", the repo's very first commit, message-only, no
  // linked PR/issue: `gh api .../commits/661ea8f.../pulls` returns `[]`) and
  // fdd5d97 (a later hardening pass that never touched this test at all).
  // 661ea8f introduced this exact broken body verbatim - no earlier history,
  // design doc, or PR exists to recover its original intended "invalid"
  // mechanism (Outcome A was unavailable).
  //
  // Outcome B applies: the architecture has a clearly documented, already
  // independently-tested multi-call isolation invariant matching this test's
  // own name - see test/integration/authority-boundaries.test.ts's "B: one
  // poisoned call does not disqualify an unrelated valid call" (via the AI
  // SDK guard) and its "C: ...keep calls independent" (via
  // OpenAICompatibleStreamAdapter). Rewritten below to prove the same
  // invariant through this file's own established idiom - raw coordinator
  // events via the gate, matching its sibling tests - with the cleanest,
  // most literal way to reach coordinator status "invalid" without
  // inventing a mechanism: finishCall()'s own explicit
  // `if (call.name === undefined ...) outcome = "invalid"` (coordinator.ts).
  // Renamed so the name states exactly what is proven. No `as unknown as`
  // casts: every event below is a fully-valid, correctly-shaped
  // NormalizedToolStreamEvent (the original casts existed only to smuggle
  // past the wrong `callRef` shape and a missing required `reason` on
  // tool_call_end).
  it("a structurally invalid call (missing tool name) does not poison an independent, valid call's execution authority", () => {
    const gate = createToolCallExecutionGate();
    let seq = 0;
    const goodRef = { sourceKey: "call-good" };
    const badRef = { sourceKey: "call-bad" };
    const events: NormalizedToolStreamEvent[] = [
      { type: "tool_call_start", sequence: ++seq, provider: "openai", callRef: goodRef, toolIndex: 0, name: "good_tool" },
      { type: "tool_call_start", sequence: ++seq, provider: "openai", callRef: badRef, toolIndex: 1 }, // no name - the sole defect
      { type: "tool_call_arguments_delta", sequence: ++seq, provider: "openai", callRef: goodRef, delta: "{}" },
      { type: "tool_call_arguments_delta", sequence: ++seq, provider: "openai", callRef: badRef, delta: "{}" },
      { type: "tool_call_end", sequence: ++seq, provider: "openai", callRef: goodRef, reason: "complete" },
      { type: "tool_call_end", sequence: ++seq, provider: "openai", callRef: badRef, reason: "complete" },
      { type: "provider_stream_end", sequence: ++seq, provider: "openai", reason: "complete" },
    ];
    for (const event of events) gate.push(event);
    const final = gate.finish();

    const good = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "good_tool"));
    expect(good.action).toBe("execute");
    expect(gate.takeDecision(good.internalId)).toBeDefined();

    const bad = expectDefined(final.decisions.find((d) => d.internalId !== good.internalId));
    expect(bad.action).not.toBe("execute");
    expect(gate.takeDecision(bad.internalId)).toBeUndefined();
  });

  it("Late provider ID", () => {
    // A toolCallId arriving after argument evidence has already started
    // must still be recorded onto the same call, not lost or rejected.
    const coord = createToolCallStreamCoordinator();
    const callRef = { sourceKey: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 0, toolCallId: "t1" } as unknown as NormalizedToolStreamEvent);
    const call = expectDefined(coord.snapshot().calls[0]);
    expect(call.toolCallId).toBe("t1");
  });

  it("Late tool index", () => {
    // Reconstructed from the sibling pattern of "Late provider ID" (toolCallId)
    // and "Late tool name" (name) immediately below/above - this file's own
    // established template for "identity component arriving after argument
    // evidence has already started" - applied to the third component
    // handleIdentity() accepts late: toolIndex. The original test body was
    // completely empty; this was not recovered from a prior partial
    // implementation, only from that structural analogy plus
    // coordinator.ts's real handleIdentity() logic. Flagged in the P1
    // report as reconstructed, not merely strengthened.
    const coord = createToolCallStreamCoordinator();
    const callRef = { sourceKey: "id0" };
    coord.push({ type: "tool_call_start", callRef, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 3 } as unknown as NormalizedToolStreamEvent);
    const call = expectDefined(coord.snapshot().calls[0]);
    expect(call.toolIndex).toBe(3);
  });

  it("Late tool name", () => {
    // A name delta arriving after argument evidence has already started
    // must still be recorded onto the same call.
    const coord = createToolCallStreamCoordinator();
    const callRef = { sourceKey: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_name_delta", callRef, toolIndex: 0, delta: "f" } as unknown as NormalizedToolStreamEvent);
    const call = expectDefined(coord.snapshot().calls[0]);
    expect(call.name).toBe("f");
  });

  it("Conflicting identity update", () => {
    // A second, conflicting toolCallId for the same call must poison it
    // (status -> "invalid") and raise a specific, attributed diagnostic -
    // not merely "something happened".
    const coord = createToolCallStreamCoordinator();
    const callRef = { sourceKey: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 0, toolCallId: "t1" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 0, toolCallId: "t2" } as unknown as NormalizedToolStreamEvent);
    const snap = coord.snapshot();
    const call = expectDefined(snap.calls[0]);
    expect(call.status).toBe("invalid");
    expect(snap.diagnostics.some(d => d.code === "E_PROVIDER_IDENTITY_CONFLICT")).toBe(true);
  });

  it("Delta after call end (per-call tool_call_end alone does not close the argument stream)", () => {
    // Verified, real, and easy to misread as a gap: a per-call
    // `tool_call_end` does NOT by itself move `call.status` off
    // "collecting" (only a stream-level provider_stream_end/finish()
    // does - see finishCall()/handleStreamEnd() and the identical
        // documented fact in coordinator-sdk-execution-observed.test.ts). So an
    // argument delta arriving after a call's own tool_call_end, but before
    // the stream itself ends, is silently merged in rather than flagged.
    // This pins that down as an explicit, observed contract (through
    // takeDecision(), the real security-relevant question) instead of
    // leaving it as an untested assumption in either direction.
    const gate = createToolCallExecutionGate();
    const callRef = { sourceKey: "id0" };
    gate.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai", name: "f" } as unknown as NormalizedToolStreamEvent);
    gate.push({ type: "tool_call_end", callRef, toolIndex: 0, reason: "complete" } as unknown as NormalizedToolStreamEvent);
    gate.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    const final = gate.finish({ reason: "complete" });
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({});
  });

  it("Event after provider stream end", () => {
    // The coordinator's own isFinished protocol guard: an event arriving
    // after the stream has already ended must be refused, and recorded as
    // the specific recognized diagnostic that downstream decisions key off
    // - not merely accepted/ignored silently.
    const coord = createToolCallStreamCoordinator();
    const callRef = { sourceKey: "id0" };
    coord.push({ type: "provider_stream_end", reason: "complete" } as unknown as NormalizedToolStreamEvent);
    const result = coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    expect(result.accepted).toBe(false);
    expect(coord.snapshot().diagnostics.some(d => d.code === "E_EVENT_AFTER_STREAM_END")).toBe(true);
  });
});
