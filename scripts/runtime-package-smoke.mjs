import * as pkg from "prefix-safe-json";
import * as ajvSubpath from "prefix-safe-json/ajv";
import * as standardSchemaSubpath from "prefix-safe-json/standard-schema";
import * as conformanceSubpath from "prefix-safe-json/conformance";

const {
  createParser,
  createToolCallExecutionGate,
  createAiSdkExecutionGuard,
  GeminiStreamAdapter,
  OpenAICompatibleStreamAdapter,
} = pkg;
const { createAjvValidator } = ajvSubpath;
const { fromStandardSchema } = standardSchemaSubpath;
const { runToolCallIntegrityFixture, runToolCallIntegritySuite } = conformanceSubpath;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

for (const [name, value] of Object.entries({
  createParser,
  createToolCallExecutionGate,
  createAiSdkExecutionGuard,
  GeminiStreamAdapter,
  OpenAICompatibleStreamAdapter,
  createAjvValidator,
  fromStandardSchema,
  runToolCallIntegrityFixture,
  runToolCallIntegritySuite,
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
    index: 0,
    content: { parts: [{ functionCall: { id: "runtime-smoke-call", name: "write_file", args: { path: "x", content: "y" } } }] },
    finishReason: "STOP",
  }],
})) geminiGate.push(event);
// Candidate-local finishReason (above) only closes that candidate - the
// ONE provider-stream terminal comes solely from the adapter's own
// finish(), which must be driven explicitly here just like a real caller
// would at the end of the SSE stream.
for (const event of geminiAdapter.finish({ reason: "complete" })) {
  geminiGate.push(event);
}
const geminiDecision = geminiGate.finish().decisions[0];
assert(
  geminiDecision?.action !== "execute",
  "Gemini projection unexpectedly received execute authority",
);
assert(
  geminiDecision?.reason === "projection_only",
  `Gemini projection reason changed: ${geminiDecision?.reason}`,
);

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

let malformedValidatorRejected = false;
try {
  createToolCallExecutionGate(undefined, undefined, undefined, { write_file: null });
} catch (error) {
  malformedValidatorRejected = /is not a valid ToolInputValidator/.test(error.message);
}
assert(malformedValidatorRejected, "gate accepted a null validator registration instead of rejecting it at construction");

const validatorGuard = createAiSdkExecutionGuard({ validators: { write_file: { validate: () => ({ valid: true }) } } });
for (const part of [
  { type: "tool-input-start", id: "validator-guard", toolName: "write_file" },
  { type: "tool-input-delta", id: "validator-guard", delta: '{"path":"v.txt","content":"ok"}' },
  { type: "tool-input-end", id: "validator-guard" },
  { type: "finish", finishReason: "tool-calls" },
]) validatorGuard.push(part);
const validatorGuardDecision = validatorGuard.finish().decisions[0];
assert(validatorGuardDecision?.action === "execute", "AI SDK guard did not propagate the validators option through to execution");

const directAjvValidator = createAjvValidator(schema);
assert(directAjvValidator.validate({ path: "a.txt", content: "hi" }).valid === true, "direct ajv adapter rejected a valid value");
assert(directAjvValidator.validate({ path: "a.txt" }).valid === false, "direct ajv adapter accepted a value missing a required field");

const standardValidator = fromStandardSchema({
  "~standard": {
    version: 1,
    vendor: "runtime-package-smoke",
    validate(value) {
      if (typeof value === "object" && value !== null && typeof value.path === "string") return { value };
      return { issues: [{ message: "path must be a string" }] };
    },
  },
});
assert(standardValidator.validate({ path: "a.txt" }).valid === true, "standard-schema adapter rejected a valid value");
assert(standardValidator.validate({ path: 1 }).valid === false, "standard-schema adapter accepted an invalid value");

let emptyIssuesRejected;
try {
  emptyIssuesRejected = fromStandardSchema({
    "~standard": { version: 1, vendor: "runtime-package-smoke", validate: () => ({ issues: [] }) },
  }).validate({}).valid === false;
} catch {
  emptyIssuesRejected = false;
}
assert(emptyIssuesRejected, "standard-schema adapter treated an empty issues array as valid (wrong per Standard Schema v1)");

let constructionRejectsBadVersion = false;
try {
  fromStandardSchema({ "~standard": { version: 2, vendor: "x", validate: () => ({ value: 1 }) } });
} catch (error) {
  constructionRejectsBadVersion = /only supports Standard Schema v1/.test(error.message);
}
assert(constructionRejectsBadVersion, "standard-schema adapter accepted an unsupported ~standard.version at construction");

const asyncStandardValidator = fromStandardSchema({
  "~standard": { version: 1, vendor: "runtime-package-smoke", validate: async (value) => ({ value }) },
});
let asyncValidatorThrew = false;
try {
  asyncStandardValidator.validate({});
} catch (error) {
  asyncValidatorThrew = /only supports synchronous Standard Schema validators/.test(error.message);
}
assert(asyncValidatorThrew, "standard-schema adapter did not fail loudly on an async validator");

const conformanceFixture = {
  schemaVersion: 1,
  profile: "normalized-gate",
  id: "runtime-package-smoke-fixture",
  description: "installed-tarball smoke fixture, not part of the repository corpus",
  provenance: { classification: "synthetic-adversarial" },
  events: [
    { type: "tool_call_start", sequence: 1, provider: "ai-sdk", callRef: { sourceKey: "cf" }, toolCallId: "cf", name: "write_file" },
    { type: "tool_call_arguments_delta", sequence: 2, provider: "ai-sdk", callRef: { sourceKey: "cf" }, delta: '{"path":"a.txt","content":"hi"}' },
    { type: "tool_call_end", sequence: 3, provider: "ai-sdk", callRef: { sourceKey: "cf" }, reason: "complete" },
    { type: "provider_stream_end", sequence: 4, provider: "ai-sdk", reason: "complete" },
  ],
  expected: [{ name: "write_file", action: "execute", reason: "complete" }],
};
const conformanceFixtureResult = runToolCallIntegrityFixture(conformanceFixture);
assert(conformanceFixtureResult.pass === true, "conformance runner did not pass its own well-formed fixture: " + JSON.stringify(conformanceFixtureResult));
const conformanceSuiteResult = runToolCallIntegritySuite([conformanceFixture]);
assert(conformanceSuiteResult.pass === true, "conformance suite runner did not pass a single well-formed fixture");

let deniedSubpathError;
try {
  await import("prefix-safe-json/package.json");
} catch (error) {
  deniedSubpathError = error;
}
assert(deniedSubpathError !== undefined, "an unexported subpath resolved instead of failing - exports map is not being enforced");
assert(
  deniedSubpathError.code === "ERR_PACKAGE_PATH_NOT_EXPORTED",
  "unexported subpath failed with the wrong error code: " + deniedSubpathError.code,
);

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
  directAjvAdapter: "pass",
  standardSchemaAdapter: "pass",
  standardSchemaAsyncFailsClosed: "pass",
  standardSchemaEmptyIssuesRejected: "pass",
  standardSchemaConstructionRejectsBadVersion: "pass",
  malformedValidatorRegistrationRejected: "pass",
  aiSdkGuardValidatorsPropagation: "pass",
  conformanceFixture: "pass",
  conformanceSuite: "pass",
  exportsMapEnforced: "pass",
  result: "pass",
}, null, 2));
