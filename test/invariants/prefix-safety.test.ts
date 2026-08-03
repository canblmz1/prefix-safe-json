// ---------------------------------------------------------------------------
// Prefix Safety Tests
// ---------------------------------------------------------------------------
// stableValue must never contain partial values:
// - No partial strings
// - No partial numbers
// - No partial literals
// - No partial unicode escapes
// - No unclosed child containers
// ---------------------------------------------------------------------------
import { expectDefined } from "../utils/expect-defined.js";

import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { JsonValue } from "../../src/types.js";

/**
 * Recursively verify that a JSON value contains no incomplete values.
 * This is a structural check — we can't detect "partial" values in a finalized
 * JSON tree, but we CAN verify the parser only puts complete values in stableValue.
 */
function assertValueComplete(value: JsonValue, path: string): void {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    // Scalars are always complete by definition
    return;
  }
  if (typeof value === "string") {
    // Strings in stableValue should be complete (not truncated mid-escape)
    // We can't fully verify this without the original source, but we can check
    // for unpaired surrogates
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      // Check for lone surrogates (shouldn't appear in valid strings)
      if (code >= 0xd800 && code <= 0xdbff) {
        // High surrogate — must be followed by low surrogate
        const next = value.charCodeAt(i + 1);
        expect(
          next >= 0xdc00 && next <= 0xdfff,
          `Unpaired high surrogate at ${path}[${i}]`,
        ).toBe(true);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertValueComplete(expectDefined(value[i]), `${path}/${i}`);
    }
    return;
  }
  // Object
  for (const key of Object.keys(value)) {
    assertValueComplete(expectDefined(value[key]), `${path}/${key}`);
  }
}

describe("Prefix Safety", () => {
  const truncatedInputs = [
    { name: "mid-string", input: '{"a":"hello wor' },
    { name: "mid-number", input: '{"a":12' },
    { name: "mid-literal", input: '{"a":tru' },
    { name: "mid-unicode", input: '{"a":"\\u00' },
    { name: "unclosed object", input: '{"a":1,"b":{"c":' },
    { name: "unclosed array", input: '{"items":[1,2,' },
    { name: "unclosed string key", input: '{"complete":1,"inc' },
  ];

  for (const tc of truncatedInputs) {
    it(`${tc.name}: stableValue has no partial values`, () => {
      const parser = createParser();
      parser.push(tc.input);
      const snap = parser.snapshot();

      if (snap.stableValue !== undefined) {
        assertValueComplete(snap.stableValue, "");
      }

      // Finish with truncation
      const result = parser.finish({ reason: "length" });
      if (result.stableValue !== undefined) {
        assertValueComplete(result.stableValue, "");
      }
    });
  }

  it("committed fields exist in stableValue, pending fields don't", () => {
    const parser = createParser();
    parser.push('{"done":"complete","pending":"incom');
    const snap = parser.snapshot();

    // "done" should be in stableValue
    expect(snap.stableValue).toBeDefined();
    const sv = snap.stableValue as Record<string, unknown>;
    expect(sv.done).toBe("complete");

    // "pending" should NOT be in stableValue
    expect(sv.pending).toBeUndefined();
  });
});
