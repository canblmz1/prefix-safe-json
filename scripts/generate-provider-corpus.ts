import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AnthropicStreamAdapter } from "../src/providers/anthropic.js";
import { OpenAICompatibleStreamAdapter } from "../src/providers/openai-compatible.js";
import { OpenAIStreamAdapter } from "../src/providers/openai.js";
import { GeminiStreamAdapter } from "../src/providers/gemini.js";
import { OpenRouterStreamAdapter } from "../src/providers/openrouter.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CORPUS_DIR = join(__dirname, "..", "corpus", "provider-envelopes");

let fileCounter = 1;

function generateFixture(category: string, provider: string, namePrefix: string, chunks: unknown[], endReason: string = "complete") {
  const adapter = getAdapter(provider);
  const events = [];
  
  for (const chunk of chunks) {
    const chunkEvents = adapter.push(chunk);
    events.push(...chunkEvents);
  }
  
  const finishEvents = adapter.finish({ reason: endReason as "complete" | "length" | "network_error" | "provider_error" | "cancelled" | "unknown" });
  events.push(...finishEvents);
  
  // Format as fixture
  const id = `${namePrefix}-${fileCounter++}`;
  const fixture = {
    version: 1,
    id,
    title: `Provider Fixture ${id}`,
    category,
    provider,
    input: {
      encoding: "utf8-text",
      data: chunks.map(c => JSON.stringify(c)).join("\n") // Store each chunk as a line
    },
    stream: {
      chunks: chunks.map(c => JSON.stringify(c)),
      endReason
    },
    expected: {
      syntax: "root_complete", // arbitrary for provider tests
      outcome: endReason === "complete" ? "valid" : "truncated",
      executable: endReason === "complete" && provider !== "gemini",
      diagnostics: provider === "gemini"
        ? [{ code: "E_ARGUMENT_EVIDENCE_PROJECTION_ONLY", severity: "warning", recoverable: false }]
        : [],
      repairs: [],
      events
    },
    provenance: {
      source: "synthetic"
    }
  };
  
  writeFileSync(join(CORPUS_DIR, `${id}.json`), JSON.stringify(fixture, null, 2));
}

function getAdapter(provider: string) {
  switch (provider) {
    case "anthropic": return new AnthropicStreamAdapter();
    case "openai-compatible": return new OpenAICompatibleStreamAdapter();
    case "openai": return new OpenAIStreamAdapter();
    case "gemini": return new GeminiStreamAdapter();
    case "openrouter": return new OpenRouterStreamAdapter();
    default: throw new Error(`Unknown provider ${provider}`);
  }
}

// Generate Anthropic
for (let i = 0; i < 12; i++) {
  generateFixture("anthropic", "anthropic", "anthropic", [
    { type: "message_start" },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t" + i, name: "test_tool" } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a": ' + i + '}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", stop_reason: "tool_use" }
  ]);
}

// Generate OpenAI Compatible
for (let i = 0; i < 12; i++) {
  generateFixture("openai-compatible", "openai-compatible", "openai-compatible", [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_" + i, type: "function", function: { name: "foo" } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"b":' + i + '}' } }] } }] },
    { choices: [{ index: 0, finish_reason: "tool_calls" }] }
  ]);
}

// Generate OpenAI Responses
for (let i = 0; i < 12; i++) {
  generateFixture("openai-responses", "openai", "openai-responses", [
    { type: "response.output_item.added", item: { type: "function_call", id: "fc_" + i, call_id: "c_" + i, name: "foo" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_" + i, delta: '{"c":' + i + '}' },
    { type: "response.function_call_arguments.done", item_id: "fc_" + i, arguments: '{"c":' + i + '}' },
    { type: "response.output_item.done", item: { id: "fc_" + i } },
    { type: "response.completed", response: { status: "completed" } }
  ]);
}

// Generate Gemini
for (let i = 0; i < 12; i++) {
  generateFixture("gemini", "gemini", "gemini", [
    { candidates: [{ content: { parts: [{ functionCall: { name: "foo", args: { d: i } } }] } }] }
  ]);
}

// Generate OpenRouter
for (let i = 0; i < 12; i++) {
  generateFixture("openrouter", "openrouter", "openrouter", [
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_" + i, type: "function", function: { name: "foo" } }] } }] },
    { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"e":' + i + '}' } }] } }] },
    { choices: [{ index: 0, finish_reason: "tool_calls" }] }
  ]);
}

console.log("Corpus generated.");
