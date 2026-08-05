import { describe, it, expect } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";

describe("Coordinator error paths (coverage gaps)", () => {
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
});
