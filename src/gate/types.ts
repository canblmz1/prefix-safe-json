import { JsonValue, Diagnostic } from "../types.js";
import {
  CoordinatorDiagnostic,
  CoordinatorPushResult,
  ToolCallCoordinatorEvent,
} from "../coordinator/types.js";
import { NormalizedToolStreamEvent, ProviderName, StreamEndReason } from "../coordinator/protocol.js";

/**
 * What to do with a tool call right now.
 *
 * - `"execute"`: the arguments are complete, unfabricated, and (if a schema
 *   was registered for this tool) schema-valid. Safe to run.
 * - `"retry"`: the provider's output was incomplete or truncated. There is
 *   nothing wrong with the data received so far - there just isn't a
 *   trustworthy complete value yet. Re-request/continue generation.
 * - `"reject"`: the data itself is the problem (malformed JSON, a schema
 *   mismatch, a resource limit, a provider-side error, or a content-policy
 *   termination). Re-sending the exact same partial input will not fix it.
 */
export type ExecutionAction = "execute" | "retry" | "reject";

/**
 * Machine-readable classification of *why* an `ExecutionAction` was chosen.
 * See `docs/EXECUTION_GATE.md` for the full decision table.
 */
export type ExecutionReason =
  | "complete"
  | "truncated"
  | "stream_incomplete"
  | "schema_invalid"
  | "malformed"
  | "resource_limit"
  | "provider_error"
  | "content_filtered"
  | "unknown";

/**
 * Why a decision came out the way it did - observability, not a second
 * decision input. Every field here is read-only, derived state already held
 * elsewhere (`ToolCallState`, the stream-level `DecisionContext`); nothing
 * on this object ever feeds back into `decideExecution()`'s own logic, and
 * changing what it reports can never change `action`/`executable`/`reason`.
 *
 * Deliberately excludes anything that would require new cross-layer
 * plumbing to derive reliably (e.g. a received-chunk count - the parser
 * only tracks cumulative bytes, not `push()` call counts, and adding that
 * tracking purely to populate a metric here was judged not worth the
 * coupling for this release).
 */
export interface DecisionEvidence {
  /** Which provider adapter produced this call (`ToolCallState.provider`). */
  readonly provider: ProviderName;

  /**
   * The provider's own, pre-normalization finish/stop reason string, when
   * the stream-ending event carried one (e.g. `"length"`, `"max_output_tokens"`,
   * `"content_filter"`). `undefined` when the stream never reported one, or
   * reported one without a `providerReason` (e.g. a default `finish()` call
   * with no `meta`).
   */
  readonly providerReason?: string;

  /** The normalized, library-level stream-end reason applied to this call. */
  readonly streamEndReason: StreamEndReason;

  /**
   * Whether a real `provider_stream_end` reason was ever observed, as
   * opposed to the neutral `"unknown"` default a gate reports before any
   * stream-end signal has arrived at all. `true` here does NOT mean the
   * reason was safe - a confirmed `"length"` still has `terminalConfirmed:
   * true` - only that the stream's end state is genuinely known rather than
   * merely unclassified or never observed.
   */
  readonly terminalConfirmed: boolean;

  /**
   * Whether the parser's root JSON container actually closed
   * (`ToolCallState.parser.rootComplete`) - independent of whether that
   * closure was genuine or reached via a safe-close repair, and independent
   * of whether the stream-end reason makes it trustworthy. A syntactically
   * complete value cut short by `length` has `structurallyComplete: true`
   * and `parserExecutable: false` at the same time - that combination *is*
   * the scenario this library exists to catch.
   */
  readonly structurallyComplete: boolean;

  /** `ToolCallState.parser.executable`, verbatim - the parser's own fail-closed verdict. */
  readonly parserExecutable: boolean;

  /**
   * `ToolCallState.schemaValid`, verbatim. `undefined` when no schema was
   * registered for this tool, or the call never reached a structurally
   * complete outcome.
   */
  readonly schemaValid?: boolean;

  /** Total bytes received for this call's argument stream (`ToolCallState.parser.receivedBytes`). */
  readonly receivedBytes: number;
}

interface ExecutionDecisionCommon {
  /** The coordinator's internal call identifier (see `ToolCallState.internalId`). */
  readonly internalId: string;
  readonly toolCallId?: string;
  readonly toolIndex?: number;
  readonly name?: string;

