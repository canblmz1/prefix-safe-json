import { StreamEndReason } from "../coordinator/protocol.js";
import { CoordinatorLimits, JsonSchemaLike } from "../coordinator/types.js";
import { ToolCallExecutionGateFinalResult, ExecutionDecision } from "../gate/types.js";
import { ParserOptions } from "../types.js";

/**
 * High-level, provider-agnostic execution guard: composes a
 * `ProviderStreamAdapter` with a `ToolCallExecutionGate` behind three
 * methods. `push()`/`snapshot()`/`finish()` mirror the underlying gate's own
 * shape exactly - this is a thinner call surface over the same object, not a
 * parallel implementation with its own state or decision logic.
 */
export interface ExecutionGuard<TRawEvent = unknown> {
  /** Feed one raw provider event (e.g. one `fullStream` part) through the adapter into the gate. */
  push(rawEvent: TRawEvent): void;

  /**
   * In-flight view of every call's current decision. As with the underlying
   * gate, every decision here is `"retry"` or `"reject"` - `"execute"` is
   * only ever returned from `finish()`.
   */
  snapshot(): readonly ExecutionDecision[];

  /**
   * Signals stream completion and returns the final decision for every tool
   * call the stream ever produced. Safe to call even if the underlying
   * provider stream already delivered its own terminal event through
   * `push()` - `meta` is only used as a fallback for a stream that ends
   * without ever reporting why.
   */
  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): ToolCallExecutionGateFinalResult;
}

/** Options accepted by every high-level provider execution guard factory. */
export interface ExecutionGuardOptions {
  /**
   * Optional JSON Schema (draft-07) per tool name - same option
   * `createToolCallExecutionGate()`/`createToolCallStreamCoordinator()`
   * accept as their third constructor argument.
   */
  schemas?: Record<string, JsonSchemaLike>;

  /** Coordinator-level limits (concurrent tool calls, tool name size, etc.). */
  limits?: Partial<CoordinatorLimits>;

  /** Per-call parser configuration (resource limits, repairs). */
  parserOptions?: ParserOptions;
}

/** A guard specialized for the Vercel AI SDK's `fullStream` part shape. See `createAiSdkExecutionGuard`. */
export type AiSdkExecutionGuard = ExecutionGuard<unknown>;
