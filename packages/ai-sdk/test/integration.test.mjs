import assert from "node:assert/strict";
import test from "node:test";
import { jsonSchema, stepCountIs, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { createGuardedChat, GuardRefusal } from "../dist/index.js";

const chunk = (delta, finish_reason = null) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] });
const call = (index, id, value) => ({ index, id, type: "function", function: { name: "record", arguments: value } });
const sse = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
const answer = sse([chunk({ role: "assistant", content: "Recorded." }), chunk({}, "stop")]);
const complete = sse([chunk({ role: "assistant", tool_calls: [call(0, "a", '{"message":"alpha"}'), call(1, "b", '{"message":"beta"}')] }), chunk({}, "tool_calls")]);
const schema = z.object({ message: z.string() }).strict();

function fixture(bodies, extra = {}) {
  const requests = [], effects = [], events = [], errors = [];
  const tools = { record: { inputSchema: schema, execute: async (value, context) => { effects.push({ input: structuredClone(value), id: context.toolCallId }); return { recorded: value.message }; } } };
  const fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const body = bodies[requests.length - 1];
    assert.notEqual(body, undefined, "unexpected continuation");
    if (typeof body === "function") return body(init);
    const bytes = new TextEncoder().encode(body);
    let offset = 0;
    return new Response(new ReadableStream({ pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + 7)); offset = Math.min(offset + 7, bytes.length);
    } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
  };
  const settings = { name: "fixture", baseURL: "https://fixture.invalid/v1", apiKey: "not-a-real-key", fetch, onDecision: event => events.push(event), ...extra };
  return { requests, effects, events, errors, tools, fetch, settings,
    options: { model: "fixture", tools, prompt: "Record two values.", stopWhen: stepCountIs(3), onError: event => errors.push(event.error) } };
}

async function consume(result) {
  const parts = [];
  for await (const part of result.fullStream) parts.push(part);
  return parts;
}

test("ordinary execute callbacks and native result continuation work without a manual loop", async () => {
  const f = fixture([complete, answer]);
  const result = createGuardedChat(f.settings)({ ...f.options, toolCallConcurrency: 1 });
  await consume(result);
  assert.equal(await result.text, "Recorded.");
  assert.deepEqual(f.effects, [{ input: { message: "alpha" }, id: "a" }, { input: { message: "beta" }, id: "b" }]);
  assert.equal(f.requests.length, 2);
  const returned = f.requests[1].messages.filter(m => m.role === "tool");
  assert.deepEqual(returned.map(m => [m.tool_call_id, JSON.parse(m.content)]), [["a", { recorded: "alpha" }], ["b", { recorded: "beta" }]]);
  assert.equal(f.errors.length, 0);
  assert.deepEqual(f.events.map(e => [e.status, e.toolCalls]), [["allowed", 2], ["allowed", 0]]);
});

const refusals = {
  "complete JSON at token limit": sse([chunk({ tool_calls: [call(0, "a", '{"message":"alpha"}')] }), chunk({}, "length")]),
  "duplicate original IDs": sse([chunk({ tool_calls: [call(0, "a", '{"message":"alpha"}'), call(1, "a", '{"message":"beta"}')] }), chunk({}, "tool_calls")]),
  "valid and malformed siblings": sse([chunk({ tool_calls: [call(0, "a", '{"message":"alpha"}'), call(1, "b", '{"message":')] }), chunk({}, "tool_calls")]),
  "schema-invalid sibling": sse([chunk({ tool_calls: [call(0, "a", '{"message":"alpha"}'), call(1, "b", '{"message":42}')] }), chunk({}, "tool_calls")]),
  "missing choice terminal": sse([chunk({ tool_calls: [call(0, "a", '{"message":"alpha"}')] })]),
  "late provider error": complete.replace("data: [DONE]", 'data: {"error":{"message":"private-provider-body"}}\n\ndata: [DONE]'),
  "evidence after DONE": complete + 'data: {"error":{}}\n\n',
  "unfinished event after finish": complete.replace("data: [DONE]\n\n", 'data: {"error":{}}'),
  "malformed event": complete.replace("data: [DONE]", "data: NOT-JSON\n\ndata: [DONE]"),
};
for (const [name, body] of Object.entries(refusals)) test(`${name}: whole batch has no effects or continuation`, async () => {
  const f = fixture([body, answer]);
  const parts = await consume(createGuardedChat(f.settings)(f.options));
  assert.equal(f.effects.length, 0);
  assert.equal(f.requests.length, 1);
  assert.ok(parts.some(p => p.type === "error"));
  assert.ok(f.events.some(e => e.status === "refused"));
  assert.equal(JSON.stringify(f.events).includes("private-provider-body"), false);
});

test("native SDK executes duplicate wire calls; the raw-response check stops both callbacks", async () => {
  const body = refusals["duplicate original IDs"];
  const native = fixture([body, answer]);
  const provider = createOpenAICompatible(native.settings);
  await consume(streamText({ ...native.options, model: provider.chatModel("fixture"), maxRetries: 0 }));
  assert.equal(native.effects.length, 2);
  assert.deepEqual(native.effects.map(effect => effect.input.message).sort(), ["alpha", "beta"]);
  const guarded = fixture([body, answer]);
  await consume(createGuardedChat(guarded.settings)(guarded.options));
  assert.equal(guarded.effects.length, 0);
});

test("application validators run once per call, before any sibling executes", async () => {
  const f = fixture([complete, answer]);
  let validations = 0;
  f.tools.record.inputSchema = jsonSchema({ type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false }, { validate: async value => {
    validations++;
    assert.equal(f.effects.length, 0);
    return { success: true, value };
  } });
  await consume(createGuardedChat(f.settings)(f.options));
  assert.equal(validations, 2);
  assert.equal(f.effects.length, 2);
});

