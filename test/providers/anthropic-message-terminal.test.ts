import { describe, expect, it } from "vitest";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";

function completeCall() {
  const adapter = new AnthropicStreamAdapter();
  const gate = createToolCallExecutionGate();
  const push = (event: unknown) => {
    const events = adapter.push(event);
    for (const normalized of events) gate.push(normalized);
    return events;
  };
  push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "record" } });
  push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"message":"hello"}' } });
  push({ type: "content_block_stop", index: 0 });
  return { adapter, gate, push };
}

describe("Anthropic message completion boundary", () => {
  it.each(["tool_use", "end_turn"])("confirms %s only at message_stop, not at stop_reason", (stopReason) => {
    const { gate, push } = completeCall();
    expect(push({ type: "message_delta", delta: { stop_reason: stopReason } })).toEqual([]);
    push({ type: "ping" });
    push({ type: "message_delta", usage: { output_tokens: 12 } });
    push({ type: "message_stop" });
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    expect(gate.takeDecision(decision.internalId)?.value).toEqual({ message: "hello" });
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("does not let caller complete metadata invent a missing message_stop", () => {
    const { adapter, gate, push } = completeCall();
    push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
    for (const event of adapter.finish({ reason: "complete" })) gate.push(event);
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("does not confirm a message_stop with no stop_reason", () => {
    const { gate, push } = completeCall();
    push({ type: "message_stop" });
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it.each(["tool_use", "max_tokens"])("rejects a second stop_reason (%s) before message_stop", (secondReason) => {
    const { gate, push } = completeCall();
    push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
    push({ type: "message_delta", delta: { stop_reason: secondReason } });
    push({ type: "message_stop" });
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("protocol_violation");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("rejects new content blocks between stop_reason and message_stop", () => {
    const { gate, push } = completeCall();
    push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
    push({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t2", name: "record" } });
    push({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } });
    push({ type: "content_block_stop", index: 1 });
    push({ type: "message_stop" });
    const { decisions } = gate.finish();
    expect(decisions).toHaveLength(2);
    for (const decision of decisions) {
      expect(decision.action).toBe("reject");
      expect(decision.reason).toBe("protocol_violation");
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    }
  });

  it("revokes unconsumed authority after a duplicate message_stop", () => {
    const { gate, push } = completeCall();
    push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
    push({ type: "message_stop" });
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    push({ type: "message_stop" });
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("preserves token-limit evidence on EOF without granting authority", () => {
    const { adapter, gate, push } = completeCall();
    push({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
    const events = adapter.finish();
    expect(events).toMatchObject([{ type: "provider_stream_end", reason: "length" }]);
    for (const event of events) gate.push(event);
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("withholds authority even if the caller omits adapter.finish after EOF", () => {
    const { gate, push } = completeCall();
    push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });
});
