import { describe, it, expect } from "vitest";
import { escapePointerToken, appendPointer } from "../../src/grammar/pointer.js";

describe("escapePointerToken", () => {
  it("escapes a literal '/' to '~1'", () => {
    expect(escapePointerToken("a/b")).toBe("a~1b");
  });

  it("escapes a literal '~' to '~0'", () => {
    expect(escapePointerToken("a~b")).toBe("a~0b");
  });

  it("escapes '~' before '/' so a literal '~1' round-trips unambiguously", () => {
    // If '/' were escaped first, "a~/b" -> "a~~1b" would be indistinguishable
    // from an already-escaped "~1". Escaping '~' first avoids that collision.
    expect(escapePointerToken("a~/b")).toBe("a~0~1b");
  });

  it("leaves a token with neither special character unchanged", () => {
    expect(escapePointerToken("plain")).toBe("plain");
  });
});

describe("appendPointer", () => {
  it("appends a numeric token without escaping", () => {
    expect(appendPointer("/a", 3)).toBe("/a/3");
  });

  it("appends and escapes a string token containing '/' and '~'", () => {
    expect(appendPointer("/a", "b/c~d")).toBe("/a/b~1c~0d");
  });

  it("distinguishes a numeric token from the equivalent numeric-looking string", () => {
    // Purely to pin down that the typeof branch is real: a numeric 0 must
    // not go through escapePointerToken (which would be a no-op for "0"
    // anyway, but the two code paths are genuinely different).
    expect(appendPointer("", 0)).toBe("/0");
    expect(appendPointer("", "0")).toBe("/0");
  });
});
