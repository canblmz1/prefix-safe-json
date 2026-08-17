import { JsonValue, Diagnostic } from "../types.js";
import {
  CoordinatorDiagnostic,
  CoordinatorPushResult,
  ToolCallCoordinatorEvent,
} from "../coordinator/types.js";
import { NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";

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
