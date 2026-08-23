// ---------------------------------------------------------------------------
// Public API — prefix-safe-json
//
// Every exported function/class carries its own `@public (Stable)` or
// `@public (Experimental)` classification directly above its own
// declaration - never one comment shared across multiple export
// statements, since a JSDoc/TSDoc comment attaches only to the single
// declaration immediately following it, not to every statement a reader's
// eye groups it with visually. Type-only exports grouped under a
// `// <Section> API` comment inherit the classification of the
// function/class they are declared alongside in that same section, unless
// individually annotated otherwise.
// ---------------------------------------------------------------------------

/**
 * @public (Stable)
 * Creates a new Incremental JSON Parser instance.
 */
export { createParser } from "./parser.js";

export type {
  // Core interface
  IncrementalJsonParser,
  ParserOptions,

  // Results
  PushResult,
  ParserSnapshot,
  FinalResult,

  // Events
  ParserEvent,
  ValueCommittedEvent,
  ContainerClosedEvent,
  RepairAppliedEvent,
  DiagnosticEvent,
  DocumentCompleteEvent,
  StreamFinishedEvent,

  // Types
  JsonValue,
  JsonObject,
  JsonArray,
  SyntaxStatus,
  StreamEndReason,
  PendingToken,
  RepairAction,
  Diagnostic,
  ParserLimits,
} from "./types.js";

/** @public (Stable) Default resource limits applied when none are supplied to `createParser()`. */
export { DEFAULT_LIMITS } from "./limits.js";
/** @public (Stable) Machine-readable parser diagnostic codes (see `Diagnostic.code`). */
export { DiagnosticCode } from "./diagnostics/codes.js";

// Coordinator API
/**
 * @public (Stable)
 * Creates a stream coordinator for mapping overlapping multi-tool streams.
 */
export { createToolCallStreamCoordinator } from "./coordinator/coordinator.js";
export type {
  ToolCallStreamCoordinator,
  ToolCallState,
  JsonSchemaLike,
  CoordinatorLimits,
  CoordinatorDiagnostic,
} from "./coordinator/types.js";
export type { NormalizedToolStreamEvent, ProviderName } from "./coordinator/protocol.js";
/**
 * @public (Stable)
 * Diagnostic code a custom `ProviderStreamAdapter` can emit (as a
 * stream-wide `provider_diagnostic`, no `callRef`) to signal a
 * content-safety/policy termination - the gate matches on this exact code
 * to report `reason: "content_filtered"`. See docs/EXECUTION_GATE.md.
 */
export { CONTENT_FILTERED_DIAGNOSTIC_CODE } from "./coordinator/diagnostic-codes.js";

// Execution Safety Gate API
/**
 * @public (Stable)
 * Fail-closed execution-decision layer built on top of the coordinator.
 * Answers one question per tool call: is it safe to execute right now?
 * See docs/EXECUTION_GATE.md.
 */
export { createToolCallExecutionGate } from "./gate/gate.js";
export type {
  ToolCallExecutionGate,
  ToolCallExecutionGateFinalResult,
  ExecutionDecision,
  ExecuteDecision,
  NonExecutableDecision,
  ExecutionAction,
  ExecutionReason,
  DecisionEvidence,
} from "./gate/types.js";

// High-level execution guards
/**
 * @public (Stable)
 * Drop-in fail-closed execution guard for the Vercel AI SDK's `fullStream`.
 * Composes `AiSdkStreamAdapter` and `createToolCallExecutionGate()` - see
 * `docs/EXECUTION_GATE.md#high-level-guards`.
 */
export { createAiSdkExecutionGuard } from "./guard/ai-sdk.js";
export type { ExecutionGuard, AiSdkExecutionGuard, ExecutionGuardOptions } from "./guard/types.js";

/**
 * @public (Experimental)
 * Removes every AI SDK-invoked callback field capable of running caller code
 * before this library's gate reaches a decision - `execute`,
 * `onInputStart`, `onInputDelta`, and `onInputAvailable` (verified directly
 * against `ai@5`/`ai@6`/`ai@7`'s own real source that all three fire
 * unconditionally, with zero reference to `needsApproval` or approval
 * status - `needsApproval: true` alone does not stop them). Also forces
 * `needsApproval: true`, which still closes the `execute` gap on `ai@6`+ via
 * the SDK's own approval mechanism. Throws for a provider-executed tool
 * (`isProviderExecuted: true`) rather than silently implying a guarantee
 * this function cannot make for execution that happens entirely on the
 * provider's remote infrastructure. Real execution stays exactly where it
 * already was: driven manually from `guard.finish().decisions`. See the
 * function's own doc comment for the exact, precisely-scoped guarantee and
 * its real limits, and
 * `docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence`.
 */
export { createAiSdkExecutionLock } from "./guard/ai-sdk-execution-lock.js";
export type { LockedAiSdkTool, LockedAiSdkTools } from "./guard/ai-sdk-execution-lock.js";

// Provider API
/**
 * @public (Experimental)
 * The contract every provider adapter above implements. Classified
 * Experimental alongside them, not Stable: writing a custom adapter against
 * this interface is exactly as exposed to upstream wire-shape churn as the
 * adapters that already implement it.
 */
export type { ProviderStreamAdapter } from "./providers/adapter.js";

// Provider adapters for various LLM network shapes. Each is independently
// classified below - see docs/COMPATIBILITY.md for what "verified" means
// per adapter (a specific tested SDK version vs. a documented wire shape).
// All six may change if the upstream API/SDK shape they target changes.

/**
 * @public (Experimental)
 * OpenAI Chat Completions (legacy `function_call`) and Responses API
 * streaming tool-call shape.
 */
export { OpenAIStreamAdapter } from "./providers/openai.js";

/**
 * @public (Experimental)
 * Generic OpenAI-compatible `choices[].delta.tool_calls[]` streaming
 * shape, shared by OpenAI's current API and most compatible endpoints.
 */
export { OpenAICompatibleStreamAdapter } from "./providers/openai-compatible.js";

/**
 * @public (Experimental)
 * Anthropic Messages API streaming tool-call shape
 * (`content_block_delta` / `input_json_delta`).
 */
export { AnthropicStreamAdapter } from "./providers/anthropic.js";

/**
 * @public (Experimental)
 * Gemini's structured `functionCall` shape. Unlike the other adapters,
 * Gemini delivers function-call arguments as an already-parsed object, not
 * incremental raw JSON text - see docs/COMPATIBILITY.md for what that
 * means for this adapter's guarantees.
 */
export { GeminiStreamAdapter } from "./providers/gemini.js";

/**
 * @public (Experimental)
 * OpenRouter's streaming tool-call shape (a thin extension of the
 * OpenAI-compatible shape above).
 */
export { OpenRouterStreamAdapter } from "./providers/openrouter.js";

/**
 * @public (Experimental)
 * Vercel AI SDK's `fullStream` tool-call part shape
 * (`tool-input-start`/`-delta`/`-end`, `tool-call`, `tool-result`,
 * `tool-error`, `finish`, `error`, `abort`). Verified against `ai@5.0.240`,
 * `ai@6.0.259`, `ai@7.0.70` - see docs/COMPATIBILITY.md. Prefer
 * `createAiSdkExecutionGuard()` (Stable, above) for the common case; use
 * this directly only if you need the adapter instance itself.
 */
export { AiSdkStreamAdapter } from "./providers/ai-sdk.js";
