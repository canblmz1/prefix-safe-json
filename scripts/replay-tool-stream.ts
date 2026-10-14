// Local development tool: replay recorded evidence without dispatching tools.
import { createReadStream, readFileSync } from "node:fs";
import { TextDecoder } from "node:util";
import { parseArgs } from "node:util";
import process from "node:process";
import console from "node:console";
import {
  AnthropicStreamAdapter,
  createAiSdkExecutionGuard,
  createToolCallExecutionGate,
  type ExecutionAction,
  type ExecutionDecision,
  type ExecutionReason,
  type JsonSchemaLike,
} from "../src/index.js";

const HELP = `Replay a recorded tool-call stream locally. No tools or model requests run.

Usage:
  pnpm exec tsx scripts/replay-tool-stream.ts --provider anthropic|ai-sdk --input trace.jsonl [--schemas schemas.json] [--expect expected.json] [--json]

Input: one original decoded provider/SDK event per JSON line, in arrival order.
Exit: 0 report/matching expectations; 1 expectation mismatch; 2 invalid input.
Reports omit argument values and diagnostic messages; call identifiers remain.
`;

const explanations: Record<ExecutionReason, string> = {
  complete: "The recorded evidence satisfies the execution gate.",
  truncated: "The original argument stream did not finish structurally.",
  stream_incomplete: "The stream lacks safe completion, even if its JSON is complete.",
  schema_invalid: "Original arguments failed the supplied tool schema.",
  malformed: "The original argument stream contains malformed JSON.",
  resource_limit: "A parser or coordinator resource limit was reached.",
  provider_error: "The recorded stream contains a provider failure.",
  content_filtered: "The recorded stream ended under a content restriction.",
  sdk_execution_observed: "The stream reports SDK execution; caller-owned authority is withheld.",
  projection_only: "A parsed projection has insufficient original argument evidence.",
  protocol_violation: "Recorded identity or lifecycle evidence is contradictory or out of order.",
  unknown: "The recorded evidence does not establish an execution outcome.",
};

class InputError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readText(path: string, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of createReadStream(path)) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      if (bytes > maxBytes) throw new InputError("E_FILE_LIMIT", "Input exceeds the documented file-size limit.");
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError("E_INPUT_READ", "Could not read an input file.");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new InputError("E_INPUT_ENCODING", "Input must be valid UTF-8.");
  }
}

function parseJson(text: string, description: string): unknown {
  try { return JSON.parse(text) as unknown; }
  catch { throw new InputError("E_INPUT_JSON", `Invalid JSON in ${description}.`); }
}

interface ExpectedCall {
  action: ExecutionAction;
  reason: ExecutionReason;
  name?: string;
  toolCallId?: string;
}

function expectedCalls(value: unknown): ExpectedCall[] {
  if (!object(value) || value.formatVersion !== 1 || !Array.isArray(value.calls) ||
      Object.keys(value).some(key => !["formatVersion", "calls"].includes(key))) {
    throw new InputError("E_EXPECTATION_FORMAT", "Expectations require formatVersion 1 and a calls array.");
  }
  return value.calls.map((call: unknown) => {
    if (!object(call) || typeof call.action !== "string" || !["execute", "retry", "reject"].includes(call.action) ||
        typeof call.reason !== "string" || !Object.hasOwn(explanations, call.reason) ||
        (call.name !== undefined && typeof call.name !== "string") ||
        (call.toolCallId !== undefined && typeof call.toolCallId !== "string") ||
        Object.keys(call).some(key => !["action", "reason", "name", "toolCallId"].includes(key))) {
      throw new InputError("E_EXPECTATION_FORMAT", "Each expected call needs a valid action and reason; optional name and toolCallId must be strings.");
    }
    return call as unknown as ExpectedCall;
  });
}

function compare(decisions: readonly ExecutionDecision[], expected: ExpectedCall[]) {
  const mismatches: Array<{ call: number | null; field: string }> = [];
  if (decisions.length !== expected.length) mismatches.push({ call: null, field: "callCount" });
  for (let index = 0; index < expected.length; index++) {
    const actual = decisions[index];
    const wanted = expected[index];
    if (!actual || !wanted) continue;
    for (const field of ["action", "reason", "name", "toolCallId"] as const) {
      if (wanted[field] !== undefined && actual[field] !== wanted[field]) mismatches.push({ call: index, field });
    }
  }
  return { checked: true, pass: mismatches.length === 0, mismatches };
}

