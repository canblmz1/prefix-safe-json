// @ts-nocheck
import { bench, describe } from "vitest";
import { createParser } from "../../src/parser.js";
import { jsonrepair } from "jsonrepair";
import { parse as partialParse } from "partial-json";
import * as clarinet from "clarinet";

const tinyPayload = JSON.stringify({ a: 1, b: "test" });

const mediumPayload = JSON.stringify({
  tools: [
    { name: "search", arguments: { query: "weather in tokyo", max_results: 5 } },
    { name: "calculator", arguments: { expression: "2 + 2 * 4" } }
  ]
});

// ~100KB payload
const largePayload = JSON.stringify(Array.from({ length: 1000 }, (_, i) => ({
  id: i,
  name: `item_${i}`,
  description: "A relatively long description to pad out the JSON size somewhat efficiently.",
  metadata: { tags: ["a", "b", "c"], active: true }
})));

// Deeply nested JSON
let deepPayload = "{}";
for (let i = 0; i < 50; i++) {
  deepPayload = `{"nested": ${deepPayload}}`;
}

function chunkString(str: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

const largePayloadChunks100 = chunkString(largePayload, 100);
const largePayloadChunks1 = chunkString(largePayload, 1);

describe("Parser Throughput (Single Chunk)", () => {
  bench("IncrementalJsonParser - Medium", () => {
    const parser = createParser();
    parser.push(mediumPayload);
    parser.finish({ reason: "complete" });
    parser.drainEvents();
  });

  bench("JSON.parse - Medium", () => {
    JSON.parse(mediumPayload);
  });

  bench("jsonrepair - Medium", () => {
    jsonrepair(mediumPayload);
  });

  bench("partial-json - Medium", () => {
    partialParse(mediumPayload);
  });

  bench("IncrementalJsonParser - 100KB", () => {
    const parser = createParser({ limits: { maxQueuedEvents: 100000 } });
    parser.push(largePayload);
    parser.finish({ reason: "complete" });
    parser.drainEvents();
  });

  bench("JSON.parse - 100KB", () => {
    JSON.parse(largePayload);
  });
  
  bench("jsonrepair - 100KB", () => {
    jsonrepair(largePayload);
  });
});

describe("Parser Streaming (100-byte chunks)", () => {
  bench("IncrementalJsonParser", () => {
    const parser = createParser({ limits: { maxQueuedEvents: 100000 } });
    for (const chunk of largePayloadChunks100) {
      parser.push(chunk);
      parser.drainEvents();
    }
    parser.finish({ reason: "complete" });
    parser.drainEvents();
  });

  bench("clarinet", () => {
    const parser = clarinet.parser();
    for (const chunk of largePayloadChunks100) {
      parser.write(chunk);
    }
    parser.close();
  });
});

describe("Parser Streaming (1-byte chunks)", () => {
  bench("IncrementalJsonParser", () => {
    const parser = createParser({ limits: { maxQueuedEvents: 100000 } });
    for (const chunk of largePayloadChunks1) {
      parser.push(chunk);
      parser.drainEvents();
    }
    parser.finish({ reason: "complete" });
    parser.drainEvents();
  });

  bench("clarinet", () => {
    const parser = clarinet.parser();
    for (const chunk of largePayloadChunks1) {
      parser.write(chunk);
    }
    parser.close();
  });
});

describe("Deeply Nested JSON", () => {
  bench("IncrementalJsonParser", () => {
    const parser = createParser();
    parser.push(deepPayload);
    parser.finish({ reason: "complete" });
    parser.drainEvents();
  });

  bench("JSON.parse", () => {
    JSON.parse(deepPayload);
  });
});
