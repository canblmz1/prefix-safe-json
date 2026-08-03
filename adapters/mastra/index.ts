import { createParser } from "../../src/parser.js";
import type { FinalResult, ParserSnapshot } from "../../src/types.js";

export interface MastraToolExecutionRequest {
  toolName: string;
  callId: string;
  rawArgsString: string;
}

export interface MastraToolExecutionResult {
  executable: boolean;
  args: unknown;
  diagnostics: readonly unknown[];
  repairs: readonly unknown[];
}

/**
 * Adapter for Mastra (mastra-ai/mastra).
 * Replaces non-deterministic `jsonrepair` pre-processing with strict, zero-fabrication parsing.
 */
export class MastraToolStreamAdapter {
  /**
   * Parse full or streaming tool call arguments for a Mastra agent tool execution step.
   */
  parseToolInput(req: MastraToolExecutionRequest): MastraToolExecutionResult {
    const parser = createParser({
      repairs: {
        rawControlCharacters: "escape",
        trailingData: "isolate",
        closeContainersAtFinish: "safe-only",
      },
    });

    parser.push(req.rawArgsString);
    const result: FinalResult = parser.finish({ reason: "complete" });

    return {
      executable: result.executable,
      args: result.stableValue ?? {},
      diagnostics: result.diagnostics,
      repairs: result.repairs,
    };
  }

  /**
   * Create an incremental parser for live tool argument delta streaming in Mastra agents.
   */
  createStreamSession() {
    const parser = createParser();
    return {
      pushDelta: (delta: string) => {
        parser.push(delta);
        return parser.snapshot();
      },
      finalize: (reason: "complete" | "length" | "cancelled" = "complete"): ParserSnapshot => {
        parser.finish({ reason });
        return parser.snapshot();
      },
    };
  }
}
