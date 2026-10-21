import { describe, expect, it } from "vitest";
import { createParser } from "../../src/parser.js";
import type { JsonValue, ParserEvent, ParserOptions, StreamEndReason } from "../../src/types.js";

const encode = (text: string) => new TextEncoder().encode(text);
const reasons: StreamEndReason[] = [
  "complete", "length", "network_error", "provider_error", "cancelled", "unknown",
];
const malformed = [
  { name: "three-byte, bad second byte", bytes: [0xe6, 0x41] },
  { name: "four-byte, bad second byte", bytes: [0xf0, 0x41] },
  { name: "four-byte, bad third byte", bytes: [0xf0, 0x9f, 0x41] },
  { name: "four-byte, bad second before continuation", bytes: [0xf0, 0x41, 0x80] },
];

function input(prefix: string, tail: number[], suffix = "") {
  return new Uint8Array([...encode(prefix), ...tail, ...encode(suffix)]);
}

function partitions(bytes: Uint8Array): Uint8Array[][] {
  const base = [
    [bytes],
    ...Array.from({ length: bytes.length + 1 }, (_, i) => [bytes.slice(0, i), bytes.slice(i)]),
    Array.from(bytes, (byte) => new Uint8Array([byte])),
  ];
  return base.flatMap((chunks) => [chunks, [new Uint8Array(), ...chunks.flatMap((chunk) => [chunk, new Uint8Array()])]]);
}

function run(chunks: Uint8Array[], reason: StreamEndReason = "complete", options?: ParserOptions, drain = true) {
  const parser = createParser(options);
  const events: ParserEvent[] = [];
  for (const chunk of chunks) {
    parser.push(chunk);
    if (drain) events.push(...parser.drainEvents());
  }
  const { syntax, outcome, executable, stableValue, diagnostics, repairs } = parser.finish({ reason });
  events.push(...parser.drainEvents());
  // Admission/consumption counters retain their existing per-push policy.
  return { syntax, outcome, executable, stableValue, diagnostics, repairs, events };
}

