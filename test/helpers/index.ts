// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

import { createParser } from "../../src/parser.js";
import type {
  ParserEvent,
  FinalResult,
  StreamEndReason,
  JsonValue,
} from "../../src/types.js";

/**
 * Require a value to be defined, throwing if undefined.
 */
export function expectDefined<T>(
  value: T | undefined,
  message = "Expected value to be defined",
): T {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
}

/**
 * Parse a complete input string and finish with the given reason.
 */
export function parseComplete(
  input: string,
  reason: StreamEndReason = "complete",
): FinalResult {
  const parser = createParser();
  parser.push(input);
  return parser.finish({ reason });
}

/**
 * Parse input as multiple string chunks.
 */
export function parseChunks(
  chunks: string[],
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
 * Parse input as individual bytes.
 */
export function parseByteByByte(
  input: string,
  reason: StreamEndReason = "complete",
): { result: FinalResult; events: ParserEvent[] } {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  const parser = createParser();
  const allEvents: ParserEvent[] = [];

  for (let i = 0; i < bytes.length; i++) {
    parser.push(bytes.slice(i, i + 1));
    allEvents.push(...parser.drainEvents());
  }

  const result = parser.finish({ reason });
  allEvents.push(...parser.drainEvents());

  return { result, events: allEvents };
}

/**
 * Parse input as individual characters.
 */
export function parseCharByChar(
  input: string,
  reason: StreamEndReason = "complete",
): { result: FinalResult; events: ParserEvent[] } {
  const parser = createParser();
  const allEvents: ParserEvent[] = [];

  for (const ch of input) {
    parser.push(ch);
    allEvents.push(...parser.drainEvents());
  }

  const result = parser.finish({ reason });
  allEvents.push(...parser.drainEvents());

  return { result, events: allEvents };
}

/**
 * Deep equality check for JSON values.
 */
export function jsonEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Get value_committed events from an event list.
 */
export function getValueEvents(events: ParserEvent[]): ParserEvent[] {
  return events.filter((e) => e.type === "value_committed");
}

/**
 * Get diagnostic events from an event list.
 */
export function getDiagnosticEvents(events: ParserEvent[]): ParserEvent[] {
  return events.filter((e) => e.type === "diagnostic");
}
