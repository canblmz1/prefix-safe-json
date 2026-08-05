import { describe, it, expect } from "vitest";
import { createObjectFrame, createArrayFrame } from "../../src/grammar/frame.js";

describe("GrammarFrame lazy path getter", () => {
  it("the 'path' property descriptor is enumerable and configurable", () => {
    const frame = createObjectFrame(null, null, 0);
    const desc = Object.getOwnPropertyDescriptor(frame, "path");
    expect(desc?.enumerable).toBe(true);
    expect(desc?.configurable).toBe(true);
  });

  it("resolves correctly through a chain that includes an explicitly undefined segment", () => {
    // Root frame: segment is null (the normal "no segment" value).
    const root = createObjectFrame(null, null, 0);
    // A frame whose segment is undefined rather than null - not something
    // GrammarStack ever produces itself, but the type permits it, and the
    // resolver must treat undefined and null identically (skip appending a
    // path segment for this frame) rather than only special-casing null.
    const middle = createObjectFrame(root, undefined as unknown as null, 0);
    const leaf = createObjectFrame(middle, "leaf", 0);

    expect(root.path).toBe("");
    expect(middle.path).toBe(""); // segment undefined -> no segment appended
    expect(leaf.path).toBe("/leaf");
  });

  it("array frames resolve the same way", () => {
    const root = createArrayFrame(null, null, 0);
    const child = createArrayFrame(root, 2, 0);
    expect(child.path).toBe("/2");
  });

  it("repeated .path reads on many sibling frames sharing a deep common ancestor stay fast", () => {
    // Regression-shaped perf check for resolveFramePath's ancestor-caching
    // loop: build a long chain, cache its deepest frame's path once, then
    // read .path on many *sibling* frames attached at varying points along
    // that same chain. Each read should stop at the nearest already-cached
    // ancestor rather than walking all the way back to the true root every
    // time - if that short-circuit were disabled, this would be O(depth)
    // per read instead of O(1) amortized, and 5000 reads at depth 3000
    // would take vastly longer than the assertion below allows.
    const DEPTH = 3000;
    let cur = createObjectFrame(null, null, 0);
    const chain = [cur];
    for (let i = 1; i < DEPTH; i++) {
      cur = createObjectFrame(cur, String(i), 0);
      chain.push(cur);
    }
    // Prime the cache for the entire chain.
    expect(cur.path.length).toBeGreaterThan(0);

    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      const parent = chain[i % chain.length] as ReturnType<typeof createObjectFrame>;
      const sibling = createObjectFrame(parent, `sib${i}`, 0);
      void sibling.path;
    }
    const elapsedMs = performance.now() - start;
    expect(elapsedMs).toBeLessThan(1000);
  });
});
