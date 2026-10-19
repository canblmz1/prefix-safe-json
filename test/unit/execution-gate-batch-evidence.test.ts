import { describe, expect, it } from "vitest";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import type { ToolCallExecutionGate } from "../../src/gate/types.js";
import type { CoordinatorLimits } from "../../src/coordinator/types.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";

const schema = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
  additionalProperties: false,
};

function call(index: number, argumentsText = '{"message":"hello"}') {
  return {
    index,
    id: `original-${index}`,
    type: "function",
    function: { name: "echo", arguments: argumentsText },
  };
}

function feedCalls(
  calls: readonly unknown[],
  limits?: Partial<CoordinatorLimits>,
  beforeEnd: readonly NormalizedToolStreamEvent[] = [],
): ToolCallExecutionGate {
  const adapter = new OpenAICompatibleStreamAdapter();
  const gate = createToolCallExecutionGate(limits, undefined, { echo: schema });
  for (const event of adapter.push({
    id: "response-original",
    usage: { prompt_tokens: 1 },
    vendor_extension: { opaque: true },
    choices: [{
      index: 0,
      delta: { tool_calls: calls, content: "display text", vendor_extension: true },
      finish_reason: "tool_calls",
      logprobs: null,
    }],
  })) gate.push(event);
  for (const event of beforeEnd) gate.push(event);
  for (const event of adapter.finish()) gate.push(event);
  return gate;
}

