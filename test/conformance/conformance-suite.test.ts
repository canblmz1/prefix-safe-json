import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runToolCallIntegrityFixture } from "../../src/conformance/runner.js";
import type { ConformanceFixture } from "../../src/conformance/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "../../conformance/fixtures");

function loadFixtures(): ConformanceFixture[] {
  return fs
    .readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8")) as ConformanceFixture);
}

describe("Tool Call Integrity conformance corpus", () => {
  const fixtures = loadFixtures();

  it("has at least the documented initial corpus size", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(15);
  });

  it.each(fixtures.map((f) => [f.id, f] as const))("%s matches its declared expected outcome", (_id, fixture) => {
    const result = runToolCallIntegrityFixture(fixture);
    if (!result.pass) {
      const detail = result.calls
        .filter((c) => !c.pass)
        .map((c) => c.failureReason ?? "unknown mismatch")
        .join("; ");
      throw new Error(`${fixture.id} failed: ${detail} (unmatchedActualCount=${result.unmatchedActualCount})`);
    }
    expect(result.pass).toBe(true);
  });
});
