// @ts-nocheck
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
