import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import { StreamEndReason } from "../../src/types.js";

describe("Executable Policy", () => {
  const nonExecutableReasons: StreamEndReason[] = [
    "unknown",
    "length",
    "network_error",
    "provider_error",
    "cancelled",
  ];

  for (const reason of nonExecutableReasons) {
    it(`is not executable when finish reason is ${reason}`, () => {
      const parser = createParser();
      // Valid complete root
      parser.push('{"a":1}');
      parser.finish({ reason });
      
      const snapshot = parser.snapshot();
      expect(snapshot.rootComplete).toBe(true);
      expect(snapshot.executable).toBe(false);
    });
  }

  it("is executable when finish reason is complete with valid root", () => {
    const parser = createParser();
    parser.push('{"a":1}');
    parser.finish({ reason: "complete" });
    
    const snapshot = parser.snapshot();
    expect(snapshot.rootComplete).toBe(true);
    expect(snapshot.executable).toBe(true);
  });
});
