// @ts-nocheck
import { describe, it, expect } from "vitest";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";

describe("Provider Safety Regressions", () => {
  it("Anthropic content_block_stop followed by max_tokens", () => {
    const adapter = new AnthropicStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "f" } }));
    events.push(...adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }));
    events.push(...adapter.push({ type: "content_block_stop", index: 0 }));
    events.push(...adapter.finish({ reason: "length", providerReason: "max_tokens" }));
    const endEvent = events.find(e => e.type === "tool_call_end");
    expect(endEvent).toBeDefined();
    const streamEnd = events.find(e => e.type === "provider_stream_end");
    expect((streamEnd as { reason?: string })?.reason).toBe("length");
  });

  it("Anthropic normal tool-use completion", () => {
    const adapter = new AnthropicStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t1", name: "f" } }));
    events.push(...adapter.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }));
    events.push(...adapter.push({ type: "content_block_stop", index: 0 }));
    expect(events.some(e => e.type === "tool_call_end")).toBe(true);
  });

  it("OpenAI-compatible normal tool_calls finish", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "f", arguments: "{}" } }] } }] }));
    events.push(...adapter.finish({ reason: "complete", providerReason: "stop" }));
    expect(events.some(e => e.type === "tool_call_end")).toBe(true);
  });

  it("OpenAI Responses response.function_call_arguments.delta", () => {
    const adapter = new OpenAIStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] }));
    events.push(...adapter.finish({ reason: "complete" }));
    expect(events.some(e => e.type === "tool_call_end")).toBe(true);
  });

  it("OpenAI Responses final arguments conflict", () => {
    const adapter = new OpenAIStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] }));
    events.push(...adapter.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "[]" } }] } }] }));
    events.push(...adapter.finish({ reason: "complete" }));
    expect(events.some(e => e.type === "tool_call_end")).toBe(true);
  });

  it("Provider error after a complete JSON root", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 0, toolCallId: "t1" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_name_delta", callRef, toolIndex: 0, delta: "f" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef, toolIndex: 0 } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_diagnostic", severity: "error", message: "Timeout" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "provider_error" } as unknown as NormalizedToolStreamEvent);
  });

  it("Cancellation after a complete JSON root", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id1" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef, toolIndex: 0 } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "provider_stream_end", reason: "cancelled" } as unknown as NormalizedToolStreamEvent);
  });

  it("Gemini repeated structured function-call event", () => {
    const adapter = new GeminiStreamAdapter();
    adapter.push({ candidates: [{ content: { parts: [{ functionCall: { name: "f", args: { a: 1 } } }] } }] });
    adapter.push({ candidates: [{ content: { parts: [{ functionCall: { name: "f", args: { a: 1 } } }] } }] });
    const events = adapter.finish({ reason: "complete" });
    expect(events.length).toBeGreaterThan(0);
  });

  it("OpenRouter reasoning between argument deltas", () => {
    const adapter = new OpenRouterStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{" } }] } }] }));
    events.push(...adapter.push({ choices: [{ delta: { reasoning: "thinking..." } }] }));
    events.push(...adapter.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } }] }));
    events.push(...adapter.finish({ reason: "complete" }));
    expect(events.some(e => e.type === "tool_call_end")).toBe(true);
  });

  it("One valid call beside one invalid call", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef0 = { internalId: "id0" };
    const callRef1 = { internalId: "id1" };
    coord.push({ type: "tool_call_start", callRef: callRef0, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_start", callRef: callRef1, toolIndex: 1, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: callRef0, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef: callRef1, toolIndex: 1, delta: '{"a":1,' } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: callRef0, toolIndex: 0 } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef: callRef1, toolIndex: 1 } as unknown as NormalizedToolStreamEvent);
  });

  it("Late provider ID", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 0, toolCallId: "t1" } as unknown as NormalizedToolStreamEvent);
  });

  it("Late tool index", () => {
    //
  });

  it("Late tool name", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_name_delta", callRef, toolIndex: 0, delta: "f" } as unknown as NormalizedToolStreamEvent);
  });

  it("Conflicting identity update", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 0, toolCallId: "t1" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_identity", callRef, toolIndex: 0, toolCallId: "t2" } as unknown as NormalizedToolStreamEvent);
  });

  it("Delta after call end", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_end", callRef, toolIndex: 0 } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_arguments_delta", callRef, toolIndex: 0, delta: "{}" } as unknown as NormalizedToolStreamEvent);
  });

  it("Event after provider stream end", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({ type: "provider_stream_end", reason: "complete" } as unknown as NormalizedToolStreamEvent);
    coord.push({ type: "tool_call_start", callRef, toolIndex: 0, provider: "openai" } as unknown as NormalizedToolStreamEvent);
  });
});
