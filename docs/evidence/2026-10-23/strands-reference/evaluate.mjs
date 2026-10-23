// Finite discovery check for Strands #4158; not a production adapter.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { Agent, tool } from "@strands-agents/sdk";
import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import { OpenAIStreamAdapter, createToolCallExecutionGate } from "prefix-safe-json";
import { fromStandardSchema } from "prefix-safe-json/standard-schema";
import { z } from "zod";

const output = process.env.PSJ_RESULT ?? "result.json";
assert.ok(!existsSync(output), "Use a new output path; do not overwrite previous evidence");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const usage = { input_tokens: 10, output_tokens: 50, total_tokens: 60 };
const created = { type: "response.created", response: { id: "resp_1" } };
const added = { type: "response.output_item.added",
  item: { type: "function_call", id: "fc_1", call_id: "call_1", name: "write_file" } };
const incomplete = { type: "response.incomplete", response: {
  incomplete_details: { reason: "max_output_tokens" }, usage } };
const partial = [created, added, { type: "response.function_call_arguments.delta", item_id: "fc_1",
  delta: '{"path": "notes.md", "content": "Lorem ipsum dol' }, incomplete];
const completeArguments = JSON.stringify({ path: "notes.md", content: "Saved notes." });
const fixtures = {
  healthy: [created, added,
    { type: "response.function_call_arguments.delta", item_id: "fc_1", delta: completeArguments },
    { type: "response.function_call_arguments.done", item_id: "fc_1", arguments: completeArguments },
    { type: "response.output_item.done", item: { ...added.item, arguments: completeArguments } },
    { type: "response.completed", response: { status: "completed", usage } }],
  partial,
  "no-args": [created, added, incomplete],
};
const continuation = [
  { type: "response.created", response: { id: "resp_2" } },
  { type: "response.output_text.delta", delta: "Done." },
  { type: "response.completed", response: { usage: { input_tokens: 20, output_tokens: 2, total_tokens: 22 } } },
];
const schema = z.object({ path: z.string().optional(), content: z.string().optional() });
const records = [];
const report = { source: "https://github.com/strands-agents/harness-sdk/issues/4158",
  packageVersions: Object.fromEntries(["@strands-agents/sdk", "openai", "prefix-safe-json", "zod"]
    .map((name) => [name, JSON.parse(readFileSync(new URL(`./node_modules/${name}/package.json`, import.meta.url))).version])),
  node: process.version, fixtures: Object.fromEntries(Object.entries(fixtures).map(([name, events]) => [name, hash(events)])),
  nativeControl: "Public stream() subclass applies only #4159's maxTokens precedence condition; PR source is not installed",
  effects: "The reporter's memory-only callback counter; no disk, network or production effects",
  records };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + "\n");

for (const [fixture, events] of Object.entries(fixtures)) for (const path of ["native", "native-control", "psj"]) {
  const state = { incomplete: false, pending: undefined };
  const record = { fixture, path, fixtureSha256: hash(events), callbacks: [], requests: [], modelStops: [],
    gateDecisions: [], authorityConsumed: 0, authoritySecondTake: 0 };
  const client = { responses: { create: async (request) => {
    if (record.requests.length >= 2) throw new Error("Finite fixture exhausted; no hidden retries");
    const response = record.requests.length === 0 ? events : continuation;
    record.requests.push({ input: structuredClone(request.input), responseSha256: hash(response) });
    state.incomplete = response.some((e) => e.type === "response.incomplete" &&
      e.response.incomplete_details?.reason === "max_output_tokens");
    state.pending = undefined;
    if (path === "psj") {
      const adapter = new OpenAIStreamAdapter();
      const gate = createToolCallExecutionGate(undefined, undefined, undefined,
        { write_file: fromStandardSchema(schema) });
      for (const event of response) for (const normalized of adapter.push(event)) gate.push(normalized);
      for (const normalized of adapter.finish()) gate.push(normalized);
      const result = gate.finish();
      record.gateDecisions.push(result.decisions.map((d) => ({ id: d.toolCallId, name: d.name,
        executable: d.executable, reason: d.reason })));
      if (result.diagnostics.some((d) => ["error", "fatal"].includes(d.severity)) ||
          result.decisions.some((d) => !d.executable)) {
        const error = new Error("PSJ refused the original response before SDK tool execution");
        error.name = "PSJRefusal";
        throw error;
      }
      state.pending = { gate, result };
    }
    return (async function* () { for (const event of structuredClone(response)) yield event; })();
  } } };
  class ObservedModel extends OpenAIModel {
    async *stream(...args) {
      for await (const original of super.stream(...args)) {
        const event = path === "native-control" && state.incomplete && original.type === "modelMessageStopEvent"
          ? { ...original, type: original.type, stopReason: "maxTokens" } : original;
        if (event.type === "modelMessageStopEvent") record.modelStops.push(event.stopReason);
        yield event;
      }
    }
  }
  const writeFile = tool({ name: "write_file", description: "Write content to a file.", inputSchema: schema,
    callback: (input, context) => {
      const id = context.toolUse.toolUseId, name = context.toolUse.name;
      if (path === "psj") {
        const { gate, result } = state.pending ?? {};
        const decisions = result?.decisions.filter((d) => d.toolCallId === id && d.name === name) ?? [];
        assert.equal(decisions.length, 1, "Match original ID and exact tool name before the effect");
        const grant = gate.takeDecision(decisions[0].internalId);
        assert.ok(grant, "A one-shot authority is required before callback effect");
        record.authorityConsumed++;
        const second = gate.takeDecision(decisions[0].internalId);
        if (second) record.authoritySecondTake++;
        assert.equal(second, undefined);
        assert.ok(isDeepStrictEqual(grant.value, input), "SDK projection must equal original JSON");
      }
      record.callbacks.push({ id, name, input });
      return `wrote ${input.content?.length ?? 0} bytes to ${input.path}`;
    } });
  const model = new ObservedModel({ api: "responses", client, maxTokens: 50 });
  const agent = new Agent({ model, tools: [writeFile], printer: false });
  try {
    const result = await agent.invoke("save my notes");
    record.outcome = "returned";
    record.stopReason = result.stopReason;
  } catch (error) {
    record.outcome = "raised";
    record.error = { name: error.name, message: error.message,
      cause: error.cause ? { name: error.cause.name, message: error.cause.message } : undefined };
  }
  record.messages = JSON.parse(JSON.stringify(agent.messages));
  records.push(record);
  save();
  console.log(JSON.stringify({ fixture, path, callbacks: record.callbacks.length,
    requests: record.requests.length, outcome: record.outcome, error: record.error?.name,
    stopReason: record.stopReason, modelStops: record.modelStops }));
  assert.equal(record.fixtureSha256, report.fixtures[fixture]);
  if (fixture === "healthy") {
    assert.equal(record.callbacks.length, 1);
    assert.deepEqual(record.callbacks[0], { id: "call_1", name: "write_file", input: JSON.parse(completeArguments) });
    assert.equal(record.outcome, "returned");
    assert.equal(record.requests.length, 2);
    assert.ok(record.requests[1].input.some((item) => item.type === "function_call_output" && item.call_id === "call_1"));
  } else {
    assert.equal(record.callbacks.length, fixture === "no-args" && path === "native" ? 1 : 0);
    if (path === "native-control") assert.equal(record.error?.name, "MaxTokensError");
    if (path === "psj") assert.equal(record.authorityConsumed, 0);
  }
}
report.conclusion = "Native precedence control and PSJ both prevent the no-argument callback; no PSJ superiority or adoption is established";
save();
console.log(`Verified ${records.length}/9 cases; results: ${output}`);
