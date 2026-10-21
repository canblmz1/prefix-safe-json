import { describe, expect, it } from "vitest";
import { Utf8Decoder, stringToUtf8 } from "../../src/utf8/decoder.js";

describe("UTF-8 first-error prefix boundary", () => {
  const prefix = "A\u00e9\u{1f600}\ufffd";
  const prefixBytes = stringToUtf8(prefix);

  for (const tc of [
    { name: "invalid start", bytes: [0xff], recovery: "", kind: "invalid_start_byte" },
    { name: "invalid continuation", bytes: [0xe6, 0xbc, 0x41], recovery: "A", kind: "invalid_continuation" },
    { name: "overlong", bytes: [0xc0, 0x80], recovery: "", kind: "overlong" },
    { name: "surrogate", bytes: [0xed, 0xa0, 0x80], recovery: "", kind: "out_of_range" },
    { name: "out of range", bytes: [0xf4, 0x90, 0x80, 0x80], recovery: "", kind: "out_of_range" },
  ]) {
    it(`marks ${tc.name} without changing recovery text or consumed bytes`, () => {
      const decoder = new Utf8Decoder();
      const bytes = new Uint8Array([...prefixBytes, ...tc.bytes, 0x5a, 0xff]);
      const result = decoder.decode(bytes);
      // The existing decoder continues recovering after errors for its direct
      // consumers. Parser-only refusal must not change that output contract.
      expect(result.text).toBe(`${prefix}${tc.recovery}Z`);
      expect(result.consumed).toBe(bytes.length);
      expect(result.errors[0]).toEqual({ kind: tc.kind, byteOffset: prefixBytes.length });
      // This is a code-point boundary, not a UTF-16 string index. The later
      // error must not move it past recovered characters.
      expect(result.validPrefixCodePoints).toBe(4);
    });
  }

  it("marks an error at the start even when later ASCII recovers", () => {
    const result = new Utf8Decoder().decode(new Uint8Array([0xff, 0x41, 0xff]));
    expect(result.validPrefixCodePoints).toBe(0);
    expect(result.text).toBe("A");
    expect(result.consumed).toBe(3);
  });

  it("keeps the original pending-sequence offset after new continuation bytes", () => {
    for (const invalid of [[0xe6, 0xbc, 0x41], [0xf0, 0x9f, 0x98, 0x41]]) {
      for (let split = 1; split < invalid.length; split++) {
        const decoder = new Utf8Decoder();
        const first = decoder.decode(new Uint8Array([...prefixBytes, ...invalid.slice(0, split)]));
        expect(first.text).toBe(prefix);
        const result = decoder.decode(new Uint8Array(invalid.slice(split)));
        expect(result.errors[0]).toEqual({ kind: "invalid_continuation", byteOffset: prefixBytes.length });
        expect(result.validPrefixCodePoints).toBe(0);
        expect(result.text).toBe("A");
        expect(result.consumed).toBe(invalid.length - split);
      }
    }
  });

  it("does not mark a failure for healthy or still-incomplete chunks", () => {
    const decoder = new Utf8Decoder();
    const valid = decoder.decode(prefixBytes);
    expect(valid.validPrefixCodePoints).toBeUndefined();
    expect(valid.errors).toEqual([]);
    expect(valid.text).toBe(prefix);
    const partial = decoder.decode(new Uint8Array([0xe6]));
    expect(partial.validPrefixCodePoints).toBeUndefined();
    expect(partial.errors).toEqual([]);
    expect(partial.text).toBe("");
    const completed = decoder.decode(new Uint8Array([0xbc, 0xa2]));
    expect(completed.validPrefixCodePoints).toBeUndefined();
    expect(completed.errors).toEqual([]);
    expect(completed.text).toBe("\u6f22");
  });
});
