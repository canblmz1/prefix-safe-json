import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
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

  it("number grammar: rejects a leading zero ('01')", () => {
    const parser = createParser();
    parser.push("01");
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: rejects a leading zero inside an object ('{\"a\":01}')", () => {
    const parser = createParser();
    parser.push('{"a":01}');
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: rejects a trailing decimal point ('1.')", () => {
    const parser = createParser();
    parser.push("1.");
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: rejects a truncated exponent ('1e+') at stream end", () => {
    const parser = createParser();
    parser.push("1e+");
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: still accepts valid numbers unaffected by the fix", () => {
    const cases: Array<[string, number]> = [
      ["0", 0],
      ["0.5", 0.5],
      ["-0", -0],
      ["1e400", Infinity],
      ["-1", -1],
      ["1.5e10", 1.5e10],
    ];
    for (const [text, expected] of cases) {
      const parser = createParser();
      parser.push(text);
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome, `input ${text}`).toBe("valid");
      expect(result.stableValue, `input ${text}`).toBe(expected);
    }
  });

  it("maxStringBytes: enforced when configured", () => {
    const parser = createParser({ limits: { maxStringBytes: 10 } });
    parser.push('{"a":"this string is much longer than ten bytes"}');

    const snapshot = parser.snapshot();
    expect(snapshot.syntax).toBe("invalid");
    expect(
      snapshot.diagnostics.some((d) => d.code === "E_LIMIT_STRING_BYTES"),
    ).toBe(true);
  });

  it("maxStringBytes: a string of exactly the configured length is allowed (off-by-one)", () => {
    // Regression: the length check ran on the closing quote character too,
    // counting it as one extra content byte, so a 5-byte string with
    // maxStringBytes:5 was wrongly rejected.
    const exactly = createParser({ limits: { maxStringBytes: 5 } });
    exactly.push('{"a":"12345"}');
    const exactResult = exactly.finish({ reason: "complete" });
    expect(exactResult.outcome).toBe("valid");
    expect(exactResult.stableValue).toEqual({ a: "12345" });

    const oneOver = createParser({ limits: { maxStringBytes: 5 } });
    oneOver.push('{"a":"123456"}');
    const overResult = oneOver.finish({ reason: "complete" });
    expect(overResult.outcome).not.toBe("valid");
  });

  it("maxStringBytes: an all-backslash-escape string still can't bypass the limit", () => {
    // Regression-adjacent: confirms the closing-quote exemption above didn't
    // accidentally also exempt the backslash-starts-an-escape branch, which
    // would let a string made entirely of escapes grow unbounded.
    const parser = createParser({
      limits: { maxStringBytes: 20, maxQueuedEvents: 1_000_000 },
    });
    const payload = '{"a":"' + "\\\\".repeat(500) + '"}'; // 1000 raw bytes
    const r = parser.push(payload);
    expect(r.terminal).toBe(true);
  });

  it("maxStringBytes: short strings under the limit are unaffected", () => {
    const parser = createParser({ limits: { maxStringBytes: 10 } });
    parser.push('{"a":"ok"}');
    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
    expect((result.stableValue as JsonObject).a).toBe("ok");
  });

  it("coordinator: parserOptions passed to the factory reach the underlying parser", () => {
    const coord = createToolCallStreamCoordinator(undefined, {
      limits: { maxDepth: 2 },
    });
    const callRef = { internalId: "id0" };
    coord.push({
      type: "tool_call_start",
      callRef,
      toolIndex: 0,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    // Three levels of nesting — over the configured maxDepth of 2.
    coord.push({
      type: "tool_call_arguments_delta",
      callRef,
      toolIndex: 0,
      delta: '{"a":{"b":{"c":1',
    } as unknown as NormalizedToolStreamEvent);

    const call = coord.snapshot().calls[0];
    expect(call).toBeDefined();
    expect(
      call?.parser.diagnostics.some((d) => d.code === "E_LIMIT_DEPTH"),
    ).toBe(true);
  });

  it("coordinator: omitting parserOptions still works with library defaults", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({
      type: "tool_call_start",
      callRef,
      toolIndex: 0,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_arguments_delta",
      callRef,
      toolIndex: 0,
      delta: '{"a":{"b":{"c":1}}}',
    } as unknown as NormalizedToolStreamEvent);

    const call = coord.snapshot().calls[0];
    expect(call?.parser.diagnostics.some((d) => d.code === "E_LIMIT_DEPTH")).toBe(
      false,
    );
  });
});
