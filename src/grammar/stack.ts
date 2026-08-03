// ---------------------------------------------------------------------------
// Grammar Stack — tracks nested JSON container state
// ---------------------------------------------------------------------------

import type { GrammarFrame } from "./frame.js";
import { createObjectFrame, createArrayFrame } from "./frame.js";
import { appendPointer } from "./pointer.js";
import type { Diagnostic } from "../types.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { createDiagnostic } from "../diagnostics/factory.js";

/**
 * Manages the stack of open JSON containers.
 * Handles object/array nesting, expectations, and duplicate key detection.
 */
export class GrammarStack {
  private stack: GrammarFrame[] = [];
  private diagnostics: Diagnostic[] = [];
  private hasDuplicateKey = false;
  private maxDepth: number;

  constructor(maxDepth: number) {
    this.maxDepth = maxDepth;
  }

  /** Current depth (number of open containers). */
  get depth(): number {
    return this.stack.length;
  }

  /** Whether any duplicate key has been seen. */
  get hasDuplicate(): boolean {
    return this.hasDuplicateKey;
  }

  /** Get the current (top) frame, or undefined if empty. */
  get current(): GrammarFrame | undefined {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Push a new object container.
   * Returns the frame, or null if depth limit exceeded.
   */
  pushObject(byteStart: number): GrammarFrame | null {
    if (this.stack.length >= this.maxDepth) {
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.E_LIMIT_DEPTH,
          "fatal",
          byteStart,
          `Maximum nesting depth ${this.maxDepth} exceeded`,
          false,
        ),
      );
      return null;
    }
    const path = this.currentValuePath();
    const frame = createObjectFrame(path, byteStart);
    this.stack.push(frame);
    return frame;
  }

  /**
   * Push a new array container.
   * Returns the frame, or null if depth limit exceeded.
   */
  pushArray(byteStart: number): GrammarFrame | null {
    if (this.stack.length >= this.maxDepth) {
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.E_LIMIT_DEPTH,
          "fatal",
          byteStart,
          `Maximum nesting depth ${this.maxDepth} exceeded`,
          false,
        ),
      );
      return null;
    }
    const path = this.currentValuePath();
    const frame = createArrayFrame(path, byteStart);
    this.stack.push(frame);
    return frame;
  }

  /**
   * Pop the current container.
   * Returns the popped frame.
   */
  pop(): GrammarFrame | undefined {
    return this.stack.pop();
  }

  /**
   * Register an object key. Returns true if the key is new.
   * If duplicate, emits diagnostic and returns false.
   */
  registerObjectKey(key: string, byteOffset: number): boolean {
    const frame = this.current;
    if (!frame || frame.containerType !== "object" || !frame.seenKeys) {
      return false;
    }

    if (frame.seenKeys.has(key)) {
      this.hasDuplicateKey = true;
      this.diagnostics.push(
        createDiagnostic(
          DiagnosticCode.E_DUPLICATE_KEY,
          "error",
          byteOffset,
          `Duplicate object key: ${JSON.stringify(key)}`,
          false,
          frame.path,
        ),
      );
      return false;
    }

    frame.seenKeys.add(key);
    frame.currentKey = key;
    return true;
  }

  /**
   * Get the JSON Pointer path for where the next value will go.
   */
  currentValuePath(): string {
    const frame = this.current;
    if (!frame) return "";

    if (frame.containerType === "object") {
      if (frame.currentKey !== undefined) {
        return appendPointer(frame.path, frame.currentKey);
      }
      return frame.path;
    }
    // array
    return appendPointer(frame.path, frame.nextArrayIndex);
  }

  /**
   * Advance the array index after an element value is committed.
   */
  advanceArrayIndex(): void {
    const frame = this.current;
    if (frame && frame.containerType === "array") {
      frame.nextArrayIndex++;
    }
  }

  /**
   * Take accumulated diagnostics and clear.
   */
  takeDiagnostics(): Diagnostic[] {
    const result = this.diagnostics;
    this.diagnostics = [];
    return result;
  }

  /**
   * Check if the stack is empty (no open containers).
   */
  isEmpty(): boolean {
    return this.stack.length === 0;
  }

  /**
   * Get all frames (for snapshot/pending info).
   */
  getFrames(): readonly GrammarFrame[] {
    return this.stack;
  }

  /**
   * Determine if all open containers can be safely closed by just appending '}' or ']'.
   * This is true if no container is waiting for a colon or a value.
   */
  canSafelyCloseAll(): boolean {
    for (const frame of this.stack) {
      if (frame.containerType === "object") {
        if (
          frame.objectExpectation === "colon" ||
          frame.objectExpectation === "value" ||
          frame.objectExpectation === "key_after_comma"
        ) {
          return false; // Missing colon or value or key
        }
      } else {
        if (frame.arrayExpectation === "value_after_comma") {
          return false; // Missing value after comma
        }
      }
    }
    return true;
  }
}
