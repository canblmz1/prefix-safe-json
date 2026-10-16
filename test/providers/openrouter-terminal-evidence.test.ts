import { describe, expect, it } from "vitest";
import { OpenRouterStreamAdapter, type OpenRouterEvent } from "../../src/providers/openrouter.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import type { StreamEndReason } from "../../src/coordinator/protocol.js";

const start = (index = 0) => ({ choices: [{ index, delta: { tool_calls: [{ index: 0,
  id: `call_${index}`, function: { name: "record", arguments: '{"message":"complete"}' } }] } }] });
const terminal = (native: string | null = "stop", reason = "tool_calls", index = 0) =>
  ({ choices: [{ index, delta: {}, finish_reason: reason, native_finish_reason: native }] });
const trailer = (native: string | null = "stop", reason = "tool_calls", index = 0): OpenRouterEvent =>
  ({ ...terminal(native, reason, index), usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
    choices: [{ ...terminal(native, reason, index).choices[0], delta: { content: "", role: "assistant" } }] });

function run(events: unknown[], adapter = new OpenRouterStreamAdapter(), callerReason?: StreamEndReason) {
  const gate = createToolCallExecutionGate();
  for (const raw of events) for (const event of adapter.push(raw)) gate.push(event);
  expect(gate.snapshot().every(decision => decision.action !== "execute")).toBe(true);
  for (const event of adapter.finish(callerReason ? { reason: callerReason } : undefined)) gate.push(event);
  const final = gate.finish();
  expect(final.decisions.length).toBeGreaterThan(0);
  return { gate, final, authorities: final.decisions.map(decision => gate.takeDecision(decision.internalId)) };
}

