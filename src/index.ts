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
export type { ToolCallStreamCoordinator } from "./coordinator/types.js";
export type { NormalizedToolStreamEvent } from "./coordinator/protocol.js";

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
