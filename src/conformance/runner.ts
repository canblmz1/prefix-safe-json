import { createToolCallExecutionGate } from "../gate/gate.js";
import type { ExecutionDecision } from "../gate/types.js";
import type {
  ConformanceCallResult,
  ConformanceExpectedCall,
  ConformanceFixture,
  ConformanceFixtureResult,
  ConformanceSuiteResult,
} from "./types.js";

function matchDecision(
  expected: ConformanceExpectedCall,
  decisions: readonly ExecutionDecision[],
  claimed: Set<ExecutionDecision>,
): ExecutionDecision | undefined {
  for (const decision of decisions) {
    if (claimed.has(decision)) continue;
    if (expected.name !== undefined && decision.name !== expected.name) continue;
    if (expected.toolIndex !== undefined && decision.toolIndex !== expected.toolIndex) continue;
    if (expected.name === undefined && expected.toolIndex === undefined) {
      // No correlation key given - fall back to first unclaimed decision,
      // in the order the gate produced them.
    }
    return decision;
  }
  return undefined;
}

/**
 * @public (Experimental)
 * Runs one conformance fixture against this package's real, unmodified
 * `createToolCallExecutionGate()` - not a reimplementation - and compares
 * the resulting decisions against `fixture.expected`. No network, no
 * provider API key, no model call: `fixture.events` are pushed directly,
 * exactly as a provider adapter would produce them.
 */
export function runToolCallIntegrityFixture(fixture: ConformanceFixture): ConformanceFixtureResult {
  if (fixture.profile !== "normalized-gate") {
    throw new Error(
      `prefix-safe-json: fixture "${fixture.id}" declares profile ${JSON.stringify(fixture.profile)}, ` +
        `which this runner does not support (only "normalized-gate" exists in v1). See docs/CONFORMANCE.md.`,
    );
  }
  const gate = createToolCallExecutionGate(undefined, undefined, fixture.toolSchemas);
  for (const event of fixture.events) gate.push(event);
  const { decisions } = gate.finish();

  const claimed = new Set<ExecutionDecision>();
  const calls: ConformanceCallResult[] = fixture.expected.map((expected) => {
    const actual = matchDecision(expected, decisions, claimed);
    if (!actual) {
      return { expected, pass: false, failureReason: "no matching decision was produced" };
    }
    claimed.add(actual);
    const pass = actual.action === expected.action && actual.reason === expected.reason;
    return {
      expected,
      pass,
      actual: { action: actual.action, reason: actual.reason, name: actual.name, toolIndex: actual.toolIndex },
      ...(pass ? {} : { failureReason: `expected ${expected.action}/${expected.reason}, got ${actual.action}/${actual.reason}` }),
    };
  });

  const unmatchedActualCount = decisions.length - claimed.size;
  return {
    id: fixture.id,
    pass: calls.every((c) => c.pass) && unmatchedActualCount === 0,
    calls,
    unmatchedActualCount,
  };
}

/**
 * @public (Experimental)
 * Runs every fixture in `fixtures` through {@link runToolCallIntegrityFixture}
 * and aggregates the results. Deterministic, synchronous, no I/O of its
 * own - callers own reading fixture files from disk (see
 * `conformance/fixtures/` and `docs/CONFORMANCE.md`).
 */
export function runToolCallIntegritySuite(fixtures: readonly ConformanceFixture[]): ConformanceSuiteResult {
  const results = fixtures.map(runToolCallIntegrityFixture);
  return { pass: results.every((r) => r.pass), results };
}
