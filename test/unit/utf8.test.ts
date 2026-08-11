// ---------------------------------------------------------------------------
// UTF-8 Decoder Unit Tests
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { expectDefined } from "../utils/expect-defined.js";
import { Utf8Decoder, stringToUtf8 } from "../../src/utf8/decoder.js";

describe("Utf8Decoder", () => {
  describe("ASCII", () => {
    it("decodes pure ASCII", () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(stringToUtf8("hello"));
      expect(result.text).toBe("hello");
      expect(result.errors).toHaveLength(0);
      expect(result.consumed).toBe(5);
    });

    it("handles empty input", () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(new Uint8Array(0));
      expect(result.text).toBe("");
      expect(result.consumed).toBe(0);
    });
  });

  describe("2-byte characters", () => {
    it("decodes 2-byte character (é = U+00E9)", () => {
      const decoder = new Utf8Decoder();
      const bytes = stringToUtf8("José");
      const result = decoder.decode(bytes);
      expect(result.text).toBe("José");
      expect(result.errors).toHaveLength(0);
    });

    it("handles 2-byte character split across chunks", () => {
      const decoder = new Utf8Decoder();
      // é = 0xC3 0xA9
      const bytes = stringToUtf8("é");
      expect(bytes.length).toBe(2);

      // Feed first byte
      const r1 = decoder.decode(bytes.slice(0, 1));
      expect(r1.text).toBe("");
      expect(decoder.hasIncomplete()).toBe(true);

      // Feed second byte
      const r2 = decoder.decode(bytes.slice(1, 2));
      expect(r2.text).toBe("é");
      expect(r2.errors).toHaveLength(0);
      expect(decoder.hasIncomplete()).toBe(false);
    });
  });

  describe("3-byte characters", () => {
    it("decodes 3-byte CJK character (日 = U+65E5)", () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(stringToUtf8("日本語"));
      expect(result.text).toBe("日本語");
      expect(result.errors).toHaveLength(0);
    });

    it("handles 3-byte character split at every byte boundary", () => {
      const decoder = new Utf8Decoder();
      // 日 = E6 97 A5
      const bytes = stringToUtf8("日");
      expect(bytes.length).toBe(3);

      const r1 = decoder.decode(bytes.slice(0, 1));
      expect(r1.text).toBe("");

      const r2 = decoder.decode(bytes.slice(1, 2));
      expect(r2.text).toBe("");

      const r3 = decoder.decode(bytes.slice(2, 3));
      expect(r3.text).toBe("日");
      expect(r3.errors).toHaveLength(0);
    });
  });

  describe("4-byte characters (emoji)", () => {
    it("decodes 4-byte emoji (😀 = U+1F600)", () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(stringToUtf8("😀"));
      expect(result.text).toBe("😀");
      expect(result.errors).toHaveLength(0);
    });

    it("handles 4-byte emoji split across chunks", () => {
      const decoder = new Utf8Decoder();
      // 😀 = F0 9F 98 80
      const bytes = stringToUtf8("😀");
      expect(bytes.length).toBe(4);

      // Send each byte separately
      for (let i = 0; i < 3; i++) {
        const r = decoder.decode(bytes.slice(i, i + 1));
        expect(r.text).toBe("");
        expect(decoder.hasIncomplete()).toBe(true);
      }

      const r = decoder.decode(bytes.slice(3, 4));
      expect(r.text).toBe("😀");
      expect(r.errors).toHaveLength(0);
      expect(decoder.hasIncomplete()).toBe(false);
    });

    it("handles emoji split at 2/2 boundary", () => {
      const decoder = new Utf8Decoder();
      const bytes = stringToUtf8("😀");

      const r1 = decoder.decode(bytes.slice(0, 2));
      expect(r1.text).toBe("");

      const r2 = decoder.decode(bytes.slice(2, 4));
      expect(r2.text).toBe("😀");
      expect(r2.errors).toHaveLength(0);
    });
  });

  describe("invalid sequences", () => {
    it("detects invalid start byte (0xFF)", () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(new Uint8Array([0xff]));
      expect(result.errors).toHaveLength(1);
      expect(expectDefined(result.errors[0]).kind).toBe("invalid_start_byte");
    });

    it("detects invalid continuation byte", () => {
      const decoder = new Utf8Decoder();
      // Start a 2-byte sequence (0xC3) but follow with invalid continuation
      const result = decoder.decode(new Uint8Array([0xc3, 0x41]));
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(expectDefined(result.errors[0]).kind).toBe("invalid_continuation");
    });

    it("detects overlong encoding", () => {
      const decoder = new Utf8Decoder();
      // Overlong encoding of ASCII 'A' (0x41) as 2 bytes: 0xC1 0x81
      const result = decoder.decode(new Uint8Array([0xc1, 0x81]));
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(expectDefined(result.errors[0]).kind).toBe("overlong");
    });

    it("rejects an encoded UTF-16 surrogate half (U+D800) as out_of_range", () => {
      const decoder = new Utf8Decoder();
      // ED A0 80 arithmetically decodes to U+D800 - a lone high surrogate.
      // Surrogate halves (U+D800-U+DFFF) are not valid Unicode scalar
      // values and RFC 3629 prohibits encoding them directly in UTF-8;
      // they exist only as a UTF-16 encoding artifact. Neither the
      // overlong check (3 bytes is the correct minimal length for this
      // range) nor the >0x10FFFF check catches this - it needs its own
      // range check.
      const result = decoder.decode(new Uint8Array([0xed, 0xa0, 0x80]));
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
      expect(expectDefined(result.errors[0]).kind).toBe("out_of_range");
    });

    it("rejects the full encoded surrogate range boundaries (U+D800 and U+DFFF) but accepts just outside it", () => {
      const lowSurrogateStart = new Utf8Decoder().decode(new Uint8Array([0xed, 0xa0, 0x80])); // U+D800
      const highSurrogateEnd = new Utf8Decoder().decode(new Uint8Array([0xed, 0xbf, 0xbf])); // U+DFFF
      expect(lowSurrogateStart.errors[0]?.kind).toBe("out_of_range");
      expect(highSurrogateEnd.errors[0]?.kind).toBe("out_of_range");

      const justBelow = new Utf8Decoder().decode(new Uint8Array([0xed, 0x9f, 0xbf])); // U+D7FF
      const justAbove = new Utf8Decoder().decode(new Uint8Array([0xee, 0x80, 0x80])); // U+E000
      expect(justBelow.errors).toHaveLength(0);
      expect(justAbove.errors).toHaveLength(0);
    });

    it("detects invalid continuation across chunk boundary", () => {
      const decoder = new Utf8Decoder();
      // Start 2-byte sequence
      const r1 = decoder.decode(new Uint8Array([0xc3]));
      expect(r1.text).toBe("");

      // Send non-continuation byte
      const r2 = decoder.decode(new Uint8Array([0x41])); // 'A'
      expect(r2.errors.length).toBeGreaterThanOrEqual(1);
      expect(expectDefined(r2.errors[0]).kind).toBe("invalid_continuation");
      // 'A' should still be decoded
      expect(r2.text).toBe("A");
    });
  });

  describe("incomplete at end", () => {
    it("reports incomplete UTF-8 via hasIncomplete()", () => {
      const decoder = new Utf8Decoder();
      // Start a 3-byte sequence but only send 2 bytes
      decoder.decode(new Uint8Array([0xe6, 0x97]));
      expect(decoder.hasIncomplete()).toBe(true);
    });
  });

  describe("string vs bytes equivalence", () => {
    it("produces same result for string and equivalent bytes", () => {
      const input = '{"name":"José","emoji":"😀"}';
      const decoder1 = new Utf8Decoder();
      const decoder2 = new Utf8Decoder();

      const bytes = stringToUtf8(input);

      // Decode all at once
      const r1 = decoder1.decode(bytes);

      // Decode byte-by-byte
      let text = "";
      for (let i = 0; i < bytes.length; i++) {
        const r = decoder2.decode(bytes.slice(i, i + 1));
        text += r.text;
      }

      expect(text).toBe(r1.text);
      expect(text).toBe(input);
    });
  });

  describe("BOM split across chunk boundaries", () => {
    it("waits for more data when only the first BOM byte has arrived", () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(new Uint8Array([0xef]));
      expect(result.text).toBe("");
      expect(result.strippedBom).toBe(false);
    });

    it("waits for more data when only the first two BOM bytes have arrived", () => {
      const decoder = new Utf8Decoder();
      const result = decoder.decode(new Uint8Array([0xef, 0xbb]));
      expect(result.text).toBe("");
      expect(result.strippedBom).toBe(false);
    });

    it("strips a BOM delivered one byte at a time", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xef]));
      decoder.decode(new Uint8Array([0xbb]));
      const result = decoder.decode(new Uint8Array([0xbf, 0x61])); // 'a' after BOM
      expect(result.strippedBom).toBe(true);
      expect(result.text).toBe("a");
    });
  });

  describe("malformed 3-byte and 4-byte sequences", () => {
    it("reports an error for an invalid 3-byte continuation sequence", () => {
      const decoder = new Utf8Decoder();
      // 0xE0 starts a 3-byte sequence but is followed by non-continuation bytes
      const result = decoder.decode(new Uint8Array([0xe0, 0x41, 0x41]));
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("reports an error for an invalid 4-byte continuation sequence", () => {
      const decoder = new Utf8Decoder();
      // 0xF0 starts a 4-byte sequence but is followed by non-continuation bytes
      const result = decoder.decode(new Uint8Array([0xf0, 0x41, 0x41, 0x41]));
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("exact consumed byte counts (single push, no chunk split)", () => {
    it("a 2-byte character followed by ASCII consumes exactly the right byte counts and continues correctly", () => {
      const decoder = new Utf8Decoder();
      // 'é' (2 bytes) + 'X' (1 byte)
      const result = decoder.decode(new Uint8Array([0xc3, 0xa9, 0x58]));
      expect(result.text).toBe("éX");
      expect(result.consumed).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it("a 3-byte character followed by ASCII consumes exactly the right byte counts and continues correctly", () => {
      const decoder = new Utf8Decoder();
      // '漢' (E6 BC A2, 3 bytes) + 'X'
      const result = decoder.decode(new Uint8Array([0xe6, 0xbc, 0xa2, 0x58]));
      expect(result.text).toBe("漢X");
      expect(result.consumed).toBe(4);
      expect(result.errors).toHaveLength(0);
    });

    it("a 4-byte character followed by ASCII consumes exactly the right byte counts and continues correctly", () => {
      const decoder = new Utf8Decoder();
      // '😀' (F0 9F 98 80, 4 bytes) + 'X'
      const result = decoder.decode(new Uint8Array([0xf0, 0x9f, 0x98, 0x80, 0x58]));
      expect(result.text).toBe("😀X");
      expect(result.consumed).toBe(5);
      expect(result.errors).toHaveLength(0);
    });

    it("an invalid start byte advances by exactly 1 and the correct byte offset is reported, then decoding continues", () => {
      const decoder = new Utf8Decoder();
      // 0xFF is never a valid start byte; 'X' should still decode after it
      const result = decoder.decode(new Uint8Array([0xff, 0x58]));
      expect(result.errors).toEqual([{ kind: "invalid_start_byte", byteOffset: 0 }]);
      expect(result.text).toBe("X");
      expect(result.consumed).toBe(2);
    });
  });

  describe("multi-byte sequences split across pushes at every possible byte", () => {
    it("resumes a 2-byte sequence split after the 1st byte, with exact consumed/text", () => {
      const decoder = new Utf8Decoder();
      const r1 = decoder.decode(new Uint8Array([0xc3]));
      expect(r1.text).toBe("");
      const r2 = decoder.decode(new Uint8Array([0xa9, 0x58])); // rest of é + X
      expect(r2.text).toBe("éX");
    });

    it("resumes a 3-byte sequence split after the 1st byte", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xe6]));
      const r2 = decoder.decode(new Uint8Array([0xbc, 0xa2, 0x58]));
      expect(r2.text).toBe("漢X");
    });

    it("resumes a 3-byte sequence split after the 2nd byte", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xe6, 0xbc]));
      const r2 = decoder.decode(new Uint8Array([0xa2, 0x58]));
      expect(r2.text).toBe("漢X");
    });

    it("resumes a 4-byte sequence split after the 1st byte", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xf0]));
      const r2 = decoder.decode(new Uint8Array([0x9f, 0x98, 0x80, 0x58]));
      expect(r2.text).toBe("😀X");
    });

    it("resumes a 4-byte sequence split after the 2nd byte", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xf0, 0x9f]));
      const r2 = decoder.decode(new Uint8Array([0x98, 0x80, 0x58]));
      expect(r2.text).toBe("😀X");
    });

    it("resumes a 4-byte sequence split after the 3rd byte", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xf0, 0x9f, 0x98]));
      const r2 = decoder.decode(new Uint8Array([0x80, 0x58]));
      expect(r2.text).toBe("😀X");
    });

    it("reports the correct byte offset when a resumed sequence turns out to have an invalid continuation byte", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xe6])); // starts a 3-byte sequence at offset 0
      const r2 = decoder.decode(new Uint8Array([0x41, 0x41])); // 'A' is not a continuation byte
      expect(r2.errors).toHaveLength(1);
      expect(r2.errors[0]?.kind).toBe("invalid_continuation");
      expect(r2.errors[0]?.byteOffset).toBe(0);
    });

    it("regression: aborting a pending sequence on an invalid continuation byte does not also emit a spurious second diagnostic", () => {
      // Root cause: the while-loop that resumes a pending sequence resets
      // both `pending` and `pendingExpected` to 0 when it aborts on an
      // invalid continuation byte. The immediately-following check
      // `pending.length === pendingExpected` then read as "0 of 0 needed -
      // sequence complete" (0 === 0), spuriously calling decodeSequence([])
      // on the now-empty pending array and pushing a second, bogus error
      // (whatever an empty-array bit-decode happens to produce) alongside
      // the correct invalid_continuation one.
      const decoder = new Utf8Decoder();
      decoder.decode(new Uint8Array([0xe6])); // pending: 1 of 3 bytes of a 3-byte sequence
      const r2 = decoder.decode(new Uint8Array([0x41, 0x41]));
      expect(r2.errors).toEqual([{ kind: "invalid_continuation", byteOffset: 0 }]);
      expect(r2.text).toBe("AA");
    });
  });

  describe("overlong and out-of-range codepoints report the exact byte offset", () => {
    it("reports 'overlong' with the sequence's own start offset, not 0", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(stringToUtf8("AB")); // 2 bytes of padding to offset the sequence
      const result = decoder.decode(new Uint8Array([0xc0, 0x80])); // overlong encoding of NUL
      // On error, the main loop only advances by 1 byte (not the sequence's
      // full length), so the remaining byte(s) of the rejected sequence are
      // each re-examined as fresh potential start bytes. A lone 0x80
      // continuation byte never validly starts a sequence, so it cascades
      // into its own invalid_start_byte diagnostic - both are real,
      // consistent, no wrong text is produced (codePoints stays empty).
      expect(result.errors).toEqual([
        { kind: "overlong", byteOffset: 2 },
        { kind: "invalid_start_byte", byteOffset: 3 },
      ]);
      expect(result.text).toBe("");
    });

    it("reports 'out_of_range' with the sequence's own start offset, not 0", () => {
      const decoder = new Utf8Decoder();
      decoder.decode(stringToUtf8("AB"));
      const result = decoder.decode(new Uint8Array([0xf4, 0x90, 0x80, 0x80])); // > U+10FFFF
      expect(result.errors).toEqual([
        { kind: "out_of_range", byteOffset: 2 },
        { kind: "invalid_start_byte", byteOffset: 3 },
        { kind: "invalid_start_byte", byteOffset: 4 },
        { kind: "invalid_start_byte", byteOffset: 5 },
      ]);
      expect(result.text).toBe("");
    });
  });

  describe("codePointsToString chunking boundary (CHUNK_SIZE = 8192)", () => {
    it("produces byte-identical output for exactly 8192, one under, and one over the chunk boundary", () => {
      for (const n of [8191, 8192, 8193]) {
        const decoder = new Utf8Decoder();
        const input = "x".repeat(n);
        const result = decoder.decode(stringToUtf8(input));
        expect(result.text.length).toBe(n);
        expect(result.text).toBe(input);
      }
    });
  });
});
