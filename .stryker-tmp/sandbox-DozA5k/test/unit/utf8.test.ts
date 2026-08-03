// @ts-nocheck
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
});
