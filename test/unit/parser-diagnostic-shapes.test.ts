// ---------------------------------------------------------------------------
// Every E_UNEXPECTED_TOKEN emission site in parser.ts shares the same code,
// severity ("error"), and recoverable (false) - only the message text
// differs per call site. A test that only checks `.some(d => d.code ===
// "E_UNEXPECTED_TOKEN")` or `.some(d => d.message === X)` in isolation can't
// distinguish a mutant that blanks out the message, flips recoverable, or
// swaps severity to "" from correct behavior, because dozens of other sites
// produce an indistinguishable-by-that-assertion diagnostic. Every case here
// asserts the full diagnostic shape (code, severity, message, recoverable)
// for one minimal reproducer per site.
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { Diagnostic } from "../../src/types.js";

function findExact(diagnostics: readonly Diagnostic[], message: string): Diagnostic | undefined {
  return diagnostics.find((d) => d.message === message);
}

const UNEXPECTED_TOKEN_SHAPE = {
  code: "E_UNEXPECTED_TOKEN",
  severity: "error" as const,
  recoverable: false,
};

describe("E_UNEXPECTED_TOKEN diagnostics — full shape (code/severity/message/recoverable) per emission site", () => {
  it("handleColon: no open container at all ('Unexpected \\':\\'')", () => {
    const p = createParser();
    p.push(":");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ':'");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleColon: inside an array ('Unexpected \\':\\'')", () => {
    const p = createParser();
    p.push("[1:2]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ':'");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleComma: no open container at all ('Unexpected \\',\\'')", () => {
    const p = createParser();
    p.push(",");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ','");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleComma: leading comma in an object ('Unexpected \\',\\' in object')", () => {
    const p = createParser();
    p.push('{,"a":1}');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ',' in object");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleComma: leading comma in an array ('Unexpected \\',\\' in array')", () => {
    const p = createParser();
    p.push("[,1]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ',' in array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleObjectStart: '{' where an object key is expected ('Unexpected \\'{\\'')", () => {
    const p = createParser();
    p.push("{{}}");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected '{'");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleObjectStart: '{' in an array missing a comma ('Unexpected \\'{\\' in array')", () => {
    const p = createParser();
    // A bare number can't be directly followed by "{" - the scanner itself
    // rejects "{" as an invalid number-terminator character before the
    // parser ever sees a token. A closed sub-array gives an unambiguous
    // token boundary instead: "[1]" commits (comma_or_end), then "{"
    // arrives with no comma first.
    p.push("[[1]{}]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected '{' in array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleObjectEnd: '}' with no matching open object ('Unexpected \\'}\\' — no matching open object')", () => {
    const p = createParser();
    p.push("}");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected '}' — no matching open object");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleObjectEnd: '}' with an open ARRAY instead (mismatched bracket) reports the same 'no matching open object' message", () => {
    const p = createParser();
    p.push("[1}");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected '}' — no matching open object");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleObjectEnd: '}' while expecting a colon, not an end ('Unexpected \\'}\\' while expecting colon')", () => {
    const p = createParser();
    p.push('{"a"}'); // key committed, expectation is now "colon"
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected '}' while expecting colon");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleArrayStart: '[' where an object key is expected ('Unexpected \\'[\\'')", () => {
    const p = createParser();
    p.push("{[");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected '['");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleArrayStart: '[' in an array missing a comma ('Unexpected \\'[\\' in array')", () => {
    const p = createParser();
    p.push("[[1][2]]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected '[' in array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleArrayEnd: ']' with no matching open array ('Unexpected \\']\\' — no matching open array')", () => {
    const p = createParser();
    p.push("]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ']' — no matching open array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleArrayEnd: ']' with an open OBJECT instead (mismatched bracket) reports the same 'no matching open array' message", () => {
    const p = createParser();
    p.push("{]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ']' — no matching open array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleArrayEnd: ']' right after a dangling comma ('Unexpected \\']\\'')", () => {
    const p = createParser();
    p.push("[1,]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected ']'");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("handleString: two strings back to back in an array with no comma ('Unexpected string in array')", () => {
    const p = createParser();
    p.push('["a" "b"]');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected string in array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("commitScalar: two numbers back to back in an array with no comma ('Unexpected scalar in array')", () => {
    const p = createParser();
    p.push("[1 2]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected scalar in array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });

  it("commitScalar: a literal (true) right after another value with no comma ('Unexpected scalar in array')", () => {
    const p = createParser();
    p.push("[1 true]");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unexpected scalar in array");
    expect(diag).toMatchObject(UNEXPECTED_TOKEN_SHAPE);
  });
});

describe("BOM-strip repair — full shape", () => {
  it("stripping a UTF-8 BOM produces the exact R_STRIP_UTF8_BOM repair object", () => {
    const p = createParser();
    p.push("﻿" + '{"a":1}');
    const r = p.finish({ reason: "complete" });
    expect(r.repairs[0]).toEqual({
      code: "R_STRIP_UTF8_BOM",
      byteRange: [0, 3],
      impact: "representation_preserving",
      description: "Stripped UTF-8 BOM at index 0",
    });
  });
});

describe("UTF-8 decode error diagnostic — full shape", () => {
  it("an invalid start byte produces the exact diagnostic shape", () => {
    const p = createParser();
    p.push(Uint8Array.from([0xff]));
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics[0]).toEqual({
      code: "E_INVALID_UTF8",
      severity: "error",
      byteOffset: 0,
      message: "Invalid UTF-8: invalid_start_byte at byte 0",
      recoverable: false,
    });
  });
});

describe("trailing data — full shape for both the isolate (default) and reject repair policies", () => {
  it("reject policy: a full E_TRAILING_DATA diagnostic, not just the code", () => {
    const p = createParser({ repairs: { trailingData: "reject" } });
    p.push('{"a":1} x');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Trailing data rejected");
    expect(diag).toMatchObject({ code: "E_TRAILING_DATA", severity: "error", recoverable: false });
  });

  it("isolate policy (default): the warning diagnostic AND the repair both have their exact full shape", () => {
    const p = createParser();
    p.push('{"a":1} x');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    const diag = findExact(r.diagnostics, "Unexpected data after root JSON value");
    expect(diag).toMatchObject({ code: "E_TRAILING_DATA", severity: "warning", recoverable: true });
    expect(r.repairs[0]).toMatchObject({
      code: "R_ISOLATE_TRAILING_DATA",
      impact: "root_preserving",
      description: "Isolated trailing data after complete JSON root",
    });
  });

  it("exceeding maxTrailingDataBytes produces the exact limit diagnostic and goes invalid", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 1 } });
    p.push('{"a":1} xx');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    const diag = findExact(r.diagnostics, "Maximum trailing data bytes exceeded");
    expect(diag).toMatchObject({ code: "E_LIMIT_INPUT_BYTES", severity: "error", recoverable: false });
  });
});

describe("finish() pending-value diagnostics — full shape, one per pendingInfo.type", () => {
  it("a grammatically invalid number pending at true stream end ('Invalid number at stream end: <buffer>')", () => {
    const p = createParser();
    p.push("01"); // leading zero - not fixable by more input
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    const diag = findExact(r.diagnostics, "Invalid number at stream end: 01");
    expect(diag).toMatchObject({ code: "E_UNEXPECTED_TOKEN", severity: "error", recoverable: false });
  });

  it("a well-formed-so-far number left pending when the stream is merely truncated ('Incomplete number at stream end: <buffer>')", () => {
    const p = createParser();
    p.push("42");
    const r = p.finish({ reason: "length" });
    const diag = findExact(r.diagnostics, "Incomplete number at stream end: 42");
    expect(diag).toMatchObject({ code: "E_INCOMPLETE_NUMBER", severity: "error", recoverable: false });
  });

  it("a genuinely partial literal buffer at stream end ('Incomplete literal at stream end: <buffer>')", () => {
    const p = createParser();
    p.push("tru");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Incomplete literal at stream end: tru");
    expect(diag).toMatchObject({ code: "E_INCOMPLETE_LITERAL", severity: "error", recoverable: false });
  });

  it("an unterminated string pending at stream end ('Unterminated string at stream end')", () => {
    const p = createParser();
    p.push('"abc');
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Unterminated string at stream end");
    expect(diag).toMatchObject({ code: "E_UNTERMINATED_STRING", severity: "error", recoverable: false });
  });
});

describe("structural salvage (R_CLOSE_CONTAINER) — full repair shape", () => {
  it("closing one open object at stream end produces the exact repair object", () => {
    const p = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
    p.push('{"a":1 ');
    const r = p.finish({ reason: "length" });
    expect(r.outcome).toBe("salvaged");
    expect(r.repairs[0]).toEqual({
      code: "R_CLOSE_CONTAINER",
      byteRange: [7, 7],
      impact: "structural",
      description: "Safely closed 1 containers at stream end",
    });
  });
});

describe("'stream marked complete but root not closed' truncation diagnostic — full shape", () => {
  it("reason:'complete' with an open array reports the exact diagnostic, distinct from the generic truncation message", () => {
    const p = createParser();
    p.push("[1");
    const r = p.finish({ reason: "complete" });
    const diag = findExact(r.diagnostics, "Stream marked complete but JSON root is not closed");
    expect(diag).toMatchObject({ code: "E_STREAM_TRUNCATED", severity: "error", recoverable: false });
  });
});

describe("value_committed events (drainEvents()) — full shape per commit site", () => {
  // Every commitScalar/handleString commit site constructs its own event
  // object literal - `type`, `operation`, `path`, and `byteRange` are
  // independently-written string/array literals at each site, not shared
  // via one helper, so each site needs its own exact-shape check.
  it("a root-level scalar commits with path '' and byteRange spanning the whole token", () => {
    const p = createParser();
    p.push("42");
    p.finish({ reason: "complete" });
    const events = p.drainEvents();
    expect(events[0]).toEqual({
      type: "value_committed",
      sequence: 0,
      path: "",
      operation: "add",
      value: 42,
      byteRange: [0, 2],
    });
  });

  it("an object field value commits with its key as the path", () => {
    const p = createParser();
    p.push('{"a":1}');
    p.finish({ reason: "complete" });
    const diag = p.drainEvents().find((e) => e.type === "value_committed");
    expect(diag).toEqual({
      type: "value_committed",
      sequence: 0,
      path: "/a",
      operation: "add",
      value: 1,
      byteRange: [5, 6],
    });
  });

  it("array elements commit with their numeric index as the path, sequence incrementing per element", () => {
    const p = createParser();
    p.push("[1,2]");
    p.finish({ reason: "complete" });
    const events = p.drainEvents().filter((e) => e.type === "value_committed");
    expect(events).toEqual([
      { type: "value_committed", sequence: 0, path: "/0", operation: "add", value: 1, byteRange: [1, 2] },
      { type: "value_committed", sequence: 1, path: "/1", operation: "add", value: 2, byteRange: [3, 4] },
    ]);
  });

  it("a root-level string commits with the same path '' shape as a root-level scalar", () => {
    const p = createParser();
    p.push('"hello"');
    p.finish({ reason: "complete" });
    const events = p.drainEvents();
    expect(events[0]).toEqual({
      type: "value_committed",
      sequence: 0,
      path: "",
      operation: "add",
      value: "hello",
      byteRange: [0, 7],
    });
  });

  it("a string value inside an array commits like any other array element (path, byteRange)", () => {
    const p = createParser();
    p.push('["x","y"]');
    p.finish({ reason: "complete" });
    const events = p.drainEvents().filter((e) => e.type === "value_committed");
    expect(events).toEqual([
      { type: "value_committed", sequence: 0, path: "/0", operation: "add", value: "x", byteRange: [1, 4] },
      { type: "value_committed", sequence: 1, path: "/1", operation: "add", value: "y", byteRange: [5, 8] },
    ]);
  });
});

describe("push()'s scanner/grammar diagnostic loops — fatal vs. non-fatal terminal handling, distinguished at the push() call itself", () => {
  it("a scanner-sourced fatal diagnostic (maxStringBytes exceeded) sets terminal=true on the very push() that trips it", () => {
    const p = createParser({ limits: { maxStringBytes: 5 } });
    const result = p.push('"123456"');
    expect(result.terminal).toBe(true);
    expect(result.syntax).toBe("invalid");
    const diag = findExact(p.snapshot().diagnostics, "String exceeds maximum of 5 bytes");
    expect(diag).toMatchObject({ code: "E_LIMIT_STRING_BYTES", severity: "fatal", recoverable: false });
  });

  it("a grammar-sourced fatal diagnostic (maxDepth exceeded) sets terminal=true on the very push() that trips it", () => {
    const p = createParser({ limits: { maxDepth: 1 } });
    const result = p.push('{"a":{}}');
    expect(result.terminal).toBe(true);
    expect(result.syntax).toBe("invalid");
    const diag = findExact(p.snapshot().diagnostics, "Maximum nesting depth 1 exceeded");
    expect(diag).toMatchObject({ code: "E_LIMIT_DEPTH", severity: "fatal", recoverable: false });
  });

  it("a grammar-sourced NON-fatal error (duplicate key) does NOT set terminal on the push() that emits it - parsing continues via skip-value - contrast case", () => {
    const p = createParser();
    const result = p.push('{"a":1,"a":2}');
    expect(result.terminal).toBe(false);
    expect(result.syntax).toBe("root_complete");
    // Still correctly reported invalid overall, just via grammar.hasDuplicate
    // at finish() time rather than the push()-level fatal short-circuit.
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.executable).toBe(false);
  });
});
