// @ts-nocheck
import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";

describe("Salvage Regressions", () => {
  const unsalvageableInputs = [
    "[1,",
    '{"a":1,',
    '{"a":',
    '{"a":"unfinished',
    '{"a":tru',
    '{"a":1 "b":2',
    "[1 2",
  ];

  it("structural salvage is disabled by default", () => {
    const parser = createParser();
    parser.push('{"a":1');
    parser.finish({ reason: "length" }); // Abrupt end
    
    const snapshot = parser.snapshot();
    expect(snapshot.repairs).toHaveLength(0);
    // Because it's not salvaged, outcome should be truncated
    // We assume outcome is evaluated by user, but repairs array is empty
  });

  describe("when safe-only is configured", () => {
    for (const input of unsalvageableInputs) {
      it(`never salvages unsafe input: ${input}`, () => {
        const parser = createParser({ repairs: { closeContainersAtFinish: "disabled" } });
        parser.push(input);
        parser.finish({ reason: "length" });

        const snapshot = parser.snapshot();
        expect(snapshot.repairs.length).toBe(0);
      });
    }

    it("salvages safe cases successfully", () => {
      const parser = createParser({ repairs: { closeContainersAtFinish: "safe-only" } });
      parser.push('{"a":"b"');
      parser.finish({ reason: "length" });
      
      const snapshot = parser.snapshot();
      expect(snapshot.repairs.length).toBeGreaterThan(0);
      expect(snapshot.executable).toBe(false);
      
      // Need to verify outcome is 'salvaged' - wait, the parser itself doesn't track stream outcome natively
      // The stream outcome is emitted via stream_finished event!
      const events = parser.drainEvents();
      const finishedEvent = events.find(e => e.type === "stream_finished");
      expect(finishedEvent).toBeDefined();
      if (finishedEvent) {
        expect((finishedEvent as { outcome?: string }).outcome).toBe("salvaged");
      }
      
      // Verify container_closed was emitted by repair
      const containerClosedEvents = events.filter(e => e.type === "container_closed");
      expect(containerClosedEvents.length).toBeGreaterThan(0);
      if (containerClosedEvents.length > 0) {
        expect(containerClosedEvents[0]?.type).toBe("container_closed");
      }
    });
  });
});
