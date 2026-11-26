// ---------------------------------------------------------------------------
// prefix-safe-json/langchain — Drop-in LangChain / LangGraph.js guard.
//
// Zero runtime dependencies on `@langchain/*` packages; structural types match
// `ChatOpenAI`, `tool()`, `DynamicStructuredTool`, and LangGraph `ToolNode`.
// ---------------------------------------------------------------------------

/**
 * @public (Experimental)
 * Creates a fail-closed execution guard for LangChain / LangGraph.js (`ChatOpenAI` +
 * `createReactAgent` / `ToolNode`).
 */
export { guardChatOpenAI } from "./guard/langchain.js";

/**
 * @public (Experimental)
 * Error thrown when a guarded LangChain tool call lacks confirmed raw-stream execution authority.
 */
export { LangChainGuardRefusal } from "./guard/langchain.js";

export type {
  LangChainToolCallLike,
  LangChainToolConfigLike,
  LangChainToolLike,
  LangChainChatOpenAIConfiguration,
  LangChainChatOpenAIOptions,
  LangChainTurnResult,
  LangChainGuardOptions,
  LangChainGuard,
} from "./guard/langchain.js";
