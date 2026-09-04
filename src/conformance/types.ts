import type { ExecutionAction, ExecutionReason } from "../gate/types.js";
import type { NormalizedToolStreamEvent } from "../coordinator/protocol.js";

/**
 * @public (Experimental)
 * How a fixture's event sequence relates to what a real provider can
 * actually send:
 *
 * - `"protocol-realistic"`: this exact sequence has been observed, or is
 *   directly documented as possible, in a real provider's stream.
 * - `"sdk-representable"`: the installed provider SDK's own types permit
 *   constructing and receiving this sequence, but it has not been
 *   independently confirmed that a real provider sends it.
 * - `"synthetic-adversarial"`: constructed to stress a specific boundary
 *   (a resource limit, a pathological ordering) with no claim that any
 *   provider produces it. Still a legitimate conformance case - not every
 *   invariant needs a real-world trigger to be worth holding - but never
 *   to be read as an observed production bug.
 */
export type FixtureClassification = "protocol-realistic" | "sdk-representable" | "synthetic-adversarial";

/**
 * @public (Experimental)
 * Where a fixture came from, for provenance. `classification` is required;
 * everything else is free-form context for a human reader, not consumed by
 * the runner.
 */
export interface FixtureProvenance {
  readonly classification: FixtureClassification;
  /** e.g. "vercel/ai", "continuedev/continue" - omitted for fixtures with no external origin. */
  readonly project?: string;
  /** An issue/PR/commit URL substantiating this fixture, when one exists. */
  readonly reference?: string;
  /** Free-text note, e.g. why a case is classified the way it is. */
  readonly note?: string;
}

/** @public (Experimental) One call's expected execution-authority outcome. */
export interface ConformanceExpectedCall {
  /** Correlates against the matching decision's own `name`, when present. */
  readonly name?: string;
  /** Correlates against the matching decision's own `toolIndex`, when present. */
  readonly toolIndex?: number;
  readonly action: ExecutionAction;
  readonly reason: ExecutionReason;
}

/**
 * @public (Experimental)
 * Which conformance claim a fixture makes, made explicit rather than
 * implied by the corpus's own name. `"normalized-gate"` is the only
 * profile v1 defines:
 *
 * A `"normalized-gate"` fixture tests the coordinator/execution-gate's
 * response to an already-normalized `NormalizedToolStreamEvent` sequence -
 * identity correlation, lifecycle/terminal-state handling, and decision
 * composition, entirely *after* a provider adapter has already produced
 * that sequence. It does NOT test, and must never be described as
 * testing, whether an adapter correctly derives that sequence (or a
 * `provider_diagnostic` within it) from a specific provider's own raw
 * wire format - that is provider-adapter conformance, a distinct,
 * currently unwritten profile. See `docs/CONFORMANCE.md`'s "Provider-
 * adapter conformance — future profile / not covered by normalized-gate
 * v1" section for exactly what this excludes and why.
 */
export type ConformanceProfile = "normalized-gate";

/**
 * @public (Experimental)
 * A single, portable tool-call-integrity conformance fixture: a
 * provider-neutral normalized event sequence and the execution-authority
 * decision it must produce. Deliberately expressed in terms of
 * `NormalizedToolStreamEvent` - the same shape every provider adapter in
 * this package already emits - rather than any raw provider wire format,
 * so a fixture never requires understanding a specific SDK's shape to
 * read or reuse. See `docs/CONFORMANCE.md`.
 */
export interface ConformanceFixture {
  readonly schemaVersion: 1;
  readonly profile: ConformanceProfile;
  readonly id: string;
  readonly description: string;
  readonly provenance: FixtureProvenance;
  readonly events: readonly NormalizedToolStreamEvent[];
  readonly expected: readonly ConformanceExpectedCall[];
  /**
   * Optional per-tool JSON Schema (draft-07), keyed by tool name, for
   * fixtures that specifically exercise schema-validity outcomes (e.g.
   * `reason: "schema_invalid"`). Deliberately raw JSON Schema only, not a
   * `ToolInputValidator` - fixtures must stay JSON-serializable. See
   * `docs/VALIDATION.md` for how validators plug in outside fixtures.
   */
  readonly toolSchemas?: Record<string, object>;
}

/** @public (Experimental) One expected call matched (or not) against the real decisions produced. */
export interface ConformanceCallResult {
  readonly expected: ConformanceExpectedCall;
  readonly pass: boolean;
  readonly actual?: { readonly action: ExecutionAction; readonly reason: ExecutionReason; readonly name?: string; readonly toolIndex?: number };
  readonly failureReason?: string;
}

/** @public (Experimental) The result of running one fixture. */
export interface ConformanceFixtureResult {
  readonly id: string;
  readonly pass: boolean;
  readonly calls: readonly ConformanceCallResult[];
  /** Present when the fixture produced more or fewer decisions than `expected` entries. */
  readonly unmatchedActualCount: number;
}

/** @public (Experimental) The result of running a whole fixture suite. */
export interface ConformanceSuiteResult {
  readonly pass: boolean;
  readonly results: readonly ConformanceFixtureResult[];
}
