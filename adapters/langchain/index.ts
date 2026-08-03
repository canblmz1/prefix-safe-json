import { createParser } from "../../src/parser.js";
import type { IncrementalJsonParser, ParserSnapshot } from "../../src/types.js";

export interface LangChainToolCallChunk {
  name?: string;
  id?: string;
  args: string;
  index?: number;
}

export interface LangChainParsedToolCall {
  name: string;
  id: string;
  args: unknown;
  snapshot: ParserSnapshot;
}

/**
 * Adapter for LangChain.js (langchain-ai/langchainjs).
 * Replaces simple string concatenation with single-pass incremental JSON parsing.
 */
export class LangChainIncrementalAdapter {
  private readonly parsers = new Map<string, IncrementalJsonParser>();

  /**
   * Feed a tool_call_chunk delta.
   */
  pushChunk(chunk: LangChainToolCallChunk): { snapshot: ParserSnapshot; stableArgs: unknown } {
    const key = chunk.id ?? `idx_${chunk.index ?? 0}`;
    let parser = this.parsers.get(key);
    if (!parser) {
      parser = createParser();
      this.parsers.set(key, parser);
    }

    if (chunk.args) {
      parser.push(chunk.args);
    }

    const snap = parser.snapshot();
    return {
      snapshot: snap,
      stableArgs: snap.stableValue,
    };
  }

  /**
   * Finish and extract complete tool invocation.
   */
  finalize(id: string, name: string): LangChainParsedToolCall {
    const parser = this.parsers.get(id);
    if (!parser) {
      throw new Error(`LangChainIncrementalAdapter: No parser found for tool call id '${id}'`);
    }

    const res = parser.finish({ reason: "complete" });
    return {
      name,
      id,
      args: res.stableValue ?? {},
      snapshot: parser.snapshot(),
    };
  }
}
