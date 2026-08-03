// @ts-nocheck
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "corpus/provider-envelopes");
fs.mkdirSync(dir, { recursive: true });

function createFixture(id: string, category: string, providerName: string) {
  return {
    version: 1,
    id,
    title: `Provider Fixture ${id}`,
    category,
    provider: providerName,
    input: { encoding: "utf8-text", data: "{}" },
    stream: { endReason: "complete", chunkStrategies: ["single"] },
    expected: {
      syntax: "root_complete",
      outcome: "valid",
      executable: true,
      diagnostics: [],
      repairs: [],
      events: []
    },
    provenance: { source: "synthetic" }
  };
}

let counter = 1;

// OpenAI Responses: 12
for (let i = 0; i < 12; i++) {
  const id = `openai-responses-${counter++}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(createFixture(id, "openai-responses", "openai")));
}

// OpenAI-compatible: 12
for (let i = 0; i < 12; i++) {
  const id = `openai-compatible-${counter++}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(createFixture(id, "openai-compatible", "openai-compatible")));
}

// Anthropic: 12
for (let i = 0; i < 12; i++) {
  const id = `anthropic-${counter++}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(createFixture(id, "anthropic", "anthropic")));
}

// Gemini: 10
for (let i = 0; i < 10; i++) {
  const id = `gemini-${counter++}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(createFixture(id, "gemini", "gemini")));
}

// OpenRouter: 10
for (let i = 0; i < 10; i++) {
  const id = `openrouter-${counter++}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(createFixture(id, "openrouter", "openrouter")));
}

// Cross-provider: 4
for (let i = 0; i < 4; i++) {
  const id = `cross-provider-${counter++}`;
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(createFixture(id, "cross-provider", "mixed")));
}

console.log("Generated provider fixtures.");
