// ---------------------------------------------------------------------------
// Every diagnostic emission site in scanner.ts, asserted by full shape
// (code/severity/message/recoverable). Many of these already have exact
// message-text coverage elsewhere, but message-only assertions can't
// distinguish a mutant that blanks severity or flips recoverable, since
// dozens of scanner diagnostics share the same code/severity/recoverable
// triple and differ only in message text.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { Diagnostic } from "../../src/types.js";

function findExact(diagnostics: readonly Diagnostic[], message: string): Diagnostic | undefined {
  return diagnostics.find((d) => d.message === message);
}

const BS = String.fromCharCode(92); // backslash, kept out of source string literals for clarity

describe("scanner.ts diagnostics — full shape per emission site", () => {
  it("processStructural: a completely invalid start character", () => {
    const p = createParser();
    p.push("@");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, 'Unexpected character: "@"');
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("processString: maxStringBytes exceeded (fatal)", () => {
    const p = createParser({ limits: { maxStringBytes: 5 } });
    p.push('"123456"');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "String exceeds maximum of 5 bytes");
    expect(diag).toMatchObject({ code: "E_LIMIT_STRING_BYTES", severity: "fatal", recoverable: false });
  });

  it("processString: raw control character (reject mode)", () => {
    const p = createParser();
    p.push(`"a${String.fromCharCode(1)}b"`);
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Raw control character U+0001 in string");
    expect(diag).toMatchObject({ code: "W_RAW_CONTROL_CHARACTER", severity: "error", recoverable: false });
  });

  it("processEscape: unrecognized escape character", () => {
    const p = createParser();
    p.push('"' + BS + 'q"');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, `Invalid escape sequence: ${BS}q`);
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("processUnicodeEscape: high surrogate followed by a non-low-surrogate unicode escape", () => {
    const p = createParser();
    p.push('"' + BS + 'uD83D' + BS + 'u0041"');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(
      r.diagnostics,
      `Expected low surrogate after ${BS}ud83d, got ${BS}u0041`,
    );
    expect(diag).toMatchObject({ code: "E_UNPAIRED_SURROGATE", severity: "error", recoverable: false });
  });

  it("processUnicodeEscape: unpaired low surrogate with no preceding high surrogate", () => {
    const p = createParser();
    p.push('"' + BS + 'uDE00"');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, `Unexpected low surrogate: ${BS}uDE00`);
    expect(diag).toMatchObject({ code: "E_UNPAIRED_SURROGATE", severity: "error", recoverable: false });
  });

  it("processUnicodeEscape: non-hex character inside a unicode escape", () => {
    const p = createParser();
    p.push('"' + BS + 'u00zz"');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Invalid hex digit in unicode escape: z");
    expect(diag).toMatchObject({ code: "E_INVALID_UNICODE_ESCAPE", severity: "error", recoverable: false });
  });

  it("processSurrogatePending (phase 0): high surrogate followed by a non-backslash character", () => {
    const p = createParser();
    p.push('"' + BS + 'uD83Dx"');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, `Expected ${BS}u for low surrogate, got: "x"`);
    expect(diag).toMatchObject({ code: "E_UNPAIRED_SURROGATE", severity: "error", recoverable: false });
  });

  it("processSurrogatePending (phase 1): high surrogate, backslash, then a non-'u' character", () => {
    const p = createParser();
    p.push('"' + BS + 'uD83D' + BS + 'x"');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, `Expected 'u' after '${BS}' for low surrogate, got: "x"`);
    expect(diag).toMatchObject({ code: "E_UNPAIRED_SURROGATE", severity: "error", recoverable: false });
  });

  it("processNumber (NumberInteger): invalid character in the integer part", () => {
    const p = createParser();
    p.push("[1@]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, 'Invalid character in number: "@"');
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("processNumber (NumberFraction): trailing decimal point with no digits - byteOffset pins this to the per-state terminator check, not the commitNumber() fallback", () => {
    // numberGrammarError() (called from commitNumber()'s fallback path) would
    // produce the *same message text* for this input, but at a *different*
    // byteOffset (the number's start, not the terminator) - so byteOffset is
    // what actually proves this line's own check fired, not the redundant
    // one inside commitNumber().
    const p = createParser();
    p.push("[1.,2]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Number has trailing decimal point with no digits");
    expect(diag).toMatchObject({
      code: "E_UNEXPECTED_TOKEN",
      severity: "error",
      recoverable: false,
      byteOffset: 3, // the "," terminator's position, not "1"'s position (1)
    });
  });

  it("processNumber (NumberFraction): invalid character in the fraction part", () => {
    const p = createParser();
    p.push("[1.5@]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, 'Invalid character in number fraction: "@"');
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("processNumber (NumberExponentStart): missing digit/sign right after the exponent marker", () => {
    const p = createParser();
    p.push("[1ex,2]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, 'Expected digit or sign after exponent, got: "x"');
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("processNumber (NumberExponent): trailing exponent marker/sign with no digits - byteOffset pins this to the per-state terminator check, not the commitNumber() fallback", () => {
    const p = createParser();
    p.push("[1e+,2]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Number has exponent with no digits");
    expect(diag).toMatchObject({
      code: "E_UNEXPECTED_TOKEN",
      severity: "error",
      recoverable: false,
      byteOffset: 4, // the "," terminator's position, not "1"'s position (1)
    });
  });

  it("processNumber (NumberExponent): invalid character in the exponent digits", () => {
    const p = createParser();
    p.push("[1e5@]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, 'Invalid character in number exponent: "@"');
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("processLiteral: fully-matched literal immediately followed by a non-terminator character", () => {
    const p = createParser();
    p.push("[truex]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, `Expected value terminator after 'true', got: "x"`);
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("processLiteral: a mismatched character mid-literal", () => {
    const p = createParser();
    p.push("[tRue]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, `Invalid literal: expected 'r' but got 'R' (parsing 'true')`);
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("commitNumber -> numberGrammarError: leading zero, via a mid-stream delimiter", () => {
    const p = createParser();
    p.push("[01,2]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Number has leading zero");
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });
});

describe("R_ESCAPE_RAW_CONTROL repair — full shape", () => {
  it("escaping a raw control character in escape mode produces the exact repair object", () => {
    const p = createParser({ repairs: { rawControlCharacters: "escape" } });
    p.push(`"a${String.fromCharCode(1)}b"`);
    const r = p.finish({ reason: "complete" });
    expect(r.repairs[0]).toEqual({
      code: "R_ESCAPE_RAW_CONTROL",
      byteRange: [2, 3],
      impact: "representation_preserving",
      description: "Escaped raw control character U+0001",
    });
  });
});
