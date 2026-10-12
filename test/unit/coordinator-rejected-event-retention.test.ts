import { describe, expect, it } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import {
  EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE,
  TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE,
} from "../../src/coordinator/diagnostic-codes.js";

const LIMIT_CODE = "E_COORDINATOR_LIMIT_EVENTS";
const note: NormalizedToolStreamEvent = {
  type: "provider_diagnostic", provider: "openai", sequence: 1,
  code: "I_PROGRESS", severity: "info", message: "progress",
};
const complete: NormalizedToolStreamEvent = {
  type: "provider_stream_end", provider: "openai", sequence: 4, reason: "complete",
};
const conflict: NormalizedToolStreamEvent = {
  type: "provider_stream_end", provider: "openai", sequence: 5, reason: "provider_error",
};

function callEvents(): NormalizedToolStreamEvent[] {
  const callRef = { sourceKey: "test:0" };
  return [
    { type: "tool_call_start", provider: "openai", sequence: 1, callRef, name: "echo", toolCallId: "external-0" },
    { type: "tool_call_arguments_delta", provider: "openai", sequence: 2, callRef, delta: '{"value":1}' },
    { type: "tool_call_end", provider: "openai", sequence: 3, callRef, reason: "complete" },
  ];
}

// Small deterministic loops test retained record counts, not heap/timing noise.
// No network, large payload, or live service is involved.
describe("coordinator retention for rejected pushes", () => {
  it("records an exhausted normalized-event budget once, even after draining", () => {
    const coordinator = createToolCallStreamCoordinator({ maxNormalizedEvents: 1 });
    expect(coordinator.push(note).accepted).toBe(true);
    coordinator.drainEvents();
    for (let i = 0; i < 32; i++) expect(coordinator.push(note).accepted).toBe(false);

    expect(coordinator.snapshot().eventsProcessed).toBe(1);
    expect(coordinator.snapshot().diagnostics.map((d) => d.code)).toEqual(["I_PROGRESS", LIMIT_CODE]);
    expect(coordinator.drainEvents()).toHaveLength(1);
    for (let i = 0; i < 32; i++) expect(coordinator.push(note).accepted).toBe(false);
    expect(coordinator.snapshot().diagnostics).toHaveLength(2);
    expect(coordinator.drainEvents()).toEqual([]);
  });

  it("records repeated post-terminal input once, without reopening a finished stream", () => {
    const coordinator = createToolCallStreamCoordinator();
    coordinator.finish({ reason: "complete" });
    coordinator.drainEvents();
    for (let i = 0; i < 32; i++) expect(coordinator.push(note).accepted).toBe(false);

    expect(coordinator.snapshot().diagnostics.map((d) => d.code)).toEqual([EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE]);
    expect(coordinator.snapshot().eventsProcessed).toBe(0);
    expect(coordinator.snapshot().isFinished).toBe(true);
    expect(coordinator.drainEvents()).toHaveLength(1);
    coordinator.finish({ reason: "complete" });
    coordinator.push(note);
    expect(coordinator.drainEvents()).toEqual([]);
    expect(coordinator.snapshot().diagnostics).toHaveLength(1);
  });

  it("retains the first conflicting-terminal evidence once across different later reasons", () => {
    const coordinator = createToolCallStreamCoordinator();
    coordinator.push(complete);
    coordinator.drainEvents();
    for (const reason of ["provider_error", "cancelled", "length", "provider_error"] as const) {
      expect(coordinator.push({ ...conflict, reason }).accepted).toBe(false);
    }
    const diagnostics = coordinator.snapshot().diagnostics;
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      code: TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE,
      severity: "fatal",
      message: 'Stream already ended with reason "complete"; a second, conflicting terminal reason "provider_error" arrived afterward',
    });
    expect(coordinator.drainEvents()).toHaveLength(1);
  });

  it.each([false, true])("keeps both late-input and conflicting-terminal categories (conflict first: %s)", (conflictFirst) => {
    const coordinator = createToolCallStreamCoordinator();
    coordinator.push(complete);
    coordinator.drainEvents();
    const first = conflictFirst ? conflict : note;
    const second = conflictFirst ? note : conflict;
    for (let i = 0; i < 16; i++) coordinator.push(first);
    const firstBatch = coordinator.drainEvents();
    expect(firstBatch).toHaveLength(1);
    for (let i = 0; i < 16; i++) coordinator.push(second);
    const secondBatch = coordinator.drainEvents();
    expect(secondBatch).toHaveLength(1);
    expect(secondBatch[0]?.sequence).toBeGreaterThan(firstBatch[0]?.sequence ?? -1);
    expect(coordinator.snapshot().diagnostics.map((d) => d.code).sort()).toEqual([
      EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE, TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE,
    ].sort());
    expect(coordinator.snapshot().diagnostics.find((d) => d.code === TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE)?.severity).toBe("fatal");
  });

  it("does not let a provider-supplied code suppress a later coordinator-wide diagnostic", () => {
    const coordinator = createToolCallStreamCoordinator();
    coordinator.push({
      ...note, code: EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE,
      callRef: { sourceKey: "other-call" },
    });
    coordinator.push(complete);
    coordinator.drainEvents();
    for (let i = 0; i < 16; i++) coordinator.push(note);
    const diagnostics = coordinator.snapshot().diagnostics;
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.sourceKey).toBe("other-call");
    expect(diagnostics[1]).toMatchObject({ code: EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE, severity: "error" });
    expect(diagnostics[1]?.sourceKey).toBeUndefined();
    expect(diagnostics[1]?.internalId).toBeUndefined();
    expect(coordinator.drainEvents()).toHaveLength(1);
  });

  it("keeps execution revoked after repeated finish/drain calls and isolates clean instances", () => {
    const affected = createToolCallExecutionGate();
    const clean = createToolCallExecutionGate();
    for (const gate of [affected, clean]) {
      for (const event of [...callEvents(), complete]) gate.push(event);
      expect(gate.finish().decisions[0]?.action).toBe("execute");
      gate.drainEvents();
    }
    for (let i = 0; i < 16; i++) {
      affected.push(note);
      affected.drainEvents();
      expect(affected.finish().decisions[0]).toMatchObject({ action: "reject", reason: "protocol_violation" });
      expect(affected.takeDecision("call-0")).toBeUndefined();
    }
    expect(affected.finish().diagnostics).toHaveLength(1);
    expect(clean.takeDecision("call-0")?.value).toEqual({ value: 1 });
    expect(clean.takeDecision("call-0")).toBeUndefined();
    expect(clean.finish().diagnostics).toEqual([]);
  });

  it("preserves all three rejection categories without restoring authority after a budget breach", () => {
    const gate = createToolCallExecutionGate({ maxNormalizedEvents: 3 });
    for (const event of callEvents()) expect(gate.push(event).accepted).toBe(true);
    gate.drainEvents();
    for (let i = 0; i < 16; i++) expect(gate.push(note).accepted).toBe(false);
    expect(gate.drainEvents()).toHaveLength(1);
    expect(gate.finish({ reason: "complete" }).decisions[0]).toMatchObject({ action: "reject", reason: "resource_limit" });
    expect(gate.takeDecision("call-0")).toBeUndefined();
    gate.drainEvents();
    for (let i = 0; i < 16; i++) {
      gate.push(note);
      gate.push(conflict);
    }
    expect(gate.drainEvents()).toHaveLength(2);
    expect(gate.finish().diagnostics.map((d) => d.code).sort()).toEqual([
      LIMIT_CODE, EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE, TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE,
    ].sort());
    expect(gate.takeDecision("call-0")).toBeUndefined();
    for (let i = 0; i < 16; i++) { gate.push(note); gate.push(conflict); }
    expect(gate.drainEvents()).toEqual([]);
    expect(gate.finish().diagnostics).toHaveLength(3);
  });
});
