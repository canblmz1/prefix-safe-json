import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import { DiagnosticCode } from "../../src/diagnostics/codes.js";

describe("Mutation Killer — Snapshot Pending Tokens", () => {
  it("reports pending unterminated string key with byteOffset of opening quote", () => {
    const parser = createParser();
    parser.push('{"incomp');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(1);
    expect(snap.pending[0]).toEqual({
      type: "object_key",
      path: "",
      buffered: "incomp",
      byteOffset: 1,
    });
  });

  it("reports pending unterminated string value with byteOffset of opening quote", () => {
    const parser = createParser();
    parser.push('{"key":"partial_val');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(1);
    expect(snap.pending[0]).toEqual({
      type: "string",
      path: "/key",
      buffered: "partial_val",
      byteOffset: 7,
    });
  });

  it("reports pending number at chunk end with byteOffset of number start", () => {
    const parser = createParser();
    parser.push('{"num":123');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(1);
    expect(snap.pending[0]).toEqual({
      type: "number",
      path: "/num",
      buffered: "123",
      byteOffset: 7,
    });
  });

  it("reports pending true literal", () => {
    const parser = createParser();
    parser.push('{"flag":tr');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(1);
    expect(snap.pending[0]).toEqual({
      type: "literal",
      path: "/flag",
      buffered: "tr",
      byteOffset: 8,
    });
  });

  it("reports pending false literal", () => {
    const parser = createParser();
    parser.push('{"flag":fal');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(1);
    expect(snap.pending[0]).toEqual({
      type: "literal",
      path: "/flag",
      buffered: "fal",
      byteOffset: 8,
    });
  });

  it("reports pending null literal", () => {
    const parser = createParser();
    parser.push('{"flag":nul');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(1);
    expect(snap.pending[0]).toEqual({
      type: "literal",
      path: "/flag",
      buffered: "nul",
      byteOffset: 8,
    });
  });

  it("reports pending unicode escape sequence with string byteOffset", () => {
    const parser = createParser();
    parser.push('{"key":"hello \\u00');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(1);
    expect(snap.pending[0]).toEqual({
      type: "unicode_escape",
      path: "/key",
      buffered: "00",
      byteOffset: 7,
    });
  });

  it("returns empty pending when syntax is structural and no pending token", () => {
    const parser = createParser();
    parser.push('{"key":');
    const snap = parser.snapshot();
    expect(snap.pending).toHaveLength(0);
  });
});

describe("Mutation Killer — Byte Range Accuracy", () => {
  it("accurately reports byteRange for ObjectStart, ObjectEnd, Comma, Colon and Numbers", () => {
    const parser = createParser();
    parser.push('{"a":1,"b":2}');
    const events = parser.drainEvents();

    const valueCommittedEvents = events.filter((e) => e.type === "value_committed");
    expect(valueCommittedEvents).toHaveLength(2);

    // "a":1 -> '1' starts at byte 5, ends at byte 6
    expect((valueCommittedEvents[0] as { byteRange: readonly [number, number] }).byteRange).toEqual([5, 6]);
    // "b":2 -> '2' starts at byte 11, ends at byte 12
    expect((valueCommittedEvents[1] as { byteRange: readonly [number, number] }).byteRange).toEqual([11, 12]);
  });

  it("accurately handles 2-byte, 3-byte, and 4-byte UTF-8 string pushes for getUtf8ByteLength", () => {
    const parser = createParser();
    const text = '{"str":"£€𐍈"}';
    parser.push(text);
    const snap = parser.snapshot();
    expect(snap.rootComplete).toBe(true);
    expect(snap.stableValue).toEqual({ str: "£€𐍈" });

    const p2 = createParser();
    p2.push('{"a":"');
    p2.push('José');
    p2.push('"}');
    expect(p2.snapshot().stableValue).toEqual({ a: "José" });
  });
});

describe("Mutation Killer — Finish Outcome & Executable Policy", () => {
  it("returns outcome='valid' when root is complete even if reason is not 'complete'", () => {
    const parser = createParser();
    parser.push('{"a":1}');
    const res = parser.finish({ reason: "length" });
    expect(res.outcome).toBe("valid");
    expect(res.executable).toBe(false);
  });

  it("returns outcome='valid' when root is complete and reason is 'cancelled'", () => {
    const parser = createParser();
    parser.push('{"a":1}');
    const res = parser.finish({ reason: "cancelled" });
    expect(res.outcome).toBe("valid");
    expect(res.executable).toBe(false);
  });

  it("returns outcome='truncated' when root is incomplete and reason is 'length'", () => {
    const parser = createParser();
    parser.push('{"a":1');
    const res = parser.finish({ reason: "length" });
    expect(res.outcome).toBe("truncated");
    expect(res.executable).toBe(false);
  });

  it("returns outcome='invalid' when duplicate key is present", () => {
    const parser = createParser();
    parser.push('{"a":1,"a":2}');
    const res = parser.finish({ reason: "complete" });
    expect(res.outcome).toBe("invalid");
    expect(res.executable).toBe(false);
  });

  it("returns outcome='salvaged' when containers are safely closed at finish", () => {
    const parser = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
    parser.push('{"a":true ');
    const res = parser.finish({ reason: "length" });
    expect(res.outcome).toBe("salvaged");
    expect(res.executable).toBe(false);
  });
});

describe("Mutation Killer — Scanner Cross-Chunk & Edge Cases", () => {
  it("handles literal true split across chunks", () => {
    const parser = createParser();
    parser.push('{"a":tr');
    parser.push('ue}');
    expect(parser.snapshot().stableValue).toEqual({ a: true });
  });

  it("handles literal false split across chunks", () => {
    const parser = createParser();
    parser.push('{"a":fal');
    parser.push('se}');
    expect(parser.snapshot().stableValue).toEqual({ a: false });
  });

  it("handles literal null split across chunks", () => {
    const parser = createParser();
    parser.push('{"a":nul');
    parser.push('l}');
    expect(parser.snapshot().stableValue).toEqual({ a: null });
  });

  it("rejects invalid literal sequence", () => {
    const parser = createParser();
    const result = parser.push('{"a":trx}');
    expect(result.syntax).toBe("invalid");
  });

  it("finalizes incomplete literal at stream end with error diagnostic", () => {
    const parser = createParser();
    parser.push('{"a":tru');
    const res = parser.finish({ reason: "complete" });
    expect(res.syntax).toBe("incomplete");
    expect(res.diagnostics.some((d) => d.code === DiagnosticCode.E_INCOMPLETE_LITERAL)).toBe(true);
  });

  it("finalizes incomplete number at stream end with error diagnostic if truncated", () => {
    const parser = createParser();
    parser.push('{"a":123');
    const res = parser.finish({ reason: "length" });
    expect(res.executable).toBe(false);
    expect(res.diagnostics.some((d) => d.code === DiagnosticCode.E_INCOMPLETE_NUMBER)).toBe(true);
  });

  it("finalizes valid number at complete stream end but unclosed root is not executable", () => {
    const parser = createParser();
    parser.push('{"a":123');
    const res = parser.finish({ reason: "complete" });
    expect(res.stableValue).toEqual({ a: 123 });
    expect(res.executable).toBe(false);
  });
});
