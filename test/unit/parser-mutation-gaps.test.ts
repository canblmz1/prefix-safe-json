import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";

describe("push() after the parser has already gone terminal is a no-op (line 129's guard)", () => {
  it("a second push() after a terminal error returns a zeroed, terminal result and is not processed at all", () => {
    const p = createParser();
    const firstResult = p.push("]"); // unmatched close - invalid synchronously, within push() itself
    expect(firstResult.terminal).toBe(true);

    const secondResult = p.push('{"a":1}'); // would be perfectly valid JSON on its own
    expect(secondResult).toEqual({
      acceptedBytes: 0,
      emittedEvents: 0,
      syntax: "invalid",
      terminal: true,
    });

    const r = p.finish({ reason: "complete" });
    // The second push's content must never have been parsed - stableValue
    // stays whatever the first (terminal) push left it as, not {a:1}.
    expect(r.stableValue).not.toEqual({ a: 1 });
    expect(r.diagnostics.length).toBe(1); // only the one diagnostic from "]"
  });

  it("a push() before the parser goes terminal is processed normally (contrast case)", () => {
    const p = createParser();
    const result = p.push('{"a":1}');
    expect(result.terminal).toBe(false);
    expect(result.acceptedBytes).toBeGreaterThan(0);
  });
});

describe("Duplicate-key value-skipping (processToken's isSkippingValue path)", () => {
  it("skips a nested OBJECT value following a duplicate key", () => {
    const p = createParser();
    p.push('{"a":1,"a":{"nested":"value","deep":{"more":1}}}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.stableValue).toEqual({ a: 1 });
  });

  it("skips a nested ARRAY value following a duplicate key", () => {
    const p = createParser();
    p.push('{"a":1,"a":[1,2,[3,4],{"x":1}]}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.stableValue).toEqual({ a: 1 });
  });

  it("skips a string value following a duplicate key", () => {
    const p = createParser();
    p.push('{"a":1,"a":"skipped"}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1 });
  });

  it("skips a true value following a duplicate key", () => {
    const p = createParser();
    p.push('{"a":1,"a":true}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1 });
  });

  it("skips a false value following a duplicate key", () => {
    const p = createParser();
    p.push('{"a":1,"a":false}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1 });
  });

  it("skips a null value following a duplicate key", () => {
    const p = createParser();
    p.push('{"a":1,"a":null}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1 });
  });

  it("resumes normal parsing after skipping, correctly parsing keys that follow the duplicate", () => {
    const p = createParser();
    p.push('{"a":1,"a":{"nested":{"deep":true}},"b":2,"c":[1,2,3]}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid"); // still invalid due to the duplicate
    expect(r.stableValue).toEqual({ a: 1, b: 2, c: [1, 2, 3] });
  });

  it("a duplicate key as the very last key in the object still resolves the object correctly", () => {
    const p = createParser();
    p.push('{"a":1,"a":{"x":1}}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1 });
  });

  it("resumes normal parsing after skipping a SCALAR duplicate-key value, correctly parsing every key that follows", () => {
    // Distinct from the "resumes...nested" case above: if the scalar-type
    // check that resets isSkippingValue (String/Number/True/False/Null)
    // were ever wrong, isSkippingValue would never clear, and every token
    // for the rest of the document - including "b" and "c" below - would
    // silently fall into the skip branch and be discarded entirely.
    const p = createParser();
    p.push('{"a":1,"a":"scalar-dup","b":2,"c":3}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.stableValue).toEqual({ a: 1, b: 2, c: 3 });
  });

  it("resumes normal parsing after skipping a NUMBER duplicate-key value", () => {
    const p = createParser();
    p.push('{"a":1,"a":999,"b":2}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1, b: 2 });
  });

  it("resumes normal parsing after skipping a TRUE duplicate-key value", () => {
    const p = createParser();
    p.push('{"a":1,"a":true,"b":2}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1, b: 2 });
  });

  it("resumes normal parsing after skipping a FALSE duplicate-key value", () => {
    const p = createParser();
    p.push('{"a":1,"a":false,"b":2}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1, b: 2 });
  });

  it("resumes normal parsing after skipping a NULL duplicate-key value", () => {
    const p = createParser();
    p.push('{"a":1,"a":null,"b":2}');
    const r = p.finish({ reason: "complete" });
    expect(r.stableValue).toEqual({ a: 1, b: 2 });
  });
});

describe("Diagnostic sticky flags (addDiagnostic)", () => {
  it("severity 'error' with recoverable:false sets everHadNonRecoverableError -> not executable, outcome invalid", () => {
    const p = createParser();
    // Leading zero -> E_UNEXPECTED_TOKEN, severity 'error', recoverable false
    p.push("01");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("invalid");
    expect(r.executable).toBe(false);
  });

  it("a duplicate-key diagnostic (severity 'error', recoverable:false) makes the stream non-executable via the sticky flag, not just grammar.hasDuplicate", () => {
    // Cross-check: this is the same scenario the hasDuplicate flag already
    // covers, but confirms hasNonRecoverableError() would independently
    // reach the same conclusion.
    const p = createParser();
    p.push('{"a":1,"a":2}');
    const r = p.finish({ reason: "complete" });
    expect(r.executable).toBe(false);
  });
});

describe("pending-literal-at-stream-end buffer states", () => {
  // finish()'s handling of a pending literal token checks the buffer value
  // against a convoluted condition that special-cases exactly "tru"/"fal"
  // (one character short of "true"/"false"). Empirically, every partial
  // buffer correctly reports truncated/E_INCOMPLETE_LITERAL regardless -
  // finalizeLiteral() itself catches the ones this outer condition doesn't
  // filter out - but nothing previously pinned down that full state space.
  for (const buf of ["tru", "fal", "nul", "t", "n", "f", "tr", "fa", "nu"]) {
    it(`a pending literal buffer of "${buf}" at stream end reports truncated, not valid`, () => {
      const p = createParser();
      p.push(buf);
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("truncated");
      expect(r.diagnostics.some((d) => d.code === "E_INCOMPLETE_LITERAL")).toBe(true);
    });
  }
});

describe("each individual whitespace character after root completion (trailing-data isWs check)", () => {
  for (const [name, ws] of [["space", " "], ["tab", "\t"], ["newline", "\n"], ["carriage return", "\r"]] as const) {
    it(`a lone trailing ${name} after the root value is NOT treated as trailing data`, () => {
      const p = createParser();
      p.push(`{"a":1}${ws}`);
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_TRAILING_DATA")).toBe(false);
    });
  }

  it("a non-whitespace character after the root value IS treated as trailing data", () => {
    const p = createParser();
    p.push('{"a":1}x');
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_TRAILING_DATA")).toBe(true);
  });
});

describe("unexpected colon placements", () => {
  it("rejects a colon with no open container at all", () => {
    const p = createParser();
    p.push(":");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).not.toBe("valid");
    expect(r.diagnostics.some((d) => d.message === "Unexpected ':'")).toBe(true);
  });

  it("rejects a colon inside an array", () => {
    const p = createParser();
    p.push("[1:2]");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).not.toBe("valid");
    expect(r.diagnostics.some((d) => d.message === "Unexpected ':'")).toBe(true);
  });

  it("rejects a colon immediately after '{' (expecting a key, not a colon)", () => {
    const p = createParser();
    p.push("{:1}");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).not.toBe("valid");
    expect(r.diagnostics.some((d) => d.message === "Unexpected ':'")).toBe(true);
  });

  it("accepts a colon in the correct position (object, expecting colon after a key)", () => {
    const p = createParser();
    p.push('{"a":1}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
  });
});

describe("unexpected '[' placements (handleArrayStart's guard)", () => {
  it("rejects '[' where an object key is expected", () => {
    const p = createParser();
    p.push("{[1]}");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).not.toBe("valid");
    expect(r.diagnostics.some((d) => d.message === "Unexpected '['")).toBe(true);
  });

  it("rejects '[' in an array missing a comma between elements", () => {
    const p = createParser();
    p.push("[[1][2]]");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).not.toBe("valid");
    expect(r.diagnostics.some((d) => d.message === "Unexpected '[' in array")).toBe(true);
  });

  it("accepts '[' as a value for an object key (frame.objectExpectation === 'value')", () => {
    const p = createParser();
    p.push('{"a":[1]}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toEqual({ a: [1] });
  });

  it("accepts '[' as the first element of an array", () => {
    const p = createParser();
    p.push("[[1]]");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toEqual([[1]]);
  });
});

describe("unexpected '{' placements (handleObjectStart's guard)", () => {
  it("rejects '{' where an object key is expected", () => {
    const p = createParser();
    p.push("{{}}");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).not.toBe("valid");
    expect(r.diagnostics.some((d) => d.message === "Unexpected '{'")).toBe(true);
  });

  it("accepts '{' as a value for an object key", () => {
    const p = createParser();
    p.push('{"a":{"b":1}}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toEqual({ a: { b: 1 } });
  });
});

describe("unexpected string placements in an array (handleString's array-context guard)", () => {
  it("accepts a bare string as the first element of an array", () => {
    const p = createParser();
    p.push('["first"]');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.stableValue).toEqual(["first"]);
  });

  it("rejects two strings back to back with no comma, with the exact expected diagnostic", () => {
    const p = createParser();
    p.push('["a" "b"]');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).not.toBe("valid");
    const diag = r.diagnostics.find((d) => d.message === "Unexpected string in array");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("error");
    expect(diag?.recoverable).toBe(false);
  });
});

describe("unexpected ']' placements (handleArrayEnd's guard)", () => {
  it("rejects ']' with no open container at all, with the exact expected diagnostic", () => {
    const p = createParser();
    p.push("]");
    const r = p.finish({ reason: "complete" });
    const diag = r.diagnostics.find(
      (d) => d.message === "Unexpected ']' — no matching open array",
    );
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("error");
    expect(diag?.recoverable).toBe(false);
  });

  it("rejects ']' when the open container is an object, not an array", () => {
    const p = createParser();
    p.push("{]");
    const r = p.finish({ reason: "complete" });
    const diag = r.diagnostics.find(
      (d) => d.message === "Unexpected ']' — no matching open array",
    );
    expect(diag).toBeDefined();
  });

  it("accepts ']' closing a real open array", () => {
    const p = createParser();
    p.push("[1]");
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
  });
});

describe("the pending literal buffer's syntax_ transition from 'empty' to 'incomplete' (handleArrayStart)", () => {
  it("an array-start as the very first token moves syntax from 'empty' to 'incomplete', not left at 'empty'", () => {
    const p = createParser();
    p.push("[");
    const snap = p.snapshot();
    expect(snap.syntax).toBe("incomplete");
    p.finish({ reason: "length" });
  });

  it("hasSeenValue (set true on array-start) makes an incomplete-at-'complete' stream report the 'root is not closed' diagnostic", () => {
    const p = createParser();
    p.push("[1");
    const r = p.finish({ reason: "complete" });
    expect(
      r.diagnostics.some(
        (d) => d.message === "Stream marked complete but JSON root is not closed",
      ),
    ).toBe(true);
  });
});

describe("truncation diagnostic when salvage does not apply (finish()'s !salvaged branch)", () => {
  it("an incomplete stream with reason 'length' and no salvage policy reports the exact truncation diagnostic", () => {
    const p = createParser(); // default closeContainersAtFinish: "disabled" -> never salvages
    p.push('{"a":1,"b":');
    const r = p.finish({ reason: "length" });
    expect(r.outcome).toBe("truncated");
    const diag = r.diagnostics.find((d) => d.message === "Stream truncated: length");
    expect(diag).toBeDefined();
    expect(diag?.code).toBe("E_STREAM_TRUNCATED");
    expect(diag?.severity).toBe("error");
    expect(diag?.recoverable).toBe(false);
  });

  it("the truncation diagnostic's message reflects the actual reason passed in, not a fixed string", () => {
    const p = createParser();
    p.push('{"a":1,"b":');
    const r = p.finish({ reason: "cancelled" });
    expect(r.diagnostics.some((d) => d.message === "Stream truncated: cancelled")).toBe(true);
    expect(r.diagnostics.some((d) => d.message === "Stream truncated: length")).toBe(false);
  });
});

describe("structural salvage requires EVERY one of its guard clauses (finish()'s safe-only salvage attempt)", () => {
  it("does NOT salvage when the scanner is mid-token (not in a structural/between-tokens state), even with closeContainersAtFinish 'safe-only'", () => {
    const p = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
    p.push('{"a":"unterminated'); // ends mid-string - scanner is in a String state, not Structural
    const r = p.finish({ reason: "length" });
    expect(r.outcome).not.toBe("salvaged");
    expect(r.repairs.some((rep) => rep.code === "R_CLOSE_CONTAINER")).toBe(false);
  });

  it("DOES salvage when every guard clause holds (contrast case, already-covered elsewhere but pinned here alongside the negative case)", () => {
    const p = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
    p.push('{"a":1 ');
    const r = p.finish({ reason: "length" });
    expect(r.outcome).toBe("salvaged");
    expect(r.repairs.some((rep) => rep.code === "R_CLOSE_CONTAINER")).toBe(true);
  });
});

describe("maxInputBytes limit exact boundary (push()'s fatal input-size guard)", () => {
  it("accepts input of exactly maxInputBytes, does not trip the limit", () => {
    const p = createParser({ limits: { maxInputBytes: 7 } });
    const result = p.push('{"a":1}'); // exactly 7 bytes
    expect(result.terminal).toBe(false);
    expect(p.snapshot().diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);
  });

  it("rejects input of maxInputBytes + 1, with the exact expected fatal diagnostic", () => {
    const p = createParser({ limits: { maxInputBytes: 6 } });
    const result = p.push('{"a":1}'); // 7 bytes, one over the limit of 6
    expect(result.terminal).toBe(true);
    const diag = p.snapshot().diagnostics.find((d) => d.code === "E_LIMIT_INPUT_BYTES");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("fatal");
    expect(diag?.message).toBe("Input exceeds maximum of 6 bytes");
  });
});

describe("pending-info diagnostics at stream end have exact, precise fields", () => {
  it("an incomplete \\u escape at stream end reports the exact E_INCOMPLETE_UNICODE_ESCAPE diagnostic", () => {
    const p = createParser();
    p.push('{"a":"\\u12'); // cut off mid unicode-escape hex digits
    const r = p.finish({ reason: "complete" });
    const diag = r.diagnostics.find((d) => d.code === "E_INCOMPLETE_UNICODE_ESCAPE");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("error");
    expect(diag?.message).toBe("Incomplete unicode escape at stream end");
    expect(diag?.recoverable).toBe(false);
  });

  it("an unpaired high surrogate pending at stream end reports the exact E_UNPAIRED_SURROGATE diagnostic", () => {
    const p = createParser();
    p.push('{"a":"\\uD83D'); // high surrogate, stream ends before its low-surrogate pair
    const r = p.finish({ reason: "complete" });
    const diag = r.diagnostics.find(
      (d) => d.code === "E_UNPAIRED_SURROGATE" && d.message === "Unpaired surrogate at stream end",
    );
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("error");
    expect(diag?.recoverable).toBe(false);
  });
});

describe("pending-literal finalization is gated on reason === 'complete', not just a full buffer match", () => {
  // A fully-typed literal ("true"/"false"/"null") with no input left is
  // still "pending" at finish() time - the scanner needs a terminator
  // (more input, or a genuine stream-complete signal) to know no further
  // characters like "truex" are coming. reason:"complete" is the signal
  // that no more input is coming, so it's safe to finalize; any other
  // reason must NOT finalize it, even though the buffer already spells
  // out the full literal.
  for (const [buf, value] of [["true", true], ["false", false], ["null", null]] as const) {
    it(`a fully-buffered "${buf}" finalizes to ${String(value)} when reason is 'complete'`, () => {
      const p = createParser();
      p.push(buf);
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("valid");
      expect(r.stableValue).toBe(value);
    });

    it(`the identical fully-buffered "${buf}" reports truncated when reason is NOT 'complete'`, () => {
      const p = createParser();
      p.push(buf);
      const r = p.finish({ reason: "length" });
      expect(r.outcome).toBe("truncated");
      expect(r.diagnostics.some((d) => d.code === "E_INCOMPLETE_LITERAL")).toBe(true);
    });
  }
});

describe("getUtf8ByteLength (via trailing-data byte counting)", () => {
  // getUtf8ByteLength isn't exported; exercised indirectly by configuring a
  // tight maxTrailingDataBytes and checking the limit trips at exactly the
  // byte count each character type actually costs in UTF-8 - a
  // misclassified length would trip the limit early or late.
  it("counts a 1-byte ASCII trailing character as exactly 1 byte", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 1 } });
    p.push('{"a":1}A'); // exactly 1 trailing byte - must NOT exceed the limit
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);
  });

  it("counts a 2-byte trailing character (é) as exactly 2 bytes", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 2 } });
    p.push('{"a":1}é'); // exactly 2 trailing bytes
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);

    const p2 = createParser({ limits: { maxTrailingDataBytes: 1 } }); // now under the actual cost
    p2.push('{"a":1}é');
    const r2 = p2.finish({ reason: "complete" });
    expect(r2.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(true);
  });

  it("counts a 3-byte trailing character (漢) as exactly 3 bytes", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 3 } });
    p.push('{"a":1}漢');
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);

    const p2 = createParser({ limits: { maxTrailingDataBytes: 2 } });
    p2.push('{"a":1}漢');
    const r2 = p2.finish({ reason: "complete" });
    expect(r2.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(true);
  });

  it("counts a 4-byte trailing character (😀) as exactly 4 bytes", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 4 } });
    p.push('{"a":1}😀');
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);

    const p2 = createParser({ limits: { maxTrailingDataBytes: 3 } });
    p2.push('{"a":1}😀');
    const r2 = p2.finish({ reason: "complete" });
    expect(r2.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(true);
  });

  // Each getUtf8ByteLength threshold uses `<=`, not `<` - exercised here at
  // the exact boundary codepoint (the highest codepoint still encoding at
  // the smaller byte count), where the two operators disagree. Codepoints
  // in the interior of a range (like é or 漢 above) can't distinguish them.
  it("U+007F (the highest 1-byte codepoint) still counts as exactly 1 byte, not 2", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 1 } });
    p.push('{"a":1}' + String.fromCodePoint(0x7f));
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);
  });

  it("U+07FF (the highest 2-byte codepoint) still counts as exactly 2 bytes, not 3", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 2 } });
    p.push('{"a":1}' + String.fromCodePoint(0x7ff));
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);
  });

  it("U+FFFF (the highest 3-byte codepoint) still counts as exactly 3 bytes, not 4", () => {
    const p = createParser({ limits: { maxTrailingDataBytes: 3 } });
    p.push('{"a":1}' + String.fromCodePoint(0xffff));
    const r = p.finish({ reason: "complete" });
    expect(r.diagnostics.some((d) => d.code === "E_LIMIT_INPUT_BYTES")).toBe(false);
  });
});

