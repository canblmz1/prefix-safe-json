import { createParser } from "../../src/parser.js";
import type { IncrementalJsonParser, ParserSnapshot } from "../../src/types.js";

export interface VercelAiToolDeltaChunk {
  type: "tool-call-delta";
  toolCallId: string;
  toolName: string;
  argsTextDelta: string;
}

export interface IncrementalVercelAiChunk extends VercelAiToolDeltaChunk {
  experimental_snapshot?: ParserSnapshot;
  experimental_stableArgs?: unknown;
}

/**
 * Adapter for Vercel AI SDK (vercel/ai).
 * Wraps tool-call argument deltas incrementally without re-parsing the string buffer.
 */
export class VercelAiIncrementalAdapter {
  private readonly parsers = new Map<string, IncrementalJsonParser>();

  /**
   * Process an incoming tool-call-delta chunk.
   */
  processChunk(chunk: VercelAiToolDeltaChunk): IncrementalVercelAiChunk {
    let parser = this.parsers.get(chunk.toolCallId);
    if (!parser) {
      parser = createParser();
      this.parsers.set(chunk.toolCallId, parser);
    }

    parser.push(chunk.argsTextDelta);
    const snap = parser.snapshot();

    return {
      ...chunk,
      experimental_snapshot: snap,
      experimental_stableArgs: snap.stableValue,
    };
  }

  /**
   * Signal end of stream for a specific toolCallId.
   */
  finishTool(toolCallId: string, reason: "complete" | "length" | "cancelled" = "complete") {
    const parser = this.parsers.get(toolCallId);
    if (!parser) return undefined;
    return parser.finish({ reason });
  }

  /**
   * Reset all cached state.
   */
  reset() {
    this.parsers.clear();
  }
}
