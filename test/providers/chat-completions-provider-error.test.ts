import { describe, expect, it } from "vitest";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import { expectDefined } from "../utils/expect-defined.js";

const formats = ["compatible", "openai-plural", "openai-legacy"] as const;
function setup(format: typeof formats[number]) {
  const adapter = format === "compatible" ? new OpenAICompatibleStreamAdapter() : new OpenAIStreamAdapter();
  const gate = createToolCallExecutionGate();
  const events: NormalizedToolStreamEvent[] = [];
  const accept = (normalized: readonly NormalizedToolStreamEvent[]) => {
    events.push(...normalized);
    for (const event of normalized) gate.push(event);
  };
  const start = (index = 0) => ({ choices: [{ index, delta: format === "openai-legacy"
    ? { function_call: { name: "record", arguments: '{"message":"complete"}' } }
    : { tool_calls: [{ index: 0, id: `call_${index}`, function: { name: "record", arguments: '{"message":"complete"}' } }] } }] });
  const terminal = (index = 0) => ({ choices: [{ index, delta: {}, finish_reason: format === "openai-legacy" ? "function_call" : "tool_calls" }] });
  return { adapter, gate, events, accept, start, terminal, push: (raw: unknown) => accept(adapter.push(raw)) };
}

describe.each(formats)("%s provider error envelopes", format => {
  it.each(["before-choice-end", "after-choice-end", "after-finish"])("refuses authority when failure arrives %s", phase => {
    const { adapter, gate, events, accept, start, terminal, push } = setup(format);
    push(start());
    if (phase !== "before-choice-end") push(terminal());
    if (phase === "after-finish") {
      accept(adapter.finish());
      expect(gate.snapshot()[0]?.action).toBe("execute");
    }
    push({ error: { message: "Authored upstream failure", code: "upstream_failure" } });
    // A later successful EOF must not weaken the original error.
    accept(adapter.finish({ reason: "complete" }));
    const final = gate.finish();
    expect(final.decisions).toHaveLength(1);
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("reject");
    if (phase !== "after-finish") {
      expect(decision.evidence).toMatchObject({ streamEndReason: "provider_error", providerReason: "error" });
      expect(events.filter(e => e.type === "provider_stream_end")).toHaveLength(1);
      expect(events).toContainEqual(expect.objectContaining({ type: "provider_diagnostic", code: "E_PROVIDER_ERROR", severity: "error" }));
      expect(events.find(e => e.type === "provider_diagnostic")?.message).toBeTruthy();
    }
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it.each([{}, "upstream failure", "", false, 0])("treats a non-null error payload %j as failure", error => {
    const { adapter, gate, accept, start, terminal, push } = setup(format);
    push(start()); push(terminal()); push({ error }); accept(adapter.finish());
    const final = gate.finish();
    expect(final.decisions[0]).toMatchObject({ action: "reject", reason: "provider_error", evidence: { streamEndReason: "provider_error" } });
    expect(gate.takeDecision(expectDefined(final.decisions[0]).internalId)).toBeUndefined();
  });

  it("rejects every choice, including a still-open call", () => {
    const { adapter, gate, accept, start, terminal, push } = setup(format);
    push(start(0)); push(start(1)); push(terminal(0));
    push({ error: { message: "Provider failed" } }); accept(adapter.finish({ reason: "complete" }));
    const final = gate.finish();
    expect(final.decisions).toHaveLength(2);
    for (const decision of final.decisions) {
      expect(decision).toMatchObject({ action: "reject", evidence: { streamEndReason: "provider_error" } });
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    }
  });

  it("ignores tool data co-resident with an error and stays closed", () => {
    const { adapter, gate, events, accept, start, terminal, push } = setup(format);
    push({ ...start(), error: { message: "Provider failed" } });
    expect(events.some(e => e.type === "tool_call_start")).toBe(false);
    push(start()); push(terminal()); accept(adapter.finish({ reason: "complete" }));
    const final = gate.finish();
    expect(events[0]).toMatchObject({ type: "provider_diagnostic", code: "E_PROVIDER_ERROR" });
    const firstEnd = events.findIndex(e => e.type === "provider_stream_end");
    expect(firstEnd).toBeGreaterThanOrEqual(0);
    expect(events.slice(0, firstEnd).some(e => e.type === "tool_call_start")).toBe(false);
    expect(final.decisions.every(d => d.action !== "execute")).toBe(true);
    for (const decision of final.decisions) expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it.each([undefined, null])("keeps successful calls executable with a usage-only frame and error=%j", error => {
    const { adapter, gate, accept, start, terminal, push } = setup(format);
    push(start()); push(terminal());
    push({ choices: [], usage: { total_tokens: 12 }, error });
    expect(gate.snapshot()[0]?.action).not.toBe("execute");
    accept(adapter.finish());
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision).toMatchObject({ action: "execute", value: { message: "complete" } });
    expect(gate.takeDecision(decision.internalId)?.value).toEqual({ message: "complete" });
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });
});
