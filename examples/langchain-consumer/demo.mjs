// Compare the installed ChatOpenAI parser with PSJ on the same raw SSE fixture.
// This is a mock transport, not a production LangChain adapter or a live API call.
import assert from "node:assert/strict";
import process from "node:process";
import { ChatOpenAI } from "@langchain/openai";
import { concat } from "@langchain/core/utils/stream";
import { OpenAICompatibleStreamAdapter, createToolCallExecutionGate } from "prefix-safe-json";

// Keep a user's optional tracing environment from exporting the mock fixture.
process.env.LANGSMITH_TRACING = "false";
process.env.LANGCHAIN_TRACING_V2 = "false";

const schema = {
  type: "object", required: ["message"], additionalProperties: false,
  properties: { message: { type: "string" } },
};

async function run({ name, argumentsText, finishReason, expectedEffects }) {
  const rawEvents = [];
  for (let offset = 0; offset < argumentsText.length; offset += 8) {
    const call = { index: 0, function: { arguments: argumentsText.slice(offset, offset + 8) } };
    if (offset === 0) Object.assign(call, { id: "call_1", type: "function", function: { name: "record", ...call.function } });
    rawEvents.push({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model",
      choices: [{ index: 0, delta: { ...(offset === 0 ? { role: "assistant" } : {}), tool_calls: [call] }, finish_reason: null }] });
  }
  rawEvents.push({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model",
    choices: [{ index: 0, delta: {}, finish_reason: finishReason }] });
  const sse = rawEvents.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  const model = new ChatOpenAI({
    model: "fixture-model", apiKey: "fixture-key-not-a-real-credential", maxRetries: 0,
    configuration: {
      baseURL: "https://fixture.invalid/v1",
      fetch: async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }),
    },
  });
  let message;
  for await (const chunk of await model.stream("Run the harmless fixture")) {
    message = message ? concat(message, chunk) : chunk;
  }

  // The fixture's original provider envelopes feed PSJ unchanged. Never
  // rebuild these from LangChain's parsed/repaired message.tool_calls.
  const adapter = new OpenAICompatibleStreamAdapter();
  const gate = createToolCallExecutionGate(undefined, undefined, { record: schema });
  for (const raw of rawEvents) for (const event of adapter.push(raw)) gate.push(event);
  for (const event of adapter.finish()) gate.push(event);
  const [decision] = gate.finish().decisions;
  assert.ok(decision);
  const dispatched = [];
  const authority = gate.takeDecision(decision.internalId);
  if (authority) dispatched.push(authority.value);
  assert.equal(dispatched.length, expectedEffects);
  if (expectedEffects) assert.deepEqual(dispatched, [{ message: "hello" }]);
  assert.equal(gate.takeDecision(decision.internalId), undefined);
  assert.equal(message.response_metadata.finish_reason, finishReason);
  assert.ok(Array.isArray(message.tool_calls), "Expected an AI message carrying the SDK's tool-call projection");
  assert.equal(message.tool_calls.length, 1);
  assert.deepEqual(message.tool_calls[0].args, { message: name === "mid-string-token-limit" ? "hel" : "hello" });
  assert.deepEqual(message.invalid_tool_calls, []);
  console.log(JSON.stringify({ scenario: name, langchainToolCalls: message.tool_calls,
    langchainInvalidToolCalls: message.invalid_tool_calls, finishReason,
    decision: decision.action, reason: decision.reason, effects: dispatched.length }));
}

await run({ name: "complete", argumentsText: '{"message":"hello"}', finishReason: "tool_calls", expectedEffects: 1 });
await run({ name: "mid-string-token-limit", argumentsText: '{"message":"hel', finishReason: "length", expectedEffects: 0 });
await run({ name: "valid-json-token-limit", argumentsText: '{"message":"hello"}', finishReason: "length", expectedEffects: 0 });
console.log("PASS: effects 1/0/0; raw evidence owns dispatch; authority is one-shot.");
console.log("Mock transport only. Your application must preserve original provider evidence before LangChain parsing.");
