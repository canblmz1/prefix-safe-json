import { createParser } from "../../src/parser.js";
import type { FinalResult, ParserSnapshot } from "../../src/types.js";

export interface GooseToolDelta {
  callId: string;
  name: string;
  argumentsDelta: string;
}

export interface GooseExecutionVerdict {
  canExecute: boolean;
  args: Record<string, unknown>;
  snapshot: ParserSnapshot;
}

/**
 * Adapter for Block Goose (block/goose).
 * Replaces try/catch exception-polling loops with zero-exception incremental parsing.
 */
export class GooseToolStreamAdapter {
  private readonly parser = createParser();

  /**
   * Push incoming tool argument text chunk.
   */
  pushDelta(chunk: GooseToolDelta): GooseExecutionVerdict {
    this.parser.push(chunk.argumentsDelta);
    const snap = this.parser.snapshot();
    const argsObj = typeof snap.stableValue === "object" && snap.stableValue !== null
      ? (snap.stableValue as Record<string, unknown>)
      : {};

    return {
      canExecute: snap.rootComplete,
      args: argsObj,
      snapshot: snap,
    };
  }

  /**
   * Finalize stream and evaluate execution safety.
   */
  finishStream(reason: "complete" | "length" | "cancelled" = "complete"): FinalResult {
    return this.parser.finish({ reason });
  }
}
