import { describe, expect, it } from "vitest";
import { stringToUtf8, Utf8Decoder } from "../../src/utf8/decoder.js";

describe("UTF-8 trailing sequences with available invalid continuations", () => {
  for (const tc of [
    { bytes: [0xe6, 0x41], extra: [] },
    { bytes: [0xf0, 0x41], extra: [] },
    { bytes: [0xf0, 0x9f, 0x41], extra: [{ kind: "invalid_start_byte", byteOffset: 4 }] },
    { bytes: [0xf0, 0x41, 0x80], extra: [{ kind: "invalid_start_byte", byteOffset: 5 }] },
    { bytes: [0xe6, 0xff], extra: [{ kind: "invalid_start_byte", byteOffset: 4 }] },
  ]) {
    it(`rejects ${tc.bytes.join(" ")} immediately and retains direct-consumer recovery`, () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(new Uint8Array([...stringToUtf8("ok:"), ...tc.bytes]));
      expect(result.errors).toEqual([{ kind: "invalid_continuation", byteOffset: 3 }, ...tc.extra]);
      expect(result.validPrefixCodePoints).toBe(3);
      expect(result.text).toBe(tc.bytes.includes(0x41) ? "ok:A" : "ok:");
      expect(result.consumed).toBe(3 + tc.bytes.length);
      expect(decoder.hasIncomplete()).toBe(false);
      const next = decoder.decode(stringToUtf8("Z"));
      expect(next.text).toBe("Z");
      expect(next.errors).toEqual([]);
      expect(next.validPrefixCodePoints).toBeUndefined();
    });
  }
});
