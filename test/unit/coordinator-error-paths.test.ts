import { describe, it, expect } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";

describe("Coordinator error paths (coverage gaps)", () => {
  it("emits tool_call_identity_updated immediately when tool_call_start itself already carries toolCallId/toolIndex - not only when it arrives later via tool_call_identity", () => {
    const coord = createToolCallStreamCoordinator();
    coord.push({
      type: "tool_call_start",
      callRef: { sourceKey: "a" },
      toolCallId: "call_abc",
      toolIndex: 2,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const events = coord.drainEvents();
    const identityEvent = events.find((e) => e.type === "tool_call_identity_updated");
    expect(identityEvent).toMatchObject({ toolCallId: "call_abc", toolIndex: 2 });
  });

  it("does NOT emit tool_call_identity_updated at start when tool_call_start carries no identity info at all", () => {
    const coord = createToolCallStreamCoordinator();
    coord.push({
      type: "tool_call_start",
      callRef: { sourceKey: "a" },
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const events = coord.drainEvents();
    expect(events.some((e) => e.type === "tool_call_identity_updated")).toBe(false);
  });

  it("sets toolIndex when it arrives later via a tool_call_identity event", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({
      type: "tool_call_start",
      callRef: ref,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_identity",
      callRef: ref,
      toolIndex: 3,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const call = coord.snapshot().calls[0];
    expect(call?.toolIndex).toBe(3);
  });

  it("flags a conflicting toolIndex reported for the same call", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({
      type: "tool_call_start",
      callRef: ref,
      toolIndex: 0,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_identity",
      callRef: ref,
      toolIndex: 1, // conflicts with the toolIndex given at start
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const diagnostics = coord.snapshot().diagnostics;
    expect(diagnostics.some((d) => d.code === "E_PROVIDER_INDEX_CONFLICT")).toBe(true);
  });

  it("flags a name delta arriving for a call already marked invalid by an identity conflict", () => {
    // handleCallEnd()/provider_stream_end alone don't move call.status off
    // "collecting" without also finishing the whole coordinator (which then
    // rejects *every* further event with a different, stream-level
    // diagnostic). Using a toolIndex conflict is a call-scoped way to reach
    // status "invalid" while the coordinator itself is still open.
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({
      type: "tool_call_start",
      callRef: ref,
      toolIndex: 0,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_identity",
      callRef: ref,
      toolIndex: 1, // conflicts -> call.status = "invalid"
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_name_delta",
      callRef: ref,
      delta: "late",
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const diagnostics = coord.snapshot().diagnostics;
    expect(diagnostics.some((d) => d.code === "E_NAME_DELTA_AFTER_END")).toBe(true);
  });

  it("flags an argument delta arriving for a call already marked invalid by an identity conflict", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({
      type: "tool_call_start",
      callRef: ref,
      toolIndex: 0,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_identity",
      callRef: ref,
      toolIndex: 1, // conflicts -> call.status = "invalid"
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_arguments_delta",
      callRef: ref,
      delta: '{"a":1}',
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const diagnostics = coord.snapshot().diagnostics;
    expect(diagnostics.some((d) => d.code === "E_ARGUMENT_DELTA_AFTER_END")).toBe(true);
  });

  it("reports a 'salvaged' call outcome when the underlying parser salvages a truncated stream", () => {
    const coord = createToolCallStreamCoordinator(undefined, {
      repairs: { closeContainersAtFinish: "safe-only" },
    });
    const ref = { sourceKey: "a" };
    coord.push({
      type: "tool_call_start",
      callRef: ref,
      toolIndex: 0,
      provider: "openai",
      name: "search",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_arguments_delta",
      callRef: ref,
      delta: '{"query":"x"', // never closed
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "provider_stream_end",
      reason: "length",
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const call = coord.snapshot().calls[0];
    expect(call?.status).toBe("salvaged");
  });

  it("flags a genuinely conflicting second terminal reason with its own diagnostic code, distinct from a plain late event", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({
      type: "tool_call_start",
      callRef: ref,
      provider: "openai",
      name: "search",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_arguments_delta",
      callRef: ref,
      delta: '{"query":"x"}',
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_end",
      callRef: ref,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "provider_stream_end",
      reason: "complete",
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const decidedCall = coord.snapshot().calls[0];
    expect(decidedCall?.status).toBe("complete");

    // A second, contradictory terminal event arrives after the stream
    // already ended (e.g. a duplicate/racing "finish" the provider sent
    // with a different reason) - it must not be able to move execution
    // confidence in either direction.
    coord.push({
      type: "provider_stream_end",
      reason: "cancelled",
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);

    const snap = coord.snapshot();
    expect(snap.diagnostics.some((d) => d.code === "E_TERMINAL_REASON_CONFLICT" && d.severity === "fatal")).toBe(true);
    expect(snap.calls[0]?.status).toBe("complete"); // unchanged
  });

  it("still reports the plain late-event code (not a terminal conflict) for a harmless duplicate of the SAME reason", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({ type: "tool_call_start", callRef: ref, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: ref, delta: '{"query":"x"}', provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: ref, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);

    const diagnostics = coord.snapshot().diagnostics;
    expect(diagnostics.some((d) => d.code === "E_EVENT_AFTER_STREAM_END")).toBe(true);
    expect(diagnostics.some((d) => d.code === "E_TERMINAL_REASON_CONFLICT")).toBe(false);
  });

  it("hasCallConflict: a prior error-severity diagnostic against a call forces its FINAL outcome to invalid, even when the JSON itself completes genuinely validly", () => {
    // E_DUPLICATE_TOOL_CALL_START is attributed to the ORIGINAL call
    // ("a") without directly mutating its status (unlike an identity
    // conflict, which sets call.status = "invalid" immediately) - so the
    // only thing that can catch this by the time call "a" reaches
    // finishCall() is hasCallConflict() checking recorded diagnostics.
    // The prior test suite only ever asserted the diagnostic CODE appears
    // (test/providers/coverage.test.ts's "handles stream end with open
    // call" does the same for E_STREAM_ENDED_WITH_OPEN_CALL) - never that
    // it actually forces the outcome, which is the real behavior this
    // exists for.
    const coord = createToolCallStreamCoordinator();
    coord.push({ type: "tool_call_start", callRef: { sourceKey: "a" }, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_start", callRef: { sourceKey: "a" }, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent); // duplicate -> E_DUPLICATE_TOOL_CALL_START, attributed to the existing call, no direct status mutation
    coord.push({ type: "tool_call_arguments_delta", callRef: { sourceKey: "a" }, delta: '{"q":"x"}', provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: { sourceKey: "a" }, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);

    const events = coord.drainEvents();
    expect(events.some((e) => e.type === "coordinator_diagnostic" && e.diagnostic.code === "E_DUPLICATE_TOOL_CALL_START")).toBe(true);
    const finished = events.find((e) => e.type === "tool_call_finished");
    // The JSON itself is genuinely, structurally complete - without
    // hasCallConflict this would report outcome "complete". It must not.
    expect(finished?.outcome).toBe("invalid");
    expect(finished?.executable).toBe(false);
  });

  it("finish() is a genuine no-op when the coordinator already finished via push() - does not re-emit provider_stream_finished", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({ type: "tool_call_start", callRef: ref, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: ref, delta: '{"query":"x"}', provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: ref, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);

    const firstDrain = coord.drainEvents();
    const firstFinishedEvents = firstDrain.filter((e) => e.type === "provider_stream_finished");
    expect(firstFinishedEvents.length).toBe(1); // exactly one, from the push() above

    // finish() must see isFinished already true and do nothing further -
    // not call handleStreamEnd a second time, not emit a second
    // provider_stream_finished, not re-decide any call's outcome.
    const result = coord.finish();
    const secondDrain = coord.drainEvents();
    expect(secondDrain.filter((e) => e.type === "provider_stream_finished").length).toBe(0);
    expect(result.calls[0]?.status).toBe("complete"); // unchanged by the redundant finish() call
  });

  it("finish() DOES synthesize the terminal event when the coordinator was never explicitly ended via push()", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({ type: "tool_call_start", callRef: ref, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: ref, delta: '{"query":"x"}', provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: ref, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    // No provider_stream_end pushed - finish() itself must be the only thing
    // that ever closes this stream.

    const result = coord.finish({ reason: "cancelled" });
    const drained = coord.drainEvents();
    expect(drained.some((e) => e.type === "provider_stream_finished" && e.reason === "cancelled")).toBe(true);
    expect(result.calls[0]?.status).toBe("cancelled");
  });
});
