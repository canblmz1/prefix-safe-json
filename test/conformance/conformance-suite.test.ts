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

/** Two parallel, independently-identified tool calls, with explicit toolIndex - real decisions, not mocked. */
function twoParallelCallsFixture(id: string): ConformanceFixture {
  return {
    schemaVersion: 1,
    profile: "normalized-gate",
    id,
    description: "synthetic runner-mechanics fixture, not part of the repository corpus",
    provenance: { classification: "synthetic-adversarial" },
    events: [
      { type: "tool_call_start", sequence: 1, provider: "openai-compatible", callRef: { sourceKey: "call-0" }, toolIndex: 0, name: "same_name" },
      { type: "tool_call_arguments_delta", sequence: 2, provider: "openai-compatible", callRef: { sourceKey: "call-0" }, delta: "{}" },
      { type: "tool_call_end", sequence: 3, provider: "openai-compatible", callRef: { sourceKey: "call-0" }, reason: "complete" },
      { type: "tool_call_start", sequence: 4, provider: "openai-compatible", callRef: { sourceKey: "call-1" }, toolIndex: 1, name: "same_name" },
      { type: "tool_call_arguments_delta", sequence: 5, provider: "openai-compatible", callRef: { sourceKey: "call-1" }, delta: "{}" },
      { type: "tool_call_end", sequence: 6, provider: "openai-compatible", callRef: { sourceKey: "call-1" }, reason: "complete" },
      { type: "provider_stream_end", sequence: 7, provider: "openai-compatible", reason: "complete" },
    ],
    expected: [{ name: "same_name", toolIndex: 1, action: "execute", reason: "complete" }],
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
  it("schemaVersion 1 is supported", () => {
    const fixture: unknown = { ...cleanCallFixture("schema-version-1", "t"), schemaVersion: 1 };
    expect(() => runToolCallIntegrityFixture(fixture as ConformanceFixture)).not.toThrow();
  });

  it("schemaVersion 0 is rejected", () => {
    const fixture: unknown = { ...cleanCallFixture("schema-version-0", "t"), schemaVersion: 0 };
    expect(() => runToolCallIntegrityFixture(fixture as ConformanceFixture)).toThrow(/schemaVersion 0/);
  });

  it("schemaVersion 2 is rejected", () => {
    const fixture: unknown = { ...cleanCallFixture("schema-version-2", "t"), schemaVersion: 2 };
    expect(() => runToolCallIntegrityFixture(fixture as ConformanceFixture)).toThrow(/schemaVersion 2/);
  });

  it("a missing schemaVersion is rejected", () => {
    const fixture = { ...cleanCallFixture("schema-version-missing", "t") } as Record<string, unknown>;
    delete fixture.schemaVersion;
    expect(() => runToolCallIntegrityFixture(fixture as unknown as ConformanceFixture)).toThrow(/schemaVersion/);
  });

  it("schemaVersion is checked before profile - a fixture wrong in both reports the schemaVersion problem", () => {
    const fixture: unknown = { ...cleanCallFixture("both-wrong", "t"), schemaVersion: 99, profile: "future-profile" };
    expect(() => runToolCallIntegrityFixture(fixture as ConformanceFixture)).toThrow(/schemaVersion 99/);
  });

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

  it("falls back to the first unclaimed decision only when neither name nor toolIndex is given", () => {
    // expected.name is deliberately omitted here - if the name check were
    // weakened to fire unconditionally (rather than only when expected.name
    // is actually given), a decision that DOES have a name (as every real
    // decision does) would be incorrectly skipped, and this would report
    // "no matching decision" instead of matching via fallback.
    const fixture = {
      ...cleanCallFixture("fallback-no-keys", "real_tool"),
      expected: [{ action: "execute", reason: "complete" }] as const,
    };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.pass).toBe(true);
    expect(result.calls[0]?.pass).toBe(true);
  });

  it("a second expected entry with no correlation key does not re-match a decision already claimed by the first", () => {
    // Only one real decision exists. Two expected entries, neither naming a
    // correlation key, both rely on "first unclaimed decision" fallback -
    // the first must claim the one real decision, leaving nothing for the
    // second to find.
    const fixture = {
      ...cleanCallFixture("claimed-set", "real_tool"),
      expected: [
        { action: "execute", reason: "complete" },
        { action: "execute", reason: "complete" },
      ] as const,
    };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]?.pass).toBe(true);
    expect(result.calls[1]?.pass).toBe(false);
    expect(result.calls[1]?.failureReason).toBe("no matching decision was produced");
    expect(result.pass).toBe(false);
    expect(result.unmatchedActualCount).toBe(0);
  });

  it("expected.toolIndex selects the specific decision by index, not just the first unclaimed one", () => {
    // Only toolIndex 1 is claimed here - if toolIndex correlation were
    // broken (e.g. never actually skipping a mismatched index), "first
    // unclaimed" would instead hand back the toolIndex 0 decision.
    const result = runToolCallIntegrityFixture(twoParallelCallsFixture("tool-index-match"));
    expect(result.calls[0]?.pass).toBe(true);
    expect(result.calls[0]?.actual?.toolIndex).toBe(1);
    // The other real decision (toolIndex 0) is legitimately unclaimed here -
    // this fixture only asserts about toolIndex 1 - so unmatchedActualCount
    // being 1 (not fixture-level pass) is the expected, correct shape.
    expect(result.unmatchedActualCount).toBe(1);
  });

  it("combined name + toolIndex must both match - a right name at the wrong index is not a match", () => {
    const fixture = { ...twoParallelCallsFixture("combined-key-wrong-index"), expected: [{ name: "same_name", toolIndex: 5, action: "execute", reason: "complete" }] as const };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.pass).toBe(false);
    expect(result.calls[0]?.failureReason).toBe("no matching decision was produced");
  });

  it("a matched decision with the wrong expected action fails, even though the reason matches", () => {
    const fixture = { ...cleanCallFixture("action-mismatch", "real_tool"), expected: [{ name: "real_tool", action: "reject", reason: "complete" }] as const };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.pass).toBe(false);
    expect(result.calls[0]?.pass).toBe(false);
    expect(result.calls[0]?.failureReason).toBe("expected reject/complete, got execute/complete");
    expect(result.calls[0]?.actual).toEqual({ action: "execute", reason: "complete", name: "real_tool", toolIndex: undefined });
  });

  it("a matched decision with the wrong expected reason fails, even though the action matches", () => {
    const fixture = { ...cleanCallFixture("reason-mismatch", "real_tool"), expected: [{ name: "real_tool", action: "execute", reason: "truncated" }] as const };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.pass).toBe(false);
    expect(result.calls[0]?.pass).toBe(false);
    expect(result.calls[0]?.failureReason).toBe("expected execute/truncated, got execute/complete");
  });

  it("a matched decision with both action and reason wrong fails", () => {
    const fixture = { ...cleanCallFixture("both-mismatch", "real_tool"), expected: [{ name: "real_tool", action: "reject", reason: "malformed" }] as const };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.pass).toBe(false);
    expect(result.calls[0]?.pass).toBe(false);
  });

  it("fixture-level pass is false when one of several expected calls fails, even though the others pass (calls.every)", () => {
    const fixture = {
      ...twoParallelCallsFixture("fixture-level-every"),
      expected: [
        { name: "same_name", toolIndex: 0, action: "execute", reason: "complete" },
        { name: "same_name", toolIndex: 1, action: "reject", reason: "complete" }, // deliberately wrong action
      ] as const,
    };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.calls[0]?.pass).toBe(true);
    expect(result.calls[1]?.pass).toBe(false);
    expect(result.pass).toBe(false);
    expect(result.unmatchedActualCount).toBe(0);
  });

  it("fixture-level pass is false when every expected call matches but an extra, unclaimed decision remains (unmatchedActualCount)", () => {
    const fixture = {
      ...twoParallelCallsFixture("unmatched-actual"),
      expected: [{ name: "same_name", toolIndex: 0, action: "execute", reason: "complete" }] as const,
    };
    const result = runToolCallIntegrityFixture(fixture);
    expect(result.calls.every((c) => c.pass)).toBe(true);
    expect(result.unmatchedActualCount).toBe(1);
    expect(result.pass).toBe(false);
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
