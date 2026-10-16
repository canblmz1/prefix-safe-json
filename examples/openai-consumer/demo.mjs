// Authored SSE fixtures through the installed official SDK, not a live provider.
import assert from "node:assert/strict";
import OpenAI from "openai";
import { OpenAICompatibleStreamAdapter, createToolCallExecutionGate } from "prefix-safe-json";

const schema = {
  type: "object", required: ["message"], additionalProperties: false,
  properties: { message: { type: "string" } },
};
const complete = '{"message":"hello"}';

function chunk(delta, finishReason = null) {
  return { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }] };
}

async function run({ name, argumentsText = complete, finishReason = "tool_calls",
  ids = ["call_1"], lateArguments = false, expectedEffects, limitation = false }) {
  const envelopes = [];
  for (let offset = 0; offset < argumentsText.length; offset += 5) {
    envelopes.push(chunk({ tool_calls: ids.map((id, index) => ({
      index, ...(offset === 0 ? { id, type: "function" } : {}),
      function: { ...(offset === 0 ? { name: "record" } : {}), arguments: argumentsText.slice(offset, offset + 5) },
    })) }));
  }
  if (finishReason !== null) envelopes.push(chunk({}, finishReason));
  if (lateArguments) envelopes.push(chunk({ tool_calls: [{ index: 0, function: { arguments: " " } }] }));
  const sse = envelopes.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
  const bytes = new TextEncoder().encode(sse);
  let requests = 0;
  const client = new OpenAI({
    apiKey: "fixture-key-not-a-real-credential", baseURL: "https://fixture.invalid/v1", maxRetries: 0,
    fetch: async () => {
      requests++;
      // Fragment SSE frames independently of the tool-argument deltas.
      const body = new ReadableStream({ start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 13) controller.enqueue(bytes.slice(offset, offset + 13));
        controller.close();
      } });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    },
  });
  const stream = await client.chat.completions.create({
    model: "fixture-model", messages: [{ role: "user", content: "Run the harmless counter" }], stream: true,
    tools: [{ type: "function", function: { name: "record", description: "Increment a counter", parameters: schema } }],
  });
  const adapter = new OpenAICompatibleStreamAdapter();
  const gate = createToolCallExecutionGate(undefined, undefined, { record: schema });
  const received = [];
  for await (const event of stream) {
    received.push(event);
    for (const normalized of adapter.push(event)) gate.push(normalized);
  }
  assert.equal(requests, 1);
  assert.deepEqual(received, envelopes, "The real SDK must preserve every supplied event, including late evidence");
  for (const normalized of adapter.finish()) gate.push(normalized);
  const final = gate.finish();
  assert.ok(final.decisions.length > 0, "A refusal must not pass merely because the call vanished");
  const effects = [];
  for (const decision of final.decisions) {
    const authority = gate.takeDecision(decision.internalId);
    if (authority) effects.push(authority.value);
    assert.equal(gate.takeDecision(decision.internalId), undefined);
  }
  assert.equal(effects.length, expectedEffects, name);
  for (const value of effects) assert.deepEqual(value, { message: "hello" });
  console.log(JSON.stringify({ scenario: name, effects: effects.length,
    decisions: final.decisions.map(({ action, reason }) => ({ action, reason })),
    ...(limitation ? { limitation: "Valid bytes plus a falsely successful provider terminal cannot reveal upstream truncation" } : {}),
  }));
}

await run({ name: "complete", expectedEffects: 1 });
await run({ name: "valid-json-token-limit", finishReason: "length", expectedEffects: 0 });
await run({ name: "malformed-json-success-terminal", argumentsText: '{"message":"hel', expectedEffects: 0 });
await run({ name: "missing-finish-reason", finishReason: null, expectedEffects: 0 });
await run({ name: "distinct-call-ids", ids: ["call_1", "call_2"], expectedEffects: 2 });
await run({ name: "duplicate-call-id", ids: ["call_1", "call_1"], expectedEffects: 0 });
await run({ name: "arguments-after-finish-before-done", lateArguments: true, expectedEffects: 0 });
// Same observable evidence as the complete control: PSJ cannot recover a hidden
// upstream length stop once a server replaces it with successful termination.
await run({ name: "misreported-success-valid-json", expectedEffects: 1, limitation: true });
console.log("Installed OpenAI SDK trial passed, including the provider-honesty limitation. No live requests were made.");