test("a transformed second sibling refuses the first too", async () => {
  const f = fixture([complete, answer]);
  f.tools.record.inputSchema = schema.transform(value => value.message === "beta" ? { message: "changed" } : value);
  // Zod's JSON Schema converter rejects transforms. A custom Schema retains
  // the same provider shape while exercising the actual application transform.
  f.tools.record.inputSchema = jsonSchema({ type: "object", properties: { message: { type: "string" } }, required: ["message"] }, { validate: value => ({ success: true, value: value.message === "beta" ? { message: "changed" } : value }) });
  await consume(createGuardedChat(f.settings)(f.options));
  assert.deepEqual(f.effects, []);
  assert.equal(f.requests.length, 1);
  assert.equal(f.events[0].reason, "transformed_input");
});

test("interleaved index-only argument deltas preserve IDs and inputs", async () => {
  const body = sse([chunk({ tool_calls: [call(0, "a", '{"message":"al'), call(1, "b", '{"message":"be')] }), chunk({ tool_calls: [{ index: 1, function: { arguments: 'ta"}' } }, { index: 0, function: { arguments: 'pha"}' } }] }), chunk({}, "tool_calls")]);
  const f = fixture([body, answer]);
  await consume(createGuardedChat(f.settings)(f.options));
  assert.deepEqual(f.effects.map(e => e.input.message).sort(), ["alpha", "beta"]);
  assert.equal(f.requests.length, 2);
});

test("read failure after a valid terminal releases no callback", async () => {
  const f = fixture([() => {
    let sent = false;
    return new Response(new ReadableStream({ pull(c) {
      if (!sent) { sent = true; c.enqueue(new TextEncoder().encode(complete)); }
      else c.error(new Error("private transport payload"));
    } }), { headers: { "content-type": "text/event-stream" } });
  }]);
  await consume(createGuardedChat(f.settings)(f.options));
  assert.equal(f.effects.length, 0);
  assert.equal(f.events[0].reason, "transport_error");
});

test("bounded buffering cancels an oversized response", async () => {
  let cancelled = false;
  const f = fixture([() => new Response(new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(128)); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } })], { maxResponseBytes: 100 });
  await consume(createGuardedChat(f.settings)(f.options));
  assert.equal(cancelled, true);
  assert.equal(f.effects.length, 0);
  assert.equal(f.events[0].reason, "response_limit");
});

test("concurrent invocations cannot consume another invocation's authority", async () => {
  const chatSettings = { name: "fixture", baseURL: "https://fixture.invalid/v1", fetch: async (_url, init) => {
    const request = JSON.parse(init.body);
    const first = request.messages.length === 1;
    const message = request.messages[0].content;
    return new Response(first ? sse([chunk({ tool_calls: [call(0, "shared-id", JSON.stringify({ message }))] }), chunk({}, "tool_calls")]) : answer, { headers: { "content-type": "text/event-stream" } });
  } };
  const chat = createGuardedChat(chatSettings);
  await Promise.all(Array.from({ length: 12 }, async (_, i) => {
    const f = fixture([]);
    await consume(chat({ ...f.options, prompt: String(i) }));
    assert.deepEqual(f.effects, [{ id: "shared-id", input: { message: String(i) } }]);
  }));
});

test("unsupported SDK replacement and tool hook paths fail before a request", () => {
  const f = fixture([]);
  assert.throws(() => createGuardedChat(f.settings)({ ...f.options, prepareStep: () => { throw new Error("must not run"); } }), /Unsupported guarded option/u);
  assert.throws(() => createGuardedChat(f.settings)({ ...f.options, tools: { record: { ...f.tools.record, onInputAvailable() {} } } }), /no input hooks/u);
  assert.equal(f.requests.length, 0);
  assert.equal(f.effects.length, 0);
  assert.equal(new GuardRefusal("test").code, "PSJ_REFUSED");
});

test("a valid terminal cannot release callbacks while the original body is still open", async () => {
  let close;
  let observed;
  const arrived = new Promise(resolve => { observed = resolve; });
  const f = fixture([() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(complete));
    close = () => controller.close();
    observed();
  } }), { headers: { "content-type": "text/event-stream" } }), answer]);
  const pending = consume(createGuardedChat(f.settings)(f.options));
  await arrived;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(f.effects, []);
  assert.deepEqual(f.events, []);
  close();
  await pending;
  assert.equal(f.effects.length, 2);
});

test("abort during buffering cancels the body and releases no callback", async () => {
  let observed;
  const arrived = new Promise(resolve => { observed = resolve; });
  let cancelled = false;
  const f = fixture([() => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(complete));
    observed();
  }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } })]);
  const controller = new AbortController();
  const pending = consume(createGuardedChat(f.settings)({ ...f.options, abortSignal: controller.signal }));
  await arrived;
  controller.abort();
  await pending;
  assert.equal(cancelled, true);
  assert.deepEqual(f.effects, []);
  assert.equal(f.requests.length, 1);
});

test("invalid UTF-8 is refused, while BOM/CRLF and split Unicode remain intact", async () => {
  const invalid = fixture([() => new Response(new Uint8Array([0xff]), { headers: { "content-type": "text/event-stream" } })]);
  await consume(createGuardedChat(invalid.settings)(invalid.options));
  assert.deepEqual(invalid.effects, []);
  assert.equal(invalid.events[0].reason, "invalid_utf8");
  const f = fixture(["\uFEFF" + complete.replaceAll("alpha", "\u03b1").replaceAll("\n", "\r\n"), answer]);
  await consume(createGuardedChat(f.settings)(f.options));
  assert.deepEqual(f.effects.map(effect => effect.input.message), ["\u03b1", "beta"]);
});
