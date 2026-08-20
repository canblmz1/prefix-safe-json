// ---------------------------------------------------------------------------
// Public API — prefix-safe-json
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

export { DEFAULT_LIMITS } from "./limits.js";
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
 * @public (Experimental)
 * Drop-in fail-closed execution guard for the Vercel AI SDK's `fullStream`.
 * Composes `AiSdkStreamAdapter` and `createToolCallExecutionGate()` - see
 * `docs/EXECUTION_GATE.md#high-level-guards`.
 */
export { createAiSdkExecutionGuard } from "./guard/ai-sdk.js";
export type { ExecutionGuard, AiSdkExecutionGuard, ExecutionGuardOptions } from "./guard/types.js";

// Provider API
export type { ProviderStreamAdapter } from "./providers/adapter.js";

/**
 * @public (Experimental)
 * Provider adapters for various LLM network shapes.
 * These are experimental and may change if upstream APIs change.
 */
export { OpenAIStreamAdapter } from "./providers/openai.js";
export { OpenAICompatibleStreamAdapter } from "./providers/openai-compatible.js";
export { AnthropicStreamAdapter } from "./providers/anthropic.js";
export { GeminiStreamAdapter } from "./providers/gemini.js";
export { OpenRouterStreamAdapter } from "./providers/openrouter.js";
export { AiSdkStreamAdapter } from "./providers/ai-sdk.js";
