import { streamText, jsonSchema, stepCountIs, type ModelMessage, type ToolResultPart } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createToolCallExecutionGate, createAiSdkExecutionLock, OpenAICompatibleStreamAdapter } from "prefix-safe-json";
import { createAjvValidator } from "prefix-safe-json/ajv";
import { canonical, compareProfile, object, parseExpectations, parseFixture, readJson, readResponses, RegressionInputError, sha256 } from "./data.js";
import { doctor, versions } from "./versions.js";
import type { DecisionSummary, FixtureCase, Json, ProfileExpectation, ProfileReport, RegressionFixture, RegressionMismatch, RegressionOptions, RegressionReport, ToolCallReference } from "./types.js";

const endpoint = "https://psj-fixture.invalid/v1/chat/completions";
const explanations: Record<string, string> = {
  complete: "Original argument and completion evidence satisfies the configured gate.",
  truncated: "The original argument JSON did not finish structurally.",
  stream_incomplete: "Safe stream completion is missing, even if the arguments parse.",
  protocol_violation: "Original call identity or lifecycle evidence is contradictory or out of order.",
  schema_invalid: "Original arguments fail the registered tool schema.",
  malformed: "Original arguments contain malformed JSON.",
  provider_error: "The original stream reports a provider failure.",
  content_filtered: "The original stream reports content filtering.",
  resource_limit: "A parser or coordinator resource limit was reached.",
};

function sseEvents(body: string): Record<string, unknown>[] {
  // Read complete SSE events, including evidence after a [DONE] marker.
  // The SDK receives the original bytes independently through its own parser.
  const frames = body.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n\n");
  frames.pop(); // An unfinished event at EOF is not dispatched by SSE.
  const events: Record<string, unknown>[] = [];
  for (const frame of frames) {
    const data = frame.split("\n").filter(line => line === "data" || line.startsWith("data:"))
      .map(line => line === "data" ? "" : line.slice(5).replace(/^ /u, "")).join("\n");
    if (!data || data === "[DONE]") continue;
    let value: unknown;
    try { value = JSON.parse(data); } catch { throw new RegressionInputError("E_SSE_JSON", "An SSE data event is not a JSON object."); }
    if (!object(value)) throw new RegressionInputError("E_SSE_JSON", "An SSE data event is not a JSON object.");
    events.push(value);
  }
  return events;
}

interface Observation extends ProfileExpectation { decisions: DecisionSummary[] }

function labelAssignedIds(observed: Observation, bodies: string[]): void {
  const wireIds = new Set<string>();
  for (const body of bodies) for (const event of sseEvents(body)) {
    if (!Array.isArray(event.choices)) continue;
    for (const choice of event.choices.filter(object)) {
      if (!object(choice.delta) || !Array.isArray(choice.delta.tool_calls)) continue;
      for (const call of choice.delta.tool_calls.filter(object)) if (typeof call.id === "string") wireIds.add(call.id);
    }
  }
  const assigned = new Map<string, number>();
  const label = (id: ToolCallReference): ToolCallReference => {
    if (typeof id !== "string" || wireIds.has(id)) return id;
    let ordinal = assigned.get(id);
    if (ordinal === undefined) { ordinal = assigned.size + 1; assigned.set(id, ordinal); }
    return { sdkAssigned: ordinal };
  };
  for (const execution of observed.executions) execution.toolCallId = label(execution.toolCallId);
  observed.toolResultIds = observed.toolResultIds.map(label);
}

