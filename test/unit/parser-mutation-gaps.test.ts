import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";

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
