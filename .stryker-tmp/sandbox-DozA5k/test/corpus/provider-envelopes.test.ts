// @ts-nocheck
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("Provider Envelopes Corpus", () => {
  it("validates all provider envelopes", () => {
    const dir = path.resolve(__dirname, "../../corpus/provider-envelopes");
    if (!fs.existsSync(dir)) {
      console.warn("No provider envelopes found");
      return;
    }
    const files = fs.readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const content = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        expect(content.version).toBe(1);
        expect(content.category).toBeDefined();
        expect(content.provider).toBeDefined();
      }
    }
  });
});
