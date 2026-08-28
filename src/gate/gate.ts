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
  ExecuteDecision,
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
  private finalResult: ToolCallExecutionGateFinalResult | undefined;
  private readonly consumedExecutionIds = new Set<string>();

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

  takeDecision(internalId: string): ExecuteDecision | undefined {
    if (this.finalResult === undefined || this.consumedExecutionIds.has(internalId)) {
      return undefined;
    }
    // Re-derive against the coordinator's CURRENT diagnostics, never the
    // decisions frozen into `finalResult` at finish()-time: a `push()` after
    // finish() still reaches the coordinator (push() above has no
    // "already finished" guard of its own) and records a sticky, stream-wide
    // AUTHORITY_PROTOCOL_VIOLATION_CODES diagnostic there, but that
    // diagnostic would otherwise never be consulted again, since
    // `finalResult` was already computed from an earlier, frozen
    // snapshot. Authority must not survive contradictory or late evidence
    // observed after finish() but before this exact call is consumed
    // (GHSA-3xpw-9694-2xxp) — `finalResult !== undefined` above still gates
    // this on finish() having been called at all, so authority is still
    // never released before the stream was reported complete at least once.
    const snap = this.coordinator.snapshot();
    const call = snap.calls.find((candidate) => candidate.internalId === internalId);
    if (call === undefined) return undefined;
    const ctx = {
      streamEndReason: this.streamEndReason as StreamEndReason,
      streamEndProviderReason: this.streamEndProviderReason,
      diagnostics: snap.diagnostics,
    };
    const decision = decideExecution(call, ctx);
    if (decision.action !== "execute") return undefined;
    this.consumedExecutionIds.add(internalId);
    return decision;
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
    // Unlike snapshot() above, this point is only ever reached after
    // streamEndCaptured is guaranteed true (set on entry to this method, or
    // already true from an earlier push()/finish() call) - and every path
    // that sets streamEndCaptured sets streamEndReason to a defined value in
    // the same branch, so the pre-finish "unknown" placeholder never applies
    // here.
    const ctx = {
      streamEndReason: this.streamEndReason as StreamEndReason,
      streamEndProviderReason: this.streamEndProviderReason,
      diagnostics,
    };
    const decisions = result.calls.map((call) => decideExecution(call, ctx));

    this.finalResult = { decisions, diagnostics };
    return this.finalResult;
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
 * const final = gate.finish();
 * for (const observed of final.decisions) {
 *   const authority = gate.takeDecision(observed.internalId);
 *   if (authority) await tools[authority.name](authority.value);
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
