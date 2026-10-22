// ---------------------------------------------------------------------------
// Chunk Invariance Tests
// ---------------------------------------------------------------------------
// Verifies that the same byte sequence produces identical results
// regardless of how it is split into chunks.
// ---------------------------------------------------------------------------
import { expectDefined } from "../utils/expect-defined.js";

import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { FinalResult, ParserEvent, StreamEndReason } from "../../src/types.js";

/**
 * Run a complete parse with the given chunks and return result + events.
 */
function runParse(
  chunks: (string | Uint8Array)[],
  reason: StreamEndReason = "complete",
): { result: FinalResult; events: ParserEvent[] } {
  const parser = createParser();
  const allEvents: ParserEvent[] = [];

  for (const chunk of chunks) {
    parser.push(chunk);
    allEvents.push(...parser.drainEvents());
  }

  const result = parser.finish({ reason });
  allEvents.push(...parser.drainEvents());

  return { result, events: allEvents };
}

/**
 * Generate multiple partitions of the input string.
 */
function generateStringPartitions(input: string): string[][] {
  const partitions: string[][] = [];

  // Single chunk
  partitions.push([input]);

  // Character-by-character
  partitions.push([...input]);

  // Two halves
  if (input.length >= 2) {
    const mid = Math.floor(input.length / 2);
    partitions.push([input.slice(0, mid), input.slice(mid)]);
  }

  // Three parts
  if (input.length >= 3) {
    const third = Math.floor(input.length / 3);
    partitions.push([
      input.slice(0, third),
      input.slice(third, third * 2),
      input.slice(third * 2),
    ]);
  }

  return partitions;
}

/**
 * Assert two parse results are equivalent.
 */
function assertEquivalentResults(
  a: { result: FinalResult; events: ParserEvent[] },
  b: { result: FinalResult; events: ParserEvent[] },
  labelA: string,
  labelB: string,
): void {
  // Same syntax
  expect(a.result.syntax, `syntax: ${labelA} vs ${labelB}`).toBe(
    b.result.syntax,
  );

  // Same outcome
  expect(a.result.outcome, `outcome: ${labelA} vs ${labelB}`).toBe(
    b.result.outcome,
  );

  // Same stableValue
  expect(
    JSON.stringify(a.result.stableValue),
    `stableValue: ${labelA} vs ${labelB}`,
  ).toBe(JSON.stringify(b.result.stableValue));

  // Same executable
  expect(
    a.result.executable,
    `executable: ${labelA} vs ${labelB}`,
  ).toBe(b.result.executable);

  // Same diagnostic codes (order may vary within a push, but overall should match)
  const diagCodesA = a.result.diagnostics.map((d) => d.code).sort();
  const diagCodesB = b.result.diagnostics.map((d) => d.code).sort();
  expect(diagCodesA, `diagnostic codes: ${labelA} vs ${labelB}`).toEqual(
    diagCodesB,
  );

  // Same repair list
  expect(
    a.result.repairs.length,
    `repairs count: ${labelA} vs ${labelB}`,
  ).toBe(b.result.repairs.length);

  // Value events should match
  const valueEventsA = a.events
    .filter((e) => e.type === "value_committed")
    .map((e) => {
      if (e.type === "value_committed") {
        return { path: e.path, value: e.value };
      }
      return null;
    });
  const valueEventsB = b.events
    .filter((e) => e.type === "value_committed")
    .map((e) => {
      if (e.type === "value_committed") {
        return { path: e.path, value: e.value };
      }
      return null;
    });
  expect(
    JSON.stringify(valueEventsA),
    `value events: ${labelA} vs ${labelB}`,
  ).toBe(JSON.stringify(valueEventsB));
}

