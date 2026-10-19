import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stepCountIs, streamText, wrapLanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { createGuardedChat } from "psj-ai-sdk";

// Authored HTTP/SSE fixtures, not samples of production traffic. Each mode gets
// the identical response bytes, schema, callbacks, model settings and answer.
const chunk = (delta, finish_reason = null) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] });
const call = (index, id, args) => ({ index, id, type: "function", function: { name: "record", arguments: args } });
const sse = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
const pair = (second = '{"message":"beta"}', secondId = "b") => [call(0, "a", '{"message":"alpha"}'), call(1, secondId, second)];
const response = (calls, finish = "tool_calls") => sse([chunk({ role: "assistant", tool_calls: calls }), chunk({}, finish)]);
const answer = sse([chunk({ content: "Recorded." }), chunk({}, "stop")]);
const schema = z.object({ message: z.string() }).strict();
const fixtures = [
  { name: "healthy", body: response(pair()), nativeCallbacks: 2, checkedCallbacks: 2 },
  { name: "duplicate-json-member", body: response(pair('{"message":"first","message":"beta"}')), nativeCallbacks: 2, checkedCallbacks: 2 },
  { name: "duplicate-original-id", body: response(pair('{"message":"beta"}', "a")), nativeCallbacks: 2, checkedCallbacks: 2 },
  { name: "schema-invalid-sibling", body: response(pair('{"message":42}')), nativeCallbacks: 1, checkedCallbacks: 0 },
  { name: "malformed-json-sibling", body: response(pair('{"message":')), nativeCallbacks: 1, checkedCallbacks: 0 },
  { name: "length-finish", body: response(pair(), "length"), nativeCallbacks: 0, checkedCallbacks: 0 },
  { name: "missing-finish", body: sse([chunk({ tool_calls: pair() })]), nativeCallbacks: 0, checkedCallbacks: 0 },
];

// A plausible application-native alternative: buffer the normalized model
// stream, then check all JSON inputs, schemas, emitted IDs and finish reason.
// It deliberately uses no PSJ code and cannot recover original wire identity.
// The fixture-specific schema/limit make this an inspectable control, not a
// general production middleware (e.g. no approvals, tool selection or retries).
function nativeBatchCheck(model, decisions) {
  return wrapLanguageModel({ model, middleware: {
    specificationVersion: "v4",
    async wrapStream({ doStream }) {
      const result = await doStream();
      const parts = [];
      try {
        for await (const part of result.stream) {
          if (parts.length >= 1024) throw new Error("native_check_part_limit");
          parts.push(part);
        }
        if (parts.some(part => part.type === "error")) throw new Error("native_check_provider_error");
        const calls = parts.filter(part => part.type === "tool-call");
        const finish = parts.findLast(part => part.type === "finish");
        if (!finish || !["stop", "tool-calls"].includes(finish.finishReason.unified)) throw new Error("native_check_finish");
        const ids = new Set();
        for (const part of calls) {
          if (part.toolName !== "record") throw new Error("native_check_tool");
          if (!part.toolCallId || ids.has(part.toolCallId)) throw new Error("native_check_id");
          ids.add(part.toolCallId);
          let input;
          try { input = JSON.parse(part.input); } catch { throw new Error("native_check_json"); }
          if (!schema.safeParse(input).success) throw new Error("native_check_schema");
        }
        decisions.push({ status: "allowed", toolCalls: calls.length });
      } catch (error) {
        decisions.push({ status: "refused", toolCalls: 0, reason: error.message });
        throw error;
      }
      return { ...result, stream: new ReadableStream({ start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      } }) };
    },
  } });
}

