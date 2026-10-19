import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { jsonSchema } from "ai";
import { createGuardedChat } from "../dist/index.js";
import { createFileRecorder, replayRecording } from "../dist/recording.js";

const schema = { type: "object", properties: { message: { type: "string" } }, required: ["message"], additionalProperties: false };
const body = (reason = "tool_calls") => [
  { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "original-id", type: "function", function: { name: "record", arguments: '{"message":"private-argument"}' } }] }, finish_reason: null }] },
  { choices: [{ index: 0, delta: {}, finish_reason: reason }] },
].map(event => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", ...event })}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n";

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "psj-recording-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function run(raw, extra = {}, inputSchema = jsonSchema(schema)) {
  const effects = [], decisions = [];
  const chat = createGuardedChat({ name: "fixture", baseURL: "https://fixture.invalid/v1", apiKey: "private-api-key",
    fetch: async () => new Response(raw, { headers: { "content-type": "text/event-stream", "private-header": "private-header-value" } }),
    onDecision: event => decisions.push(event), ...extra });
  const result = chat({ model: "fixture", prompt: "private-user-prompt", onError() {}, tools: {
    record: { inputSchema, execute: async (input, context) => { effects.push({ input, id: context.toolCallId }); return "private-tool-result"; } },
  } });
  const parts = [];
  for await (const part of result.fullStream) parts.push(part);
  return { result, effects, decisions, parts };
}

test("default recorder saves refusals verbatim and replays offline without argument disclosure", async t => {
  const root = await directory(t), saved = [];
  const recorder = createFileRecorder({ directory: root, onSaved: path => saved.push(path) });
  const raw = "\uFEFF" + body("length");
  const result = await run(raw, { onCapture: recorder });
  assert.deepEqual(result.effects, []);
  assert.equal(saved.length, 1);
  assert.equal(await readFile(join(saved[0], "..", "response.sse"), "utf8"), raw);
  const metadata = await readFile(saved[0], "utf8");
  for (const secret of ["private-api-key", "private-header-value", "private-user-prompt", "private-tool-result", "private-argument"]) assert.equal(metadata.includes(secret), false);
  const report = await replayRecording(saved[0]);
  assert.equal(report.scope, "wire-policy-only");
  assert.equal(report.bodyComplete, true);
  assert.equal(report.replayed.status, "refused");
  assert.equal(report.replayed.reason, result.decisions[0].reason);
  assert.equal(JSON.stringify(report).includes("private-argument"), false);
  const cli = fileURLToPath(new URL("./cli.js", import.meta.resolve("psj-ai-sdk")));
  const matching = spawnSync(process.execPath, [cli, "replay", saved[0], "--expect", "refused", "--json"], { encoding: "utf8" });
  assert.equal(matching.status, 0, matching.stderr);
  assert.equal(JSON.parse(matching.stdout).replayed.status, "refused");
  const mismatch = spawnSync(process.execPath, [cli, "replay", saved[0], "--expect", "allowed"], { encoding: "utf8" });
  assert.equal(mismatch.status, 1);
});

test("successful responses create no files by default; all mode retains the positive control", async t => {
  const root = await directory(t);
  const result = await run(body(), { onCapture: createFileRecorder({ directory: root }) });
  assert.deepEqual(result.effects, [{ id: "original-id", input: { message: "private-argument" } }]);
  assert.deepEqual(await readdir(root), []);
  const saved = [];
  await run(body(), { onCapture: createFileRecorder({ directory: root, mode: "all", onSaved: path => saved.push(path) }) });
  const replay = await replayRecording(saved[0]);
  assert.deepEqual(replay.replayed, { status: "allowed", toolCalls: 1 });
});

test("partial and bounded captures cannot acquire authority on replay", async t => {
  const root = await directory(t), saved = [];
  const recorder = createFileRecorder({ directory: root, onSaved: path => saved.push(path) });
  let sent = false;
  const interrupted = new ReadableStream({ pull(controller) {
    if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode(body())); }
    else controller.error(new Error("private-transport-error"));
  } });
  for (const raw of [interrupted, body() + " "]) {
    const result = await run(raw, { onCapture: recorder, ...(typeof raw === "string" ? { maxResponseBytes: new TextEncoder().encode(body()).byteLength } : {}) });
    assert.deepEqual(result.effects, []);
    const replay = await replayRecording(saved.at(-1));
    assert.equal(replay.bodyComplete, false);
    assert.deepEqual(replay.replayed, { status: "refused", toolCalls: 0, reason: "incomplete_recording" });
  }
});

test("application validator outcomes are recorded but are not falsely reproduced by wire-only replay", async t => {
  const root = await directory(t), saved = [];
  const result = await run(body(), { onCapture: createFileRecorder({ directory: root, onSaved: path => saved.push(path) }) },
    jsonSchema(schema, { validate: async () => ({ success: false, error: new Error("private-validator-message") }) }));
  assert.deepEqual(result.effects, []);
  const report = await replayRecording(saved[0]);
  assert.equal(report.recorded.reason, "application_schema_invalid");
  assert.deepEqual(report.replayed, { status: "allowed", toolCalls: 1 });
});

test("capture callback failures refuse an otherwise valid batch", async () => {
  let count = 0;
  const result = await run(body(), { onCapture() { count++; throw new Error("private-storage-error"); } });
  assert.equal(count, 1);
  assert.deepEqual(result.effects, []);
  assert.deepEqual(result.decisions, [{ status: "refused", toolCalls: 0, reason: "recording_error" }]);
});

test("mutating a capture cannot change approved wire inputs or schemas", async () => {
  const result = await run(body(), { onCapture(capture) {
    capture.body.fill(0);
    capture.toolSchemas.record.properties.message.type = "number";
  } });
  assert.deepEqual(result.effects, [{ id: "original-id", input: { message: "private-argument" } }]);
});

test("concurrent recordings have separate manifests and exact bodies", async t => {
  const root = await directory(t), saved = [];
  const recorder = createFileRecorder({ directory: root, onSaved: path => saved.push(path) });
  await Promise.all(Array.from({ length: 8 }, () => run(body("length"), { onCapture: recorder })));
  assert.equal(new Set(saved).size, 8);
  for (const path of saved) assert.equal((await replayRecording(path)).replayed.status, "refused");
});

test("changed bodies and invalid manifests are rejected before replay", async t => {
  const root = await directory(t), saved = [];
  await run(body("length"), { onCapture: createFileRecorder({ directory: root, onSaved: path => saved.push(path) }) });
  const path = saved[0], original = await readFile(path, "utf8");
  await writeFile(join(path, "..", "response.sse"), body());
  await assert.rejects(replayRecording(path), /hash or length mismatch/u);
  const manifest = JSON.parse(original);
  manifest.bodyFile = "../../elsewhere.sse";
  await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(replayRecording(path), /invalid recording manifest/u);
});
