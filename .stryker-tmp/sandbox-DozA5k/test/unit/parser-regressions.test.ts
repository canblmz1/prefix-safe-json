// @ts-nocheck
import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";

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