async function run(mode, fixture) {
  const requests = [], effects = [], decisions = [], errors = [], parts = [];
  const settings = { name: "comparison", baseURL: "https://fixture.invalid/v1", fetch: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    assert.ok(requests.length <= 2, "unexpected continuation beyond the fixed answer");
    return new Response(requests.length === 1 ? fixture.body : answer, { headers: { "content-type": "text/event-stream" } });
  } };
  const tools = { record: { inputSchema: schema, execute: async (input, context) => {
    effects.push({ id: context.toolCallId, input: structuredClone(input) });
    return { recorded: input.message };
  } } };
  const options = { tools, prompt: "Record alpha and beta, then summarize.", stopWhen: stepCountIs(3), toolCallConcurrency: 1, onError: ({ error }) => errors.push(error) };
  let result;
  if (mode === "companion") result = createGuardedChat({ ...settings, onDecision: event => decisions.push(event) })({ ...options, model: "fixture" });
  else {
    let model = createOpenAICompatible(settings).chatModel("fixture");
    if (mode === "native-check") model = nativeBatchCheck(model, decisions);
    result = streamText({ ...options, model, maxRetries: 0 });
  }
  // Refusing before model output can reject these native result promises.
  // Observe them immediately, including for the expected refusal cases.
  const textPromise = Promise.resolve(result.text).catch(() => null);
  const stepsPromise = Promise.resolve(result.steps).catch(() => []);
  for await (const part of result.fullStream) parts.push(part);
  const text = await textPromise;
  const firstStep = (await stepsPromise)[0];
  const returned = requests[1]?.messages.filter(message => message.role === "tool") ?? [];
  const invalidInputs = parts.filter(part => part.type === "tool-call" && part.invalid).length;
  const nativeReason = invalidInputs ? "invalid-tool-input" : errors.length ? "provider-error" :
    firstStep?.finishReason && !["stop", "tool-calls"].includes(firstStep.finishReason) ? `finish-${firstStep.finishReason}` : "native-normal-completion";
  const row = { fixture: fixture.name, mode, callbacks: effects.length, effects,
    requests: requests.length, continuation: returned.map(message => ({ id: message.tool_call_id, content: message.content })),
    reason: decisions[0]?.reason ?? (decisions[0]?.status === "allowed" ? "allowed" : nativeReason),
    decisions, invalidInputs, errors: errors.length, firstFinish: firstStep?.finishReason ?? null, text };
  const expectedCallbacks = mode === "native" ? fixture.nativeCallbacks : mode === "native-check" ? fixture.checkedCallbacks : fixture.name === "healthy" ? 2 : 0;
  assert.equal(row.callbacks, expectedCallbacks, `${mode}/${fixture.name} callback count`);
  assert.equal(row.requests, expectedCallbacks > 0 ? 2 : 1, `${mode}/${fixture.name} continuation count`);
  if (fixture.name === "healthy") {
    assert.equal(row.requests, 2);
    assert.deepEqual(effects, [{ id: "a", input: { message: "alpha" } }, { id: "b", input: { message: "beta" } }]);
    assert.deepEqual(returned.map(message => [message.tool_call_id, JSON.parse(message.content)]), [["a", { recorded: "alpha" }], ["b", { recorded: "beta" }]]);
    assert.equal(text, "Recorded.");
    assert.equal(errors.length, 0);
  }
  if ((mode === "companion" && fixture.name !== "healthy") || (mode === "native-check" && fixture.checkedCallbacks === 0)) {
    assert.equal(requests.length, 1, "refused group cannot continue");
    assert.equal(decisions[0]?.status, "refused");
    assert.equal(parts.filter(part => part.type === "tool-call" || part.type === "tool-result").length, 0, "refusal releases no executable call");
  }
  if (fixture.name === "duplicate-json-member" && mode !== "companion") {
    assert.equal(effects[1].input.message, "beta", "native JSON parser keeps the last duplicate member");
  }
  if (fixture.name === "duplicate-original-id" && mode !== "companion") {
    assert.equal(effects[0].id, "a");
    assert.notEqual(effects[1].id, "a", "provider replaces the repeated original wire ID");
    assert.deepEqual(returned.map(message => message.tool_call_id), effects.map(effect => effect.id));
  }
  if (mode === "native" && ["schema-invalid-sibling", "malformed-json-sibling"].includes(fixture.name)) {
    assert.equal(invalidInputs, 1);
    assert.deepEqual(returned.map(message => message.tool_call_id), ["a", "b"]);
    assert.deepEqual(JSON.parse(returned[0].content), { recorded: "alpha" });
    assert.match(returned[1].content, /InvalidToolInputError/u);
  }
  if (mode === "native" && fixture.name === "length-finish") assert.equal(firstStep?.finishReason, "length");
  if (mode === "native" && fixture.name === "missing-finish") {
    assert.equal(firstStep?.finishReason, "error");
    assert.ok(errors.length > 0);
  }
  return row;
}

function installedVersion(name) {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)));
  for (let depth = 0; depth < 6; depth++, directory = dirname(directory)) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (manifest.name === name) return manifest.version;
    } catch { /* Package manifests need not be exported. */ }
  }
  throw new Error(`Cannot locate installed manifest for ${name}`);
}
console.log(JSON.stringify({ kind: "versions", node: process.versions.node,
  packages: Object.fromEntries(["ai", "@ai-sdk/openai-compatible", "prefix-safe-json", "psj-ai-sdk", "zod"].map(name => [name, installedVersion(name)])) }));
for (const fixture of fixtures) for (const mode of ["native", "native-check", "companion"]) console.log(JSON.stringify(await run(mode, fixture)));
console.log(JSON.stringify({ kind: "summary", cases: fixtures.length * 3, status: "PASS", scope: "authored fixtures; no API request or independent adoption claim" }));
