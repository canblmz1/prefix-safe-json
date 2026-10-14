// The installed official SDK parses mock SSE; its original events feed PSJ.
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicStreamAdapter, createToolCallExecutionGate } from "prefix-safe-json";

const schema = {
  type: "object", required: ["message"], additionalProperties: false,
  properties: { message: { type: "string" } },
};

async function run({ name, argumentsText, stopReason, messageStop = true, lateDelta = false, expectedEffects }) {
  const rawEvents = [
    { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant",
      model: "fixture-model", content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0,
      content_block: { type: "tool_use", id: "toolu_fixture", name: "record", input: {} } },
  ];
  for (let offset = 0; offset < argumentsText.length; offset += 8) {
    rawEvents.push({ type: "content_block_delta", index: 0,
      delta: { type: "input_json_delta", partial_json: argumentsText.slice(offset, offset + 8) } });
  }
  rawEvents.push({ type: "content_block_stop", index: 0 });
  rawEvents.push({ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: 100 } });
  if (messageStop) rawEvents.push({ type: "message_stop" });
  if (lateDelta) rawEvents.push({ type: "content_block_delta", index: 0,
    delta: { type: "input_json_delta", partial_json: '{"message":"late"}' } });

  const bytes = new TextEncoder().encode(rawEvents.map(event =>
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""));
  const client = new Anthropic({
    apiKey: "fixture-key-not-a-real-credential", maxRetries: 0, baseURL: "https://fixture.invalid",
    fetch: async () => new Response(new ReadableStream({
      start(controller) {
        // Deliberately split frames across transport chunks; use the SDK parser.
        for (let offset = 0; offset < bytes.length; offset += 41) controller.enqueue(bytes.slice(offset, offset + 41));
        controller.close();
      },
    }), { headers: { "content-type": "text/event-stream" } }),
  });
  const stream = await client.messages.create({ model: "fixture-model", max_tokens: 100,
    messages: [{ role: "user", content: "Record a harmless message" }], stream: true });
  const adapter = new AnthropicStreamAdapter();
  const gate = createToolCallExecutionGate(undefined, undefined, { record: schema });
  const received = [];
  for await (const raw of stream) {
    received.push(raw);
    for (const event of adapter.push(raw)) gate.push(event);
  }
  // Drain the actual SDK stream before dispatch, including any late evidence.
  // Do not synthesize terminal evidence from JSON validity or a caller flag.
  assert.deepEqual(received, rawEvents);
  for (const event of adapter.finish()) gate.push(event);
  const [decision] = gate.finish().decisions;
  assert.ok(decision);
  const dispatched = [];
  const authority = gate.takeDecision(decision.internalId);
  if (authority) dispatched.push(authority.value);
  assert.equal(dispatched.length, expectedEffects);
  if (expectedEffects) assert.deepEqual(dispatched, [{ message: "hello" }]);
  assert.equal(gate.takeDecision(decision.internalId), undefined);
  console.log(JSON.stringify({ scenario: name, sdkEventTypes: received.map(event => event.type),
    decision: decision.action, reason: decision.reason, effects: dispatched.length,
    structurallyComplete: decision.evidence.structurallyComplete,
    terminalConfirmed: decision.evidence.terminalConfirmed }));
}

await run({ name: "complete", argumentsText: '{"message":"hello"}', stopReason: "tool_use", expectedEffects: 1 });
await run({ name: "mid-string-token-limit", argumentsText: '{"message":"hel', stopReason: "max_tokens", expectedEffects: 0 });
await run({ name: "valid-json-token-limit", argumentsText: '{"message":"hello"}', stopReason: "max_tokens", expectedEffects: 0 });
await run({ name: "missing-message-stop", argumentsText: '{"message":"hello"}', stopReason: "tool_use", messageStop: false, expectedEffects: 0 });
await run({ name: "post-terminal-delta", argumentsText: '{"message":"hello"}', stopReason: "tool_use", lateDelta: true, expectedEffects: 0 });
console.log("PASS: effects 1/0/0/0/0; official SDK events retain raw evidence; authority is one-shot.");
console.log("Mock transport only. Running this demo alone is not integration in your project or a live-provider check.");
