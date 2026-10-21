import { describe, expect, it } from "vitest";
import { createParser } from "../../src/parser.js";
import type { JsonValue, ParserEvent, ParserOptions, StreamEndReason } from "../../src/types.js";

const encode = (text: string) => new TextEncoder().encode(text);
const endReasons: StreamEndReason[] = [
  "complete", "length", "network_error", "provider_error", "cancelled", "unknown",
];

function input(prefix: string, invalid: number[], suffix = ""): Uint8Array {
  return new Uint8Array([...encode(prefix), ...invalid, ...encode(suffix)]);
}

function partitions(bytes: Uint8Array): Uint8Array[][] {
  return [
    [bytes],
    ...Array.from({ length: bytes.length + 1 }, (_, split) => [bytes.slice(0, split), bytes.slice(split)]),
    Array.from(bytes, (byte) => new Uint8Array([byte])),
  ];
}

function run(chunks: Uint8Array[], reason: StreamEndReason, options?: ParserOptions, drain = true) {
  const parser = createParser(options);
  const events: ParserEvent[] = [];
  for (const chunk of chunks) {
    parser.push(chunk);
    if (drain) events.push(...parser.drainEvents());
  }
  const result = parser.finish({ reason });
  events.push(...parser.drainEvents());
  const snapshot = parser.snapshot();
  return {
    // Received bytes reflect the size of the push that encountered terminal
    // input; later pushes are rejected. Compare the semantic state instead.
    result: {
      syntax: result.syntax, outcome: result.outcome, stableValue: result.stableValue,
      executable: result.executable, diagnostics: result.diagnostics, repairs: result.repairs,
    },
    consumedBytes: result.consumedBytes,
    rootComplete: snapshot.rootComplete,
    pending: snapshot.pending,
    events,
  };
}

const cases: { name: string; prefix: string; invalid: number[]; suffix?: string; value: JsonValue | undefined }[] = [
  { name: "complete object", prefix: '{"a":1}', invalid: [0xff], value: { a: 1 } },
  { name: "complete array", prefix: '[1,"ok"]', invalid: [0xff], value: [1, "ok"] },
  { name: "complete string root", prefix: '"done"', invalid: [0xff], value: "done" },
  { name: "terminated number root", prefix: "123 ", invalid: [0xff], value: 123 },
  { name: "pending number root", prefix: "123", invalid: [0xff], suffix: " ", value: undefined },
  { name: "pending string root", prefix: '"cut', invalid: [0xff], suffix: '"', value: undefined },
  { name: "committed field before pending string", prefix: '{"done":1,"pending":"cut', invalid: [0xff], suffix: '","after":2}', value: { done: 1 } },
  { name: "pending object key", prefix: '{"done":1,"key', invalid: [0xff], suffix: '":2}', value: { done: 1 } },
  { name: "pending number field", prefix: '{"done":1,"pending":12', invalid: [0xff], suffix: "3}", value: { done: 1 } },
  { name: "pending literal", prefix: '{"done":1,"pending":tru', invalid: [0xff], suffix: "e}", value: { done: 1 } },
  { name: "pending JSON escape", prefix: '{"done":1,"pending":"\\u00', invalid: [0xff], suffix: '41"}', value: { done: 1 } },
  { name: "closed child before pending string", prefix: '{"done":{"ok":true},"pending":"cut', invalid: [0xff], suffix: '"}', value: { done: { ok: true } } },
  { name: "committed array elements", prefix: '[1,"ok","cut', invalid: [0xff], suffix: '"]', value: [1, "ok"] },
  { name: "Unicode prefix including astral and replacement characters", prefix: '{"text":"\u00e9\u{1f600}\ufffd","pending":"cut', invalid: [0xff], suffix: '"}', value: { text: "\u00e9\u{1f600}\ufffd" } },
  { name: "invalid two-byte continuation", prefix: '{"done":1,"pending":"cut', invalid: [0xc3, 0x41], suffix: '"}', value: { done: 1 } },
  { name: "invalid three-byte continuation", prefix: '{"done":1,"pending":"cut', invalid: [0xe6, 0xbc, 0x41], suffix: '"}', value: { done: 1 } },
  { name: "invalid four-byte continuation", prefix: '{"done":1,"pending":"cut', invalid: [0xf0, 0x9f, 0x98, 0x41], suffix: '"}', value: { done: 1 } },
  { name: "overlong sequence", prefix: '{"done":1,"pending":"cut', invalid: [0xc0, 0x80], suffix: '"}', value: { done: 1 } },
  { name: "encoded surrogate", prefix: '{"done":1,"pending":"cut', invalid: [0xed, 0xa0, 0x80], suffix: '"}', value: { done: 1 } },
  { name: "out-of-range code point", prefix: '{"done":1,"pending":"cut', invalid: [0xf4, 0x90, 0x80, 0x80], suffix: '"}', value: { done: 1 } },
  { name: "new root after the error", prefix: "", invalid: [0xff], suffix: '{"after":2}', value: undefined },
  { name: "trailing root after the error", prefix: '{"a":1}', invalid: [0xff], suffix: ' {"after":2}', value: { a: 1 } },
  { name: "multiple errors with parseable text between them", prefix: '{"done":1,"pending":"cut', invalid: [0xff, 0x22, 0xc3, 0x41], suffix: ',"after":2}', value: { done: 1 } },
];

