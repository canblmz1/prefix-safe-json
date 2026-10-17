#!/usr/bin/env node
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseFixture, readJson, readResponses, RegressionInputError, sha256 } from "./data.js";
import { runRegression } from "./index.js";
import { doctor } from "./versions.js";

const help = `psj-regression — offline raw-stream checks through your installed SDK

Commands:
  psj-regression doctor [--json]
      Show installed peer versions. No API key or network is needed.
  psj-regression init --out ./tool-regression [--dry-run] [--json]
      Copy authored SSE fixtures and reviewed expectations to a NEW directory.
  psj-regression inspect suite.json [--json]
      Validate capture files and show their hashes without running the SDK.
  psj-regression run suite.json [--json]
      Diagnose native execution and PSJ's caller-owned policy with memory stubs.
  psj-regression check suite.json --expect expected.json [--json]
      Compare inputs, effects, result IDs, continuation and PSJ decisions in CI.

Node 22+, ai 7.x, @ai-sdk/openai-compatible 3.x and prefix-safe-json 0.6.x.
Only raw OpenAI-compatible Chat Completions SSE is supported in this prototype.
No application tools run. Reports omit argument values and final text.
Exit: 0 diagnostic success/matching expectations; 1 mismatch; 2 setup/input error.
Without --expect, exit 0 means a report was generated, not that behavior passed.
`;

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({ options: { json: { type: "boolean" }, help: { type: "boolean" },
      expect: { type: "string" }, out: { type: "string" }, "dry-run": { type: "boolean" } },
      strict: true, allowPositionals: true });
  } catch { throw new RegressionInputError("E_USAGE", "Invalid arguments. Use --help."); }
  const { values, positionals } = parsed;
  const [command, file] = positionals;
  const emit = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  if (values.help || command === undefined) { process.stdout.write(help); return; }
  if (positionals.length > 2) throw new RegressionInputError("E_USAGE", "Unexpected positional argument.");
  if (command === "doctor") {
    if (file || values.expect || values.out || values["dry-run"]) throw new RegressionInputError("E_USAGE", "doctor accepts only --json.");
    const result = doctor();
    if (values.json) emit(result);
    else process.stdout.write(`${result.ready ? "READY" : "SETUP REQUIRED"}: offline fixtures; no authentication\n${JSON.stringify(result.versions, null, 2)}\n`);
    if (!result.ready) process.exitCode = 2;
    return;
  }
  if (command === "init") {
    if (!values.out || file || values.expect) throw new RegressionInputError("E_USAGE", "init requires --out pointing to a new directory.");
    const source = new URL("../fixtures/", import.meta.url);
    const sourceFiles = (await readdir(source)).filter(name => name !== ".gitattributes").sort();
    const files = [...sourceFiles, ".gitattributes"];
    const directory = resolve(values.out);
    if (!values["dry-run"]) {
      try { await mkdir(directory); }
      catch { throw new RegressionInputError("E_OUTPUT", "Output directory must be new and its parent must exist."); }
      for (const name of sourceFiles) await cp(new URL(name, source), resolve(directory, name), { errorOnExist: true, force: false });
      await writeFile(resolve(directory, ".gitattributes"), "*.sse -text whitespace=-blank-at-eof\n", { flag: "wx" });
    }
    if (values.json) emit({ formatVersion: 1, status: values["dry-run"] ? "preview" : "initialized", directory, files });
    else process.stdout.write(`${values["dry-run"] ? "Would copy" : "Copied"} ${files.length} authored fixture files to ${directory}\nNext: psj-regression check ${JSON.stringify(resolve(directory, "suite.json"))} --expect ${JSON.stringify(resolve(directory, "expected.json"))}\n`);
    return;
  }
  if (!["inspect", "run", "check"].includes(command) || !file || values.out || values["dry-run"] ||
      (command === "check" && !values.expect) || (command !== "check" && values.expect)) {
    throw new RegressionInputError("E_USAGE", "Use inspect/run with a suite file, or check with --expect. See --help.");
  }
  if (command === "inspect") {
    const fixture = parseFixture(await readJson(file));
    const responses = await readResponses(file, fixture);
    const cases = fixture.cases.map(entry => {
      const bodies = responses.get(entry.id);
      if (!bodies) throw new RegressionInputError("E_READ", "A fixture response is missing.");
      return { id: entry.id, classification: entry.provenance.classification, responses: entry.responses.map((response, index) => {
        const body = bodies[index];
        if (body === undefined) throw new RegressionInputError("E_READ", "A fixture response is missing.");
        return { body: response.body, sha256: sha256(body) };
      }) };
    });
    emit({ formatVersion: 1, protocol: fixture.protocol, tools: Object.keys(fixture.tools), cases });
    return;
  }
  if (!doctor().ready) throw new RegressionInputError("E_PEERS", "Required SDK peers are missing or unsupported. Run doctor.");
  const report = await runRegression({ fixture: file, ...(values.expect ? { expect: values.expect } : {}) });
  if (values.json) emit(report);
  else {
    process.stdout.write(`${report.expectations.checked ? report.expectations.pass ? "PASS" : "FAIL" : "DIAGNOSTIC"}: ${report.cases.length} cases through ai@${report.versions.ai} / provider@${report.versions.provider} / PSJ@${report.versions.psj}\n`);
    for (const entry of report.cases) process.stdout.write(`${entry.id}: native ${entry.native.executions.length} effects, ${entry.native.requests} requests; guarded ${entry.guarded.executions.length} effects, ${entry.guarded.requests} requests\n`);
    for (const mismatch of report.expectations.mismatches) process.stdout.write(`Changed: ${mismatch.caseId}.${mismatch.profile}.${mismatch.field}\n`);
  }
  if (report.expectations.pass === false) process.exitCode = 1;
}

main().catch(error => {
  const known = error instanceof RegressionInputError;
  const result = { formatVersion: 1, status: "error", error: {
    code: known ? error.code : "E_RUN", message: known ? error.message : "The offline SDK run failed. Check setup and fixture structure.",
  } };
  if (process.argv.includes("--json")) process.stderr.write(JSON.stringify(result) + "\n");
  else process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.exitCode = 2;
});