describe("Chunk Invariance", () => {
  it("preserves BOM-prefixed JSON across byte splits and empty chunks", () => {
    const input = '{"text":"é😀","escaped":"\\u0041\\n"}';
    const bytes = new TextEncoder().encode(`\ufeff${input}`);
    const reference = runParse([bytes]);
    expect(reference.result.outcome).toBe("valid");
    expect(reference.result.stableValue).toEqual(JSON.parse(input));
    expect(reference.result.executable).toBe(true);
    expect(reference.result.diagnostics).toEqual([]);
    expect(reference.result.repairs.map((repair) => repair.code)).toEqual([
      "R_STRIP_UTF8_BOM",
    ]);

    for (let split = 0; split <= bytes.length; split++) {
      const actual = runParse([
        "", bytes.slice(0, split), new Uint8Array(), bytes.slice(split), "",
      ]);
      expect(actual, `split at byte ${split}`).toEqual(reference);
    }

    const byteChunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
    expect(runParse(byteChunks.flatMap((chunk) => ["", chunk]))).toEqual(reference);
    expect(runParse(["", `\ufeff${input}`, ""])).toEqual(reference);
  });

  const endReasons: StreamEndReason[] = [
    "complete", "length", "network_error", "provider_error", "cancelled", "unknown",
  ];

  for (const reason of endReasons) {
    it(`reports incomplete BOM prefixes at EOF (${reason})`, () => {
      const partitions = [
        [new Uint8Array([0xef])],
        [new Uint8Array([0xef, 0xbb])],
        [new Uint8Array([0xef]), new Uint8Array([0xbb])],
      ];

      for (const chunks of partitions) {
        const parsed = runParse(chunks, reason);
        expect(parsed.result.outcome).toBe("truncated");
        expect(parsed.result.executable).toBe(false);
        expect(parsed.result.stableValue).toBeUndefined();
        expect(parsed.result.repairs).toEqual([]);
        expect(parsed.result.diagnostics.filter((d) => d.code === "E_INCOMPLETE_UTF8"))
          .toEqual([expect.objectContaining({
            code: "E_INCOMPLETE_UTF8",
            severity: "error",
            byteOffset: 0,
            recoverable: false,
          })]);
        expect(runParse(chunks.flatMap((chunk) => ["", chunk, new Uint8Array()]), reason))
          .toEqual(parsed);
      }
    });
  }

  it("does not diagnose empty input or a complete BOM as incomplete UTF-8", () => {
    for (const chunks of [[], ["", new Uint8Array()], [new Uint8Array([0xef, 0xbb, 0xbf])]]) {
      const { result } = runParse(chunks);
      expect(result.outcome).toBe("truncated");
      expect(result.executable).toBe(false);
      expect(result.diagnostics).toEqual([]);
    }
  });

  const testCases: Array<{
    name: string;
    input: string;
    reason: StreamEndReason;
  }> = [
    { name: "simple object", input: '{"a":1,"b":2}', reason: "complete" },
    { name: "nested object", input: '{"x":{"y":1}}', reason: "complete" },
    { name: "array", input: "[1,2,3]", reason: "complete" },
    {
      name: "string with escapes",
      input: '{"msg":"hello\\nworld"}',
      reason: "complete",
    },
    {
      name: "unicode escape",
      input: '{"ch":"\\u0041"}',
      reason: "complete",
    },
    { name: "boolean values", input: '{"a":true,"b":false}', reason: "complete" },
    { name: "null value", input: '{"a":null}', reason: "complete" },
    {
      name: "nested with arrays",
      input: '{"a":[1,2],"b":{"c":3}}',
      reason: "complete",
    },
    {
      name: "empty containers",
      input: '{"obj":{},"arr":[]}',
      reason: "complete",
    },
    {
      name: "truncated object",
      input: '{"a":1,"b":',
      reason: "length",
    },
    {
      name: "truncated string",
      input: '{"key":"val',
      reason: "length",
    },
  ];

  for (const tc of testCases) {
    it(`${tc.name}: all partitions produce same result`, () => {
      const partitions = generateStringPartitions(tc.input);
      const reference = runParse([tc.input], tc.reason);

      for (let i = 1; i < partitions.length; i++) {
        const partition = expectDefined(partitions[i]);
        const result = runParse(partition, tc.reason);
        assertEquivalentResults(
          reference,
          result,
          "single",
          `partition-${i} (${partition.length} chunks)`,
        );
      }
    });
  }
});
