// ---------------------------------------------------------------------------
// Valid JSON Equivalence Tests
// ---------------------------------------------------------------------------
// For valid complete JSON: parser result must match JSON.parse,
// no repairs, no fatal diagnostics, and executable = true.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";

const validInputs = [
  '{"a":1}',
  '{"name":"Alice","age":30}',
  '[1,2,3]',
  '{"nested":{"x":true}}',
  '{"arr":[1,"two",null,false]}',
  '{"empty":{}}',
  '{"list":[]}',
  '"standalone string"',
  "42",
  "-3.14",
  "1e10",
  "true",
  "false",
  "null",
  '{"msg":"line1\\nline2"}',
  '{"path":"c:\\\\dir\\\\file"}',
  '{"unicode":"\\u0041"}',
  '{"nested":{"a":{"b":{"c":1}}}}',
  '[{"x":1},{"y":2}]',
  '{"a":1,"b":2,"c":3,"d":4,"e":5}',
];

describe("Valid JSON Equivalence", () => {
  for (const input of validInputs) {
    it(`matches JSON.parse: ${input.slice(0, 40)}`, () => {
      const expected = JSON.parse(input) as unknown;
      const parser = createParser();
      parser.push(input);
      const result = parser.finish({ reason: "complete" });

      // Same semantic value
      expect(result.stableValue).toEqual(expected);

      // No repairs
      expect(result.repairs).toHaveLength(0);

      // No fatal diagnostics
      const fatalDiags = result.diagnostics.filter(
        (d) => d.severity === "fatal",
      );
      expect(fatalDiags).toHaveLength(0);

      // No error diagnostics
      const errorDiags = result.diagnostics.filter(
        (d) => d.severity === "error",
      );
      expect(errorDiags).toHaveLength(0);

      // Executable
      expect(result.executable).toBe(true);

      // Valid outcome
      expect(result.outcome).toBe("valid");
    });
  }
});
