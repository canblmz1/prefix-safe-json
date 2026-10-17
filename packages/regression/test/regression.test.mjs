import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runRegression } from "../dist/index.js";
import { chunk, call, sse, writeExample } from "./helpers.mjs";

const fixture = fileURLToPath(new URL("../fixtures/suite.json", import.meta.url));
const expect = fileURLToPath(new URL("../fixtures/expected.json", import.meta.url));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const load = async path => JSON.parse(await readFile(path, "utf8"));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + "\n");
async function temporaryFixture() {
  const directory = await mkdtemp(join(tmpdir(), "psj-regression-test-"));
  const suite = await writeExample(directory);
  const expected = await load(expect);
  await save(join(directory, "expected.json"), expected);
  return { directory, suite, expected, fixture: join(directory, "suite.json"), expect: join(directory, "expected.json") };
}
const command = args => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd: tmpdir(), timeout: 30_000 });

test("real installed transport parser, interleaved inputs, native controls and paired continuation pass", async () => {
  const original = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => { networkRequests++; throw new Error("A live request is forbidden in this test."); };
  try {
    const report = await runRegression({ fixture, expect });
    assert.equal(report.expectations.pass, true);
    assert.equal(report.cases.length, 6);
    assert.equal(networkRequests, 0);
    const complete = report.cases[0];
    assert.equal(complete.native.requests, 2);
    assert.equal(complete.native.executions.length, 1);
    assert.deepEqual(complete.native.toolResultIds, ["call_a"]);
    assert.equal(complete.guarded.requests, 2);
    assert.equal(report.cases[1].native.executions.length, 2);
    assert.equal(report.cases[2].native.executions.length, 0, "Native truncation handling already suffices for this case");
    assert.equal(report.cases[3].native.executions.length, 2);
    assert.deepEqual(report.cases[3].native.executions[1].toolCallId, { sdkAssigned: 1 });
    assert.deepEqual(report.cases[3].native.toolResultIds, ["call_a", { sdkAssigned: 1 }]);
    assert.equal(report.cases[3].guarded.executions.length, 0);
    assert.match(report.cases[3].guarded.decisions[0].explanation, /identity/);
    assert.equal(report.cases[3].guarded.decisions[0].evidence.structurallyComplete, true);
    assert.equal(report.cases[4].native.errorCount, 1);
    assert.equal(report.cases[5].native.requests, 2, "Native schema/parse errors can be returned to the next model step");
    assert.equal(report.cases[5].guarded.requests, 1, "The guarded batch policy deliberately refuses continuation");
  } finally { globalThis.fetch = original; }
});

test("a changed raw argument reaches the actual SDK and yields a precise redacted mismatch", async () => {
  const temp = await temporaryFixture();
  const path = join(temp.directory, "complete.sse");
  await writeFile(path, (await readFile(path, "utf8")).replace("alpha", "private-changed-value"));
  const report = await runRegression({ fixture: temp.fixture, expect: temp.expect });
  assert.equal(report.expectations.pass, false);
  assert.ok(report.expectations.mismatches.some(m => m.caseId === "complete" && m.profile === "native" && m.field === "executions[0].input"));
  assert.ok(report.expectations.mismatches.some(m => m.caseId === "complete" && m.profile === "guarded" && m.field === "executions[0].input"));
  assert.equal(JSON.stringify(report).includes("private-changed-value"), false);
  assert.notEqual(report.cases[0].responseSha256[0], (await runRegression({ fixture })).cases[0].responseSha256[0]);
});

test("changing a wire finish reason changes SDK execution, rather than replaying old decoded events", async () => {
  const temp = await temporaryFixture();
  const path = join(temp.directory, "length.sse");
  await writeFile(path, (await readFile(path, "utf8")).replace('"length"', '"tool_calls"'));
  const report = await runRegression({ fixture: temp.fixture, expect: temp.expect });
  assert.equal(report.expectations.pass, false);
  assert.equal(report.cases[2].native.executions.length, 1);
  assert.ok(report.expectations.mismatches.some(m => m.caseId === "token-limit" && m.profile === "native" && m.field === "executions.length"));
});

test("SDK-assigned IDs are reproducible labels that retain exact result correlation", async () => {
  const first = await runRegression({ fixture, expect });
  const second = await runRegression({ fixture, expect });
  assert.deepEqual(first, second);
  const temp = await temporaryFixture();
  temp.expected.cases[3].native.toolResultIds[1] = { sdkAssigned: 2 };
  await save(temp.expect, temp.expected);
  const report = await runRegression({ fixture: temp.fixture, expect: temp.expect });
  assert.equal(report.expectations.pass, false);
  assert.ok(report.expectations.mismatches.some(m => m.caseId === "duplicate-id" && m.field === "toolResultIds"));
});

test("an invalid sibling leaves the entire guarded batch without effects", async () => {
  const temp = await temporaryFixture();
  await writeFile(join(temp.directory, "interleaved.sse"), sse([
    chunk({ role: "assistant", tool_calls: [call(0, "call_a", "record", '{"message":"alpha"}'), call(1, "call_b", "record", '{"message":12}')] }),
    chunk({}, "tool_calls"),
  ]));
  const report = await runRegression({ fixture: temp.fixture });
  assert.equal(report.cases[1].native.executions.length, 1);
  assert.equal(report.cases[1].guarded.executions.length, 0);
  assert.equal(report.cases[1].guarded.requests, 1);
});

