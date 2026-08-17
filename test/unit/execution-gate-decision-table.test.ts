import { describe, it, expect } from "vitest";
import { decideExecution, DecisionContext } from "../../src/gate/decide.js";
import type { CoordinatorDiagnostic, ToolCallState } from "../../src/coordinator/types.js";
import type { ParserSnapshot, JsonValue, Diagnostic } from "../../src/types.js";

function parserSnapshot(overrides: Partial<ParserSnapshot> = {}): ParserSnapshot {
  return {
    phase: "finished",
    syntax: "root_complete",
    stableValue: { path: "a.txt" },
    rootComplete: true,
    executable: true,
    pending: [],
    repairs: [],
    diagnostics: [],
    receivedBytes: 10,
    consumedBytes: 10,
    ...overrides,
  };
}

function call(overrides: Partial<ToolCallState> = {}): ToolCallState {
  return {
    internalId: "call-0",
    provider: "anthropic",
    toolCallId: "toolu_01",
    toolIndex: 0,
    name: "write_file",
    nameComplete: true,
    parser: parserSnapshot(),
    status: "complete",
    schemaValid: undefined,
    ...overrides,
  };
}

function ctx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    streamEndReason: "complete",
    diagnostics: [],
    ...overrides,
  };
}

function diagnostic(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    code: "E_LIMIT_DEPTH",
    severity: "fatal",
    byteOffset: 0,
    recoverable: false,
    message: "depth limit exceeded",
    ...overrides,
  };
}

function coordDiag(overrides: Partial<CoordinatorDiagnostic> = {}): CoordinatorDiagnostic {
  return {
    code: "E_SOME_DIAGNOSTIC",
    severity: "error",
    message: "something",
    ...overrides,
  };
}

describe("decideExecution — happy path", () => {
  it("execute/complete for a structurally complete, executable, schema-valid call", () => {
    const value: JsonValue = { path: "a.txt", content: "hello" };
    const decision = decideExecution(
      call({ parser: parserSnapshot({ stableValue: value }), schemaValid: true }),
      ctx(),
    );
    expect(decision.action).toBe("execute");
    expect(decision.executable).toBe(true);
    expect(decision.reason).toBe("complete");
    if (decision.action === "execute") {
      expect(decision.value).toEqual(value);
    }
  });

  it("execute/complete when no schema was registered for the tool (schemaValid undefined)", () => {
    const decision = decideExecution(call({ schemaValid: undefined }), ctx());
    expect(decision.action).toBe("execute");
  });

  it("never exposes a `value` property on a non-executable decision", () => {
    const decision = decideExecution(call({ status: "truncated" }), ctx());
    expect(decision.action).not.toBe("execute");
    expect("value" in decision).toBe(false);
  });
});

describe("decideExecution — priority ordering (fail-closed checks run before execute)", () => {
  it("resource_limit wins even over an otherwise-executable call (parser-level limit diagnostic)", () => {
    const decision = decideExecution(
      call({
        parser: parserSnapshot({
          diagnostics: [diagnostic({ code: "E_LIMIT_DEPTH" })],
        }),
      }),
      ctx(),
    );
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("resource_limit");
  });

  it("resource_limit wins via a coordinator-level per-call limit diagnostic (E_TOOL_NAME_LIMIT)", () => {
    const decision = decideExecution(
      call(),
      ctx({ diagnostics: [coordDiag({ code: "E_TOOL_NAME_LIMIT", internalId: "call-0" })] }),
    );
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("resource_limit");
  });

  it("resource_limit wins via a stream-wide coordinator limit diagnostic (E_COORDINATOR_LIMIT_EVENTS)", () => {
    const decision = decideExecution(
      call(),
      ctx({ diagnostics: [coordDiag({ code: "E_COORDINATOR_LIMIT_EVENTS" })] }),
    );
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("resource_limit");
  });

  it("provider_error wins even over an otherwise-executable call", () => {
    const decision = decideExecution(call(), ctx({ streamEndReason: "provider_error" }));
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("provider_error");
  });

  it("content_filtered wins even over an otherwise-executable call", () => {
    const decision = decideExecution(
      call(),
      ctx({ diagnostics: [coordDiag({ code: "E_CONTENT_FILTERED" })] }),
    );
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("content_filtered");
  });

  it("resource_limit is checked before content_filtered/provider_error (both present at once)", () => {
    const decision = decideExecution(
      call({ parser: parserSnapshot({ diagnostics: [diagnostic({ code: "E_LIMIT_INPUT_BYTES" })] }) }),
      ctx({
        streamEndReason: "provider_error",
        diagnostics: [coordDiag({ code: "E_CONTENT_FILTERED" })],
      }),
    );
    expect(decision.reason).toBe("resource_limit");
  });
});

