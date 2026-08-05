// ---------------------------------------------------------------------------
// Snapshot builder — constructs stableValue from committed events
// ---------------------------------------------------------------------------

import type { JsonValue, JsonObject, JsonArray, ParserEvent } from "../types.js";

/**
 * Maintains the stable value by processing committed events.
 * Only committed values appear in the stable value.
 */
export class SnapshotBuilder {
  private root: JsonValue | undefined = undefined;
  private hasRoot = false;

  /**
   * Process a value_committed event and integrate it into the stable value.
   */
  processEvent(event: ParserEvent): void {
    if (event.type !== "value_committed") return;

    const { path, value } = event;

    if (path === "") {
      // Root value
      this.root = value;
      this.hasRoot = true;
      return;
    }

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
   */
  initRootObject(): void {
    if (!this.hasRoot) {
      this.root = {};
      this.hasRoot = true;
    }
  }

  /**
   * Initialize the root as an array container.
   */
  initRootArray(): void {
    if (!this.hasRoot) {
      this.root = [];
      this.hasRoot = true;
    }
  }

  /**
   * Initialize a nested container at the given path.
   */
  initContainer(path: string, type: "object" | "array"): void {
    if (!this.hasRoot) return;

    const segments = parsePointer(path);
    if (segments.length === 0) return;

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
        return;
      }
    }

    if (target === null || target === undefined) return;

    const newContainer = type === "object" ? {} : [];

    if (typeof target === "object" && !Array.isArray(target)) {
      safeSet(target as JsonObject, lastSegment, newContainer);
    } else if (Array.isArray(target)) {
      const idx = parseInt(lastSegment, 10);
      if (!isNaN(idx)) {
        (target as JsonArray)[idx] = newContainer;
      }
    }
  }

  /**
   * Remove a path from the stable value (for unclosed containers during snapshot).
   */
  removePath(path: string): void {
    if (!this.hasRoot || path === "") return;

    const segments = parsePointer(path);
    if (segments.length === 0) return;

    const parentSegments = segments.slice(0, -1);
    const lastSegment = segments[segments.length - 1];
    if (lastSegment === undefined) return;

    let target = this.root;
    let parent: unknown = null;
    let parentKey: string | number = "";

    for (const seg of parentSegments) {
      if (target === null || target === undefined) return;
      parent = target;
      if (typeof target === "object" && !Array.isArray(target)) {
        parentKey = seg;
        target = (target as JsonObject)[seg];
      } else if (Array.isArray(target)) {
        const idx = parseInt(seg, 10);
        if (isNaN(idx)) return;
        parentKey = idx;
        target = target[idx];
      } else {
        return;
      }
    }

    if (target !== null && target !== undefined) {
      if (typeof target === "object" && !Array.isArray(target)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { [lastSegment]: removed, ...rest } = target as JsonObject;
        if (parent === null) {
          this.root = rest;
        } else if (Array.isArray(parent)) {
          (parent as JsonArray)[parentKey as number] = rest;
        } else {
          (parent as JsonObject)[parentKey as string] = rest;
        }
      }
    }
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
