import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runToolCallIntegrityFixture, runToolCallIntegritySuite } from "../../src/conformance.js";
import type { ConformanceFixture } from "../../src/conformance.js";

function cleanCallFixture(id: string, toolName: string): ConformanceFixture {
  return {
    schemaVersion: 1,
    profile: "normalized-gate",
    id,
    description: "synthetic runner-mechanics fixture, not part of the repository corpus",
    provenance: { classification: "synthetic-adversarial" },
    events: [
      { type: "tool_call_start", sequence: 1, provider: "ai-sdk", callRef: { sourceKey: "s" }, toolCallId: "s", name: toolName },
      { type: "tool_call_arguments_delta", sequence: 2, provider: "ai-sdk", callRef: { sourceKey: "s" }, delta: "{}" },
      { type: "tool_call_end", sequence: 3, provider: "ai-sdk", callRef: { sourceKey: "s" }, reason: "complete" },
      { type: "provider_stream_end", sequence: 4, provider: "ai-sdk", reason: "complete" },
    ],
    expected: [{ name: toolName, action: "execute", reason: "complete" }],
  };
}

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

describe("runToolCallIntegrityFixture - runner mechanics (not corpus content)", () => {
  it('throws for any profile other than "normalized-gate" instead of silently running an unrecognized claim', () => {
    const fixture = { ...cleanCallFixture("bad-profile", "t"), profile: "future-profile" as never };
    expect(() => runToolCallIntegrityFixture(fixture)).toThrow(/does not support/);
  });

  it("reports \"no matching decision was produced\" when an expected entry names a call that never happened", () => {
    const fixture = {
      ...cleanCallFixture("no-match", "real_tool"),
      expected: [{ name: "a_tool_that_was_never_called", action: "execute", reason: "complete" }] as const,
    };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.pass).toBe(false);
    expect(result.calls[0]?.pass).toBe(false);
    expect(result.calls[0]?.failureReason).toBe("no matching decision was produced");
    // The one real decision that did happen is also unclaimed/unexpected.
    expect(result.unmatchedActualCount).toBe(1);
  });
});

describe("runToolCallIntegritySuite", () => {
  it("passes when every fixture in the batch passes", () => {
    const suite = runToolCallIntegritySuite([cleanCallFixture("suite-a", "a"), cleanCallFixture("suite-b", "b")]);
    expect(suite.pass).toBe(true);
    expect(suite.results).toHaveLength(2);
    expect(suite.results.every((r) => r.pass)).toBe(true);
  });

  it("fails the whole suite when any one fixture fails, while still reporting every result", () => {
    const failing = {
      ...cleanCallFixture("suite-fail", "c"),
      expected: [{ name: "wrong_name", action: "execute", reason: "complete" }] as const,
    };
    const suite = runToolCallIntegritySuite([cleanCallFixture("suite-ok", "d"), failing]);
    expect(suite.pass).toBe(false);
    expect(suite.results).toHaveLength(2);
    expect(suite.results[0]?.pass).toBe(true);
    expect(suite.results[1]?.pass).toBe(false);
  });
});
