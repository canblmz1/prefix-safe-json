import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, release } from "node:os";
import { stepCountIs, streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createGuardedChat } from "psj-ai-sdk";
import { z } from "zod";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const event = (delta, finish_reason = null) => ({ id: "fixture", object: "chat.completion.chunk", created: 1,
  model: "fixture", choices: [{ index: 0, delta, finish_reason }] });
const sse = events => events.map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n";
const toolCall = (index, id, message) => ({ index, id, type: "function", function: {
  name: "update", arguments: JSON.stringify({ message }),
} });
const response = duplicate => sse([
  event({ role: "assistant", tool_calls: [toolCall(0, "a", "alpha"), toolCall(1, duplicate ? "a" : "b", "beta")] }),
  event({}, "tool_calls"),
]);
const answer = sse([event({ content: "Updated." }), event({}, "stop")]);
const schema = z.object({ message: z.string() }).strict();

// An application-owned alternative, with the SAME original response access as
// PSJ. Bounded finite SSE capture, fatal UTF-8, then original-ID uniqueness.
// This evaluates one policy on the fixed Chat Completions fixtures below, not
// a replacement for a production transport, schema gate or approval system.
async function checkRawIdentity(response) {
  const buffers = [];
  let size = 0;
  for await (const bytes of response.body) {
    size += bytes.length;
    if (size > 8 * 1024 * 1024) throw new Error("raw_identity_response_limit");
    buffers.push(bytes);
  }
  const body = Buffer.concat(buffers);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  const identities = new Map();
  for (const block of text.replace(/\r\n?/gu, "\n").split("\n\n")) {
    const data = block.split("\n").filter(line => line.startsWith("data:"))
      .map(line => line.slice(5).replace(/^ /u, "")).join("\n");
    if (!data || data === "[DONE]") continue;
    const parsed = JSON.parse(data);
    for (const choice of parsed.choices ?? []) {
      if (choice.index !== 0) throw new Error("raw_identity_choice");
      for (const call of choice.delta?.tool_calls ?? []) {
        if (!Number.isSafeInteger(call.index) || call.index < 0) throw new Error("raw_identity_index");
        const previous = identities.get(call.index);
        if (call.id !== undefined && (typeof call.id !== "string" || !call.id || (previous && previous !== call.id))) {
          throw new Error("raw_identity_conflict");
        }
        identities.set(call.index, call.id ?? previous);
      }
    }
  }
  const ids = [...identities.values()];
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error("original_id_not_unique");
  // The native SDK still checks JSON, schemas and finish reasons and owns
  // callbacks and continuation. This wrapper does not replace those checks.
  return new Response(body, { status: response.status, headers: response.headers });
}

async function run(mode, duplicate) {
  const body = response(duplicate);
  const requests = [], effects = [], decisions = [], errors = [], parts = [];
  const database = [];
  const fetchFixture = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    assert.ok(requests.length <= 2, "unexpected continuation");
    const bytes = Buffer.from(requests.length === 1 ? body : answer);
    // Bytewise transport also checks that the raw check handles SSE lines and
    // JSON tokens crossing transport boundaries. All modes get these bytes.
    const result = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
    if (mode !== "native-raw-check") return result;
    try { return await checkRawIdentity(result); }
    catch (error) { decisions.push({ status: "refused", reason: error.message }); throw error; }
  };
  const settings = { name: "raw-id-evaluation", baseURL: "https://fixture.invalid/v1", fetch: fetchFixture };
  const options = { tools: { update: { inputSchema: schema, execute: async (input, context) => {
    effects.push({ id: context.toolCallId, input: structuredClone(input) });
    database.push(input.message);
    return { updated: input.message };
  } } }, prompt: "Update alpha and beta, then summarize.", stopWhen: stepCountIs(3),
  toolCallConcurrency: 1, onError: ({ error }) => errors.push(error) };
  const result = mode === "psj"
    ? createGuardedChat({ ...settings, onDecision: decision => decisions.push(decision) })({ ...options, model: "fixture" })
    : streamText({ ...options, model: createOpenAICompatible(settings).chatModel("fixture"), maxRetries: 0 });
  const finalText = Promise.resolve(result.text).catch(() => null);
  const steps = Promise.resolve(result.steps).catch(() => []);
  for await (const part of result.fullStream) parts.push(part);
  const text = await finalText;
  await steps;
  const tools = requests[1]?.messages.filter(message => message.role === "tool") ?? [];
  const refused = duplicate && mode !== "native";
  assert.equal(effects.length, refused ? 0 : 2, `${mode}: actual side effects`);
  assert.equal(requests.length, refused ? 1 : 2, `${mode}: actual continuation requests`);
  assert.deepEqual(database, refused ? [] : ["alpha", "beta"]);
  if (refused) {
    assert.equal(decisions[0]?.status, "refused");
    assert.equal(parts.filter(part => ["tool-call", "tool-result"].includes(part.type)).length, 0);
  } else {
    assert.equal(text, "Updated.");
    assert.equal(errors.length, 0);
    assert.deepEqual(tools.map(message => message.tool_call_id), effects.map(effect => effect.id));
    assert.deepEqual(tools.map(message => JSON.parse(message.content)), [{ updated: "alpha" }, { updated: "beta" }]);
    if (!duplicate) assert.deepEqual(effects.map(effect => effect.id), ["a", "b"]);
    else {
      assert.equal(effects[0].id, "a");
      assert.notEqual(effects[1].id, "a", "native provider replaces the repeated original ID");
    }
  }
  return { fixture: duplicate ? "duplicate-original-id" : "healthy", mode, inputSha256: sha256(body),
    firstRequestSha256: sha256(JSON.stringify(requests[0])), callbacks: effects.length, database, effects,
    requests: requests.length, continuationIds: tools.map(message => message.tool_call_id), text,
    status: refused ? "refused" : "allowed", reason: decisions[0]?.reason ??
      (decisions[0]?.status === "allowed" ? "allowed" : "native-normal-completion"),
    correctRefusal: refused ? 1 : 0, unnecessaryRefusal: !duplicate && effects.length === 0 ? 1 : 0,
    missedRequiredRefusal: duplicate && effects.length > 0 ? 1 : 0,
  };
}

function version(name) {
  let directory = dirname(fileURLToPath(import.meta.resolve(name)));
  for (let depth = 0; depth < 6; depth++, directory = dirname(directory)) {
    try {
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
      if (manifest.name === name) return manifest.version;
    } catch { /* Package manifests need not be exported. */ }
  }
  throw new Error(`Cannot locate installed ${name} version`);
}
console.log(JSON.stringify({ kind: "environment", measuredAt: new Date().toISOString(), node: process.versions.node,
  os: `${platform()} ${release()}`, packages: Object.fromEntries(
    ["ai", "@ai-sdk/openai-compatible", "prefix-safe-json", "psj-ai-sdk", "zod"].map(name => [name, version(name)])) }));
for (const duplicate of [false, true]) {
  const rows = [];
  for (const mode of ["native", "native-raw-check", "psj"]) rows.push(await run(mode, duplicate));
  assert.equal(new Set(rows.map(row => row.inputSha256)).size, 1, "identical original response bytes");
  assert.equal(new Set(rows.map(row => row.firstRequestSha256)).size, 1, "identical first application request");
  for (const row of rows) console.log(JSON.stringify(row));
}
console.log(JSON.stringify({ kind: "summary", cases: 6, status: "PASS",
  scope: "authored original-ID policy fixture; no live-model, performance or adoption claim" }));
