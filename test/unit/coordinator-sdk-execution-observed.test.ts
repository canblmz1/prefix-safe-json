import { describe, it, expect } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import {
  SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE,
} from "../../src/coordinator/diagnostic-codes.js";
import { expectDefined } from "../utils/expect-defined.js";

function startCall(coord: ReturnType<typeof createToolCallStreamCoordinator>, sourceKey: string, name: string) {
  coord.push({
    type: "tool_call_start",
    callRef: { sourceKey },
    provider: "ai-sdk",
    name,
  } as unknown as NormalizedToolStreamEvent);
}

function pushExecutionObservedDiagnostic(
  coord: ReturnType<typeof createToolCallStreamCoordinator>,
  sourceKey: string,
  code: string = SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
) {
  coord.push({
    type: "provider_diagnostic",
    provider: "ai-sdk",
    code,
    severity: "error",
    message: "already executed",
    callRef: { sourceKey },
  } as unknown as NormalizedToolStreamEvent);
}

describe("Coordinator — SDK execution-observed poisoning", () => {
  it("a provider_diagnostic with the SDK-execution-observed code moves a collecting call to status sdk_execution_observed", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    pushExecutionObservedDiagnostic(coord, "a");

    const call = expectDefined(coord.snapshot().calls[0]);
    expect(call.status).toBe("sdk_execution_observed");
  });

  it("the tool-error diagnostic code gets identical treatment (success/error not distinguished)", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    pushExecutionObservedDiagnostic(coord, "a", SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE);

    const call = expectDefined(coord.snapshot().calls[0]);
    expect(call.status).toBe("sdk_execution_observed");
  });

  it("D: a duplicate SDK-execution-observed diagnostic for the same call is a deterministic no-op, not an error", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    pushExecutionObservedDiagnostic(coord, "a");
    const afterFirst = expectDefined(coord.snapshot().calls[0]).status;
    pushExecutionObservedDiagnostic(coord, "a");
    const afterSecond = expectDefined(coord.snapshot().calls[0]).status;

    expect(afterFirst).toBe("sdk_execution_observed");
    expect(afterSecond).toBe("sdk_execution_observed");
  });

  it("E: tool-error observed, then a tool-result for the same call - status stays poisoned either order", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    pushExecutionObservedDiagnostic(coord, "a", SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE);
    pushExecutionObservedDiagnostic(coord, "a", SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE);

    expect(expectDefined(coord.snapshot().calls[0]).status).toBe("sdk_execution_observed");
  });

  it("H: evidence arriving after tool_call_end (structural completion) but before the stream finishes is still correctly attributed", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    coord.push({
      type: "tool_call_arguments_delta",
      callRef: { sourceKey: "a" },
      provider: "ai-sdk",
      delta: '{"path":"a.txt"}',
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_end",
      callRef: { sourceKey: "a" },
      provider: "ai-sdk",
      reason: "complete",
    } as unknown as NormalizedToolStreamEvent);

    // Structurally done (argumentStreamClosed), but finishCall() has not run
    // yet - status is still "collecting" at this exact point, which is
    // precisely why the poisoning path cannot wait for a terminal status.
    expect(expectDefined(coord.snapshot().calls[0]).status).toBe("collecting");

    pushExecutionObservedDiagnostic(coord, "a");
    expect(expectDefined(coord.snapshot().calls[0]).status).toBe("sdk_execution_observed");

    // Stream end must not be able to overwrite it either - finishCall()'s
    // own `status !== "collecting"` guard should skip this call entirely.
    coord.push({ type: "provider_stream_end", provider: "ai-sdk", reason: "complete" } as unknown as NormalizedToolStreamEvent);
    expect(expectDefined(coord.snapshot().calls[0]).status).toBe("sdk_execution_observed");
  });

  it("a safe finish arriving after the poison never reverts it (a later favorable event cannot upgrade the call)", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    coord.push({
      type: "tool_call_arguments_delta",
      callRef: { sourceKey: "a" },
      provider: "ai-sdk",
      delta: '{"path":"a.txt"}',
    } as unknown as NormalizedToolStreamEvent);
    pushExecutionObservedDiagnostic(coord, "a");
    coord.push({
      type: "tool_call_end",
      callRef: { sourceKey: "a" },
      provider: "ai-sdk",
      reason: "complete",
    } as unknown as NormalizedToolStreamEvent);
    const result = coord.finish({ reason: "complete" });

    expect(expectDefined(result.calls[0]).status).toBe("sdk_execution_observed");
  });

  it("J: an unattributable SDK-execution-observed diagnostic (no callRef) poisons no call and still records the diagnostic", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    coord.push({
      type: "provider_diagnostic",
      provider: "ai-sdk",
      code: SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
      severity: "error",
      message: "already executed, unknown call",
      // no callRef
    } as unknown as NormalizedToolStreamEvent);

    const snap = coord.snapshot();
    expect(expectDefined(snap.calls[0]).status).toBe("collecting");
    expect(
      snap.diagnostics.some((d) => d.code === SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE && d.internalId === undefined),
    ).toBe(true);
  });

  it("F: only the call that received the diagnostic is poisoned - a concurrent, unrelated call is unaffected", () => {
    const coord = createToolCallStreamCoordinator();
    startCall(coord, "a", "write_file");
    startCall(coord, "b", "read_file");
    pushExecutionObservedDiagnostic(coord, "a");

    const calls = coord.snapshot().calls;
    const callA = expectDefined(calls.find((c) => c.name === "write_file"));
    const callB = expectDefined(calls.find((c) => c.name === "read_file"));
    expect(callA.status).toBe("sdk_execution_observed");
    expect(callB.status).toBe("collecting");
  });

  it("an unattributable diagnostic also leaves a call that starts AFTER it at status collecting - the coordinator never guesses, at any point in time", () => {
    // This is the coordinator half of the story only: it deliberately never
    // assigns unattributable evidence to any call, no matter when that call
    // starts. The corresponding cross-call fail-closed response lives
    // entirely in decideExecution()'s global-diagnostics check (see
    // test/unit/execution-gate-decision-table.test.ts and
    // test/guard/ai-sdk-execution-observed.test.ts) - not here.
    const coord = createToolCallStreamCoordinator();
    coord.push({
      type: "provider_diagnostic",
      provider: "ai-sdk",
      code: SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
      severity: "error",
      message: "already executed, unknown call",
    } as unknown as NormalizedToolStreamEvent);
    startCall(coord, "later", "write_file");

    expect(expectDefined(coord.snapshot().calls[0]).status).toBe("collecting");
  });
});
