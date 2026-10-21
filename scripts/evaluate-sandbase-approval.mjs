import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { platform, release } from "node:os";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Applies only a test patch to an explicitly supplied, pinned clean checkout.
// Clone and frozen npm installation remain visible commands in the runbook.
const { values } = parseArgs({ options: { checkout: { type: "string" }, output: { type: "string" } } });
if (!values.checkout || !values.output) throw new Error("Use --checkout <clean Sandbase clone> --output <new results directory>");
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node 22+ required");
const checkout = realpathSync(resolve(values.checkout));
const requestedOutput = resolve(values.output);
const output = join(realpathSync(dirname(requestedOutput)), basename(requestedOutput));
const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const patch = join(source, "docs/evidence/2026-10-21/sandbase-approval/experiment.patch");
const expectedHead = "427b52a96a5309ca23268407f85c237468ab6a4e";
const expectedLock = "3bfdbfe41522b0e8c312478caee6dbc290e159b2242b070fba1f9a3a3694b345";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const baseEnv = { ...process.env };
delete baseEnv.PSJ_APPROVAL_MODE;
delete baseEnv.PSJ_APPROVAL_OUTPUT;

function git(args) {
  const result = spawnSync("git", args, { cwd: checkout, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
assert.equal(git(["rev-parse", "HEAD"]), expectedHead, "unexpected Sandbase source");
assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "", "checkout must be clean; existing changes are never reset");
assert.equal(sha256(readFileSync(join(checkout, "package-lock.json"))), expectedLock, "unchanged lock bytes required");
const withinCheckout = relative(checkout, output);
assert.ok(withinCheckout.startsWith(`..${sep}`) || withinCheckout === ".." || isAbsolute(withinCheckout),
  "write results outside the source checkout");
assert.ok(!existsSync(output), "results directory must be new; previous evidence is never overwritten");
const packages = {};
for (const name of ["ai", "prefix-safe-json", "zod", "vitest", "typescript"]) {
  const path = join(checkout, "node_modules", name, "package.json");
  const installed = realpathSync(path);
  assert.ok(installed.startsWith(join(realpathSync(checkout), "node_modules") + sep), "no dependency overlay or external link");
  packages[name] = JSON.parse(readFileSync(path, "utf8")).version;
}
assert.equal(packages.ai, "7.0.128");
assert.equal(packages["prefix-safe-json"], "0.5.0");
assert.equal(packages.zod, "4.6.5");
mkdirSync(output, { recursive: true });
const commands = [];
function node(name, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, { cwd: checkout, env: { ...baseEnv, ...extraEnv },
    encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(output, `${name}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  commands.push({ name, command: ["node", ...args], exit: result.status, signal: result.signal });
  if (result.status !== 0) throw new Error(`${name} failed; inspect its result log`);
}
let npm = null;
for (const path of [join(dirname(process.execPath), "node_modules/npm/package.json"),
  resolve(dirname(process.execPath), "../lib/node_modules/npm/package.json")]) {
  if (existsSync(path)) { npm = JSON.parse(readFileSync(path, "utf8")).version; break; }
}
const environment = { measuredAt: new Date().toISOString(), node: process.versions.node, npm,
  os: `${platform()} ${release()}`, source: expectedHead, packageLockSha256: expectedLock,
  patchSha256: sha256(readFileSync(patch)), packages, cleanSourceBeforePatch: true,
  model: "scripted v4 protocol fixture through installed AI SDK 7; no live provider" };
writeFileSync(join(output, "environment.json"), JSON.stringify(environment, null, 2) + "\n");

try {
  const vitest = "node_modules/vitest/vitest.mjs";
  node("baseline", [vitest, "run", "tests/integration/tool-confirmation-reliability.test.ts",
    "tests/integration/post-terminal-authority.test.ts", "--maxWorkers=1"]);
  git(["apply", "--check", patch]);
  git(["apply", patch]);
  const rows = [];
  for (const mode of ["psj", "native", "native-check"]) {
    const path = join(output, `results-${mode}.jsonl`);
    node(`experiment-${mode}`, [vitest, "run", "tests/integration/tool-confirmation-reliability.test.ts", "--maxWorkers=1"],
      { PSJ_APPROVAL_MODE: mode, PSJ_APPROVAL_OUTPUT: path });
    const measured = readFileSync(path, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(measured.length, 5);
    assert.ok(measured.every(row => row.mode === mode));
    rows.push(...measured);
  }
  const cases = ["healthy", "length", "schema-invalid", "raw-projection-conflict", "healthy-reapproval"];
  for (const name of cases) {
    const group = rows.filter(row => row.case === name);
    assert.equal(group.length, 3);
    assert.equal(new Set(group.map(row => row.scriptSha256)).size, 1, "same model script in all modes");
    assert.equal(new Set(group.map(row => row.lifecycleSha256)).size, 1, "same recorded initial lifecycle in all modes");
    for (const row of group) {
      assert.equal(sha256(JSON.stringify(row.lifecycle[0])), row.lifecycleSha256);
      assert.equal(row.before.successfulWrites, 0);
      assert.equal(row.before.attemptedWrites, 0);
      assert.equal(row.repeatedApproval.accepted, false);
      assert.equal(row.afterRepeat.successfulWrites, row.after.successfulWrites);
      assert.equal(row.afterRepeat.attemptedWrites, row.after.attemptedWrites);
      assert.deepEqual(row.afterRepeat.files, row.after.files);
      assert.equal(row.afterRepeat.modelRequests, row.after.modelRequests);
    }
    const projection = row => ({ pending: row.before.pending, firstAccepted: row.firstApproval.accepted,
      after: row.after, repeat: row.afterRepeat, unnecessaryRefusal: row.unnecessaryRefusal });
    assert.deepEqual(projection(group.find(row => row.mode === "psj")),
      projection(group.find(row => row.mode === "native-check")), "PSJ/native-check measured behavior differs");
  }
  for (const [name, args] of [["typecheck-src", ["--noEmit"]],
    ["typecheck-tests", ["--noEmit", "-p", "tsconfig.tests.json"]],
    ["typecheck-console", ["--noEmit", "-p", "apps/console/tsconfig.json"]]]) {
    node(name, ["node_modules/typescript/bin/tsc", ...args]);
  }
  assert.equal(git(["diff", "--name-only", "HEAD", "--", "src", "package.json", "package-lock.json"]), "");
  git(["diff", "--check"]);
  const summary = { environment, baselineCases: 13, measuredCases: rows.length,
    modes: Object.fromEntries(["psj", "native", "native-check"].map(mode => [mode, {
      cases: rows.filter(row => row.mode === mode).length,
      policySatisfied: rows.filter(row => row.mode === mode && row.policySatisfied).length,
      unnecessaryRefusals: rows.filter(row => row.mode === mode && row.unnecessaryRefusal).length,
    }])), identicalInitialLifecycles: true, sameMeasuredPsjAndNativeCheckBehavior: true,
    productionSourceAndLockUnchanged: true, conclusion: "Same measured behavior; maintenance preference unmeasured",
    limits: ["five authored scripted-model cases, not provider incidents", "selected lifecycle fields, not complete wire capture",
      "temporary DB/files inspected then removed by existing teardown", "no process-restart/crash replay experiment", "not new adoption"] };
  writeFileSync(join(output, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary));
} finally {
  writeFileSync(join(output, "commands.json"), JSON.stringify(commands, null, 2) + "\n");
}
