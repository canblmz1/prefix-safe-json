// ---------------------------------------------------------------------------
// Grammar stack frame — tracks state of a JSON container
// ---------------------------------------------------------------------------

/**
 * Expectation states for object parsing.
 */
export type ObjectExpectation =
  | "first_key_or_end"
  | "key_after_comma"
  | "colon"
  | "value"
  | "comma_or_end";

/**
 * Expectation states for array parsing.
 */
export type ArrayExpectation =
  | "first_value_or_end"
  | "value_after_comma"
  | "comma_or_end";

/**
 * A frame on the grammar stack representing a JSON container.
 */
export interface GrammarFrame {
  /** The type of container. */
  containerType: "object" | "array";

  /** The JSON Pointer path up to this container. */
  path: string;

  // --- Object state ---
  /** Current expectation for object parsing. */
  objectExpectation?: ObjectExpectation;

  /** Current key being processed. */
  currentKey?: string;

  /** Set of keys already seen (for duplicate detection). */
  seenKeys?: Set<string>;

  // --- Array state ---
  /** Current expectation for array parsing. */
  arrayExpectation?: ArrayExpectation;

  /** Index of the next element. */
  nextArrayIndex: number;

  /** Byte offset where this container started. */
  byteStart: number;
}

/**
 * Create a new object frame.
 */
export function createObjectFrame(
  path: string,
  byteStart: number,
): GrammarFrame {
  return {
    containerType: "object",
    path,
    objectExpectation: "first_key_or_end",
    seenKeys: new Set(),
    nextArrayIndex: 0,
    byteStart,
  };
}

/**
 * Create a new array frame.
 */
export function createArrayFrame(
  path: string,
  byteStart: number,
): GrammarFrame {
  return {
    containerType: "array",
    path,
    arrayExpectation: "first_value_or_end",
    nextArrayIndex: 0,
    byteStart,
  };
}
