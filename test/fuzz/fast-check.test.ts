import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { createParser } from "../../src/parser.js";

// Helper to chunk a string into random sizes
function chunkString(str: string, sizes: number[]): string[] {
  const chunks: string[] = [];
  let i = 0;
  let sizeIdx = 0;
  while (i < str.length) {
    const size = sizes[sizeIdx % sizes.length] || 1;
    chunks.push(str.slice(i, i + size));
    i += size;
    sizeIdx++;
  }
  return chunks;
}

describe("Property-Based Testing (fast-check)", () => {
  it("Chunk invariance: Output is identical regardless of how chunks are split", () => {
    fc.assert(
      fc.property(
        fc.jsonValue({ maxDepth: 5 }), 
        fc.array(fc.integer({ min: 1, max: 20 }), { minLength: 1, maxLength: 50 }),
        (jsonValue, chunkSizes) => {
          const jsonString = JSON.stringify(jsonValue);
          const chunks = chunkString(jsonString, chunkSizes);
          
          const singleParser = createParser();
          singleParser.push(jsonString);
          singleParser.finish({ reason: "complete" });
          singleParser.drainEvents(); // avoid memory queue limits in fuzz
          const singleSnapshot = singleParser.snapshot();
          
          const chunkedParser = createParser();
          for (const chunk of chunks) {
            chunkedParser.push(chunk);
            chunkedParser.drainEvents();
          }
          chunkedParser.finish({ reason: "complete" });
          chunkedParser.drainEvents();
          const chunkedSnapshot = chunkedParser.snapshot();
          
          expect(chunkedSnapshot.syntax).toBe(singleSnapshot.syntax);
          expect(chunkedSnapshot.executable).toBe(singleSnapshot.executable);
          expect(chunkedSnapshot.stableValue).toEqual(singleSnapshot.stableValue);
        }
      ),
      { numRuns: 1000 }
    );
  });
  
  it("Prefix safety: A truncated valid JSON stream never contains partial scalars", () => {
    fc.assert(
      fc.property(
        fc.jsonValue({ maxDepth: 5 }),
        fc.integer({ min: 1, max: 100 }),
        (jsonValue, truncatePercent) => {
          const jsonString = JSON.stringify(jsonValue);
          const length = Math.max(1, Math.floor((jsonString.length * truncatePercent) / 100));
          const truncated = jsonString.slice(0, length);
          
          const parser = createParser();
          parser.push(truncated);
          parser.finish({ reason: "length" });
          parser.drainEvents();
          const snapshot = parser.snapshot();
          
          // executable MUST be false for truncated streams
          expect(snapshot.executable).toBe(false);
          // syntax MUST be incomplete or invalid or empty
          expect(["empty", "incomplete", "invalid", "root_complete"]).toContain(snapshot.syntax);
        }
      ),
      { numRuns: 1000 }
    );
  });
});
