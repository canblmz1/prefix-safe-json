// @ts-nocheck
// ---------------------------------------------------------------------------
// Event Monotonicity Tests
// ---------------------------------------------------------------------------
// Once a value_committed event is emitted, it must never be:
// - Retracted
// - Modified
// - Replaced by a different event for the same path
// ---------------------------------------------------------------------------
import { expectDefined } from "../utils/expect-defined.js";

import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import type { ParserEvent, ValueCommittedEvent } from "../../src/types.js";

describe("Event Monotonicity", () => {
  it("committed events are never retracted across pushes", () => {
    const parser = createParser();
    const allValueEvents: ValueCommittedEvent[] = [];

    const chunks = ['{"a":', "1,", '"b":', '"hello"', "}"];

    for (const chunk of chunks) {
      parser.push(chunk);
      const events = parser.drainEvents();
      const valueEvents = events.filter(
        (e): e is ValueCommittedEvent => e.type === "value_committed",
      );
      allValueEvents.push(...valueEvents);
    }

    // Every event that was emitted should still be valid
    // No path should have multiple events
    const pathSet = new Set<string>();
    for (const event of allValueEvents) {
      expect(
        pathSet.has(event.path),
        `Duplicate event for path ${event.path}`,
      ).toBe(false);
      pathSet.add(event.path);
    }
  });

  it("sequence numbers are monotonically increasing", () => {
    const parser = createParser();
    const allEvents: ParserEvent[] = [];

    parser.push('{"a":1,"b":[2,3],"c":"x"}');
    allEvents.push(...parser.drainEvents());

    parser.finish({ reason: "complete" });
    allEvents.push(...parser.drainEvents());

    // Verify monotonic sequence
    for (let i = 1; i < allEvents.length; i++) {
      expect(
        expectDefined(allEvents[i]).sequence,
        `Event ${i} sequence should be > event ${i - 1}`,
      ).toBeGreaterThan(expectDefined(allEvents[i - 1]).sequence);
    }
  });

  it("no duplicate path events for same object", () => {
    const parser = createParser();
    parser.push('{"a":1,"b":2,"c":3}');
    const events = parser.drainEvents();

    const valueEvents = events.filter(
      (e): e is ValueCommittedEvent => e.type === "value_committed",
    );

    const paths = valueEvents.map((e) => e.path);
    const uniquePaths = new Set(paths);
    expect(paths.length).toBe(uniquePaths.size);
  });

  it("array element events use sequential indices", () => {
    const parser = createParser();
    parser.push("[10,20,30]");
    const events = parser.drainEvents();

    const valueEvents = events.filter(
      (e): e is ValueCommittedEvent => e.type === "value_committed",
    );

    expect(expectDefined(valueEvents[0]).path).toBe("/0");
    expect(expectDefined(valueEvents[0]).value).toBe(10);
    expect(expectDefined(valueEvents[1]).path).toBe("/1");
    expect(expectDefined(valueEvents[1]).value).toBe(20);
    expect(expectDefined(valueEvents[2]).path).toBe("/2");
    expect(expectDefined(valueEvents[2]).value).toBe(30);
  });
});