// The core exposes one decision for each call it actually created. A caller
// applying whole-response policy must also inspect finish().diagnostics before
// consuming any authority; untracked calls have no decision to inspect.
describe("execution gate evidence for a caller's whole-batch policy", () => {
  it("keeps the global maxToolCalls diagnostic after draining, without changing call-scoped authority", () => {
    const gate = feedCalls([call(0), call(1)], { maxToolCalls: 1 });
    expect(gate.takeDecision("call-0")).toBeUndefined();
    gate.drainEvents();

    const final = gate.finish();
    expect(final.decisions).toHaveLength(1);
    expect(final.decisions[0]).toMatchObject({ action: "execute", toolCallId: "original-0" });
    expect(final.diagnostics).toEqual([{
      code: "E_COORDINATOR_LIMIT_CALLS",
      severity: "error",
      message: "Maximum tool calls exceeded",
    }]);
    expect(gate.takeDecision("call-0")?.toolCallId).toBe("original-0");
    expect(gate.takeDecision("call-0")).toBeUndefined();
    expect(gate.takeDecision("call-1")).toBeUndefined();
    expect(gate.finish().diagnostics).toEqual(final.diagnostics);
  });

  it.each([127, 128])("retains every original ID and one-shot authority for %i valid calls", (count) => {
    const gate = feedCalls(Array.from({ length: count }, (_, index) => call(index)));
    const final = gate.finish();
    expect(final.diagnostics).toEqual([]);
    expect(final.decisions).toHaveLength(count);
    expect(final.decisions.every((decision) => decision.action === "execute")).toBe(true);
    expect(final.decisions.map((decision) => decision.toolCallId)).toEqual(
      Array.from({ length: count }, (_, index) => `original-${index}`),
    );
    for (const decision of final.decisions) {
      expect(gate.takeDecision(decision.internalId)?.toolCallId).toBe(decision.toolCallId);
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    }
  });

  it.each(['{"message":"last"}', '{"message":129}'])(
    "exposes the default-limit loss even when the uncreated 129th call has arguments %s",
    (lastArguments) => {
      const calls = Array.from({ length: 129 }, (_, index) => call(index));
      calls[128] = call(128, lastArguments);
      const gate = feedCalls(calls);
      gate.drainEvents();
      const final = gate.finish();

      expect(final.decisions).toHaveLength(128);
      expect(final.decisions.every((decision) => decision.action === "execute")).toBe(true);
      expect(final.diagnostics).toEqual([{
        code: "E_COORDINATOR_LIMIT_CALLS",
        severity: "error",
        message: "Maximum tool calls exceeded",
      }]);
      expect(gate.takeDecision("call-128")).toBeUndefined();
    },
  );

  it.each([-1, 1.5])("preserves a dropped provider index %s as an unattributed error", (index) => {
    const gate = feedCalls([call(0), call(index)]);
    gate.drainEvents();
    const final = gate.finish();

    expect(final.decisions).toHaveLength(1);
    expect(final.decisions[0]).toMatchObject({ action: "execute", toolCallId: "original-0" });
    expect(final.diagnostics).toEqual([{
      code: "E_PROVIDER_EVENT_MALFORMED",
      severity: "error",
      message: "tool_call index is missing or invalid",
      internalId: undefined,
    }]);
    expect(gate.takeDecision("call-0")?.toolCallId).toBe("original-0");
    expect(gate.takeDecision("call-0")).toBeUndefined();
    expect(gate.takeDecision("call-1")).toBeUndefined();
  });

  it("preserves an error whose provider source identity never resolves to a coordinator call", () => {
    const gate = feedCalls([call(0)], undefined, [{
      type: "provider_diagnostic",
      provider: "openai-compatible",
      sequence: 100,
      callRef: { sourceKey: "never-started" },
      code: "E_TOOL_ARGUMENTS_BEFORE_START",
      severity: "error",
      message: "Argument evidence references a call that was never started",
    }]);
    gate.drainEvents();
    const final = gate.finish();

    expect(final.decisions).toHaveLength(1);
    expect(final.decisions[0]?.action).toBe("execute");
    expect(final.diagnostics).toEqual([{
      code: "E_TOOL_ARGUMENTS_BEFORE_START",
      severity: "error",
      message: "Argument evidence references a call that was never started",
      internalId: undefined,
      sourceKey: "never-started",
    }]);
    expect(gate.takeDecision("never-started")).toBeUndefined();
    expect(gate.takeDecision("call-0")?.toolCallId).toBe("original-0");
    expect(gate.takeDecision("call-0")).toBeUndefined();
  });

  it("keeps a missing original provider ID visible for a stricter caller to refuse", () => {
    const missingId = { ...call(1), id: undefined };
    const gate = feedCalls([call(0), missingId]);
    const final = gate.finish();

    expect(final.decisions).toHaveLength(2);
    expect(final.decisions[1]).toMatchObject({ action: "execute", toolIndex: 1 });
    expect(final.decisions[1]?.toolCallId).toBeUndefined();
    // Abstract normalized core consumers need not have provider-issued IDs.
    // A companion preserving native continuation must require them itself.
    expect(final.diagnostics).toEqual([]);
  });

  it("keeps a schema failure call-scoped while surfacing the failed sibling's diagnostic", () => {
    const gate = feedCalls([call(0), call(1, '{"message":1}')]);
    const final = gate.finish();

    expect(final.decisions.map((decision) => [decision.action, decision.reason])).toEqual([
      ["execute", "complete"], ["reject", "schema_invalid"],
    ]);
    expect(final.diagnostics).toEqual([expect.objectContaining({
      code: "E_SCHEMA_VALIDATION_FAILED", severity: "error", internalId: "call-1",
    })]);
    expect(gate.takeDecision("call-1")).toBeUndefined();
    expect(gate.takeDecision("call-0")?.toolCallId).toBe("original-0");
    expect(gate.takeDecision("call-0")).toBeUndefined();
  });

  it("preserves harmless warning/info records and accepts supported provider extra fields", () => {
    const gate = feedCalls([call(0)], undefined, [
      {
        type: "provider_diagnostic", provider: "openai-compatible", sequence: 100,
        code: "W_VENDOR_NOTICE", severity: "warning", message: "Optional usage details unavailable",
      },
      {
        type: "provider_diagnostic", provider: "openai-compatible", sequence: 101,
        code: "I_VENDOR_METADATA", severity: "info", message: "Supplementary metadata",
      },
    ]);
    const final = gate.finish();

    expect(final.decisions).toHaveLength(1);
    expect(final.decisions[0]?.action).toBe("execute");
    expect(final.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(["warning", "info"]);
    expect(gate.takeDecision("call-0")?.value).toEqual({ message: "hello" });
    expect(gate.takeDecision("call-0")).toBeUndefined();
  });
});
