import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { Json, ProfileExpectation, RegressionExpectations, RegressionFixture } from "./types.js";

export class RegressionInputError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function fail(message: string): never { throw new RegressionInputError("E_FORMAT", message); }

function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail("Unknown fixture or expectation field.");
}

function validateJson(value: unknown, depth = 0): void {
  if (depth > 64) fail("JSON nesting exceeds 64 levels.");
  if (typeof value === "number" && !Number.isFinite(value)) fail("JSON numbers must be finite.");
  if (Array.isArray(value)) for (const entry of value) validateJson(entry, depth + 1);
  else if (object(value)) for (const entry of Object.values(value)) validateJson(entry, depth + 1);
}

export async function readJson(path: string): Promise<unknown> {
  const text = await readBounded(path, 1024 * 1024);
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail("Input must contain valid JSON."); }
  validateJson(value);
  return value;
}

export async function readBounded(path: string, maxBytes: number): Promise<string> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > maxBytes) fail("Input is not a regular file within the size limit.");
    const bytes = await readFile(path);
    if (bytes.length > maxBytes) fail("Input exceeds the size limit.");
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (error instanceof RegressionInputError) throw error;
    throw new RegressionInputError("E_READ", "Could not read an input file as UTF-8.");
  }
}

export function parseFixture(value: unknown): RegressionFixture {
  if (!object(value)) fail("Fixture must be an object.");
  keys(value, ["formatVersion", "protocol", "tools", "cases"]);
  if (value.formatVersion !== 1 || value.protocol !== "openai-chat-completions-sse") fail("Unsupported fixture version or protocol.");
  if (!object(value.tools) || Object.keys(value.tools).length === 0 || Object.keys(value.tools).length > 32) fail("Register 1–32 harmless tool stubs.");
  for (const [name, tool] of Object.entries(value.tools)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/u.test(name) || !object(tool)) fail("Invalid tool stub.");
    keys(tool, ["inputSchema", "result"]);
    if (!object(tool.inputSchema) || !Object.hasOwn(tool, "result")) fail("A tool needs inputSchema and a fixed JSON result.");
  }
  if (!Array.isArray(value.cases) || value.cases.length === 0 || value.cases.length > 32) fail("Supply 1–32 fixture cases.");
  const ids = new Set<string>();
  for (const entry of value.cases) {
    if (!object(entry)) fail("Invalid case.");
    keys(entry, ["id", "positiveControl", "provenance", "responses"]);
    if (entry.positiveControl !== undefined && typeof entry.positiveControl !== "boolean") fail("positiveControl must be a boolean.");
    if (typeof entry.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/u.test(entry.id) || ids.has(entry.id)) fail("Case IDs must be unique, short names.");
    ids.add(entry.id);
    if (!object(entry.provenance)) fail("A case needs provenance.");
    keys(entry.provenance, ["classification", "note"]);
    if (!["authored", "recorded"].includes(String(entry.provenance.classification)) || typeof entry.provenance.note !== "string" || !entry.provenance.note.trim()) fail("Provenance needs a classification and note.");
    if (!Array.isArray(entry.responses) || entry.responses.length === 0 || entry.responses.length > 8) fail("A case needs 1–8 HTTP response bodies.");
    for (const response of entry.responses) {
      if (!object(response)) fail("Invalid response.");
      keys(response, ["body", "chunkBytes"]);
      if (typeof response.body !== "string" || !response.body.endsWith(".sse") || isAbsolute(response.body)) fail("Response bodies must be relative .sse files.");
      if (response.chunkBytes !== undefined && (!Number.isInteger(response.chunkBytes) || Number(response.chunkBytes) < 1 || Number(response.chunkBytes) > 65536)) fail("chunkBytes must be 1–65536.");
    }
    if (entry.positiveControl === true && entry.responses.length < 2) fail("A positive control must include continuation to a final response.");
  }
  if (!value.cases.some(entry => object(entry) && entry.positiveControl === true)) fail("Include at least one complete positiveControl case.");
  return value as unknown as RegressionFixture;
}