describe("Available invalid UTF-8 continuations are not incomplete sequences", () => {
  for (const tc of malformed) {
    for (const reason of reasons) {
      for (const context of [
        { name: "complete root", prefix: '{"a":1}', value: { a: 1 } },
        { name: "pending string", prefix: '{"a":1,"b":"cut', value: { a: 1 } },
        { name: "pending key", prefix: '{"a":1,"cut', value: { a: 1 } },
        { name: "pending number", prefix: '{"a":1,"b":12', value: { a: 1 } },
        { name: "pending root", prefix: '"cut', value: undefined },
      ] satisfies { name: string; prefix: string; value: JsonValue | undefined }[]) {
        it(`${tc.name}: ${context.name} (${reason})`, () => {
          const bytes = input(context.prefix, tc.bytes);
          const offset = encode(context.prefix).length;
          // The contract supplies the expected value and error. The split
          // after the lead byte supplies only the full event-order reference.
          const reference = run([bytes.slice(0, offset + 1), bytes.slice(offset + 1)], reason);
          expect(reference).toMatchObject({ syntax: "invalid", outcome: "invalid", executable: false, stableValue: context.value });
          expect(reference.diagnostics.filter((diag) => diag.code === "E_INVALID_UTF8")).toEqual([expect.objectContaining({
            code: "E_INVALID_UTF8", byteOffset: offset, severity: "error", recoverable: false,
          })]);
          expect(reference.diagnostics.some((diag) => diag.code === "E_INCOMPLETE_UTF8")).toBe(false);
          for (const [i, chunks] of partitions(bytes).entries()) {
            expect(run(chunks, reason), `partition ${i}`).toEqual(reference);
          }
        });
      }
    }
  }

  it("never consumes recoverable text after the error or retracts prior commits", () => {
    const prefix = '{"a":1,"b":"cut';
    const bytes = input(prefix, [0xe6, 0x41], '","after":2}');
    const reference = run([bytes]);
    expect(reference.stableValue).toEqual({ a: 1 });
    expect(reference.events.filter((event) => event.type === "value_committed").map((event) => event.path)).toEqual(["/a"]);
    for (const chunks of partitions(bytes)) expect(run(chunks)).toEqual(reference);

    const parser = createParser();
    parser.push(prefix);
    const committed = parser.drainEvents();
    expect(committed.filter((event) => event.type === "value_committed").map((event) => event.path)).toEqual(["/a"]);
    parser.push(new Uint8Array([0xe6, 0x41]));
    expect(parser.push('","after":2}')).toMatchObject({ acceptedBytes: 0, emittedEvents: 0, terminal: true });
    expect(parser.finish({ reason: "complete" }).stableValue).toEqual({ a: 1 });
    const after = parser.drainEvents();
    expect(after[0]?.sequence).toBe(committed.length);
    expect(after.some((event) => event.type === "value_committed" || event.type === "container_closed")).toBe(false);
  });

  for (const tail of [[0xc3], [0xe6], [0xe6, 0xbc], [0xf0], [0xf0, 0x9f], [0xf0, 0x9f, 0x98]]) {
    for (const reason of reasons) {
      it(`preserves genuinely incomplete ${tail.join(" ")} (${reason})`, () => {
        const bytes = input('{"a":1}', tail);
        const reference = run([bytes], reason);
        expect(reference.stableValue).toEqual({ a: 1 });
        expect(reference.outcome).toBe("valid");
        expect(reference.executable).toBe(false);
        expect(reference.diagnostics).toEqual([expect.objectContaining({ code: "E_INCOMPLETE_UTF8", byteOffset: 7 })]);
        for (const chunks of partitions(bytes)) expect(run(chunks, reason)).toEqual(reference);
      });
    }
  }

  for (const reason of reasons) {
    it(`retains healthy Unicode and JSON escapes (${reason})`, () => {
      const bytes = encode('{"a":"\u00e9\u6f22\u{1f600}","escape":"\\uD83D\\uDE00\\n"}');
      const reference = run([bytes], reason);
      expect(reference.stableValue).toEqual({ a: "\u00e9\u6f22\u{1f600}", escape: "\u{1f600}\n" });
      expect(reference.outcome).toBe("valid");
      expect(reference.executable).toBe(reason === "complete");
      expect(reference.diagnostics).toEqual([]);
      for (const chunks of partitions(bytes)) expect(run(chunks, reason)).toEqual(reference);
    });
  }

  for (const tc of [
    { prefix: '{"a":"long"}', options: { limits: { maxStringBytes: 2 } }, drain: true },
    { prefix: '{"a":[[]]}', options: { limits: { maxDepth: 2 } }, drain: true },
    { prefix: '{"a":1,"b":2}', options: { limits: { maxQueuedEvents: 1 } }, drain: false },
    { prefix: '{"a":1}X', options: { repairs: { trailingData: "reject" as const } }, drain: true },
  ]) {
    it(`preserves earlier terminal failure for ${tc.prefix}`, () => {
      const reference = run([encode(tc.prefix)], "complete", tc.options, tc.drain);
      expect(reference.outcome).toBe("invalid");
      for (const chunks of partitions(input(tc.prefix, [0xe6, 0x41]))) {
        expect(run(chunks, "complete", tc.options, tc.drain)).toEqual(reference);
      }
    });
  }

  it("keeps input admission and post-error string/trailing limits unchanged", () => {
    const bytes = input('{"a":"ok"}', [0xe6, 0x41], ' "too long" {"after":2}');
    const options = { limits: { maxInputBytes: bytes.length, maxStringBytes: 2, maxTrailingDataBytes: 0 } };
    const reference = run([bytes], "complete", options);
    expect(reference.stableValue).toEqual({ a: "ok" });
    expect(reference.diagnostics.map((diag) => diag.code)).toEqual(["E_INVALID_UTF8"]);
    for (const chunks of partitions(bytes)) expect(run(chunks, "complete", options)).toEqual(reference);
    const refused = run([bytes], "complete", { limits: { maxInputBytes: bytes.length - 1 } });
    expect(refused.stableValue).toBeUndefined();
    expect(refused.outcome).toBe("invalid");
    expect(refused.executable).toBe(false);
    expect(refused.diagnostics.map((diag) => diag.code)).toEqual(["E_LIMIT_INPUT_BYTES"]);
  });
});