test("empty suites, unreviewed controls, unknown fields and invalid captures fail explicitly", async () => {
  const temp = await temporaryFixture();
  const bad = [
    { ...temp.suite, cases: [] },
    { ...temp.suite, unknown: true },
    { ...temp.suite, cases: temp.suite.cases.map(entry => ({ ...entry, positiveControl: false })) },
  ];
  for (const suite of bad) {
    await save(temp.fixture, suite);
    await assert.rejects(runRegression({ fixture: temp.fixture }), /case|field|positiveControl/i);
  }
  await save(temp.fixture, temp.suite);
  temp.expected.cases[0].native.executions = [];
  await save(temp.expect, temp.expected);
  await assert.rejects(runRegression({ fixture: temp.fixture, expect: temp.expect }), /positive control/i);
  for (const response of new Set(temp.suite.cases.flatMap(entry => entry.responses.map(r => r.body)))) {
    await writeFile(join(temp.directory, response), '{"parsedToolCall":{"message":"not original SSE"}}\n');
  }
  await assert.rejects(runRegression({ fixture: temp.fixture }), /No tool calls/);
});

test("response references cannot escape the suite directory and invalid UTF-8 is rejected", async () => {
  const temp = await temporaryFixture();
  const outside = join(temp.directory, "..", `outside-${Date.now()}.sse`);
  await writeFile(outside, "data: [DONE]\n\n");
  temp.suite.cases[0].responses[0].body = `../${outside.split(/[\\/]/).at(-1)}`;
  await save(temp.fixture, temp.suite);
  await assert.rejects(runRegression({ fixture: temp.fixture }), /inside the fixture/);
  temp.suite.cases[0].responses[0].body = "complete.sse";
  await save(temp.fixture, temp.suite);
  await writeFile(join(temp.directory, "complete.sse"), Buffer.from([0xc3, 0x28]));
  await assert.rejects(runRegression({ fixture: temp.fixture }), /UTF-8/);
});

test("CLI works outside the checkout, preserves stdout JSON, and returns 0/1/2 distinctly", async () => {
  assert.equal(command(["--help"]).status, 0);
  assert.equal(command(["doctor", "--json"]).status, 0);
  const passed = command(["check", fixture, "--expect", expect, "--json"]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.equal(passed.stderr, "");
  assert.equal(JSON.parse(passed.stdout).expectations.pass, true);
  const temp = await temporaryFixture();
  temp.expected.cases[1].native.executions[0].input.message = "different-reviewed-value";
  await save(temp.expect, temp.expected);
  const failed = command(["check", temp.fixture, "--expect", temp.expect, "--json"]);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).expectations.pass, false);
  const invalid = command(["check", fixture, "--json"]);
  assert.equal(invalid.status, 2);
  assert.equal(invalid.stdout, "");
  assert.equal(JSON.parse(invalid.stderr).error.code, "E_USAGE");
  const diagnostic = command(["run", fixture, "--json"]);
  assert.equal(diagnostic.status, 0);
  assert.equal(JSON.parse(diagnostic.stdout).expectations.pass, null);
});

test("init supports preview, ships reviewed data, and refuses to overwrite an existing directory", async () => {
  const parent = await mkdtemp(join(tmpdir(), "psj-regression-init-"));
  const directory = join(parent, "new-suite");
  const preview = command(["init", "--out", directory, "--dry-run", "--json"]);
  assert.equal(preview.status, 0);
  assert.equal(JSON.parse(preview.stdout).status, "preview");
  const initialized = command(["init", "--out", directory, "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(await readFile(join(directory, ".gitattributes"), "utf8"), "*.sse -text whitespace=-blank-at-eof\n");
  const checked = command(["check", resolve(directory, "suite.json"), "--expect", resolve(directory, "expected.json")]);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(command(["init", "--out", directory]).status, 2);
});

test("help, inspection and missing-peer diagnostics work before any SDK can be imported", async () => {
  const directory = await mkdtemp(join(tmpdir(), "psj-regression-no-peers-"));
  await cp(new URL("../dist/", import.meta.url), join(directory, "dist"), { recursive: true });
  await cp(new URL("../package.json", import.meta.url), join(directory, "package.json"));
  const bare = args => spawnSync(process.execPath, [join(directory, "dist/cli.js"), ...args], { encoding: "utf8", cwd: tmpdir() });
  assert.equal(bare(["--help"]).status, 0);
  const setup = bare(["doctor", "--json"]);
  assert.equal(setup.status, 2);
  assert.equal(JSON.parse(setup.stdout).ready, false);
  const inspected = bare(["inspect", fixture, "--json"]);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).cases[0].responses[0].body, "complete.sse");
  const check = bare(["check", fixture, "--expect", expect, "--json"]);
  assert.equal(check.status, 2);
  assert.equal(JSON.parse(check.stderr).error.code, "E_PEERS");
});
