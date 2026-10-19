import assert from "node:assert/strict";
import test from "node:test";
import { dynamicTool, streamText, stepCountIs, jsonSchema } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGuardedChat } from "../dist/index.js";

const chunk = (delta, finish_reason = null) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] });
const frame = event => `data: ${JSON.stringify(event)}\n\n`;
const call = (name, id) => frame(chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: "{}" } }] })) + frame(chunk({}, "tool_calls")) + "data: [DONE]\n\n";
const answer = frame(chunk({ content: "Done." })) + frame(chunk({}, "stop")) + "data: [DONE]\n\n";
const schema = jsonSchema({ type: "object", properties: {}, additionalProperties: false });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 30));

test("runtime-defined tools retain native execution, original IDs and continuation", async () => {
  for (const guarded of [false, true]) {
    const requests = [], effects = [];
    const settings = { name: "fixture", baseURL: "https://fixture.invalid/v1", fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(requests.length === 1 ? call("record", "dynamic-id") : answer, { headers: { "content-type": "text/event-stream" } });
    } };
    const tools = { record: dynamicTool({ inputSchema: schema, execute: async (input, context) => {
      effects.push({ input, id: context.toolCallId });
      return "recorded";
    } }) };
    const options = { tools, prompt: "Record", stopWhen: stepCountIs(3) };
    const result = guarded ? createGuardedChat(settings)({ ...options, model: "fixture" }) :
      streamText({ ...options, model: createOpenAICompatible(settings).chatModel("fixture"), maxRetries: 0 });
    await result.consumeStream();
    assert.deepEqual(effects, [{ input: {}, id: "dynamic-id" }]);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].tools[0].type, "function");
    assert.deepEqual(requests[1].messages.filter(m => m.role === "tool").map(m => m.tool_call_id), ["dynamic-id"]);
    assert.equal((await result.steps)[0].toolCalls[0].dynamic, true);
    assert.equal(await result.text, "Done.");
  }
});

for (const problem of ["invalid_schema", "unknown_tool", "duplicate_id"]) test(`runtime-defined tools have zero effects for a batch with ${problem}`, async () => {
  let effects = 0;
  const decisions = [];
  const sibling = { index: 1, id: problem === "duplicate_id" ? "first-id" : "second-id", type: "function",
    function: { name: problem === "unknown_tool" ? "unregistered" : "record", arguments: problem === "invalid_schema" ? '{"extra":true}' : "{}" } };
  const body = frame(chunk({ tool_calls: [
    { index: 0, id: "first-id", type: "function", function: { name: "record", arguments: "{}" } }, sibling,
  ] })) + frame(chunk({}, "tool_calls")) + "data: [DONE]\n\n";
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", onDecision: event => decisions.push(event),
    fetch: async () => new Response(body, { headers: { "content-type": "text/event-stream" } }) });
  await chat({ model: "fixture", tools: { record: dynamicTool({ inputSchema: schema, execute: async () => { effects++; } }) }, prompt: "Record", onError() {} }).consumeStream();
  assert.equal(effects, 0);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].status, "refused");
});

for (const policy of [{ needsApproval: true }, { onInputAvailable() {} }]) test(`runtime-defined tools still reject ${Object.keys(policy)[0]}`, () => {
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1" });
  assert.throws(() => chat({ model: "fixture", tools: { record: dynamicTool({ inputSchema: schema, execute: async () => "done", ...policy }) }, prompt: "Record" }), /no input hooks or approval continuation/u);
});

test("ordinary instructions and sampling settings do not require rewriting an SDK call", async () => {
  let request;
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", fetch: async (_url, init) => {
    request = JSON.parse(init.body);
    return new Response(answer, { headers: { "content-type": "text/event-stream" } });
  } });
  const result = chat({ model: "fixture", tools: {}, prompt: "Hello", instructions: "Be concise.", reasoning: "none",
    topP: 0.9, presencePenalty: 0, frequencyPenalty: 0, stopSequences: ["END"], seed: 0 });
  await result.consumeStream();
  assert.equal(await result.text, "Done.");
  assert.equal(request.messages[0].role, "system");
  assert.equal(request.messages[0].content, "Be concise.");
  assert.equal(request.top_p, 0.9);
  assert.equal(request.seed, 0);
  assert.equal(request.presence_penalty, 0);
  assert.deepEqual(request.stop, ["END"]);
});

