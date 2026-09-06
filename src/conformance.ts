// ---------------------------------------------------------------------------
// prefix-safe-json/conformance — Tool Call Integrity conformance runner.
//
// Runs portable, provider-neutral fixtures (see conformance/fixtures/ and
// docs/CONFORMANCE.md) against this package's own real execution-authority
// gate. Useful even to projects that do not install this package at
// runtime: the fixture format and expected outcomes are meaningful on
// their own, against any implementation of this problem class.
// ---------------------------------------------------------------------------

export { runToolCallIntegrityFixture, runToolCallIntegritySuite } from "./conformance/runner.js";
export type {
  ConformanceFixture,
  ConformanceFixtureResult,
  ConformanceSuiteResult,
  ConformanceCallResult,
  ConformanceExpectedCall,
  FixtureProvenance,
  FixtureClassification,
} from "./conformance/types.js";