function parseProfile(value: unknown, guarded: boolean): void {
  if (!object(value)) fail("Missing profile expectation.");
  keys(value, ["requests", "executions", "toolResultIds", "finalText", "errorCount", "decisions"]);
  if (!Number.isInteger(value.requests) || Number(value.requests) < 1 || Number(value.requests) > 9 ||
      !Number.isInteger(value.errorCount) || Number(value.errorCount) < 0 || typeof value.finalText !== "string" ||
      !Array.isArray(value.executions) || !Array.isArray(value.toolResultIds)) fail("Invalid expected observation.");
  const id = (value: unknown) => typeof value === "string" || (object(value) && Object.keys(value).length === 1 &&
    Number.isInteger(value.sdkAssigned) && Number(value.sdkAssigned) > 0);
  if (value.toolResultIds.some(value => !id(value))) fail("Invalid expected result identity.");
  for (const execution of value.executions) {
    if (!object(execution)) fail("Invalid expected execution.");
    keys(execution, ["toolCallId", "name", "input"]);
    if (!id(execution.toolCallId) || typeof execution.name !== "string" || !Object.hasOwn(execution, "input")) fail("Expected executions need ID, name and input.");
  }
  if (guarded && !Array.isArray(value.decisions)) fail("Guarded expectations need explicit decisions.");
  if (value.decisions !== undefined) {
    if (!Array.isArray(value.decisions)) fail("Invalid expected decisions.");
    for (const decision of value.decisions) {
      if (!object(decision)) fail("Invalid expected decision.");
      keys(decision, ["action", "reason", "name", "toolCallId"]);
      if (!["execute", "retry", "reject"].includes(String(decision.action)) || typeof decision.reason !== "string" || !decision.reason ||
          (decision.name !== undefined && typeof decision.name !== "string") || (decision.toolCallId !== undefined && typeof decision.toolCallId !== "string")) fail("Expected decisions need action and reason.");
    }
  }
}

export function parseExpectations(value: unknown): RegressionExpectations {
  if (!object(value)) fail("Expectations must be an object.");
  keys(value, ["formatVersion", "cases"]);
  if (value.formatVersion !== 1 || !Array.isArray(value.cases) || value.cases.length === 0 || value.cases.length > 32) fail("Expectations need version 1 and 1–32 cases.");
  const ids = new Set<string>();
  for (const entry of value.cases) {
    if (!object(entry)) fail("Invalid expected case.");
    keys(entry, ["id", "native", "guarded"]);
    if (typeof entry.id !== "string" || ids.has(entry.id)) fail("Expected case IDs must be unique.");
    ids.add(entry.id);
    parseProfile(entry.native, false);
    parseProfile(entry.guarded, true);
  }
  return value as unknown as RegressionExpectations;
}

export async function readResponses(fixturePath: string, fixture: RegressionFixture): Promise<Map<string, string[]>> {
  const root = await realpath(dirname(resolve(fixturePath)));
  const bodies = new Map<string, string[]>();
  let bytes = 0;
  for (const entry of fixture.cases) {
    const responses: string[] = [];
    for (const response of entry.responses) {
      let target: string;
      try { target = await realpath(resolve(root, response.body)); }
      catch { throw new RegressionInputError("E_READ", `Response body file is unavailable: ${response.body}`); }
      const inside = relative(root, target);
      if (inside.startsWith("..") || isAbsolute(inside)) fail("Response files must stay inside the fixture directory.");
      const text = await readBounded(target, 8 * 1024 * 1024);
      bytes += Buffer.byteLength(text);
      if (bytes > 32 * 1024 * 1024) fail("Suite response bodies exceed 32 MiB.");
      responses.push(text);
    }
    bodies.set(entry.id, responses);
  }
  return bodies;
}

export function canonical(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

export function compareProfile(actual: ProfileExpectation, expected: ProfileExpectation): string[] {
  const fields = ["requests", "finalText", "errorCount"] as const;
  const changed = fields.filter(field => canonical(actual[field] as Json) !== canonical(expected[field] as Json)) as string[];
  if (actual.executions.length !== expected.executions.length) changed.push("executions.length");
  for (const [index, wanted] of expected.executions.entries()) {
    const observed = actual.executions[index];
    if (!observed) continue;
    for (const field of ["toolCallId", "name", "input"] as const) {
      if (canonical(observed[field]) !== canonical(wanted[field])) changed.push(`executions[${index}].${field}`);
    }
  }
  if (canonical(actual.toolResultIds) !== canonical(expected.toolResultIds)) changed.push("toolResultIds");
  if (expected.decisions) {
    const projected = actual.decisions?.map((decision, index) => {
      const wanted = expected.decisions?.[index];
      if (!wanted) return decision;
      return Object.fromEntries(Object.keys(wanted).map(key => [key, decision[key as keyof typeof decision]]));
    });
    if (canonical((projected ?? []) as Json) !== canonical(expected.decisions as Json)) changed.push("decisions");
  }
  return changed;
}
