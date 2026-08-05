// ---------------------------------------------------------------------------
// Grammar stack frame — tracks state of a JSON container
// ---------------------------------------------------------------------------

import { appendPointer } from "./pointer.js";

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

  /**
   * The JSON Pointer path up to this container.
   * Backed by a lazily-computed, memoized getter (see attachLazyPath) —
   * reads exactly like a plain string field everywhere else in the codebase.
   */
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

  /**
   * @internal Lazy-path bookkeeping. Do not read directly — use `.path`.
   * A frame's own path never changes after creation (only descendants'
   * currentKey/nextArrayIndex mutate), so it's safe to resolve on demand.
   */
  _parent?: GrammarFrame | null;
  /** @internal The key/index linking `_parent` to this frame, captured at creation time. */
  _segment?: string | number | null;
  /** @internal Memoized resolved path, set the first time `.path` is read. */
  _cachedPath?: string;
}

/**
 * Resolve (and memoize) a frame's full JSON Pointer path.
 *
 * Iterative, not recursive: walks up `_parent` references collecting frames
 * until it finds one whose path is already cached (or the root), then walks
 * back down building and caching each frame's path exactly once. This keeps
 * per-frame cost amortized O(1) regardless of nesting depth, and avoids
 * both the call-stack growth a recursive walk would have and the O(depth)
 * eager string concatenation this replaces (which made opening N nested
 * containers cost O(N^2) total, regardless of whether any value inside them
 * was ever committed).
 */
function resolveFramePath(frame: GrammarFrame): string {
  if (frame._cachedPath !== undefined) return frame._cachedPath;

  const chain: GrammarFrame[] = [];
  let cur: GrammarFrame | null = frame;
  while (cur !== null && cur._cachedPath === undefined) {
    chain.push(cur);
    cur = cur._parent === undefined ? null : cur._parent;
  }

  let basePath = cur !== null ? (cur._cachedPath as string) : "";

  // chain[0] is always `frame` itself (pushed in the first loop iteration),
  // and this loop runs in reverse, so the last iteration (i === 0) sets
  // basePath to frame's own resolved path — returning it directly avoids
  // re-reading frame._cachedPath, which TS can't prove was set here since
  // the mutation happens through the aliased `f` reference.
  for (let i = chain.length - 1; i >= 0; i--) {
    const f = chain[i] as GrammarFrame;
    const seg = f._segment;
    basePath =
      seg === null || seg === undefined ? basePath : appendPointer(basePath, seg);
    f._cachedPath = basePath;
  }

  return basePath;
}

function attachLazyPath(
  frame: GrammarFrame,
  parent: GrammarFrame | null,
  segment: string | number | null,
): void {
  frame._parent = parent;
  frame._segment = segment;
  Object.defineProperty(frame, "path", {
    enumerable: true,
    configurable: true,
    get(): string {
      return resolveFramePath(frame);
    },
  });
}

/**
 * Create a new object frame.
 * `parent` is the frame this one is nested inside (or null at the root);
 * `segment` is the key/index leading from parent to this frame (or null at
 * the root) — the same value `GrammarStack.currentValuePath()` would have
 * used, captured eagerly since it reflects the parent's mutable state at
 * this exact moment. Only the (expensive, O(depth)) string flattening is
 * deferred.
 */
export function createObjectFrame(
  parent: GrammarFrame | null,
  segment: string | number | null,
  byteStart: number,
): GrammarFrame {
  const frame: GrammarFrame = {
    containerType: "object",
    path: "",
    objectExpectation: "first_key_or_end",
    seenKeys: new Set(),
    nextArrayIndex: 0,
    byteStart,
  };
  attachLazyPath(frame, parent, segment);
  return frame;
}

/**
 * Create a new array frame. See createObjectFrame for `parent`/`segment`.
 */
export function createArrayFrame(
  parent: GrammarFrame | null,
  segment: string | number | null,
  byteStart: number,
): GrammarFrame {
  const frame: GrammarFrame = {
    containerType: "array",
    path: "",
    arrayExpectation: "first_value_or_end",
    nextArrayIndex: 0,
    byteStart,
  };
  attachLazyPath(frame, parent, segment);
  return frame;
}