async function runProfile(fixture: RegressionFixture, entry: FixtureCase, bodies: string[], guarded: boolean): Promise<Observation> {
  const observed: Observation = { requests: 0, executions: [], toolResultIds: [], finalText: "", errorCount: 0, decisions: [] };
  const fetchFixture = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (String(url) !== endpoint || init?.method !== "POST") throw new RegressionInputError("E_REQUEST", "The harness only accepts its fixed offline endpoint.");
    const index = observed.requests++;
    const request: unknown = JSON.parse(String(init.body));
    if (object(request) && Array.isArray(request.messages)) {
      observed.toolResultIds.push(...request.messages.filter(object).filter(message => message.role === "tool")
        .map(message => message.tool_call_id).filter((id): id is string => typeof id === "string"));
    }
    const text = bodies[index];
    if (text === undefined) throw new RegressionInputError("E_EXTRA_REQUEST", "The SDK requested a response not present in this case.");
    const bytes = new TextEncoder().encode(text);
    const chunkBytes = entry.responses[index]?.chunkBytes ?? 17;
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + chunkBytes));
      offset += chunkBytes;
    } });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
  const provider = createOpenAICompatible({ name: "psj-fixture", baseURL: "https://psj-fixture.invalid/v1", apiKey: "fixture-not-a-credential", fetch: fetchFixture });
  const tools = Object.create(null) as Record<string, {
    description: string;
    inputSchema: ReturnType<typeof jsonSchema<Json>>;
    execute: (input: Json, options: { toolCallId: string }) => Promise<Json>;
  }>;
  const schemas = Object.fromEntries(Object.entries(fixture.tools).map(([name, tool]) => [name, tool.inputSchema]));
  for (const [name, definition] of Object.entries(fixture.tools)) {
    let validator;
    try { validator = createAjvValidator(definition.inputSchema); }
    catch { throw new RegressionInputError("E_SCHEMA", "A fixture tool schema cannot be compiled."); }
    tools[name] = {
      description: "Harmless offline fixture counter",
      inputSchema: jsonSchema<Json>(definition.inputSchema, { validate: value =>
        validator.validate(value).valid ? { success: true as const, value: value as Json } : { success: false as const, error: new Error("Fixture input failed schema validation.") } }),
      execute: async (input, options) => {
        observed.executions.push({ toolCallId: options.toolCallId, name, input: input as Json });
        return definition.result;
      },
    };
  }
  const messages: ModelMessage[] = [{ role: "user", content: "Run the offline fixture tools, then summarize their results." }];
  const options = { model: provider.chatModel("fixture-model"), maxRetries: 0, abortSignal: AbortSignal.timeout(10_000), onError: () => {} };
  const drain = async (result: { fullStream: AsyncIterable<{ type: string }> }) => {
    for await (const part of result.fullStream) {
      if (part.type === "error" || part.type === "tool-error") observed.errorCount++;
    }
  };
  if (!guarded) {
    const result = streamText({ ...options, messages, tools, stopWhen: stepCountIs(9) });
    await drain(result);
    observed.finalText = await result.text;
    labelAssignedIds(observed, bodies);
    return observed;
  }

  for (let round = 0; round < 9; round++) {
    const beforeErrors = observed.errorCount;
    const responseIndex = observed.requests;
    const result = streamText({ ...options, messages, tools: createAiSdkExecutionLock(tools), stopWhen: stepCountIs(1) });
    await drain(result);
    const body = bodies[responseIndex];
    if (body === undefined) break;
    const adapter = new OpenAICompatibleStreamAdapter();
    const gate = createToolCallExecutionGate(undefined, undefined, schemas);
    for (const event of sseEvents(body)) for (const normalized of adapter.push(event)) gate.push(normalized);
    for (const event of adapter.finish()) gate.push(event);
    const final = gate.finish();
    observed.decisions.push(...final.decisions.map(({ action, reason, name, toolCallId, evidence }) => ({ action, reason,
      explanation: explanations[reason] ?? "Recorded evidence does not establish execution authority.",
      evidence: { terminalConfirmed: evidence.terminalConfirmed, structurallyComplete: evidence.structurallyComplete,
        parserExecutable: evidence.parserExecutable, ...(evidence.streamEndReason ? { streamEndReason: evidence.streamEndReason } : {}),
        ...(evidence.schemaValid !== undefined ? { schemaValid: evidence.schemaValid } : {}) },
      ...(name !== undefined ? { name } : {}), ...(toolCallId !== undefined ? { toolCallId } : {}) })));
    if (observed.errorCount > beforeErrors) break;
    if (final.decisions.length === 0) { observed.finalText = await result.text; break; }
    const authorities = final.decisions.map(decision => gate.takeDecision(decision.internalId));
    if (authorities.some(authority => !authority || !authority.toolCallId || !Object.hasOwn(fixture.tools, authority.name))) break;
    const sdkCalls = await result.toolCalls;
    if (sdkCalls.length !== authorities.length || authorities.some(authority => !authority ||
        !sdkCalls.some(call => call.toolCallId === authority.toolCallId && call.toolName === authority.name))) {
      observed.errorCount++;
      break;
    }
    const results: ToolResultPart[] = [];
    for (const authority of authorities) {
      if (!authority || !authority.toolCallId || !Object.hasOwn(fixture.tools, authority.name)) {
        observed.errorCount++;
        break;
      }
      const definition = fixture.tools[authority.name];
      if (!definition) throw new RegressionInputError("E_SCHEMA", "A fixture tool definition is missing.");
      observed.executions.push({ toolCallId: authority.toolCallId, name: authority.name, input: authority.value as Json });
      results.push({ type: "tool-result", toolName: authority.name, toolCallId: authority.toolCallId,
        output: { type: "json", value: definition.result } });
      if (gate.takeDecision(authority.internalId) !== undefined) throw new Error("Consumed fixture authority was reusable.");
    }
    if (observed.errorCount > beforeErrors) break;
    messages.push(...(await result.response).messages, { role: "tool", content: results });
  }
  return observed;
}

