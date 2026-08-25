import * as pkg from "prefix-safe-json";

const {
  createParser,
  createToolCallExecutionGate,
  createAiSdkExecutionGuard,
  GeminiStreamAdapter,
  OpenAICompatibleStreamAdapter,
} = pkg;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [name, value] of Object.entries({
  createParser,
  createToolCallExecutionGate,
  createAiSdkExecutionGuard,
  GeminiStreamAdapter,
  OpenAICompatibleStreamAdapter,
})) {
  assert(typeof value === "function", `missing public export ${name}`);
}

const completeParser = createParser();
completeParser.push('{"message":"ok","unicode":"\u20ac"}');
const completeParse = completeParser.finish({ reason: "complete" });
assert(completeParse.outcome === "valid", "complete JSON was not valid");
assert(completeParse.executable === true, "complete JSON was not executable");
assert(completeParse.stableValue?.unicode === "€", "unicode parser result differed");

const truncatedParser = createParser();
truncatedParser.push('{"message":"cut');
const truncatedParse = truncatedParser.finish({ reason: "length" });
assert(truncatedParse.outcome === "truncated", "truncated JSON was not classified truncated");
assert(truncatedParse.executable === false, "truncated JSON was executable");

function pushNormalizedCall(gate, { key, id, name, json, reason }) {
  gate.push({
    type: "tool_call_start",
    sequence: 1,
    provider: "ai-sdk",
    callRef: { sourceKey: key },
    toolCallId: id,
    name,
  });
  gate.push({
    type: "tool_call_arguments_delta",
    sequence: 2,
    provider: "ai-sdk",
    callRef: { sourceKey: key },
    delta: json,
  });
  gate.push({
    type: "tool_call_end",
    sequence: 3,
    provider: "ai-sdk",
    callRef: { sourceKey: key },
    reason: "complete",
  });
  gate.push({
    type: "provider_stream_end",
    sequence: 4,
    provider: "ai-sdk",
    reason,
  });
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["path", "content"],
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
};

const safeGate = createToolCallExecutionGate(undefined, undefined, { write_file: schema });
pushNormalizedCall(safeGate, {
  key: "safe",
  id: "safe",
  name: "write_file",
  json: '{"path":"a.txt","content":"hello"}',
  reason: "complete",
});
const safeDecision = safeGate.finish().decisions[0];
assert(safeDecision?.action === "execute", "safe gate call was not executable");
const firstAuthority = safeGate.takeDecision(safeDecision.internalId);
assert(firstAuthority?.value?.path === "a.txt", "first authority did not contain validated AJV value");
assert(safeGate.takeDecision(safeDecision.internalId) === undefined, "gate authority was replayable");

const unsafeGate = createToolCallExecutionGate();
pushNormalizedCall(unsafeGate, {
  key: "unsafe",
  id: "unsafe",
  name: "write_file",
  json: '{"path":"a.txt","content":"hello"}',
  reason: "length",
});
const unsafeDecision = unsafeGate.finish().decisions[0];
assert(unsafeDecision?.action !== "execute", "length-terminated gate call executed");
assert(unsafeGate.takeDecision(unsafeDecision.internalId) === undefined, "unsafe gate exposed authority");

const invalidSchemaGate = createToolCallExecutionGate(undefined, undefined, { write_file: schema });
pushNormalizedCall(invalidSchemaGate, {
  key: "invalid-schema",
  id: "invalid-schema",
  name: "write_file",
  json: '{"path":"a.txt"}',
  reason: "complete",
});
const invalidSchemaDecision = invalidSchemaGate.finish().decisions[0];
assert(invalidSchemaDecision?.reason === "schema_invalid", "AJV schema failure was not enforced");