test("prepareStep activates registered tools and retains messages, original IDs and continuation", async () => {
  const requests = [], effects = [], steps = [], finishes = [];
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const body = [call("enable", "enable-id"), call("record", "record-id"), answer][requests.length - 1];
    assert.ok(body, "unexpected continuation");
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  } });
  let enabled = false;
  const tools = {
    enable: { inputSchema: schema, execute: async () => { enabled = true; effects.push("enable"); return "enabled"; } },
    record: { inputSchema: schema, execute: async (_input, context) => { effects.push(context.toolCallId); return "recorded"; } },
  };
  const result = chat({ model: "fixture", tools, prompt: "Enable then record", activeTools: ["enable"], stopWhen: stepCountIs(4),
    onStepFinish: step => finishes.push(step.toolCalls.map(call => call.toolCallId)),
    prepareStep: async ({ stepNumber, messages }) => {
      steps.push(stepNumber);
      return { activeTools: enabled ? ["record"] : ["enable"], messages, instructions: "Keep the original result IDs." };
    } });
  await result.consumeStream();
  assert.deepEqual(steps, [0, 1, 2]);
  assert.deepEqual(effects, ["enable", "record-id"]);
  assert.deepEqual(finishes, [["enable-id"], ["record-id"], []]);
  assert.deepEqual(requests.slice(0, 2).map(r => r.tools.map(t => t.function.name)), [["enable"], ["record"]]);
  assert.deepEqual(requests[2].messages.filter(m => m.role === "tool").map(m => m.tool_call_id), ["enable-id", "record-id"]);
  assert.equal(await result.text, "Done.");
});

for (const field of ["model", "tools", "toolsContext", "runtimeContext", "experimental_sandbox", "unknown"]) test(`prepareStep cannot replace ${field} or bypass the guarded transport`, async () => {
  let requests = 0, effects = 0;
  const errors = [];
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", fetch: async () => {
    requests++;
    return new Response(call("record", "record-id"), { headers: { "content-type": "text/event-stream" } });
  } });
  const result = chat({ model: "fixture", tools: { record: { inputSchema: schema, execute: async () => { effects++; } } }, prompt: "Record",
    prepareStep: () => ({ [field]: "replacement", activeTools: ["record"] }), onError: ({ error }) => errors.push(error) });
  await result.consumeStream();
  assert.equal(requests, 0);
  assert.equal(effects, 0);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].message.includes(`Unsupported prepareStep option: ${field}`));
});

test("a provider cannot execute a registered tool disabled by prepareStep", async () => {
  let effects = 0;
  const events = [];
  const tools = { record: { inputSchema: schema, execute: async () => { effects++; } } };
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", onDecision: event => events.push(event),
    fetch: async (_url, init) => {
      const request = JSON.parse(init.body);
      assert.ok(!request.tools || request.tools.length === 0);
      return new Response(call("record", "record-id"), { headers: { "content-type": "text/event-stream" } });
    } });
  await chat({ model: "fixture", tools, prompt: "Do not record", prepareStep: () => ({ activeTools: [] }), onError() {} }).consumeStream();
  assert.equal(effects, 0);
  assert.equal(events[0].status, "refused");
});

test("routing query parameters and usage selection reach the configured provider", async () => {
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", queryParams: { route: "local" }, includeUsage: true,
    fetch: async (url, init) => {
      assert.equal(new URL(url).searchParams.get("route"), "local");
      assert.equal(JSON.parse(init.body).stream_options.include_usage, true);
      return new Response(answer, { headers: { "content-type": "text/event-stream" } });
    } });
  const result = chat({ model: "fixture", tools: {}, prompt: "Hello" });
  await result.consumeStream();
  assert.equal(await result.text, "Done.");
});

test("unsupported provider settings are reported instead of silently discarded", () => {
  assert.throws(() => createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", transformRequestBody: body => body }), /Unsupported guarded provider setting: transformRequestBody/u);
});

test("provider metadata cannot silently replace the configured model", async () => {
  let requests = 0;
  const errors = [];
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", fetch: async () => {
    requests++;
    return new Response(answer, { headers: { "content-type": "text/event-stream" } });
  } });
  await chat({ model: "fixture", tools: {}, prompt: "Hello", providerOptions: { fixture: { model: "another-model" } },
    onError: ({ error }) => errors.push(error) }).consumeStream();
  assert.equal(requests, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, "model_mismatch");
});

for (const phase of ["validator", "recorder"]) test(`abort interrupts a pending application ${phase} without waiting for it`, { timeout: 5000 }, async () => {
  const started = deferred(), release = deferred(), controller = new AbortController();
  let effects = 0, finished = false, original;
  const decisions = [];
  const tools = { record: { inputSchema: phase === "validator" ? jsonSchema(schema.jsonSchema, { validate: async value => {
    started.resolve(); await release.promise; return { success: true, value };
  } }) : schema, execute: async () => { effects++; return "done"; } } };
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1",
    fetch: async () => (original = new Response(call("record", "record-id"), { headers: { "content-type": "text/event-stream" } })),
    onDecision: event => decisions.push(event),
    ...(phase === "recorder" ? { onCapture: async () => { started.resolve(); await release.promise; } } : {}),
  });
  const result = chat({ model: "fixture", tools, prompt: "Record", abortSignal: controller.signal, onError() {} });
  const consuming = Promise.resolve(result.consumeStream()).catch(() => {}).then(() => { finished = true; });
  try {
    await started.promise;
    controller.abort();
    await tick();
    assert.equal(finished, true, "abort must settle the stream while the application callback remains pending");
    assert.equal(effects, 0);
    assert.equal(original.body.locked, false, "abort must release the original reader without waiting for application callbacks");
    assert.deepEqual(decisions, [{ status: "refused", toolCalls: 0, reason: "aborted" }]);
  } finally {
    release.resolve();
    await consuming;
  }
  await tick();
  assert.equal(effects, 0, "late callback completion must not restore authority");
});
