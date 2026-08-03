import { createParser } from "../../src/parser.js";
import type { ParserSnapshot } from "../../src/types.js";

export interface StagehandActionDelta {
  actionName: string;
  deltaText: string;
}

export interface StagehandParsedAction {
  actionName: string;
  parameters: Record<string, unknown>;
  snapshot: ParserSnapshot;
}

/**
 * Adapter for Stagehand (browserbase/stagehand).
 * Replaces `partial-json` dependency with single-pass incremental parsing for browser actions.
 */
export class StagehandActionAdapter {
  private readonly parser = createParser();

  /**
   * Push incoming LLM browser action argument delta text.
   */
  pushDelta(delta: string): ParserSnapshot {
    this.parser.push(delta);
    return this.parser.snapshot();
  }

  /**
   * Extract current committed action parameters.
   */
  getCommittedParameters(): Record<string, unknown> {
    const stable = this.parser.snapshot().stableValue;
    if (typeof stable === "object" && stable !== null && !Array.isArray(stable)) {
      return stable as Record<string, unknown>;
    }
    return {};
  }

  /**
   * Finalize browser action extraction.
   */
  finalize(actionName: string): StagehandParsedAction {
    this.parser.finish({ reason: "complete" });
    const snap = this.parser.snapshot();
    return {
      actionName,
      parameters: this.getCommittedParameters(),
      snapshot: snap,
    };
  }
}