const guard = createAiSdkExecutionGuard({ schemas: { write_file: schema } });
for (const part of [
  { type: "tool-input-start", id: "guard-safe", toolName: "write_file" },
  { type: "tool-input-delta", id: "guard-safe", delta: '{"path":"g.txt","content":"ok"}' },
  { type: "tool-input-end", id: "guard-safe" },
  { type: "finish", finishReason: "tool-calls" },
]) guard.push(part);
const guardDecision = guard.finish().decisions[0];
assert(guardDecision?.action === "execute", "AI SDK guard safe call did not execute");
assert(guard.takeDecision(guardDecision.internalId)?.value?.path === "g.txt", "AI SDK guard authority missing");
assert(guard.takeDecision(guardDecision.internalId) === undefined, "AI SDK guard authority was replayable");

const lengthGuard = createAiSdkExecutionGuard();
for (const part of [
  { type: "tool-input-start", id: "guard-length", toolName: "write_file" },
  { type: "tool-input-delta", id: "guard-length", delta: '{"path":"g.txt","content":"apparently complete"}' },
  { type: "tool-input-end", id: "guard-length" },
  { type: "finish", finishReason: "length" },
]) lengthGuard.push(part);
const lengthDecision = lengthGuard.finish().decisions[0];
assert(lengthDecision?.action !== "execute", "AI SDK length call executed");
assert(lengthGuard.takeDecision(lengthDecision.internalId) === undefined, "AI SDK length call exposed authority");

const protocolGuard = createAiSdkExecutionGuard();
for (const part of [
  { type: "tool-input-delta", id: "poisoned", delta: "{}" },
  { type: "tool-input-start", id: "poisoned", toolName: "write_file" },
  { type: "tool-input-delta", id: "poisoned", delta: '{"path":"p.txt","content":"ok"}' },
  { type: "tool-input-end", id: "poisoned" },
  { type: "finish", finishReason: "tool-calls" },
]) protocolGuard.push(part);
const protocolDecision = protocolGuard.finish().decisions[0];
assert(protocolDecision?.reason === "protocol_violation", "protocol ordering did not poison authority");
assert(protocolGuard.takeDecision(protocolDecision.internalId) === undefined, "poisoned call exposed authority");

const geminiAdapter = new GeminiStreamAdapter();
const geminiGate = createToolCallExecutionGate(undefined, undefined, { write_file: schema });
for (const event of geminiAdapter.push({
  candidates: [{
    content: { parts: [{ functionCall: { name: "write_file", args: { path: "x", content: "y" } } }] },
    finishReason: "STOP",
  }],
})) geminiGate.push(event);
const geminiDecision = geminiGate.finish().decisions[0];
assert(geminiDecision?.reason === "projection_only", "Gemini projection received strict authority");

const openAiAdapter = new OpenAICompatibleStreamAdapter();
const openAiGate = createToolCallExecutionGate();
for (const event of openAiAdapter.push({ choices: [
  { index: 1, delta: { tool_calls: [{ index: 0, id: "choice-1", function: { name: "second", arguments: '{"n":2}' } }] } },
  { index: 0, delta: { tool_calls: [{ index: 0, id: "choice-0", function: { name: "first", arguments: '{"n":1}' } }] } },
] })) openAiGate.push(event);
for (const event of openAiAdapter.finish({ reason: "complete", providerReason: "tool_calls" })) openAiGate.push(event);
const openAiDecisions = openAiGate.finish().decisions;
assert(openAiDecisions.length === 2, "OpenAI-compatible choices were conflated");
assert(openAiDecisions.every((decision) => decision.action === "execute"), "OpenAI-compatible choice lost authority");
assert(new Set(openAiDecisions.map((decision) => decision.toolCallId)).size === 2, "OpenAI-compatible identities were ambiguous");

globalThis.console.log(JSON.stringify({
  node: globalThis.process.version,
  import: "pass",
  parser: "pass",
  gate: "pass",
  guard: "pass",
  ajv: "pass",
  authority: "one-shot-pass",
  geminiProjection: "pass",
  openAiMultiChoice: "pass",
  protocolPoisoning: "pass",
  result: "pass",
}, null, 2));
