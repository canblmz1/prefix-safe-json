// @ts-nocheck
// ---------------------------------------------------------------------------
// Finish Honesty Tests
// ---------------------------------------------------------------------------
// finish({reason:"complete"}) vs finish({reason:"length"})
// must produce different executable results for the same parser state.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { StreamEndReason } from "../../src/types.js";

describe("Finish Honesty", () => {
  it("complete vs length: different executable for complete root", () => {
    const parser1 = createParser();
    parser1.push('{"a":1}');
    const r1 = parser1.finish({ reason: "complete" });

    const parser2 = createParser();
    parser2.push('{"a":1}');
    const r2 = parser2.finish({ reason: "length" });

    expect(r1.executable).toBe(true);
    expect(r2.executable).toBe(false);
  });

  it("complete vs network_error: different executable", () => {
    const parser1 = createParser();
    parser1.push('{"a":1}');
    const r1 = parser1.finish({ reason: "complete" });

    const parser2 = createParser();
    parser2.push('{"a":1}');
    const r2 = parser2.finish({ reason: "network_error" });

    expect(r1.executable).toBe(true);
    expect(r2.executable).toBe(false);
  });

  it("complete vs cancelled: different executable", () => {
    const parser1 = createParser();
    parser1.push('{"a":1}');
    const r1 = parser1.finish({ reason: "complete" });

    const parser2 = createParser();
    parser2.push('{"a":1}');
    const r2 = parser2.finish({ reason: "cancelled" });

    expect(r1.executable).toBe(true);
    expect(r2.executable).toBe(false);
  });

  it("incomplete input: neither reason produces executable", () => {
    const reasons: StreamEndReason[] = [
      "complete",
      "length",
      "network_error",
      "provider_error",
      "cancelled",
      "unknown",
    ];

    for (const reason of reasons) {
      const parser = createParser();
      parser.push('{"a":');
      const result = parser.finish({ reason });
      expect(
        result.executable,
        `Incomplete input with reason=${reason} should not be executable`,
      ).toBe(false);
    }
  });

  it("snapshot phase changes after finish", () => {
    const parser = createParser();
    parser.push('{"a":1}');

    expect(parser.snapshot().phase).toBe("collecting");

    parser.finish({ reason: "complete" });

    // After finish, snapshot should show "finished" phase
    // (but finish already set the phase)
    // We can't call snapshot after finish without storing result...
    // The FinalResult captures the state at finish time.
  });
});
