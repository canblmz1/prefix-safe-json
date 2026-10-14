// Two interleaved calls, checked through the installed SDK's actual fullStream.
import assert from "node:assert/strict";
import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createAiSdkExecutionGuard, createAiSdkExecutionLock } from "prefix-safe-json";
import { fromStandardSchema } from "prefix-safe-json/standard-schema";

async function runBatch(truncated) {
  const schema = z.object({ message: z.string() }).strict();
  const callbacks = { execute: 0, onInputStart: 0, onInputDelta: 0, onInputAvailable: 0 };
  const tools = createAiSdkExecutionLock({ record_message: {
    description: "Record a harmless in-memory message", inputSchema: schema,
    execute: async () => { callbacks.execute += 1; return "unused"; },
    onInputStart: () => { callbacks.onInputStart += 1; },
    onInputDelta: () => { callbacks.onInputDelta += 1; },
    onInputAvailable: () => { callbacks.onInputAvailable += 1; },
  } });
  const parts = [
    { type: "stream-start", warnings: [] },
    { type: "tool-input-start", id: "first", toolName: "record_message" },
    { type: "tool-input-delta", id: "first", delta: '{"message":"' },
    { type: "tool-input-start", id: "second", toolName: "record_message" },
    { type: "tool-input-delta", id: "second", delta: '{"message":"' },
    { type: "tool-input-delta", id: "first", delta: 'first"}' },
    { type: "tool-input-end", id: "first" },
    { type: "tool-call", toolCallId: "first", toolName: "record_message", input: '{"message":"first"}' },
    { type: "tool-input-delta", id: "second", delta: truncated ? "second" : 'second"}' },
    { type: "tool-input-end", id: "second" },
    // A plausible projection cannot repair the second call's raw evidence.
    { type: "tool-call", toolCallId: "second", toolName: "record_message", input: '{"message":"second"}' },
    { type: "finish", finishReason: { unified: truncated ? "length" : "tool-calls", raw: truncated ? "length" : "tool_calls" },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 } } },
  ];
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({
    start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); },
  }) }) });
  const guard = createAiSdkExecutionGuard({ validators: { record_message: fromStandardSchema(schema) } });
  const raw = { first: "", second: "" };
  const dispatched = [];
  for await (const part of streamText({ model, tools, prompt: "Exercise two interleaved harmless calls" }).fullStream) {
    if (part.type === "tool-input-delta") raw[part.id] += part.delta;
    guard.push(part);
  }
  assert.deepEqual(raw, { first: '{"message":"first"}', second: truncated ? '{"message":"second' : '{"message":"second"}' });
  assert.deepEqual(callbacks, { execute: 0, onInputStart: 0, onInputDelta: 0, onInputAvailable: 0 });
  assert.equal(dispatched.length, 0);
  const { decisions } = guard.finish();
  assert.equal(decisions.length, 2);
  for (const decision of decisions) {
    const authority = guard.takeDecision(decision.internalId);
    if (authority) dispatched.push(authority.value);
    assert.equal(guard.takeDecision(decision.internalId), undefined);
    if (truncated) assert.notEqual(decision.action, "execute");
  }
  assert.equal(dispatched.length, truncated ? 0 : 2);
  if (!truncated) assert.deepEqual(dispatched, [{ message: "first" }, { message: "second" }]);
  console.log(JSON.stringify({ scenario: truncated ? "interleaved-batch-token-limit" : "interleaved-batch-complete",
    decisions: decisions.map(({ action, reason }) => ({ action, reason })), effects: dispatched.length, sdkCallbacks: callbacks }));
}

await runBatch(false);
await runBatch(true);
console.log("PASS: interleaved batch effects 2/0; a length-limited step grants no call authority.");
