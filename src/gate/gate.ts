// ---------------------------------------------------------------------------
// ToolCallExecutionGate — high-level execution safety layer.
//
// Built by composition over ToolCallStreamCoordinator, not by extending or
// reimplementing it: the gate holds a coordinator instance and adds exactly
// one thing coordinator state doesn't already capture - which stream-end
// reason actually got applied - then maps every ToolCallState through the
// pure decideExecution() table. No re-parsing, no duplicate event pipeline.
// ---------------------------------------------------------------------------

import { createToolCallStreamCoordinator } from "../coordinator/coordinator.js";
import {
  CoordinatorLimits,
  CoordinatorPushResult,
  JsonSchemaLike,
  ToolCallCoordinatorEvent,
  ToolCallStreamCoordinator,
} from "../coordinator/types.js";
import { NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ParserOptions } from "../types.js";
import { decideExecution } from "./decide.js";
import {
  ExecutionDecision,
  ToolCallExecutionGate,
  ToolCallExecutionGateFinalResult,
} from "./types.js";

class DefaultToolCallExecutionGate implements ToolCallExecutionGate {
  private readonly coordinator: ToolCallStreamCoordinator;

  // Mirrors the coordinator's own "first provider_stream_end (from push(),
  // or from finish()'s meta if none arrived) wins" rule - see push()/finish()
  // below and DefaultToolCallStreamCoordinator.finish()'s matching
  // `if (!this.isFinished)` guard. streamEndProviderReason is captured
  // alongside streamEndReason purely for DecisionEvidence.providerReason -
  // it is never read by decideExecution()'s own logic.
  private streamEndReason: StreamEndReason | undefined;
  private streamEndProviderReason: string | undefined;
  private streamEndCaptured = false;

  constructor(
    limits?: Partial<CoordinatorLimits>,
    parserOptions?: ParserOptions,
    toolSchemas?: Record<string, JsonSchemaLike>,
  ) {
    this.coordinator = createToolCallStreamCoordinator(limits, parserOptions, toolSchemas);
  }

  push(event: NormalizedToolStreamEvent): CoordinatorPushResult {
    if (event.type === "provider_stream_end" && !this.streamEndCaptured) {
      this.streamEndCaptured = true;
      this.streamEndReason = event.reason;
      this.streamEndProviderReason = event.providerReason;
    }
    return this.coordinator.push(event);
  }

  snapshot(): readonly ExecutionDecision[] {
    const snap = this.coordinator.snapshot();
    const ctx = {
      // Pre-finish, no stream-end reason has been observed yet ("unknown"
      // is a neutral placeholder here, not a claim anything went wrong) -
      // every in-flight call is still "collecting" regardless, so this
      // never influences whether something looks executable.
      streamEndReason: this.streamEndReason ?? "unknown",
      streamEndProviderReason: this.streamEndProviderReason,
      diagnostics: snap.diagnostics,
    };
    return snap.calls.map((call) => decideExecution(call, ctx));
  }

  drainEvents(): readonly ToolCallCoordinatorEvent[] {
    return this.coordinator.drainEvents();
  }

  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): ToolCallExecutionGateFinalResult {
    if (!this.streamEndCaptured) {
      this.streamEndCaptured = true;
      this.streamEndReason = meta?.reason ?? "unknown";
      this.streamEndProviderReason = meta?.providerReason;
    }

    const result = this.coordinator.finish(meta);
    const diagnostics = this.coordinator.snapshot().diagnostics;
    const ctx = {
      streamEndReason: this.streamEndReason ?? "unknown",
      streamEndProviderReason: this.streamEndProviderReason,
      diagnostics,
    };
    const decisions = result.calls.map((call) => decideExecution(call, ctx));

    return { decisions, diagnostics };
  }
}

/**
 * Creates a fail-closed execution-decision gate for streamed LLM tool calls.
 * Wraps a `ToolCallStreamCoordinator` (same constructor arguments) and adds
 * exactly one operation: turn each call's settled state into an
 * `ExecutionDecision` (`execute` / `retry` / `reject`) via a deterministic,
 * fully-typed decision table. See `docs/EXECUTION_GATE.md`.
 *
 * ```ts
 * const gate = createToolCallExecutionGate(undefined, undefined, {
 *   write_file: { type: "object", required: ["path", "content"], properties: {
 *     path: { type: "string" }, content: { type: "string" } } },
 * });
 * for (const raw of providerEvents) {
 *   for (const normalized of adapter.push(raw)) gate.push(normalized);
 * }
 * for (const decision of gate.finish().decisions) {
 *   if (decision.action === "execute") await tools[decision.name](decision.value);
 * }
 * ```
 */
export function createToolCallExecutionGate(
  limits?: Partial<CoordinatorLimits>,
  parserOptions?: ParserOptions,
  toolSchemas?: Record<string, JsonSchemaLike>,
): ToolCallExecutionGate {
  return new DefaultToolCallExecutionGate(limits, parserOptions, toolSchemas);
}
