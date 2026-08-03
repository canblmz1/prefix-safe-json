// ---------------------------------------------------------------------------
// Parser Unit Tests
// ---------------------------------------------------------------------------
import { expectDefined } from "../utils/expect-defined.js";

import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { ParserEvent } from "../../src/types.js";

describe("Parser", () => {
  describe("push()", () => {
    it("accepts a string chunk", () => {
      const parser = createParser();
      const result = parser.push('{"a":1}');
      expect(result.acceptedBytes).toBeGreaterThan(0);
      expect(result.syntax).toBe("root_complete");
    });

    it("accepts a Uint8Array chunk", () => {
      const parser = createParser();
      const bytes = new TextEncoder().encode('{"a":1}');
      const result = parser.push(bytes);
      expect(result.acceptedBytes).toBeGreaterThan(0);
      expect(result.syntax).toBe("root_complete");
    });

    it("returns incomplete for partial input", () => {
      const parser = createParser();
      const result = parser.push('{"a":');
      expect(result.syntax).toBe("incomplete");
    });

    it("returns empty for empty string", () => {
      const parser = createParser();
      const result = parser.push("");
      expect(result.syntax).toBe("empty");
    });

    it("throws after finish()", () => {
      const parser = createParser();
      parser.push("{}");
      parser.finish({ reason: "complete" });
      expect(() => parser.push("x")).toThrow("E_PUSH_AFTER_FINISH");
    });
  });

  describe("snapshot()", () => {
    it("returns collecting phase before finish", () => {
      const parser = createParser();
      parser.push('{"a":1}');
      const snap = parser.snapshot();
      expect(snap.phase).toBe("collecting");
    });

    it("includes only committed fields in stableValue", () => {
      const parser = createParser();
      parser.push('{"path":"/src/app.ts","content":"henüz devam ediyor');
      const snap = parser.snapshot();
      expect(snap.stableValue).toEqual({ path: "/src/app.ts" });
    });

    it("includes committed number terminated by comma", () => {
      const parser = createParser();
      parser.push('{"a":1,"b":');
      const snap = parser.snapshot();
      expect(snap.stableValue).toEqual({ a: 1 });
    });

    it("does not include number without terminator", () => {
      const parser = createParser();
      parser.push('{"value":12');
      const snap = parser.snapshot();
      // Number 12 has no terminator — not committed
      expect(snap.stableValue).toEqual({});
    });
  });

  describe("drainEvents()", () => {
    it("returns events and clears queue", () => {
      const parser = createParser();
      parser.push('{"a":1}');
      const events1 = parser.drainEvents();
      expect(events1.length).toBeGreaterThan(0);

      const events2 = parser.drainEvents();
      expect(events2).toHaveLength(0);
    });

    it("emits value_committed for completed fields", () => {
      const parser = createParser();
      parser.push('{"name":"Alice"}');
      const events = parser.drainEvents();
      const valueEvents = events.filter(
        (e): e is Extract<ParserEvent, { type: "value_committed" }> =>
          e.type === "value_committed",
      );
      expect(valueEvents.length).toBeGreaterThanOrEqual(1);
      expect(expectDefined(valueEvents[0]).path).toBe("/name");
      expect(expectDefined(valueEvents[0]).value).toBe("Alice");
    });

    it("emits container_closed for closed object", () => {
      const parser = createParser();
      parser.push('{"a":1}');
      const events = parser.drainEvents();
      const closeEvents = events.filter(
        (e) => e.type === "container_closed",
      );
      expect(closeEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("finish()", () => {
    it("returns valid outcome for complete JSON", () => {
      const parser = createParser();
      parser.push('{"a":1}');
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome).toBe("valid");
      expect(result.executable).toBe(true);
    });

    it("returns truncated for incomplete JSON with length reason", () => {
      const parser = createParser();
      parser.push('{"a":1');
      const result = parser.finish({ reason: "length" });
      expect(result.outcome).toBe("truncated");
      expect(result.executable).toBe(false);
    });

    it("returns non-executable for abnormal end reason", () => {
      const parser = createParser();
      parser.push('{"a":1}');
      const result = parser.finish({ reason: "length" });
      expect(result.executable).toBe(false);
    });

    it("throws if called twice", () => {
      const parser = createParser();
      parser.push("{}");
      parser.finish({ reason: "complete" });
      expect(() => parser.finish({ reason: "complete" })).toThrow();
    });

    it("finalizes number at complete stream end", () => {
      const parser = createParser();
      parser.push("42");
      const result = parser.finish({ reason: "complete" });
      expect(result.syntax).toBe("root_complete");
      expect(result.outcome).toBe("valid");
    });
  });

  describe("valid JSON equivalence", () => {
    const validCases = [
      '{"a":1,"b":2}',
      '[1,2,3]',
      '{"nested":{"x":true,"y":false}}',
      '{"arr":[1,"two",null]}',
      '{"empty_obj":{},"empty_arr":[]}',
      '"hello"',
      "42",
      "true",
      "false",
      "null",
      '{"msg":"hello\\nworld"}',
    ];

    for (const input of validCases) {
      it(`matches JSON.parse for: ${input}`, () => {
        const expected = JSON.parse(input) as unknown;
        const parser = createParser();
        parser.push(input);
        const result = parser.finish({ reason: "complete" });
        expect(result.stableValue).toEqual(expected);
        expect(result.outcome).toBe("valid");
        expect(result.executable).toBe(true);
      });
    }
  });

  describe("duplicate key detection", () => {
    it("detects duplicate keys", () => {
      const parser = createParser();
      parser.push('{"a":1,"b":2,"a":3}');
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome).toBe("invalid");
      expect(result.executable).toBe(false);
      expect(
        result.diagnostics.some((d) => d.code === "E_DUPLICATE_KEY"),
      ).toBe(true);
    });

    it("first value wins for duplicate keys", () => {
      const parser = createParser();
      parser.push('{"a":1,"b":2,"a":3}');
      const result = parser.finish({ reason: "complete" });
      // stableValue should have a:1, b:2 — not a:3
      expect(result.stableValue).toEqual({ a: 1, b: 2 });
    });
  });

  describe("trailing data", () => {
    it("detects trailing non-whitespace data", () => {
      const parser = createParser();
      parser.push('{"a":1}some trailing');
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome).toBe("valid");
      expect(result.executable).toBe(false);
      expect(
        result.diagnostics.some((d) => d.code === "E_TRAILING_DATA"),
      ).toBe(true);
    });

    it("accepts trailing whitespace", () => {
      const parser = createParser();
      parser.push('{"a":1}   \n  ');
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome).toBe("valid");
      expect(result.executable).toBe(true);
    });
  });

  describe("nested structures", () => {
    it("parses nested objects", () => {
      const parser = createParser();
      parser.push('{"user":{"name":"Bob","scores":[1,2,3]}}');
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome).toBe("valid");
      expect(result.stableValue).toEqual({
        user: { name: "Bob", scores: [1, 2, 3] },
      });
    });

    it("parses array of objects", () => {
      const parser = createParser();
      parser.push('[{"a":1},{"b":2}]');
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome).toBe("valid");
      expect(result.stableValue).toEqual([{ a: 1 }, { b: 2 }]);
    });
  });

  describe("resource limits", () => {
    it("rejects input exceeding maxInputBytes", () => {
      const parser = createParser({ limits: { maxInputBytes: 10 } });
      const result = parser.push("a".repeat(20));
      expect(result.terminal).toBe(true);
      expect(result.syntax).toBe("invalid");
    });

    it("rejects depth exceeding maxDepth", () => {
      const parser = createParser({ limits: { maxDepth: 2 } });
      parser.push('[[[');
      const snap = parser.snapshot();
      expect(snap.diagnostics.some((d) => d.code === "E_LIMIT_DEPTH")).toBe(true);
    });
  });

  describe("string escapes", () => {
    it("handles all standard escape sequences", () => {
      const parser = createParser();
      parser.push('{"v":"a\\nb\\tc\\\\d\\/e\\bf\\fg"}');
      const result = parser.finish({ reason: "complete" });
      expect(result.stableValue).toEqual({
        v: "a\nb\tc\\d/e\bf\fg",
      });
    });

    it("handles unicode escapes", () => {
      const parser = createParser();
      parser.push('{"v":"\\u0041\\u0042"}');
      const result = parser.finish({ reason: "complete" });
      expect(result.stableValue).toEqual({ v: "AB" });
    });
  });

  describe("finish honesty", () => {
    it("complete and length give different executable values", () => {
      const parser1 = createParser();
      parser1.push('{"a":1}');
      const result1 = parser1.finish({ reason: "complete" });

      const parser2 = createParser();
      parser2.push('{"a":1}');
      const result2 = parser2.finish({ reason: "length" });

      expect(result1.executable).toBe(true);
      expect(result2.executable).toBe(false);
    });
  });
});
