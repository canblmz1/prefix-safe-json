import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cli = join(root, "scripts/replay-tool-stream.ts");
const tsx = join(root, "node_modules/tsx/dist/cli.mjs");
const missingStop = readFileSync(join(root, "examples/replay/anthropic-missing-stop.jsonl"), "utf8");
const complete = missingStop + '{"type":"message_stop"}\n';
const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});

function replay(trace: string | Buffer, options: { provider?: string; expected?: unknown; schemas?: unknown } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "psj-replay-"));
  temporary.push(directory);
  const input = join(directory, "trace.jsonl");
  writeFileSync(input, trace);
  const args = [tsx, cli, "--provider", options.provider ?? "anthropic", "--input", input, "--json"];
  for (const [flag, value] of [["expect", options.expected], ["schemas", options.schemas]] as const) {
    if (value === undefined) continue;
    const path = join(directory, `${flag}.json`);
    writeFileSync(path, JSON.stringify(value));
    args.push(`--${flag}`, path);
  }
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", timeout: 8_000 });
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  return { status: result.status, stdout: result.stdout, report: JSON.parse(result.stdout) as Record<string, unknown> };
}

const expected = (action: string, reason: string) => ({ formatVersion: 1, calls: [{ name: "record", action, reason }] });

describe("recorded tool-stream replay CLI", () => {
  it("checks a complete call without disclosing arguments or dispatching the named tool", () => {
    const trace = complete.replace("hello", "PRIVATE_ARGUMENT_MARKER");
    const result = replay(trace, { expected: expected("execute", "complete") });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({
      formatVersion: 1, scope: "recorded-events", eventCount: 6,
      calls: [{ name: "record", action: "execute", reason: "complete", evidence: { terminalConfirmed: true } }],
      expectations: { checked: true, pass: true },
    });
    expect(result.stdout).not.toContain("PRIVATE_ARGUMENT_MARKER");
    expect(result.stdout).not.toContain('"value"');
    expect(result.stdout).not.toContain('"stableValue"');
  });

  it("makes a missing terminal event a regression failure when execution was expected", () => {
    const match = replay(missingStop, { expected: expected("retry", "stream_incomplete") });
    expect(match.status).toBe(0);
    expect(match.report).toMatchObject({ calls: [{ evidence: { structurallyComplete: true, terminalConfirmed: false } }] });
    const mismatch = replay(missingStop, { expected: expected("execute", "complete") });
    expect(mismatch.status).toBe(1);
    expect(mismatch.report).toMatchObject({ expectations: { pass: false, mismatches: [{ call: 0, field: "action" }, { call: 0, field: "reason" }] } });
  });

  it("drains contradictory post-terminal evidence before deciding", () => {
    const result = replay(complete + '{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":" "}}\n');
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ eventCount: 7, calls: [{ action: "reject", reason: "protocol_violation" }] });
  });

  it("keeps interleaved AI SDK call identities separate under a token limit", () => {
    const events = [
      { type: "tool-input-start", id: "a", toolName: "first" },
      { type: "tool-input-start", id: "b", toolName: "second" },
      { type: "tool-input-delta", id: "a", delta: '{"message":"PRIVATE_ARGUMENT_MARKER"}' },
      { type: "tool-input-delta", id: "b", delta: '{"message":"cut' },
      { type: "tool-input-end", id: "a" },
      { type: "tool-input-end", id: "b" },
      { type: "finish", finishReason: "length" },
    ];
    const result = replay(events.map(event => JSON.stringify(event)).join("\n"), { provider: "ai-sdk" });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ calls: [
      { toolCallId: "a", name: "first", action: "retry", reason: "stream_incomplete" },
      { toolCallId: "b", name: "second", action: "retry", reason: "truncated" },
    ] });
    expect(result.stdout).not.toContain("PRIVATE_ARGUMENT_MARKER");
  });

  it("reports supplied schema failures as decisions", () => {
    const result = replay(complete, { schemas: { record: { type: "object", required: ["missing"] } }, expected: expected("reject", "schema_invalid") });
    expect(result.status).toBe(0);
    expect(result.report).toMatchObject({ calls: [{ action: "reject", reason: "schema_invalid", evidence: { schemaValid: false } }] });
  });

  it.each([
    ["empty trace", "\n", "anthropic", "E_EMPTY_TRACE"],
    ["wrong capture boundary", complete, "ai-sdk", "E_NO_TOOL_CALLS"],
    ["malformed trace", '{"PRIVATE_ARGUMENT_MARKER":\n', "anthropic", "E_INPUT_JSON"],
    ["corrupt UTF-8", Buffer.from([0xff, 0xfe]), "anthropic", "E_INPUT_ENCODING"],
  ])("fails closed for %s", (_label, trace, provider, code) => {
    const result = replay(trace, { provider });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ error: { code } });
    expect(result.stdout).not.toContain("PRIVATE_ARGUMENT_MARKER");
  });

  it("rejects malformed expectations instead of coercing their types", () => {
    const result = replay(complete, { expected: { formatVersion: 1, calls: [{ action: ["execute"], reason: "complete" }] } });
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ error: { code: "E_EXPECTATION_FORMAT" } });
  });
});
