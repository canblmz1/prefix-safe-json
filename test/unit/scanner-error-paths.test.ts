import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";

describe("Scanner error paths (coverage gaps)", () => {
  describe("string escape sequences", () => {
    it("accepts \\r escape", () => {
      const p = createParser();
      p.push('{"a":"line1\\rline2"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("valid");
      expect((r.stableValue as { a: string }).a).toBe("line1\rline2");
    });

    it("rejects an unknown escape sequence", () => {
      const p = createParser();
      p.push('{"a":"\\x"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Invalid escape sequence"))).toBe(true);
    });
  });

  describe("\\u unicode escapes and surrogate pairs", () => {
    it("decodes a valid \\uD83D\\uDE00 surrogate pair to the correct emoji", () => {
      const p = createParser();
      p.push('{"a":"\\uD83D\\uDE00"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("valid");
      expect((r.stableValue as { a: string }).a).toBe("\u{1F600}");
    });

    it("rejects a high surrogate followed by a non-low-surrogate escape", () => {
      const p = createParser();
      p.push('{"a":"\\uD83D\\u0041"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_UNPAIRED_SURROGATE")).toBe(true);
    });

    it("rejects an unpaired low surrogate with no preceding high surrogate", () => {
      const p = createParser();
      p.push('{"a":"\\uDC00"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_UNPAIRED_SURROGATE")).toBe(true);
    });

    it("rejects an invalid hex digit in a \\u escape", () => {
      const p = createParser();
      p.push('{"a":"\\uZZZZ"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_INVALID_UNICODE_ESCAPE")).toBe(true);
    });

    it("rejects a high surrogate followed by a non-backslash character", () => {
      const p = createParser();
      p.push('{"a":"\\uD83Dx"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_UNPAIRED_SURROGATE")).toBe(true);
    });

    it("rejects a high surrogate followed by backslash-non-u", () => {
      const p = createParser();
      p.push('{"a":"\\uD83D\\n"}');
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_UNPAIRED_SURROGATE")).toBe(true);
    });
  });

  describe("number malformation mid-token", () => {
    it("rejects an invalid character in the integer part", () => {
      const p = createParser();
      p.push("1x2");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Invalid character in number"))).toBe(true);
    });

    it("rejects an invalid character in the fraction part", () => {
      const p = createParser();
      p.push("1.2x3");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Invalid character in number fraction"))).toBe(true);
    });

    it("rejects a missing digit/sign right after the exponent marker", () => {
      const p = createParser();
      p.push("1ex");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Expected digit or sign after exponent"))).toBe(true);
    });

    it("rejects an invalid character in the exponent digits", () => {
      const p = createParser();
      p.push("1e1x");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Invalid character in number exponent"))).toBe(true);
    });
  });

  describe("literal matching", () => {
    it("rejects a case-mismatched literal", () => {
      const p = createParser();
      p.push("tRue");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Invalid literal"))).toBe(true);
    });

    it("rejects a fully-matched literal immediately followed by a non-terminator character", () => {
      const p = createParser();
      p.push("truex");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Expected value terminator"))).toBe(true);
    });
  });

  describe("top-level unexpected character", () => {
    it("rejects a completely invalid start character", () => {
      const p = createParser();
      p.push("@");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.message.includes("Unexpected character"))).toBe(true);
    });
  });

  describe("trailing data with reject policy", () => {
    it("rejects trailing non-whitespace after the root value when repairs.trailingData is 'reject'", () => {
      const p = createParser({ repairs: { trailingData: "reject" } });
      p.push("1 2");
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_TRAILING_DATA")).toBe(true);
    });
  });

  describe("malformed UTF-8 error kinds", () => {
    it("rejects an overlong UTF-8 encoding", () => {
      const p = createParser();
      // Overlong encoding of '"' (0x22) as a 2-byte sequence: C0 A2
      p.push(new Uint8Array([0x22, 0xc0, 0xa2, 0x22]));
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_INVALID_UTF8")).toBe(true);
    });

    it("rejects an out-of-range UTF-8 codepoint", () => {
      const p = createParser();
      // F7 BF BF BF encodes a codepoint above U+10FFFF (5-byte-style leading byte pattern is invalid/out of range)
      p.push(new Uint8Array([0x22, 0xf7, 0xbf, 0xbf, 0xbf, 0x22]));
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_INVALID_UTF8")).toBe(true);
    });

    it("rejects an invalid UTF-8 start byte", () => {
      const p = createParser();
      // 0xFF is never a valid UTF-8 start byte
      p.push(new Uint8Array([0x22, 0xff, 0x22]));
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).not.toBe("valid");
      expect(r.diagnostics.some((d) => d.code === "E_INVALID_UTF8")).toBe(true);
    });
  });
});