describe("Invalid UTF-8 preserves only the verified semantic prefix", () => {
  for (const reason of endReasons) {
    for (const tc of cases) {
      it(`${tc.name} (${reason})`, () => {
        const bytes = input(tc.prefix, tc.invalid, tc.suffix);
        const errorOffset = encode(tc.prefix).length;
        // Explicit expected values come only from completed JSON before the
        // error. The split reference also preserves every event's order,
        // sequence, byte range and diagnostic offset without normalization.
        const reference = run([bytes.slice(0, errorOffset), bytes.slice(errorOffset)], reason);
        expect(reference.result.stableValue).toEqual(tc.value);
        expect(reference.result.syntax).toBe("invalid");
        expect(reference.result.outcome).toBe("invalid");
        expect(reference.result.executable).toBe(false);
        expect(reference.result.diagnostics.filter((diag) => diag.code === "E_INVALID_UTF8"))
          .toEqual([expect.objectContaining({ byteOffset: errorOffset, severity: "error", recoverable: false })]);
        expect(reference.consumedBytes).toBe(errorOffset);

        for (const [index, chunks] of partitions(bytes).entries()) {
          expect(run(chunks, reason), `partition ${index}`).toEqual(reference);
        }
      });
    }
  }

  it("never retracts or duplicates previously drained commits", () => {
    const parser = createParser();
    parser.push('{"done":1,"pending":"cut');
    const committed = structuredClone(parser.drainEvents());
    expect(committed.filter((event) => event.type === "value_committed").map((event) => event.path)).toEqual(["/done"]);
    const before = parser.snapshot();
    parser.push(input("", [0xff], '","after":2}'));
    expect(parser.push(encode('{"later":3}'))).toMatchObject({ acceptedBytes: 0, emittedEvents: 0, terminal: true });
    const result = parser.finish({ reason: "complete" });
    const after = parser.drainEvents();
    expect(result.stableValue).toEqual({ done: 1 });
    expect(before.stableValue).toEqual({ done: 1 });
    expect(after.some((event) => event.type === "value_committed" || event.type === "container_closed")).toBe(false);
    expect(after[0]?.sequence).toBe(committed.length);
  });

  for (const reason of endReasons) {
    it(`preserves healthy Unicode and escaped JSON (${reason})`, () => {
      const bytes = encode('{"text":"\u00e9\u{1f600}\ufffd","escape":"\\uD83D\\uDE00\\n"}');
      const reference = run([bytes], reason);
      expect(reference.result.stableValue).toEqual({ text: "\u00e9\u{1f600}\ufffd", escape: "\u{1f600}\n" });
      expect(reference.result.executable).toBe(reason === "complete");
      for (const chunks of partitions(bytes)) expect(run(chunks, reason)).toEqual(reference);
    });

    it(`retains committed fields before incomplete Unicode at EOF (${reason})`, () => {
      const bytes = input('{"done":1,"pending":"', [0xe6, 0xbc]);
      const reference = run([bytes], reason);
      expect(reference.result.stableValue).toEqual({ done: 1 });
      expect(reference.result.executable).toBe(false);
      expect(reference.result.diagnostics).toContainEqual(expect.objectContaining({ code: "E_INCOMPLETE_UTF8" }));
      for (const chunks of partitions(bytes)) expect(run(chunks, reason)).toEqual(reference);
    });
  }

  it("ignores post-error strings and trailing data even at their limits", () => {
    const bytes = input('{"a":"ok"}', [0xff], ' "too long" {"after":2}');
    const options = { limits: { maxInputBytes: bytes.length, maxStringBytes: 2, maxTrailingDataBytes: 0 } };
    const reference = run([bytes.slice(0, 10), bytes.slice(10)], "complete", options);
    expect(reference.result.stableValue).toEqual({ a: "ok" });
    expect(reference.result.diagnostics.map((diag) => diag.code)).toEqual(["E_INVALID_UTF8"]);
    for (const chunks of partitions(bytes)) expect(run(chunks, "complete", options)).toEqual(reference);
  });

  for (const tc of [
    { name: "string limit", prefix: '{"a":"long"}', options: { limits: { maxStringBytes: 2 } }, drain: true },
    { name: "depth limit", prefix: '{"a":[[]]}', options: { limits: { maxDepth: 2 } }, drain: true },
    { name: "event queue limit", prefix: '{"a":1,"b":2}', options: { limits: { maxQueuedEvents: 1 } }, drain: false },
    { name: "rejected trailing data", prefix: '{"a":1}X', options: { repairs: { trailingData: "reject" as const } }, drain: true },
  ]) {
    it(`preserves an earlier terminal ${tc.name}`, () => {
      const bytes = input(tc.prefix, [0xff]);
      const reference = run([encode(tc.prefix)], "complete", tc.options, tc.drain);
      expect(reference.result.outcome).toBe("invalid");
      for (const chunks of partitions(bytes)) {
        const actual = run(chunks, "complete", tc.options, tc.drain);
        // Admission/consumption counters keep their existing per-push policy.
        expect(actual.result).toEqual(reference.result);
        expect(actual.events).toEqual(reference.events);
        expect(actual.result.diagnostics.some((diag) => diag.code === "E_INVALID_UTF8")).toBe(false);
      }
    });
  }

  it("keeps input-limit admission ahead of decoding an oversized push", () => {
    const bytes = input('{"a":1}', [0xff]);
    const result = run([bytes], "complete", { limits: { maxInputBytes: bytes.length - 1 } });
    expect(result.result.stableValue).toBeUndefined();
    expect(result.result.outcome).toBe("invalid");
    expect(result.result.executable).toBe(false);
    expect(result.result.diagnostics.map((diag) => diag.code)).toEqual(["E_LIMIT_INPUT_BYTES"]);
  });
});