  /**
   * Whatever was safely committed for this call, complete or not - present
   * for both executable and non-executable decisions so a caller can see
   * *what part* of a rejected/retried call was genuinely received (e.g. a
   * `path` field that arrived before a `content` field got cut off).
   * Never the source of truth for whether it's safe to act on - that's
   * `action`/`executable`. Absent only when nothing was ever committed.
   */
  readonly stableValue?: JsonValue;

  /** This call's own parser diagnostics, verbatim (`ToolCallState.parser.diagnostics`). */
  readonly parserDiagnostics: readonly Diagnostic[];

  /** Coordinator-level diagnostics attributable to this call, verbatim. */
  readonly coordinatorDiagnostics: readonly CoordinatorDiagnostic[];

  /**
   * Why this decision came out the way it did. See `DecisionEvidence` -
   * always present, purely observational, never a second source of truth
   * for `action`/`executable`/`reason`.
   */
  readonly evidence: DecisionEvidence;
}

/**
 * The one and only shape a decision can have when `action === "execute"`.
 * `value` is a real, present `JsonValue` here - never `undefined`, never
 * optional - because this is the single positive case: everything else in
 * the gate exists to rule this out unless it's genuinely earned.
 */
export interface ExecuteDecision extends ExecutionDecisionCommon {
  readonly action: "execute";
  readonly executable: true;
  readonly reason: "complete";
  readonly value: JsonValue;

  /**
   * Narrowed to required here (unlike the inherited `name?: string`):
   * the coordinator only ever transitions a call to `status: "complete"`
   * when `name` is defined (see `DefaultToolCallStreamCoordinator.finishCall`
   * - a call with no name is forced to `"invalid"` instead), so every
   * `ExecuteDecision` genuinely has one. Encoding that here means
   * `tools[decision.name](decision.value)` type-checks directly after
   * narrowing on `action === "execute"`, with no non-null assertion needed.
   */
  readonly name: string;
}

/**
 * Every other outcome. `value` does not exist on this type at all (not
 * `undefined` - absent) - TypeScript itself refuses code that reads a
 * "final executable value" off a call the gate did not clear for execution.
 */
export interface NonExecutableDecision extends ExecutionDecisionCommon {
  readonly action: "retry" | "reject";
  readonly executable: false;
  readonly reason: Exclude<ExecutionReason, "complete">;
}

/**
 * `ExecuteDecision | NonExecutableDecision` - a discriminated union on
 * `action` (and redundantly on `executable`, for callers who prefer that
 * check). Narrowing on either field gives you the right shape:
 *
 * ```ts
 * if (decision.action === "execute") {
 *   await tools[decision.name](decision.value); // JsonValue, not JsonValue|undefined
 * }
 * ```
 */
export type ExecutionDecision = ExecuteDecision | NonExecutableDecision;

export interface ToolCallExecutionGateFinalResult {
  /** One decision per tool call the coordinator ever created. */
  readonly decisions: readonly ExecutionDecision[];

  /**
   * The full, unfiltered coordinator diagnostics list (same as
   * `coordinator.snapshot().diagnostics`) - includes diagnostics with no
   * associated call, e.g. `E_COORDINATOR_LIMIT_CALLS` fires for a call that
   * hit the concurrent-call limit before a `ToolCallState` could even be
   * created for it, so it can never appear in `decisions`.
   */
  readonly diagnostics: readonly CoordinatorDiagnostic[];
}

/**
 * High-level fail-closed execution decision layer built on top of
 * `ToolCallStreamCoordinator`. Answers one question per tool call: is it
 * safe to execute right now? Callers never need to touch parser lexical
 * state, coordinator event mechanics, or JSON Pointer paths - push provider
 * events in, read `ExecutionDecision`s out.
 */
export interface ToolCallExecutionGate {
  push(event: NormalizedToolStreamEvent): CoordinatorPushResult;

  /**
   * In-flight view. Every decision here is `"retry"` or `"reject"` -
   * `"execute"` is only ever returned once the stream has genuinely
   * finished (see `finish()`), since schema validity and prefix-safety are
   * both only meaningful once a call has settled.
   */
  snapshot(): readonly ExecutionDecision[];

  /** Drains the underlying coordinator's raw event queue, for advanced/UI consumers. */
  drainEvents(): readonly ToolCallCoordinatorEvent[];

  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): ToolCallExecutionGateFinalResult;
}
