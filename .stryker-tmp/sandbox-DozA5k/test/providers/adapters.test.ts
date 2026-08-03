// @ts-nocheck
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { OpenRouterStreamAdapter } from "../../src/providers/openrouter.js";
import { ProviderStreamAdapter } from "../../src/providers/adapter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_DIR = join(__dirname, "..", "..", "corpus", "provider-envelopes");

function getAdapter(provider: string): ProviderStreamAdapter<unknown> {
  switch (provider) {
    case "anthropic": return new AnthropicStreamAdapter();
    case "openai-compatible": return new OpenAICompatibleStreamAdapter();
    case "openai": return new OpenAIStreamAdapter();
    case "gemini": return new GeminiStreamAdapter();
    case "openrouter": return new OpenRouterStreamAdapter();
    default: throw new Error(`Unknown provider ${provider}`);
  }
}

describe("Provider Adapters Conformance", () => {
  if (!existsSync(CORPUS_DIR)) {
    console.warn("No provider-envelopes corpus found");
    return;
  }

  const files = readdirSync(CORPUS_DIR).filter(f => f.endsWith(".json"));
  
  for (const file of files) {
    it(`should correctly process ${file}`, () => {
      const content = readFileSync(join(CORPUS_DIR, file), "utf8");
      const fixture = JSON.parse(content);
      
      const adapter = getAdapter(fixture.provider);
      
      // The input data contains newline separated JSON chunks
      const chunksStr = fixture.input.data.split("\\n").filter((l: string) => l.trim());
      const events: unknown[] = [];
      
      for (const line of chunksStr) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        events.push(...adapter.push(chunk));
      }
      
      events.push(...adapter.finish({ reason: fixture.stream.endReason }));
      
      expect(events).toEqual(fixture.expected.events);
    });
  }
});