describe("decideExecution — structural status mapping", () => {
  it("truncated status -> retry/truncated", () => {
    const decision = decideExecution(
      call({ status: "truncated", parser: parserSnapshot({ executable: false, rootComplete: false }) }),
      ctx({ streamEndReason: "length" }),
    );
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("truncated");
  });

  it("salvaged status (container-level truncation, repaired-closed) -> retry/stream_incomplete", () => {
    const decision = decideExecution(
      call({
        status: "salvaged",
        parser: parserSnapshot({
          executable: false,
          repairs: [{ code: "R_CLOSE_CONTAINER", byteRange: [0, 0], impact: "structural", description: "x" }],
        }),
      }),
      ctx({ streamEndReason: "length" }),
    );
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("stream_incomplete");
  });

  it("invalid status (malformed content) -> reject/malformed", () => {
    const decision = decideExecution(
      call({ status: "invalid", parser: parserSnapshot({ executable: false }) }),
      ctx(),
    );
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("malformed");
  });

  it("cancelled status -> retry/stream_incomplete", () => {
    const decision = decideExecution(
      call({ status: "cancelled", parser: parserSnapshot({ executable: false }) }),
      ctx({ streamEndReason: "cancelled" }),
    );
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("stream_incomplete");
  });

  it("collecting status (mid-stream, never finished) -> retry/stream_incomplete", () => {
    const decision = decideExecution(
      call({ status: "collecting", parser: parserSnapshot({ executable: false, phase: "collecting" }) }),
      ctx({ streamEndReason: "unknown" }),
    );
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("stream_incomplete");
  });

  it("complete status + schemaValid:false -> reject/schema_invalid", () => {
    const decision = decideExecution(call({ status: "complete", schemaValid: false }), ctx());
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("schema_invalid");
  });

  it("complete status but parser.executable:false (stream-reason mismatch, no repair needed) -> retry/stream_incomplete", () => {
    const decision = decideExecution(
      call({ status: "complete", parser: parserSnapshot({ executable: false }) }),
      ctx({ streamEndReason: "cancelled" }),
    );
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("stream_incomplete");
  });

  it("defensive guard: complete + executable:true but stableValue undefined never executes", () => {
    const decision = decideExecution(
      call({ status: "complete", parser: parserSnapshot({ executable: true, stableValue: undefined }) }),
      ctx(),
    );
    expect(decision.action).not.toBe("execute");
    expect(decision.reason).toBe("stream_incomplete");
  });
});

describe("decideExecution — diagnostics surfaced on the decision", () => {
  it("includes this call's own parser diagnostics verbatim", () => {
    const diag = diagnostic({ code: "E_UNTERMINATED_STRING", severity: "error" });
    const decision = decideExecution(
      call({ status: "truncated", parser: parserSnapshot({ executable: false, diagnostics: [diag] }) }),
      ctx(),
    );
    expect(decision.parserDiagnostics).toEqual([diag]);
  });

  it("includes both global and per-call coordinator diagnostics", () => {
    const global = coordDiag({ code: "E_GLOBAL_THING" });
    const perCall = coordDiag({ code: "E_PER_CALL_THING", internalId: "call-0" });
    const otherCall = coordDiag({ code: "E_OTHER_CALL_THING", internalId: "call-99" });
    const decision = decideExecution(
      call({ status: "invalid" }),
      ctx({ diagnostics: [global, perCall, otherCall] }),
    );
    expect(decision.coordinatorDiagnostics).toContainEqual(global);
    expect(decision.coordinatorDiagnostics).toContainEqual(perCall);
    expect(decision.coordinatorDiagnostics).not.toContainEqual(otherCall);
  });

  it("always surfaces stableValue when known, even on non-executable decisions", () => {
    const partial: JsonValue = { path: "a.txt" };
    const decision = decideExecution(
      call({ status: "truncated", parser: parserSnapshot({ executable: false, stableValue: partial }) }),
      ctx(),
    );
    expect(decision.stableValue).toEqual(partial);
  });
});
