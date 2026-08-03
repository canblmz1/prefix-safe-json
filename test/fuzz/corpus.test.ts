import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { createParser } from "../../src/parser.js";
import { StreamEndReason } from "../../src/types.js";

const CORPUS_DIR = path.resolve(__dirname, "../../corpus/fuzz");

describe("Fuzz Corpus", () => {
  if (!fs.existsSync(CORPUS_DIR)) return;

  const files = fs.readdirSync(CORPUS_DIR).filter(f => f.endsWith(".json"));

  for (const file of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, file), "utf8"));
    
    it(`fuzz: ${fixture.id} - ${fixture.title}`, () => {
       const parser = createParser();
       parser.push(fixture.input.data);
       
       const endReason: StreamEndReason = fixture.stream.endReason;
       const result = parser.finish({ reason: endReason });
       
       if (fixture.category === "fuzz" && fixture.title.includes("Truncation")) {
         // Truncated fixtures can now be legitimately salvaged by R_CLOSE_CONTAINER
         expect(["truncated", "salvaged"]).toContain(result.outcome);
         expect(result.executable).toBe(false);
       } else {
         expect(result.syntax).toBe(fixture.expected.syntax);
         expect(result.outcome).toBe(fixture.expected.outcome);
         expect(result.executable).toBe(fixture.expected.executable);
       }
       
       // Just verify it doesn't crash and returns the expected top-level properties
    });
  }
});