async function main(): Promise<void> {
  let options;
  try {
    options = parseArgs({ options: {
      provider: { type: "string" }, input: { type: "string" }, schemas: { type: "string" },
      expect: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" },
    }, allowPositionals: false, strict: true }).values;
  } catch {
    throw new InputError("E_USAGE", "Invalid arguments. Use --help for usage.");
  }
  if (options.help) { process.stdout.write(HELP); return; }
  if (!options.input || !["anthropic", "ai-sdk"].includes(options.provider ?? "")) {
    throw new InputError("E_USAGE", "Supply --input and --provider anthropic or ai-sdk.");
  }
  let schemas: Record<string, JsonSchemaLike> | undefined;
  if (options.schemas) {
    const value = parseJson(await readText(options.schemas, 1024 * 1024), "schemas");
    if (!object(value)) throw new InputError("E_SCHEMA_FORMAT", "Schemas must be an object keyed by tool name.");
    schemas = value as Record<string, JsonSchemaLike>;
  }
  const expected = options.expect ? expectedCalls(parseJson(await readText(options.expect, 1024 * 1024), "expectations")) : undefined;
  const text = await readText(options.input, 16 * 1024 * 1024);
  let engine;
  try {
    engine = options.provider === "ai-sdk"
      ? createAiSdkExecutionGuard({ schemas })
      : createToolCallExecutionGate(undefined, undefined, schemas);
  } catch {
    throw new InputError("E_SCHEMA_FORMAT", "Tool schemas could not be registered.");
  }
  const adapter = options.provider === "anthropic" ? new AnthropicStreamAdapter() : undefined;
  let eventCount = 0;
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    if (++eventCount > 100_000) throw new InputError("E_EVENT_LIMIT", "Trace exceeds 100000 events.");
    const raw = parseJson(line, `trace line ${index + 1}`);
    if (!object(raw)) throw new InputError("E_EVENT_FORMAT", `Trace line ${index + 1} must contain an event object.`);
    if (adapter) for (const event of adapter.push(raw)) engine.push(event);
    else engine.push(raw);
  }
  if (eventCount === 0) throw new InputError("E_EMPTY_TRACE", "The trace contains no events.");
  if (adapter) for (const event of adapter.finish()) engine.push(event);
  const result = engine.finish();
  if (result.decisions.length === 0) {
    throw new InputError("E_NO_TOOL_CALLS", "No tool calls were recognized; verify the selected provider and capture boundary.");
  }
  const report = {
    formatVersion: 1, scope: "recorded-events", provider: options.provider, eventCount,
    libraryVersion: (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
    calls: result.decisions.map((decision, index) => ({
      call: index, toolCallId: decision.toolCallId ?? null, name: decision.name ?? null,
      action: decision.action, reason: decision.reason, explanation: explanations[decision.reason],
      evidence: {
        provider: decision.evidence.provider,
        streamEndReason: decision.evidence.streamEndReason,
        terminalConfirmed: decision.evidence.terminalConfirmed,
        structurallyComplete: decision.evidence.structurallyComplete,
        parserExecutable: decision.evidence.parserExecutable,
        schemaValid: decision.evidence.schemaValid,
        receivedBytes: decision.evidence.receivedBytes,
      },
      diagnosticCodes: [...new Set([...decision.parserDiagnostics, ...decision.coordinatorDiagnostics].map(item => item.code))],
    })),
    diagnosticCodes: [...new Set(result.diagnostics.map(item => item.code))],
    expectations: expected ? compare(result.decisions, expected) : { checked: false, pass: null, mismatches: [] },
  };
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`PSJ replay: ${report.provider}; ${eventCount} recorded events; ${report.calls.length} calls`);
    for (const call of report.calls) console.log(`[${call.call}] ${JSON.stringify(call.name)}: ${call.action} (${call.reason}) — ${call.explanation}`);
    console.log(expected ? `Expectations: ${report.expectations.pass ? "PASS" : "FAIL"}` : "Expectations: not supplied");
    for (const mismatch of report.expectations.mismatches) console.log(`Mismatch: call ${mismatch.call ?? "count"}, ${mismatch.field}`);
    console.log("Offline evidence replay only; no tool was dispatched.");
  }
  process.exitCode = report.expectations.pass === false ? 1 : 0;
}

main().catch((error: unknown) => {
  const failure = error instanceof InputError ? error : new InputError("E_REPLAY", "Replay failed; check the recorded event shape and schemas.");
  if (process.argv.includes("--json")) console.log(JSON.stringify({ formatVersion: 1, error: { code: failure.code, message: failure.message } }));
  else console.error(`${failure.code}: ${failure.message}`);
  process.exitCode = 2;
});