function redact(observed: Observation): ProfileReport {
  return { requests: observed.requests,
    executions: observed.executions.map(({ toolCallId, name, input }) => ({ toolCallId, name, inputSha256: sha256(canonical(input)) })),
    toolResultIds: observed.toolResultIds,
    finalTextSha256: sha256(observed.finalText), errorCount: observed.errorCount, decisions: observed.decisions };
}

/** Run real installed SDK parsers against local transport bytes and reviewed expectations. */
export async function runSuite(options: RegressionOptions): Promise<RegressionReport> {
  if (!doctor().ready) throw new RegressionInputError("E_PEERS", "Install Node 22+, AI SDK 7, OpenAI-compatible provider 3 and PSJ 0.6.x; run doctor for details.");
  const fixture = parseFixture(await readJson(options.fixture));
  const expected = options.expect ? parseExpectations(await readJson(options.expect)) : undefined;
  const responses = await readResponses(options.fixture, fixture);
  const cases: RegressionReport["cases"] = [];
  const mismatches: RegressionMismatch[] = [];
  if (expected && (expected.cases.length !== fixture.cases.length || expected.cases.some((entry, index) => fixture.cases[index]?.id !== entry.id))) {
    throw new RegressionInputError("E_CASES", "Expected case IDs and order must match the fixture exactly.");
  }
  if (expected) for (const [index, entry] of fixture.cases.entries()) if (entry.positiveControl) {
    const wanted = expected.cases[index];
    if (!wanted) throw new RegressionInputError("E_CASES", "A positive control expectation is missing.");
    for (const profile of [wanted.native, wanted.guarded]) {
      if (profile.requests < 2 || profile.executions.length === 0 || profile.toolResultIds.length !== profile.executions.length ||
          canonical(profile.toolResultIds) !== canonical(profile.executions.map(execution => execution.toolCallId)) ||
          profile.errorCount !== 0 || !profile.finalText.trim()) {
        throw new RegressionInputError("E_CONTROL", "A positive control must expect real effects, paired results, continuation, a final answer and zero errors.");
      }
    }
  }
  for (const bodies of responses.values()) for (const body of bodies) sseEvents(body);
  let toolCalls = 0;
  for (const [index, entry] of fixture.cases.entries()) {
    const bodies = responses.get(entry.id);
    if (!bodies) throw new RegressionInputError("E_READ", "A fixture response is missing.");
    const native = await runProfile(fixture, entry, bodies, false);
    const guarded = await runProfile(fixture, entry, bodies, true);
    toolCalls += native.executions.length + guarded.decisions.length;
    const wanted = expected?.cases[index];
    if (wanted) for (const profile of ["native", "guarded"] as const) {
      const actual = profile === "native" ? native : guarded;
      mismatches.push(...compareProfile(actual, wanted[profile]).map(field => ({ caseId: entry.id, profile, field })));
    }
    cases.push({ id: entry.id, provenance: entry.provenance, responseSha256: bodies.map(sha256), native: redact(native), guarded: redact(guarded) });
  }
  if (toolCalls === 0) throw new RegressionInputError("E_NO_TOOL_CALLS", "No tool calls were recognized. Check the capture boundary and include a complete positive control.");
  return { formatVersion: 1, scope: "offline-sdk-regression", versions: versions(), fixtureSha256: sha256(canonical(fixture as unknown as Json)), cases,
    expectations: { checked: expected !== undefined, pass: expected ? mismatches.length === 0 : null, mismatches },
    limits: ["Only fixed in-memory fixture stubs run; no model requests or application tools are invoked.",
      "These bytes exercise the installed AI SDK and OpenAI-compatible provider, not a live server or a complete application.",
      "Guarded execution uses original wire evidence and a caller-owned whole-batch policy; native and guarded behaviors can legitimately differ.",
      "SDK-assigned IDs absent from wire data are labelled by first-use order; matching labels require identical actual IDs in execution and result requests.",
      "Reports omit raw inputs and final text; hashes, tool names, call IDs and provenance remain."] };
}
