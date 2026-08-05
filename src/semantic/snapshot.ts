// ---------------------------------------------------------------------------
// Snapshot builder — constructs stableValue from committed events
// ---------------------------------------------------------------------------

import type { JsonValue, JsonObject, JsonArray, ParserEvent } from "../types.js";
import type { GrammarFrame } from "../grammar/frame.js";

/**
 * Maintains the stable value by processing committed events.
 * Only committed values appear in the stable value.
 */
export class SnapshotBuilder {
  private root: JsonValue | undefined = undefined;
  private hasRoot = false;

  /**
   * Maps each open container's grammar frame to its corresponding node in
   * the stable-value tree, so a newly-opened child container can attach
   * directly to its parent in O(1) via initContainerForFrame() instead of
   * re-parsing a JSON Pointer path string and re-walking from the root on
   * every single container open (see initContainerForFrame).
   */
  private frameNodes = new WeakMap<GrammarFrame, JsonValue>();

  /**
   * Process a value_committed event and integrate it into the stable value.
   */
  processEvent(event: ParserEvent): void {
    if (event.type !== "value_committed") return;

    const { path, value } = event;

    // Parse the JSON Pointer path to navigate to the parent
    const segments = parsePointer(path);
    if (segments.length === 0) return;

    // Ensure root exists
    if (!this.hasRoot) {
      // We need a container at root — determine from the first segment
      // This shouldn't happen if events are emitted correctly,
      // because container events come before child value events.
      return;
    }

    const parentSegments = segments.slice(0, -1);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment === undefined) return;

    let target = this.root;
    for (const seg of parentSegments) {
      if (target === null || target === undefined) return;
      if (typeof target === "object" && !Array.isArray(target)) {
        target = (target as JsonObject)[seg];
      } else if (Array.isArray(target)) {
        const idx = parseInt(seg, 10);
        if (isNaN(idx)) return;
        target = target[idx];
      } else {
        return; // Can't navigate into scalar
      }
    }

    if (target === null || target === undefined) return;

    if (typeof target === "object" && !Array.isArray(target)) {
      safeSet(target as JsonObject, lastSegment, value);
    } else if (Array.isArray(target)) {
      const idx = parseInt(lastSegment, 10);
      if (!isNaN(idx)) {
        (target as JsonArray)[idx] = value;
      }
    }
  }

  /**
   * Initialize the root as an object container.
   * `frame` is registered so child containers can find it in O(1).
   */
  initRootObject(frame?: GrammarFrame): void {
    if (!this.hasRoot) {
      this.root = {};
      this.hasRoot = true;
    }
    if (frame) this.frameNodes.set(frame, this.root as JsonValue);
  }

  /**
   * Initialize the root as an array container.
   * `frame` is registered so child containers can find it in O(1).
   */
  initRootArray(frame?: GrammarFrame): void {
    if (!this.hasRoot) {
      this.root = [];
      this.hasRoot = true;
    }
    if (frame) this.frameNodes.set(frame, this.root as JsonValue);
  }

  /**
   * Initialize a nested container for the given (already-pushed) grammar
   * frame, attaching it directly to its parent's node.
   *
   * Uses frame._parent/_segment (see grammar/frame.ts) plus the frameNodes
   * map instead of re-parsing frame.path and walking the tree from the
   * root on every call — that walk is O(depth), and calling it once for
   * every one of N nested containers made opening N levels cost O(N^2)
   * total, independent of the grammar-stack path-string fix.
   */
  initContainerForFrame(frame: GrammarFrame, type: "object" | "array"): void {
    if (!this.hasRoot) return;

    const parent = frame._parent;
    const segment = frame._segment;
    if (!parent || segment === null || segment === undefined) return;

    const parentNode = this.frameNodes.get(parent);
    if (parentNode === undefined || parentNode === null) return;

    const newContainer: JsonValue = type === "object" ? {} : [];

    if (typeof parentNode === "object" && !Array.isArray(parentNode)) {
      safeSet(parentNode as JsonObject, segment as string, newContainer);
    } else if (Array.isArray(parentNode)) {
      const idx =
        typeof segment === "number" ? segment : parseInt(segment, 10);
      if (!isNaN(idx)) {
        (parentNode as JsonArray)[idx] = newContainer;
      }
    } else {
      return;
    }

    this.frameNodes.set(frame, newContainer);
  }

  /**
   * Get a deep clone of the current stable value.
   */
  getStableValue(): JsonValue | undefined {
    if (!this.hasRoot) return undefined;
    return deepClone(this.root as JsonValue);
  }

  get hasRootValue(): boolean {
    return this.hasRoot;
  }
}

/**
 * Parse a JSON Pointer string into segments.
 * Handles ~0 (~) and ~1 (/) unescaping.
 */
function parsePointer(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return [];

  return pointer
    .slice(1)
    .split("/")
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Assign a JSON-derived key onto a plain object without going through the
 * inherited `__proto__` accessor. Bracket assignment (obj[key] = value) on a
 * plain object silently reassigns the object's prototype instead of creating
 * an own property when key === "__proto__", which makes that field vanish
 * from Object.keys()/JSON.stringify(). defineProperty always creates a real
 * own data property, matching native JSON.parse's behavior for such keys.
 */
function safeSet(obj: JsonObject, key: string, value: JsonValue): void {
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

/**
 * Deep clone a JSON value.
 * Iterative (explicit work-stack) rather than recursive: a recursive
 * implementation overflows the JS call stack around ~5000 levels of nesting,
 * well below values maxDepth's type otherwise permits.
 */
function deepClone(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  const root: JsonValue = Array.isArray(value) ? [] : {};
  const stack: Array<{ src: JsonObject | JsonArray; dst: JsonObject | JsonArray }> = [
    { src: value as JsonObject | JsonArray, dst: root as JsonObject | JsonArray },
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;
    const { src, dst } = frame;

    if (Array.isArray(src)) {
      const dstArr = dst as JsonArray;
      for (let i = 0; i < src.length; i++) {
        const child = src[i] as JsonValue;
        if (child !== null && typeof child === "object") {
          const childClone: JsonValue = Array.isArray(child) ? [] : {};
          dstArr[i] = childClone;
          stack.push({
            src: child as JsonObject | JsonArray,
            dst: childClone as JsonObject | JsonArray,
          });
        } else {
          dstArr[i] = child;
        }
      }
    } else {
      const srcObj = src as JsonObject;
      const dstObj = dst as JsonObject;
      for (const key of Object.keys(srcObj)) {
        const child = srcObj[key] as JsonValue;
        if (child !== null && typeof child === "object") {
          const childClone: JsonValue = Array.isArray(child) ? [] : {};
          safeSet(dstObj, key, childClone);
          stack.push({
            src: child as JsonObject | JsonArray,
            dst: childClone as JsonObject | JsonArray,
          });
        } else {
          safeSet(dstObj, key, child);
        }
      }
    }
  }

  return root;
}
