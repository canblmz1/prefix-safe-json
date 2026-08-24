import { describe, it, expect } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import type { ToolCallCoordinatorEvent } from "../../src/coordinator/types.js";

// Direct, coordinator-only tests for `tool_call_finished.executable` -
// documented (src/coordinator/types.ts) as a real contract for any consumer
// of the public, Stable createToolCallStreamCoordinator() API directly, not
// merely an internal detail the gate happens to re-derive its own way. See
// src/gate/decide.ts: the gate reads `call.parser.executable`, NOT this
// field - so a direct coordinator consumer trusting `executable` here needs
// its own independent proof this computation is correct.

function finishedEvent(events: readonly ToolCallCoordinatorEvent[]) {
  return events.find((e): e is ToolCallCoordinatorEvent & { type: "tool_call_finished" } => e.type === "tool_call_finished");
}

describe("coordinator tool_call_finished.executable — direct API contract", () => {
  it("true: structurally complete, no schema registered", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({ type: "tool_call_start", callRef: ref, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: ref, delta: '{"q":"x"}', provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: ref, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);
    const finished = finishedEvent(coord.drainEvents());
    expect(finished?.outcome).toBe("complete");
    expect(finished?.executable).toBe(true);
  });

  it("false: structurally complete but fails its registered schema", () => {
    const coord = createToolCallStreamCoordinator(undefined, undefined, {
      search: { type: "object", properties: { q: { type: "string" } }, required: ["missing_required_field"] },
    });
    const ref = { sourceKey: "a" };
    coord.push({ type: "tool_call_start", callRef: ref, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: ref, delta: '{"q":"x"}', provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: ref, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "complete", provider: "openai" } as unknown as NormalizedToolStreamEvent);
    const finished = finishedEvent(coord.drainEvents());
    // outcome is still "complete" - the value is genuinely structurally
    // complete - but executable must be false, because schema validity is
    // an independent, additional requirement.
    expect(finished?.outcome).toBe("complete");
    expect(finished?.executable).toBe(false);
  });

  it("false: truncated (structurally incomplete), regardless of schema", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({ type: "tool_call_start", callRef: ref, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: ref, delta: '{"q":"x"', provider: "openai" } as unknown as NormalizedToolStreamEvent); // never closed
    coord.push({ type: "provider_stream_end", reason: "length", provider: "openai" } as unknown as NormalizedToolStreamEvent);
    const finished = finishedEvent(coord.drainEvents());
    expect(finished?.outcome).not.toBe("complete");
    expect(finished?.executable).toBe(false);
  });

  it("false: structurally complete AND schema-valid, but the stream ended with an unsafe reason (parser.executable false)", () => {
    const coord = createToolCallStreamCoordinator();
    const ref = { sourceKey: "a" };
    coord.push({ type: "tool_call_start", callRef: ref, provider: "openai", name: "search" } as unknown as NormalizedToolStreamEvent);
    // Complete-looking JSON, but the stream's own terminal reason is unsafe -
    // parser.executable must be false even though the JSON shape parses.
    coord.push({ type: "tool_call_arguments_delta", callRef: ref, delta: '{"q":"x"}', provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "length", provider: "openai" } as unknown as NormalizedToolStreamEvent);
    const finished = finishedEvent(coord.drainEvents());
    expect(finished?.executable).toBe(false);
  });
});