describe("Repair sticky flags (addRepair)", () => {
  it("a 'structural' repair (R_CLOSE_CONTAINER salvage) sets everHadStructuralOrLossyRepair -> not executable", () => {
    const p = createParser({
      repairs: { closeContainersAtFinish: "safe-only" },
    });
    // Ends with a committed value followed by a space (so the number
    // terminates into "comma_or_end", not "key_after_comma" - the latter
    // is one of the states canSafelyCloseAll() explicitly refuses to
    // close over, since closing there would produce a trailing comma).
    p.push('{"a":1 ');
    const r = p.finish({ reason: "length" });
    expect(r.outcome).toBe("salvaged");
    expect(r.executable).toBe(false);
    expect(r.repairs.some((rep) => rep.impact === "structural")).toBe(true);
  });

  it("a 'representation_preserving' repair (BOM strip) does NOT set everHadStructuralOrLossyRepair -> stream stays executable", () => {
    const p = createParser();
    p.push("﻿" + '{"a":1}');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.executable).toBe(true);
    expect(r.repairs.some((rep) => rep.code === "R_STRIP_UTF8_BOM")).toBe(true);
  });

  it("a 'root_preserving' repair (isolated trailing data) is NOT what makes executable false - the dedicated trailingDataSeen check is", () => {
    // outcome stays "valid" (root_preserving doesn't trip
    // everHadStructuralOrLossyRepair), but executable is still false via
    // isExecutable()'s separate, unconditional `this.trailingDataSeen`
    // check - trailing data always disqualifies execution regardless of
    // how it's classified for repair-impact purposes.
    const p = createParser(); // default trailingData policy is "isolate"
    p.push('{"a":1} trailing');
    const r = p.finish({ reason: "complete" });
    expect(r.outcome).toBe("valid");
    expect(r.executable).toBe(false);
    expect(r.repairs.some((rep) => rep.code === "R_ISOLATE_TRAILING_DATA")).toBe(true);
  });
});
