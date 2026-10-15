import { describe, expect, it } from "vitest";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";

const call = (index: number, id?: string, args = '{"message":"hello"}') => ({
  index, ...(id === undefined ? {} : { id }), function: { name: "record", arguments: args },
});
const choice = (index: number, calls: ReturnType<typeof call>[]) => ({ index, delta: { tool_calls: calls } });

describe.each([
  { name: "OpenAI-compatible", Adapter: OpenAICompatibleStreamAdapter },
  { name: "OpenAI", Adapter: OpenAIStreamAdapter },
  { name: "OpenRouter", Adapter: OpenRouterStreamAdapter },
])(
  "$name duplicate tool-call IDs within a choice", ({ Adapter }) => {
    function run(events: unknown[], choices = [0]) {
      const adapter = new Adapter();
      const gate = createToolCallExecutionGate();
      for (const raw of [...events, { choices: choices.map(index => ({ index, finish_reason: "tool_calls" })) }]) {
        for (const event of adapter.push(raw)) gate.push(event);
      }
      for (const event of adapter.finish()) gate.push(event);
      const final = gate.finish();
      const authorities = final.decisions.map(decision => gate.takeDecision(decision.internalId));
      for (const decision of final.decisions) expect(gate.takeDecision(decision.internalId)).toBeUndefined();
      return { final, authorities };
    }

    it("refuses both calls that reuse an ID at different indexes, preserving an unrelated sibling", () => {
      const { final, authorities } = run([{ choices: [choice(0, [call(0, "shared"), call(1, "shared"), call(2, "other")])] }]);
      expect(final.decisions).toHaveLength(3);
      expect(final.decisions.map(({ action, reason }) => ({ action, reason }))).toEqual([
        { action: "reject", reason: "protocol_violation" },
        { action: "reject", reason: "protocol_violation" },
        { action: "execute", reason: "complete" },
      ]);
      expect(authorities.map(Boolean)).toEqual([false, false, true]);
    });

    it("refuses collisions discovered when an ID arrives in a later chunk", () => {
      const { final, authorities } = run([
        { choices: [choice(0, [call(0, "shared"), call(1)])] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "shared" }] } }] },
      ]);
      expect(final.decisions).toHaveLength(2);
      expect(final.decisions.every(d => d.action === "reject" && d.reason === "protocol_violation")).toBe(true);
      expect(authorities).toEqual([undefined, undefined]);
    });

    it("refuses every colliding call and retains only one identity diagnostic per affected coordinate", () => {
      const { final, authorities } = run([
        { choices: [choice(0, [call(0, "shared"), call(1, "shared"), call(2, "shared")])] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "shared" }, { index: 2, id: "shared" }] } }] },
      ]);
      expect(final.decisions).toHaveLength(3);
      expect(authorities).toEqual([undefined, undefined, undefined]);
      expect(final.diagnostics.filter(d => d.code === "E_DUPLICATE_TOOL_CALL_ID")).toHaveLength(3);
    });

    it("allows the same ID in independent choices", () => {
      const { authorities } = run([{ choices: [choice(0, [call(0, "shared")]), choice(1, [call(0, "shared")])] }], [0, 1]);
      expect(authorities.map(Boolean)).toEqual([true, true]);
    });

    it("allows a repeated ID on the same coordinate across argument deltas", () => {
      const { authorities } = run([
        { choices: [choice(0, [call(0, "same", '{"message":')])] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "same", function: { arguments: '"hello"}' } }] } }] },
      ]);
      expect(authorities[0]?.value).toEqual({ message: "hello" });
    });

    it("allows distinct IDs and index-only calls", () => {
      const { authorities } = run([{ choices: [choice(0, [call(0, "first"), call(1, "second"), call(2), call(3, "")])] }]);
      expect(authorities.map(Boolean)).toEqual([true, true, true, true]);
    });
  },
);
