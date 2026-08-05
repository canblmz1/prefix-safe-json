import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { JsonObject } from "../../src/types.js";

describe("Parser Regressions", () => {
  const invalidInputs = [
    "[1 2]",
    "[true false]",
    '["a" "b"]',
    "[{} {}]",
    "[[] []]",
    "[1,]",
    "[true,]",
    "[{},]",
    '{"a":1,}',
    '{"a":{},}',
  ];

  for (const input of invalidInputs) {
    it(`rejects invalid input: ${input}`, () => {
      const parser = createParser();
      parser.push(input);
      parser.finish({ reason: "complete" });

      const snapshot = parser.snapshot();
      expect(["invalid", "incomplete"]).toContain(snapshot.syntax);
      expect(snapshot.executable).toBe(false);

      const hasError = snapshot.diagnostics.some(d => d.severity === "error" || d.severity === "fatal");
      expect(hasError).toBe(true);
    });
  }
});

describe("Hostile audit fixes", () => {
  it("decoder: does not crash on a single push over ~130KB", () => {
    const parser = createParser({ limits: { maxQueuedEvents: 1_000_000 } });
    const bigString = "x".repeat(200_000);
    const payload = `{"a":"${bigString}"}`;

    expect(() => parser.push(payload)).not.toThrow();

    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
    expect((result.stableValue as JsonObject).a).toHaveLength(200_000);
  });

  it("decoder: does not crash on a single Uint8Array push over ~130KB", () => {
    const parser = createParser({ limits: { maxQueuedEvents: 1_000_000 } });
    const bigString = "y".repeat(200_000);
    const bytes = new TextEncoder().encode(`{"a":"${bigString}"}`);

    expect(() => parser.push(bytes)).not.toThrow();

    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
  });

  it("__proto__: is preserved as a real own property, not silently dropped", () => {
    const parser = createParser();
    parser.push('{"__proto__": "hello", "safe": 1}');
    const result = parser.finish({ reason: "complete" });

    const value = result.stableValue as JsonObject;
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toBe("hello");
    expect(value.safe).toBe(1);
    expect(Object.keys(value).sort()).toEqual(["__proto__", "safe"]);
    // Compare against native JSON.parse's own output rather than a
    // hand-written `{ __proto__: "hello" }` object literal — the literal
    // shorthand form is itself special-cased by the JS spec to *set the
    // prototype* rather than create an own property, and silently no-ops
    // for a non-object value like "hello". JSON.parse doesn't have that
    // problem (it uses CreateDataProperty), so it's a safe reference here.
    expect(JSON.stringify(value)).toBe(
      JSON.stringify(JSON.parse('{"__proto__":"hello","safe":1}')),
    );
    // Must not escalate to real prototype pollution either.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("__proto__: nested under a key does not leak into the global prototype", () => {
    const before = ({} as Record<string, unknown>).polluted;
    const parser = createParser();
    parser.push('{"a":{"__proto__":{"polluted":"yes"}}}');
    const result = parser.finish({ reason: "complete" });

    expect(({} as Record<string, unknown>).polluted).toBe(before);
    const a = (result.stableValue as JsonObject).a as JsonObject;
    expect(Object.getOwnPropertyDescriptor(a, "__proto__")?.value).toEqual({
      polluted: "yes",
    });
  });

  it("deepClone: snapshot() does not crash at nesting depth 6000", () => {
    const DEPTH = 6000;
    const parser = createParser({ limits: { maxDepth: 100_000 } });
    parser.push('{"a":'.repeat(DEPTH) + "1" + "}".repeat(DEPTH));

    expect(() => parser.snapshot()).not.toThrow();
  });

  it("deepClone: finish() does not crash at nesting depth 6000", () => {
    const DEPTH = 6000;
    const parser = createParser({ limits: { maxDepth: 100_000 } });
    parser.push('{"a":'.repeat(DEPTH) + "1" + "}".repeat(DEPTH));

    expect(() => parser.finish({ reason: "complete" })).not.toThrow();
  });

  it("pointer construction: opening 6000 nested unclosed arrays stays fast", () => {
    const DEPTH = 6000;
    const parser = createParser({
      limits: { maxDepth: 100_000, maxQueuedEvents: 1_000_000 },
    });

    const start = performance.now();
    parser.push("[".repeat(DEPTH));
    const elapsedMs = performance.now() - start;

    // Pre-fix (O(n^2) eager path materialization) this took multiple
    // seconds at this depth; post-fix it's a handful of milliseconds.
    expect(elapsedMs).toBeLessThan(1500);
  }, 20_000);

  it("diagnostics: allDiagnostics/allRepairs stay bounded even when drained after every push", () => {
    const CAP = 50;
    const parser = createParser({ limits: { maxQueuedEvents: CAP } });

    parser.push('{"a":1');
    parser.drainEvents();

    // Each of these repeats registers one E_DUPLICATE_KEY diagnostic. A
    // consumer draining events after every push keeps the live event queue
    // short, which must not let the diagnostics/repairs history grow past
    // the configured cap regardless.
    for (let i = 0; i < CAP * 4; i++) {
      parser.push(',"a":1');
      parser.drainEvents();
    }
    parser.push("}");
    parser.drainEvents();

    const result = parser.finish({ reason: "complete" });
    expect(result.diagnostics.length).toBeLessThanOrEqual(CAP);
  });

  it("outcome/executable stay correct when the repairs array is saturated before a structural repair occurs", () => {
    // Regression: determineOutcome() and isExecutable() used to re-derive
    // "was there ever a structural repair / R_CLOSE_CONTAINER repair" by
    // scanning allRepairs — which the maxQueuedEvents cap can truncate. If
    // enough representation_preserving repairs (e.g. escaped raw control
    // characters) filled the cap before a later closeContainersAtFinish
    // salvage occurred, the salvage repair itself would be silently dropped
    // from the array, and outcome incorrectly reported "valid" instead of
    // "salvaged" for a stream that was actually truncated and only survived
    // via structural salvage.
    const CAP = 10;
    const parser = createParser({
      limits: { maxQueuedEvents: CAP, maxDepth: 100 },
      repairs: { rawControlCharacters: "escape", closeContainersAtFinish: "safe-only" },
    });

    parser.push('{"a":"');
    parser.drainEvents();
    for (let i = 0; i < CAP + 5; i++) {
      parser.push("\x01"); // each produces one representation_preserving repair
      parser.drainEvents();
    }
    parser.push('","b":true ');
    parser.drainEvents();

    const result = parser.finish({ reason: "length" }); // truncated -> triggers safe-only salvage

    expect(result.repairs.length).toBeLessThanOrEqual(CAP); // array is still capped
    expect(result.outcome).toBe("salvaged"); // but outcome is correct regardless
    expect(result.executable).toBe(false);
  });
});
