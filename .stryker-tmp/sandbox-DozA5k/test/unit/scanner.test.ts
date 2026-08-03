// @ts-nocheck
// ---------------------------------------------------------------------------
// Scanner Unit Tests
// ---------------------------------------------------------------------------
import { expectDefined } from "../utils/expect-defined.js";

import { describe, it, expect } from "vitest";
import { Scanner } from "../../src/lexer/scanner.js";
import { TokenType } from "../../src/lexer/tokens.js";

function scanAll(input: string): ReturnType<Scanner["takeTokens"]> {
  const scanner = new Scanner();
  let bytePos = 0;
  for (const ch of input) {
    const len = getUtf8ByteLength(ch);
    scanner.feedChar(ch, bytePos, len);
    bytePos += len;
  }
  return scanner.takeTokens();
}

function getUtf8ByteLength(ch: string): number {
  const code = expectDefined(ch.codePointAt(0));
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code <= 0xffff) return 3;
  return 4;
}

describe("Scanner", () => {
  describe("structural tokens", () => {
    it("scans empty object", () => {
      const tokens = scanAll("{}");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.ObjectStart);
      expect(expectDefined(tokens[1]).type).toBe(TokenType.ObjectEnd);
    });

    it("scans empty array", () => {
      const tokens = scanAll("[]");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.ArrayStart);
      expect(expectDefined(tokens[1]).type).toBe(TokenType.ArrayEnd);
    });
  });

  describe("strings", () => {
    it("scans a simple string", () => {
      const scanner = new Scanner();
      const input = '"hello"';
      let bytePos = 0;
      for (const ch of input) {
        scanner.feedChar(ch, bytePos, 1);
        bytePos++;
      }
      const tokens = scanner.takeTokens();
      expect(tokens).toHaveLength(1);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.String);
      expect(expectDefined(tokens[0]).value).toBe("hello");
    });

    it("scans string with escape sequences", () => {
      const scanner = new Scanner();
      const input = '"hello\\nworld"';
      let bytePos = 0;
      for (const ch of input) {
        scanner.feedChar(ch, bytePos, 1);
        bytePos++;
      }
      const tokens = scanner.takeTokens();
      expect(tokens).toHaveLength(1);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.String);
      expect(expectDefined(tokens[0]).value).toBe("hello\nworld");
    });

    it("scans string with unicode escape", () => {
      const scanner = new Scanner();
      const input = '"\\u0041"';
      let bytePos = 0;
      for (const ch of input) {
        scanner.feedChar(ch, bytePos, 1);
        bytePos++;
      }
      const tokens = scanner.takeTokens();
      expect(tokens).toHaveLength(1);
      expect(expectDefined(tokens[0]).value).toBe("A");
    });
  });

  describe("numbers", () => {
    it("scans integer terminated by comma", () => {
      const tokens = scanAll("42,");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.Number);
      expect(expectDefined(tokens[0]).value).toBe("42");
      expect(expectDefined(tokens[1]).type).toBe(TokenType.Comma);
    });

    it("scans negative number", () => {
      const tokens = scanAll("-3}");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.Number);
      expect(expectDefined(tokens[0]).value).toBe("-3");
    });

    it("scans decimal number", () => {
      const tokens = scanAll("3.14}");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.Number);
      expect(expectDefined(tokens[0]).value).toBe("3.14");
    });

    it("scans exponent number", () => {
      const tokens = scanAll("1e10}");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.Number);
      expect(expectDefined(tokens[0]).value).toBe("1e10");
    });
  });

  describe("literals", () => {
    it("scans true", () => {
      const tokens = scanAll("true}");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.True);
    });

    it("scans false", () => {
      const tokens = scanAll("false]");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.False);
    });

    it("scans null", () => {
      const tokens = scanAll("null,");
      expect(tokens).toHaveLength(2);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.Null);
    });
  });

  describe("whitespace handling", () => {
    it("skips whitespace between tokens", () => {
      const tokens = scanAll('  { "a" : 1 }  ');
      // { string colon number }
      // Note: trailing whitespace after } goes to TrailingWhitespace state
      const structuralTokens = tokens.filter(t =>
        t.type === TokenType.ObjectStart ||
        t.type === TokenType.ObjectEnd ||
        t.type === TokenType.String ||
        t.type === TokenType.Colon ||
        t.type === TokenType.Number
      );
      expect(structuralTokens.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("incremental feeding", () => {
    it("handles string split across feeds", () => {
      const scanner = new Scanner();
      // Feed "hel
      scanner.feedChar('"', 0, 1);
      scanner.feedChar('h', 1, 1);
      scanner.feedChar('e', 2, 1);
      scanner.feedChar('l', 3, 1);

      // No complete token yet
      let tokens = scanner.takeTokens();
      expect(tokens).toHaveLength(0);

      // Feed lo"
      scanner.feedChar('l', 4, 1);
      scanner.feedChar('o', 5, 1);
      scanner.feedChar('"', 6, 1);

      tokens = scanner.takeTokens();
      expect(tokens).toHaveLength(1);
      expect(expectDefined(tokens[0]).type).toBe(TokenType.String);
      expect(expectDefined(tokens[0]).value).toBe("hello");
    });
  });

  describe("pending state", () => {
    it("reports pending number", () => {
      const scanner = new Scanner();
      scanner.feedChar("4", 0, 1);
      scanner.feedChar("2", 1, 1);

      const info = scanner.getPendingInfo();
      expect(info.type).toBe("number");
      expect(info.buffer).toBe("42");
    });

    it("reports pending string", () => {
      const scanner = new Scanner();
      scanner.feedChar('"', 0, 1);
      scanner.feedChar('h', 1, 1);

      const info = scanner.getPendingInfo();
      expect(info.type).toBe("string");
      expect(info.buffer).toBe("h");
    });
  });
});
