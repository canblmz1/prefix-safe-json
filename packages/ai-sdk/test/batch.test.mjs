import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, stepCountIs } from "ai";
import { createGuardedChat } from "../dist/index.js";

const schema = { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false };
const chunk = (delta, finish_reason = null, extra = {}) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture",
  choices: [{ index: 0, delta, finish_reason }], ...extra });
const frames = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
const call = (index, id = `call-${index}`, args = JSON.stringify({ message: `message-${index}` })) => ({ index, id, type: "function", function: { name: "record", arguments: args } });
const batch = calls => frames([chunk({ tool_calls: calls }), chunk({}, "tool_calls")]);
const answer = frames([chunk({ content: "Recorded." }), chunk({}, "stop")]);

async function run(body, settings = {}) {
  const requests = [], effects = [], events = [], errors = [], validated = [];
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", ...settings,
    onDecision: event => events.push(event), fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      assert.ok(requests.length <= 2, "unexpected continuation");
      return new Response(requests.length === 1 ? body : answer, { headers: { "content-type": "text/event-stream" } });
    } });
  const tools = { record: { inputSchema: jsonSchema(schema, { validate: input => {
    validated.push(input);
    return { success: true, value: input };
  } }), execute: async (input, context) => { effects.push({ id: context.toolCallId, input }); return input.message; } } };
  const result = chat({ model: "fixture", tools, prompt: "Record", stopWhen: stepCountIs(3), onError: ({ error }) => errors.push(error) });
  const parts = [];
  for await (const part of result.fullStream) parts.push(part);
  return { requests, effects, events, errors, validated, parts, text: await Promise.resolve(result.text).catch(() => undefined) };
}

for (const count of [127, 128]) test(`${count} valid calls keep original identities, execute once and continue`, async () => {
  const calls = Array.from({ length: count }, (_, index) => call(index));
  const result = await run(batch(calls));
  assert.equal(result.effects.length, count);
  assert.equal(result.validated.length, count);
  assert.equal(result.requests.length, 2);
  assert.deepEqual(result.effects.map(effect => effect.id), calls.map(call => call.id));
  assert.deepEqual(result.requests[1].messages.filter(message => message.role === "tool").map(message => message.tool_call_id), calls.map(call => call.id));
  assert.deepEqual(result.events.map(event => [event.status, event.toolCalls]), [["allowed", count], ["allowed", 0]]);
  assert.equal(result.errors.length, 0);
  assert.equal(result.text, "Recorded.");
});

const refusals = {
  "schema-invalid second sibling": { calls: [call(0), call(1, "second", '{"message":42}')], reason: "schema_invalid" },
  "129 calls with valid unaccounted final call": { calls: Array.from({ length: 129 }, (_, index) => call(index)), reason: "resource_limit" },
  "129 calls with invalid unaccounted final call": { calls: Array.from({ length: 129 }, (_, index) => call(index, `call-${index}`, index === 128 ? '{"message":42}' : undefined)), reason: "resource_limit" },
  "negative provider index": { calls: [call(0), call(-1, "second")], reason: "unaccounted_call" },
  "fractional provider index": { calls: [call(0), call(1.5, "second")], reason: "unaccounted_call" },
  "missing provider index": { calls: [call(0), { ...call(1), index: undefined }], reason: "unaccounted_call" },
  "missing original call ID": { calls: [call(0), { ...call(1), id: undefined }], reason: "unresolved_call" },
  "empty original call ID": { calls: [call(0), { ...call(1), id: "" }], reason: "unresolved_call" },
};
for (const [name, fixture] of Object.entries(refusals)) test(`${name}: zero callbacks, no released SDK calls, no continuation`, async () => {
  const result = await run(batch(fixture.calls));
  assert.equal(result.effects.length, 0, "no sibling may execute when any part of the original batch is unaccounted for");
  assert.equal(result.requests.length, 1, "a refused original response must not create a result-continuation request");
  assert.equal(result.parts.filter(part => part.type === "tool-call" || part.type === "tool-result").length, 0, "the SDK must receive no executable call authority");
  assert.ok(result.parts.some(part => part.type === "error"));
  assert.deepEqual(result.events, [{ status: "refused", toolCalls: 0, reason: fixture.reason }]);
  assert.equal(result.validated.length, 0, "wire batch errors must refuse before application validation or one-shot authority consumption");
});

test("a configured one-call limit refuses the entire wire batch before returning authority", async () => {
  // Exercise the shipped private wire module without workspace source aliases.
  const { inspectWire } = await import(new URL("./wire.js", import.meta.resolve("psj-ai-sdk")));
  const bytes = body => new TextEncoder().encode(body);
  let released;
  assert.throws(() => { released = inspectWire(bytes(batch([call(0), call(1)])), { record: schema }, { maxToolCalls: 1 }); }, error => error.reason === "resource_limit");
  assert.equal(released, undefined, "no gate or one-shot authority escapes the refused group");
  const healthy = inspectWire(bytes(batch([call(0)])), { record: schema }, { maxToolCalls: 1 });
  assert.equal(healthy.gate.takeDecision(healthy.decisions[0].internalId)?.toolCallId, "call-0");
  assert.equal(healthy.gate.takeDecision(healthy.decisions[0].internalId), undefined);
});

test("supported provider extension fields retain healthy execution and continuation", async () => {
  const body = frames([chunk({ tool_calls: [call(0)] }, null, { provider_extension: { cache_hit: true } }), chunk({}, "tool_calls", { usage: { total_tokens: 4 } })]);
  const result = await run(body);
  assert.equal(result.effects.length, 1);
  assert.equal(result.requests.length, 2);
  assert.equal(result.events[0].status, "allowed");
});