describe("OpenRouter terminal evidence", () => {
  // OpenRouter documents the raw reason and its repeated final usage frame:
  // https://github.com/OpenRouterTeam/docs/blob/c6d74754eefd40a9acb9ba6c9fe86683745106ae/api_reference/overview.mdx
  // https://github.com/OpenRouterTeam/docs/blob/c6d74754eefd40a9acb9ba6c9fe86683745106ae/api_reference/streaming.mdx
  // The conflicting raw/normalized token-limit shape was reported independently:
  // https://github.com/TanStack/ai/issues/1689
  it.each(["stop", "end_turn", "tool_use", "STOP", "custom_success", null])(
    "accepts one documented usage trailer with native reason %s", native => {
      const { final, gate, authorities } = run([start(), terminal(native), trailer(native)]);
      expect(final.decisions[0]).toMatchObject({ action: "execute", value: { message: "complete" } });
      expect(authorities[0]?.value).toEqual({ message: "complete" });
      expect(gate.takeDecision(expectDefined(final.decisions[0]).internalId)).toBeUndefined();
    });

  it.each(["max_output_tokens", "max_tokens", "MAX_TOKENS", "length"])(
    "refuses valid JSON when native reason is %s despite normalized success", native => {
      for (const normalized of ["tool_calls", "stop"]) {
        for (const withUsage of [false, true]) {
          const { final, authorities } = run([start(), terminal(native, normalized),
            ...(withUsage ? [trailer(native, normalized)] : [])]);
          expect(final.decisions[0]).toMatchObject({ action: "retry", evidence: { streamEndReason: "length", providerReason: native } });
          expect(authorities).toEqual([undefined]);
        }
      }
    });

  it("uses an explicit native output-limit signal even without a normalized reason", () => {
    const { final, authorities } = run([start(), { choices: [{ index: 0, delta: {},
      finish_reason: null, native_finish_reason: "max_output_tokens" }] }]);
    expect(final.decisions[0]).toMatchObject({ action: "retry", evidence: { streamEndReason: "length" } });
    expect(authorities).toEqual([undefined]);
  });

  it("does not weaken a normalized failure when the native reason is a token limit", () => {
    const { final, authorities } = run([start(), terminal("max_output_tokens", "error")]);
    expect(final.decisions[0]?.action).not.toBe("execute");
    expect(authorities).toEqual([undefined]);
  });

  it("does not synthesize normalized success from a native-only success", () => {
    const { final, authorities } = run([start(), { choices: [{ index: 0, delta: {}, native_finish_reason: "stop" }] }]);
    expect(final.decisions[0]?.action).not.toBe("execute");
    expect(authorities).toEqual([undefined]);
  });

  it("does not let caller-supplied completion weaken native truncation", () => {
    const { final, authorities } = run([start(), terminal("max_output_tokens")], new OpenRouterStreamAdapter(), "complete");
    expect(final.decisions[0]).toMatchObject({ action: "retry", evidence: { streamEndReason: "length" } });
    expect(authorities).toEqual([undefined]);
  });

  it("retains choice-local termination and the restrictive aggregate", () => {
    const { final, authorities } = run([start(0), start(1), terminal("stop", "tool_calls", 0),
      terminal("max_output_tokens", "tool_calls", 1),
      { usage: trailer().usage, choices: [...expectDefined(trailer().choices), ...expectDefined(trailer("max_output_tokens", "tool_calls", 1).choices)] }]);
    expect(final.decisions).toHaveLength(2);
    expect(final.decisions.every(decision => decision.action !== "execute")).toBe(true);
    expect(authorities).toEqual([undefined, undefined]);
  });

  it("allows a usage-bearing first terminal without needing an earlier terminal", () => {
    const { final } = run([start(), trailer()]);
    expect(final.decisions[0]?.action).toBe("execute");
  });

  it.each([{}, { content: null }, { role: "assistant" }])("accepts content-free accounting delta %j with zero usage", delta => {
    const { final } = run([start(), terminal(), { ...trailer(),
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      choices: [{ ...terminal().choices[0], delta }] }]);
    expect(final.decisions[0]?.action).toBe("execute");
  });

  it.each(["network_error", "provider_error", "unknown"] as const)("retains stronger caller failure %s", reason => {
    const { final, authorities } = run([start(), terminal("max_output_tokens")], new OpenRouterStreamAdapter(), reason);
    expect(final.decisions[0]?.evidence.streamEndReason).toBe(reason);
    expect(authorities).toEqual([undefined]);
  });

  const invalidTrailers: Array<[string, () => unknown]> = [
    ["different normalized reason", () => trailer("stop", "stop")],
    ["different native reason", () => trailer("max_output_tokens")],
    ["absent usage", () => ({ choices: trailer().choices })],
    ["empty usage", () => ({ ...trailer(), usage: {} })],
    ["invalid usage", () => ({ ...trailer(), usage: { prompt_tokens: NaN, completion_tokens: 1, total_tokens: 1 } })],
    ["infinite usage", () => ({ ...trailer(), usage: { prompt_tokens: 1, completion_tokens: Infinity, total_tokens: 1 } })],
    ["negative usage", () => ({ ...trailer(), usage: { prompt_tokens: -1, completion_tokens: 1, total_tokens: 0 } })],
    ["string usage", () => ({ ...trailer(), usage: { prompt_tokens: "10", completion_tokens: 1, total_tokens: 11 } })],
    ["missing usage count", () => ({ ...trailer(), usage: { completion_tokens: 1, total_tokens: 11 } })],
    ["missing delta", () => ({ ...trailer(), choices: [{ ...terminal().choices[0], delta: undefined }] })],
    ["null delta", () => ({ ...trailer(), choices: [{ ...terminal().choices[0], delta: null }] })],
    ["array delta", () => ({ ...trailer(), choices: [{ ...terminal().choices[0], delta: [] }] })],
    ["wrong role", () => ({ ...trailer(), choices: [{ ...terminal().choices[0], delta: { content: "", role: "user" } }] })],
    ["additional delta field", () => ({ ...trailer(), choices: [{ ...terminal().choices[0], delta: { role: "assistant", unrecognized: "" } }] })],
    ["text payload", () => ({ ...trailer(), choices: [{ ...terminal().choices[0], delta: { content: "late text" } }] })],
    ["tool payload", () => ({ ...trailer(), choices: [{ ...terminal().choices[0], delta: expectDefined(start().choices[0]).delta }] })],
    ["choice error", () => ({ ...trailer(), choices: [{ ...expectDefined(trailer().choices?.[0]), error: { message: "late failure" } }] })],
    ["duplicate choice", () => ({ ...trailer(), choices: [expectDefined(trailer().choices?.[0]), expectDefined(trailer().choices?.[0])] })],
    ["missing choice index", () => ({ ...trailer(), choices: [{ ...expectDefined(trailer().choices?.[0]), index: undefined }] })],
    ["negative choice index", () => ({ ...trailer(), choices: [{ ...expectDefined(trailer().choices?.[0]), index: -1 }] })],
  ];
  it.each(invalidTrailers)("does not hide a duplicate terminal with %s", (_name, makeTrailer) => {
    const { final, authorities } = run([start(), terminal(), makeTrailer()]);
    expect(final.decisions[0]?.action).not.toBe("execute");
    expect(authorities).toEqual([undefined]);
  });

  it("does not hide a second accounting trailer", () => {
    const { final, authorities } = run([start(), terminal(), trailer(), trailer()]);
    expect(final.decisions[0]?.action).not.toBe("execute");
    expect(authorities).toEqual([undefined]);
  });

  it("checks every choice in a multi-choice accounting frame", () => {
    const { final, authorities } = run([start(0), start(1), terminal("stop", "tool_calls", 0), terminal("stop", "tool_calls", 1),
      { usage: trailer().usage, choices: [expectDefined(trailer().choices?.[0]),
        { ...terminal("stop", "tool_calls", 1).choices[0], delta: { content: "", role: "user" } }] }]);
    expect(final.decisions).toHaveLength(2);
    expect(final.decisions.every(decision => decision.action !== "execute")).toBe(true);
    expect(authorities).toEqual([undefined, undefined]);
  });

  it("does not hide tool arguments arriving after the accepted trailer", () => {
    const { final, authorities } = run([start(), terminal(), trailer(), start()]);
    expect(final.decisions[0]?.action).not.toBe("execute");
    expect(authorities).toEqual([undefined]);
  });

  it("keeps the generic OpenAI-compatible duplicate-terminal rule strict", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const raw of [start(), terminal(), trailer()]) for (const event of adapter.push(raw)) gate.push(event);
    for (const event of adapter.finish()) gate.push(event);
    expect(gate.finish().decisions[0]?.action).not.toBe("execute");
  });

  it("preserves existing non-array choices handling", () => {
    expect(new OpenRouterStreamAdapter().push({ choices: {} })).toEqual([]);
  });

  it("emits its final stream boundary once", () => {
    const adapter = new OpenRouterStreamAdapter();
    adapter.push(start());
    adapter.push(terminal());
    expect(adapter.finish().filter(event => event.type === "provider_stream_end")).toHaveLength(1);
    expect(adapter.finish()).toEqual([]);
  });

  it.each([undefined, null, false, 42, "not-an-envelope"])("reports malformed envelope %j", raw => {
    expect(new OpenRouterStreamAdapter().push(raw)).toEqual([{
      type: "provider_diagnostic", sequence: 1, provider: "openrouter",
      code: "E_PROVIDER_EVENT_MALFORMED", severity: "error", message: "Raw event is not an object",
    }]);
  });

  it.each(["fixture unavailable", { message: "fixture unavailable" }])("preserves provider error evidence %j", error => {
    const adapter = new OpenRouterStreamAdapter();
    expect(adapter.push({ error })).toEqual([
      { type: "provider_diagnostic", sequence: 1, provider: "openrouter", code: "E_PROVIDER_ERROR",
        severity: "error", message: typeof error === "string" ? error : JSON.stringify(error) },
      { type: "provider_stream_end", sequence: 2, provider: "openrouter", reason: "provider_error", providerReason: "error" },
    ]);
    expect(adapter.finish()).toEqual([]);
  });
});
