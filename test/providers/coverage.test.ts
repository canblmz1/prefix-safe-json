/**
 * Provider adapter coverage tests — targeting uncovered branches identified
 * by v8 coverage: anthropic error events, gemini MAX_TOKENS/SAFETY/OTHER,
 * openai Responses API full flow, openrouter error path,
 * openai-compatible post-finish event, coordinator limits and edge cases.
 */
import { describe, it, expect } from "vitest";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { DefaultToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";

// ─────────────────────────────────────────────────────────────────────────────
// Anthropic
// ─────────────────────────────────────────────────────────────────────────────
describe("AnthropicStreamAdapter — uncovered branches", () => {
  it("handles non-object raw event", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push(null);
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it("ignores unknown event types silently", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_start", message: {} });
    expect(events).toHaveLength(0);
  });

  it("handles error event type", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "error", error: { type: "overloaded_error" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("provider_error");
  });

  it("handles message_delta with max_tokens stop_reason", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_delta", delta: { stop_reason: "max_tokens" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("length");
  });

  it("handles message_delta with unknown stop_reason", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_delta", delta: { stop_reason: "some_future_reason" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
  });

  it("handles message_delta with tool_use stop_reason", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "message_delta", delta: { stop_reason: "tool_use" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("complete");
  });

  it("ignores events after finished", () => {
    const a = new AnthropicStreamAdapter();
    a.push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    const events = a.push({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } });
    expect(events).toHaveLength(0);
  });

  it("handles content_block_start with non-tool_use type", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "content_block_start", index: 0, content_block: { type: "text", id: "id1", name: "unused" } });
    expect(events).toHaveLength(0);
  });

  it("handles content_block_delta with wrong delta type", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } });
    expect(events).toHaveLength(0);
  });

  it("finish() emits stream_end if not yet finished", () => {
    const a = new AnthropicStreamAdapter();
    const events = a.finish({ reason: "cancelled" });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("cancelled");
  });

  it("finish() is idempotent after already finished", () => {
    const a = new AnthropicStreamAdapter();
    a.push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
    const events = a.finish({ reason: "cancelled" });
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gemini
// ─────────────────────────────────────────────────────────────────────────────
describe("GeminiStreamAdapter — uncovered branches", () => {
  it("handles non-object event", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push("bad string");
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it("handles candidate with MAX_TOKENS finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "MAX_TOKENS" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("length");
  });

  it("handles candidate with SAFETY finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "SAFETY" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("handles candidate with RECITATION finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "RECITATION" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("handles candidate with OTHER finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "OTHER" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("handles candidate with unknown finishReason", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{ finishReason: "SOMETHING_NEW" }],
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("unknown");
  });

  it("handles functionCall without args", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({
      candidates: [{
        content: { parts: [{ functionCall: { name: "my_tool" } }] },
      }],
    });
    // Should have start + end but no arguments_delta
    const types = events.map((e) => e.type);
    expect(types).toContain("tool_call_start");
    expect(types).toContain("tool_call_end");
    expect(types).not.toContain("tool_call_arguments_delta");
  });

  it("handles empty candidates array", () => {
    const g = new GeminiStreamAdapter();
    const events = g.push({ candidates: [] });
    expect(events).toHaveLength(0);
  });

  it("ignores events after finished", () => {
    const g = new GeminiStreamAdapter();
    g.push({ candidates: [{ finishReason: "STOP" }] });
    const events = g.push({ candidates: [{ finishReason: "STOP" }] });
    expect(events).toHaveLength(0);
  });

  it("finish() returns stream_end event", () => {
    const g = new GeminiStreamAdapter();
    const events = g.finish({ reason: "network_error" });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("network_error");
  });

  it("finish() is idempotent", () => {
    const g = new GeminiStreamAdapter();
    g.push({ candidates: [{ finishReason: "STOP" }] });
    const events = g.finish();
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI — Responses API
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenAIStreamAdapter — Responses API", () => {
  it("handles response.output_item.added with function_call type", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: "item-1", call_id: "call-abc", name: "search" },
    });
    expect(events[0]?.type).toBe("tool_call_start");
  });

  it("handles response.function_call_arguments.delta", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    const events = a.push({
      type: "response.function_call_arguments.delta",
      item_id: "item-1",
      delta: '{"q":',
    });
    expect(events[0]?.type).toBe("tool_call_arguments_delta");
  });

  it("handles response.function_call_arguments.done with no prior deltas", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    const events = a.push({
      type: "response.function_call_arguments.done",
      item_id: "item-1",
      arguments: '{"q":"test"}',
    });
    expect(events[0]?.type).toBe("tool_call_arguments_delta");
  });

  it("handles response.function_call_arguments.done with conflicting accumulated", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    a.push({ type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"q":"' });
    const events = a.push({
      type: "response.function_call_arguments.done",
      item_id: "item-1",
      arguments: '{"q":"different"}',
    });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect(diag).toBeDefined();
    expect((diag as {code: string})?.code).toBe("E_FINAL_ARGUMENTS_CONFLICT");
  });

  it("handles response.output_item.done", () => {
    const a = new OpenAIStreamAdapter();
    a.push({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "item-1", call_id: "call-1", name: "search" } });
    const events = a.push({ type: "response.output_item.done", item: { id: "item-1" } });
    expect(events[0]?.type).toBe("tool_call_end");
  });

  it("handles response.completed", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ type: "response.completed", response: { status: "completed" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("complete");
  });

  it("handles response.incomplete with max_output_tokens as a length/truncation signal", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("length");
    expect((end as { providerReason?: string })?.providerReason).toBe("max_output_tokens");
  });

  it("handles response.incomplete with content_filter as a content-filtered diagnostic", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
    });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect((diag as { code?: string })?.code).toBe("E_CONTENT_FILTERED");
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("cancelled");
    expect((end as { providerReason?: string })?.providerReason).toBe("content_filter");
  });

  it("handles response.incomplete with an unrecognized reason by failing closed as unknown", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.incomplete",
      response: { status: "incomplete", incomplete_details: { reason: "some_future_reason" } },
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
    expect((end as { providerReason?: string })?.providerReason).toBe("some_future_reason");
  });

  it("handles response.incomplete with missing incomplete_details by failing closed as unknown", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ type: "response.incomplete", response: { status: "incomplete" } });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("unknown");
    expect((end as { providerReason?: string })?.providerReason).toBe("incomplete");
  });

  it("handles error type in Responses API", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ type: "error" });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("provider_error");
  });

  it("handles response.failed as a provider_error (was previously dropped entirely)", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({
      type: "response.failed",
      response: { status: "failed", error: { code: "server_error", message: "boom" } },
    });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.type).toBe("provider_stream_end");
    expect((end as { reason?: string })?.reason).toBe("provider_error");
    expect((end as { providerReason?: string })?.providerReason).toBe("server_error");
  });

  it("handles legacy function_call format name delta", () => {
    const a = new OpenAIStreamAdapter();
    // first push creates the call
    a.push({ choices: [{ delta: { function_call: { name: "search" } } }] });
    // second push with name delta (rare but valid)
    const events = a.push({ choices: [{ delta: { function_call: { name: "_v2" } } }] });
    expect(events[0]?.type).toBe("tool_call_name_delta");
  });

  it("handles legacy function_call finish_reason cancelled", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push({ choices: [{ finish_reason: "cancelled" }] });
    const end = events.find((e) => e.type === "provider_stream_end");
    expect(end?.reason).toBe("cancelled");
  });

  it("handles non-object event", () => {
    const a = new OpenAIStreamAdapter();
    const events = a.push(42);
    expect(events[0]?.type).toBe("provider_diagnostic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAI Compatible
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenAICompatibleStreamAdapter — uncovered branches", () => {
  it("emits diagnostic on event after stream end", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ finish_reason: "tool_calls" }] });
    const events = a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] } }] });
    expect(events[0]?.type).toBe("provider_diagnostic");
    expect((events[0] as { code?: string })?.code).toBe("W_EVENT_AFTER_STREAM_END");
  });

  it("handles tool_call with missing index", () => {
    const a = new OpenAICompatibleStreamAdapter();
    const events = a.push({ choices: [{ delta: { tool_calls: [{ function: { name: "test" } }] } }] });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect(diag).toBeDefined();
  });

  it("handles late identity update (toolCallId on existing index)", () => {
    const a = new OpenAICompatibleStreamAdapter();
    // First: start with no id
    a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "test" } }] } }] });
    // Then: send id separately
    const events = a.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call-xyz" }] } }] });
    expect(events[0]?.type).toBe("tool_call_identity");
  });

  it("handles name delta on known index", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "search" } }] } }] });
    const events = a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "_v2" } }] } }] });
    const nameDelta = events.find((e) => e.type === "tool_call_name_delta");
    expect(nameDelta).toBeDefined();
  });

  it("finish() emits end events for known source keys", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "search", arguments: '{"' } }] } }] });
    const events = a.finish({ reason: "network_error" });
    expect(events.some((e) => e.type === "tool_call_end")).toBe(true);
    expect(events.some((e) => e.type === "provider_stream_end")).toBe(true);
  });

  it("finish() is idempotent", () => {
    const a = new OpenAICompatibleStreamAdapter();
    a.push({ choices: [{ finish_reason: "tool_calls" }] });
    const events = a.finish();
    expect(events).toHaveLength(0);
  });

  it("handles non-object event", () => {
    const a = new OpenAICompatibleStreamAdapter();
    const events = a.push(null);
    expect(events[0]?.type).toBe("provider_diagnostic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter
// ─────────────────────────────────────────────────────────────────────────────
describe("OpenRouterStreamAdapter — uncovered branches", () => {
  it("handles non-object event", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.push("bad");
    expect(events[0]?.type).toBe("provider_diagnostic");
  });

  it("handles chunk with error field", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.push({ error: "rate_limit_exceeded" });
    expect(events.some((e) => e.type === "provider_diagnostic")).toBe(true);
    expect(events.some((e) => e.type === "provider_stream_end")).toBe(true);
  });

  it("handles chunk with error as object", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.push({ error: { code: 429, message: "Too many requests" } });
    const diag = events.find((e) => e.type === "provider_diagnostic");
    expect(diag).toBeDefined();
    expect((diag as { message: string })?.message).toContain("429");
  });

  it("ignores events after finished", () => {
    const r = new OpenRouterStreamAdapter();
    r.push({ error: "rate_limit" });
    const events = r.push({ choices: [{ delta: { tool_calls: [] } }] });
    expect(events).toHaveLength(0);
  });

  it("finish() delegates to compatible adapter", () => {
    const r = new OpenRouterStreamAdapter();
    const events = r.finish({ reason: "cancelled" });
    expect(events.some((e) => e.type === "provider_stream_end")).toBe(true);
  });

  it("finish() is idempotent after error", () => {
    const r = new OpenRouterStreamAdapter();
    r.push({ error: "some error" });
    const events = r.finish();
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator — uncovered branches
// ─────────────────────────────────────────────────────────────────────────────
describe("DefaultToolCallStreamCoordinator — uncovered branches", () => {
  function makeStartEvent(sourceKey: string, name = "search") {
    return {
      type: "tool_call_start" as const,
      sequence: 1,
      provider: "openai-compatible" as const,
      callRef: { sourceKey },
      name,
    };
  }

  function makeArgsEvent(sourceKey: string, delta: string) {
    return {
      type: "tool_call_arguments_delta" as const,
      sequence: 2,
      provider: "openai-compatible" as const,
      callRef: { sourceKey },
      delta,
    };
  }

  function makeEndEvent(sourceKey: string) {
    return {
      type: "tool_call_end" as const,
      sequence: 3,
      provider: "openai-compatible" as const,
      callRef: { sourceKey },
      reason: "complete" as const,
    };
  }

  function makeStreamEnd(reason = "complete" as const) {
    return {
      type: "provider_stream_end" as const,
      sequence: 99,
      provider: "openai-compatible" as const,
      reason,
    };
  }

  it("rejects events after stream end", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStreamEnd());
    const result = c.push(makeStartEvent("k1"));
    expect(result.accepted).toBe(false);
  });

  it("handles duplicate tool_call_start for same sourceKey", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1"));
    c.push(makeStartEvent("k1")); // duplicate
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect(diag).toBeDefined();
  });

  it("handles maxToolCalls limit", () => {
    const c = new DefaultToolCallStreamCoordinator({ maxToolCalls: 1 });
    c.push(makeStartEvent("k1"));
    c.push(makeStartEvent("k2")); // exceeds limit
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect(diag).toBeDefined();
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_COORDINATOR_LIMIT_CALLS");
  });

  it("handles maxNormalizedEvents limit", () => {
    const c = new DefaultToolCallStreamCoordinator({ maxNormalizedEvents: 2 });
    c.push(makeStartEvent("k1"));
    c.push(makeArgsEvent("k1", "{}"));
    const result = c.push(makeEndEvent("k1")); // 3rd event
    expect(result.accepted).toBe(false);
  });

  it("handles identity update with conflicting toolCallId", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push({ ...makeStartEvent("k1"), toolCallId: "id-1" });
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolCallId: "id-2", // conflicts
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_PROVIDER_IDENTITY_CONFLICT");
  });

  it("handles identity update with conflicting toolIndex", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push({ ...makeStartEvent("k1"), toolIndex: 0 });
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolIndex: 1, // conflicts
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_PROVIDER_INDEX_CONFLICT");
  });

  it("handles name_delta after call ended", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1"));
    c.push(makeEndEvent("k1"));
    c.push(makeStreamEnd());
    c.drainEvents();
    // try name delta after stream ended
    const result = c.push({
      type: "tool_call_name_delta",
      sequence: 5,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      delta: "_extra",
    });
    expect(result.accepted).toBe(false); // stream is finished
  });

  it("handles argument_delta after call ended", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1"));
    c.push(makeEndEvent("k1"));
    c.push(makeStreamEnd());
    const result = c.push(makeArgsEvent("k1", "{}"));
    expect(result.accepted).toBe(false); // stream is finished
  });

  it("handles tool_call_end for call with no name → E_TOOL_NAME_MISSING", () => {
    const c = new DefaultToolCallStreamCoordinator();
    // Start with no name
    c.push({
      type: "tool_call_start",
      sequence: 1,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
    });
    c.push(makeArgsEvent("k1", "{}"));
    c.push(makeEndEvent("k1"));
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_TOOL_NAME_MISSING");
  });

  it("handles stream end with open (not closed) call", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push(makeArgsEvent("k1", '{"q":"test"}'));
    // No tool_call_end before stream ends
    c.push(makeStreamEnd());
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as {diagnostic: {code: string}})?.diagnostic?.code).toBe("E_STREAM_ENDED_WITH_OPEN_CALL");
  });

  it("handles cancelled stream end reason", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push(makeArgsEvent("k1", '{"q":"test"}'));
    c.push({ type: "provider_stream_end", sequence: 99, provider: "openai-compatible", reason: "cancelled" });
    const events = c.drainEvents();
    const finished = events.find((e) => e.type === "tool_call_finished");
    expect((finished as { outcome: string })?.outcome).toBe("cancelled");
  });

  it("handles provider_diagnostic event with callRef", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push({
      type: "provider_diagnostic",
      sequence: 5,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      code: "E_SOMETHING",
      severity: "warning",
      message: "Provider-level warning",
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect(diag).toBeDefined();
  });

  it("snapshot() reflects current state", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    const snap = c.snapshot();
    expect(snap.calls).toHaveLength(1);
    expect(snap.calls[0]?.name).toBe("search");
    expect(snap.isFinished).toBe(false);
  });

  it("finish() with reason closes open calls", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1", "search"));
    c.push(makeArgsEvent("k1", '{"q":"test"}'));
    c.push(makeEndEvent("k1")); // close it
    const result = c.finish({ reason: "complete" });
    expect(result.calls).toHaveLength(1);
  });

  it("identity update on unknown sourceKey is a no-op", () => {
    const c = new DefaultToolCallStreamCoordinator();
    // No start for "k-unknown"
    c.push({
      type: "tool_call_identity",
      sequence: 1,
      provider: "openai-compatible",
      callRef: { sourceKey: "k-unknown" },
      toolCallId: "id-x",
    });
    const events = c.drainEvents();
    // no diagnostic expected for unknown identity with no start
    expect(events).toHaveLength(0);
  });

  it("tool_name exceeding limit marks call invalid", () => {
    const c = new DefaultToolCallStreamCoordinator({ maxToolNameBytes: 5 });
    c.push(makeStartEvent("k1"));
    c.push({
      type: "tool_call_name_delta",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      delta: "a_very_long_tool_name_exceeding_limit",
    });
    const events = c.drainEvents();
    const diag = events.find((e) => e.type === "coordinator_diagnostic");
    expect((diag as { diagnostic: { code: string } })?.diagnostic?.code).toBe("E_TOOL_NAME_LIMIT");
  });

  it("identity update providing new toolCallId emits identity_updated event", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push(makeStartEvent("k1")); // no toolCallId or toolIndex initially
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolCallId: "new-id",
    });
    const events = c.drainEvents();
    const identity = events.find((e) => e.type === "tool_call_identity_updated");
    expect(identity).toBeDefined();
  });

  it("identity update for same id and index is a no-op (no changed event)", () => {
    const c = new DefaultToolCallStreamCoordinator();
    c.push({ ...makeStartEvent("k1"), toolCallId: "same-id", toolIndex: 0 });
    c.drainEvents(); // clear
    c.push({
      type: "tool_call_identity",
      sequence: 2,
      provider: "openai-compatible",
      callRef: { sourceKey: "k1" },
      toolCallId: "same-id",
      toolIndex: 0,
    });
    const events = c.drainEvents();
    // No identity_updated since nothing changed
    const identity = events.find((e) => e.type === "tool_call_identity_updated");
    expect(identity).toBeUndefined();
  });
});
