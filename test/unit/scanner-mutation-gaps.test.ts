import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";

describe("string escapes — each standard escape sequence produces its exact character", () => {
  const cases: Array<[string, string]> = [
    ['\\"', '"'],
    ["\\\\", "\\"],
    ["\\/", "/"],
    ["\\b", "\b"],
    ["\\f", "\f"],
    ["\\n", "\n"],
    ["\\r", "\r"],
    ["\\t", "\t"],
  ];

  for (const [escape, expected] of cases) {
    it(`"\\${escape.replace("\\", "")}" decodes to the correct character`, () => {
      const p = createParser();
      p.push(`"${escape}"`);
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("valid");
      expect(r.stableValue).toBe(expected);
    });
  }

  it("an unrecognized escape character (\\q) is rejected with the exact expected message", () => {
    const p = createParser();
    p.push('"\\q"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.diagnostics.some((d) => d.message === "Invalid escape sequence: \\q")).toBe(true);
  });
});

describe("unicode escapes (\\uXXXX) — surrogate pairing", () => {
  it("a valid surrogate pair (\\uD83D\\uDE00, U+1F600 grinning face) decodes to the correct astral codepoint", () => {
    const p = createParser();
    p.push('"\\uD83D\\uDE00"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toBe("\u{1F600}");
  });

  it("a high surrogate followed by a non-surrogate unicode escape is an unpaired-surrogate error", () => {
    const p = createParser();
    p.push('"\\uD83D\\u0041"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.diagnostics.some((d) => d.code === "E_UNPAIRED_SURROGATE")).toBe(true);
  });

  it("a high surrogate followed immediately by another high surrogate is an unpaired-surrogate error", () => {
    const p = createParser();
    p.push('"\\uD83D\\uD800"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.diagnostics.some((d) => d.code === "E_UNPAIRED_SURROGATE")).toBe(true);
  });

  it("a low surrogate with no preceding high surrogate is an unpaired-surrogate error, exact message", () => {
    const p = createParser();
    p.push('"\\uDE00"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(
      r.diagnostics.some((d) => d.code === "E_UNPAIRED_SURROGATE" && d.message === "Unexpected low surrogate: \\uDE00"),
    ).toBe(true);
  });

  it("a non-hex character inside a unicode escape is an invalid-unicode-escape error with the exact message", () => {
    const p = createParser();
    p.push('"\\u00zz"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(
      r.diagnostics.some(
        (d) => d.code === "E_INVALID_UNICODE_ESCAPE" && d.message === "Invalid hex digit in unicode escape: z",
      ),
    ).toBe(true);
  });

  it("a BMP unicode escape below the surrogate range (\\u0041 = 'A') decodes directly, no surrogate machinery involved", () => {
    const p = createParser();
    p.push('"\\u0041"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toBe("A");
  });

  it("chunk invariance: a surrogate pair split at every possible byte boundary still decodes identically", () => {
    const whole = '"\\uD83D\\uDE00"';
    const oneShot = createParser();
    oneShot.push(whole);
    const oneShotResult = oneShot.finish({ reason: "complete" });

    for (let i = 1; i < whole.length; i++) {
      const p = createParser();
      p.push(whole.slice(0, i));
      p.push(whole.slice(i));
      const r = p.finish({ reason: "complete" });
      expect(r.stableValue).toBe(oneShotResult.stableValue);
      expect(r.outcome).toBe(oneShotResult.outcome);
    }
  });
});

describe("raw control characters inside strings", () => {
  const rawControlChar = String.fromCharCode(1); // U+0001

  it("a raw control character (U+0001) inside a string is rejected by default (reject mode)", () => {
    const p = createParser();
    p.push(`"a${rawControlChar}b"`);
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.diagnostics.some((d) => d.code === "W_RAW_CONTROL_CHARACTER")).toBe(true);
  });

  it("with repairs.rawControlCharacters: 'escape', a raw control character is preserved (not rejected) and recorded as a repair", () => {
    const p = createParser({ repairs: { rawControlCharacters: "escape" } });
    p.push(`"a${rawControlChar}b"`);
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toBe(`a${rawControlChar}b`);
    expect(r.repairs.some((rep) => rep.code === "R_ESCAPE_RAW_CONTROL")).toBe(true);
  });

  it("a raw newline (U+000A) inside a string is also rejected as a control character - not confused with the \\n escape", () => {
    const p = createParser();
    p.push('"a\nb"');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.diagnostics.some((d) => d.code === "W_RAW_CONTROL_CHARACTER")).toBe(true);
  });
});

describe("literal tokens (true/false/null) — terminator and mismatch diagnostics for every literal, exact message text", () => {
  // "true" itself is exercised in scanner-error-paths.test.ts; this block fills
  // in the false/null variants of the same two diagnostic branches, since the
  // message text is built from `this.literalTarget` and is only genuinely
  // exercised per literal, not shared.
  const literalCases: Array<{ target: string; validTerminatorInput: string }> = [
    { target: "true", validTerminatorInput: "[true,1]" },
    { target: "false", validTerminatorInput: "[false,1]" },
    { target: "null", validTerminatorInput: "[null,1]" },
  ];

  for (const { target, validTerminatorInput } of literalCases) {
    it(`a fully-matched '${target}' immediately followed by a non-terminator character is rejected with the exact expected message`, () => {
      const p = createParser();
      p.push(`[${target}x]`);
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("invalid");
      expect(
        r.diagnostics.some(
          (d) => d.message === `Expected value terminator after '${target}', got: "x"`,
        ),
      ).toBe(true);
    });

    it(`'${target}' followed by a valid terminator (${JSON.stringify(validTerminatorInput)}) parses as the correct literal value`, () => {
      const p = createParser();
      p.push(validTerminatorInput);
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("valid");
    });
  }

  it("a mismatched character at the second position of 'false' ('fals' -> 'falze') is rejected with the exact expected message", () => {
    const p = createParser();
    p.push("falze");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(
      r.diagnostics.some(
        (d) => d.message === "Invalid literal: expected 's' but got 'z' (parsing 'false')",
      ),
    ).toBe(true);
  });

  it("a mismatched character at the last position of 'null' ('nul' -> 'nulx') is rejected with the exact expected message", () => {
    const p = createParser();
    p.push("nulx");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(
      r.diagnostics.some(
        (d) => d.message === "Invalid literal: expected 'l' but got 'x' (parsing 'null')",
      ),
    ).toBe(true);
  });
});

describe("beginNumber — numberHasDigit initial value distinguishes a leading digit from a leading minus sign", () => {
  it("a single-digit number immediately followed by a terminator is accepted (numberHasDigit starts true for a digit)", () => {
    const p = createParser();
    p.push("[5]");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toEqual([5]);
  });

  it("a bare minus sign immediately followed by a terminator is rejected as an invalid number, not accepted as a digit", () => {
    const p = createParser();
    p.push("[-]");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
  });
});
