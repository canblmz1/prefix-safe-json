// @ts-nocheck
import {
  createToolCallStreamCoordinator,
  DEFAULT_LIMITS,
  DiagnosticCode
} from "./dist/index.js";

// Verify types are exportable (in TS we'd import type, in JS we just import values)
import * as exports from "./dist/index.js";

const requiredExports = [
  "createToolCallStreamCoordinator",
  "OpenAIStreamAdapter",
  "OpenAICompatibleStreamAdapter",
  "AnthropicStreamAdapter",
  "GeminiStreamAdapter",
  "OpenRouterStreamAdapter"
];

for (const req of requiredExports) {
  if (!(req in exports)) {
    throw new Error(`Missing export: ${req}`);
  }
}

console.log("All package-root imports successful!");
