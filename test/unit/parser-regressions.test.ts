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
});
