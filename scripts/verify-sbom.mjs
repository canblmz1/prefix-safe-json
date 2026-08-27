import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import {
  buildCycloneDx,
  defaultSbomPath,
  readProductionDependencyTree,
  serializeCycloneDx,
} from "./generate-sbom.mjs";

function fail(message) {
  throw new Error(`SBOM policy violation: ${message}`);
}

try {
  const tree = readProductionDependencyTree();
  const sbomPath = resolve(process.argv[2] ?? defaultSbomPath(tree.version));
  const actualText = readFileSync(sbomPath, "utf8");
  const actual = JSON.parse(actualText);
  const expected = buildCycloneDx(tree);
  const expectedText = serializeCycloneDx(expected);

  if (actualText !== expectedText) {
    fail("artifact differs from the deterministic frozen production dependency graph");
  }
  if (actual.bomFormat !== "CycloneDX" || actual.specVersion !== "1.6") {
    fail("format must remain CycloneDX 1.6 JSON");
  }

  const rootRef = actual.metadata?.component?.["bom-ref"];
  const componentRefs = new Set((actual.components ?? []).map((component) => component["bom-ref"]));
  const edges = new Map((actual.dependencies ?? []).map((entry) => [entry.ref, entry.dependsOn ?? []]));
  const reachable = new Set();
  const pending = [...(edges.get(rootRef) ?? [])];
  while (pending.length > 0) {
    const ref = pending.pop();
    if (reachable.has(ref)) continue;
    reachable.add(ref);
    pending.push(...(edges.get(ref) ?? []));
  }
  if (reachable.size !== componentRefs.size || [...componentRefs].some((ref) => !reachable.has(ref))) {
    fail("every component must be reachable from the shipped package's production dependency graph");
  }
  if (actualText.includes(tree.path)) fail("artifact leaks a local absolute project path");

  process.stdout.write(
    `${JSON.stringify({ result: "PASS", format: "CycloneDX 1.6 JSON", components: componentRefs.size, path: sbomPath })}\n`,
  );
} catch (error) {
  process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
