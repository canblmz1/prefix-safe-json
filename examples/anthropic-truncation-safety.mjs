// End-to-end demonstration against this library's real public API
// (createToolCallStreamCoordinator + AnthropicStreamAdapter, both from
// dist/, exactly as an external consumer would import them - not an
// internal reimplementation).
//
// The event shapes below match Anthropic's actual documented Messages API
// streaming protocol for tool use: content_block_start -> repeated
// content_block_delta (input_json_delta / partial_json) -> content_block_stop
// -> message_delta (carries stop_reason) -> message_stop. This is the same
// shape verified against the real @ai-sdk/anthropic source while
// investigating the Cline finding in README.md (content_block_stop fires
// unconditionally, even when the block was cut short by max_tokens).
//
// Run: node examples/anthropic-truncation-safety.mjs

import {
  createToolCallStreamCoordinator,
  AnthropicStreamAdapter,
} from "../dist/index.js";

function run(label, rawEvents) {
  console.log(`\n=== ${label} ===`);

  const coordinator = createToolCallStreamCoordinator();
  const adapter = new AnthropicStreamAdapter();

  for (const rawEvent of rawEvents) {
    for (const normalized of adapter.push(rawEvent)) {
      coordinator.push(normalized);
    }
  }

  const snapshot = coordinator.snapshot();
  for (const call of snapshot.calls) {
    console.log(`tool: ${call.name}`);
    console.log(`  status:      ${call.status}`);
    console.log(`  executable:  ${call.parser.executable ?? "(pending)"}`);
    console.log(`  stableValue: ${JSON.stringify(call.parser.stableValue)}`);
  }
  return snapshot;
}

// --- Scenario 1: a tool call cut off mid-argument by max_tokens --------
// The model was writing a config file and got cut off mid-password, the
// same shape as the Cline finding in README.md - except this time going
// through this library's own real adapter + coordinator, not a
// third-party's jsonrepair-based "last chance" fixer.
const truncatedStream = [
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_01", name: "write_file" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"path":"config/database.yml",' },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "input_json_delta",
      partial_json:
        '"content":"production:\\n  host: db.prod.internal\\n  password: correct-horse-battery-sta',
    },
  },
  // Anthropic still closes the in-progress block even though it was cut
  // short - confirmed against the real @ai-sdk/anthropic source.
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "max_tokens" } },
];

const truncated = run(
  "Scenario 1: write_file cut off mid-argument by max_tokens",
  truncatedStream,
);
const truncatedCall = truncated.calls[0];
if (truncatedCall.status === "complete" || truncatedCall.parser.executable) {
  console.error(
    "\nFAIL: a truncated tool call was reported as safe to execute.",
  );
  process.exitCode = 1;
} else {
  console.log(
    "\nOK: coordinator refuses to mark this executable - the corrupted",
    "\n    `content` value never appears in stableValue, so a caller",
    "\n    gating write_file on `executable` correctly does not run it.",
  );
}

// --- Scenario 2: the same tool call, genuinely complete -----------------
// Contrast case: this library isn't just always saying no - a real,
// fully-delivered tool call reports complete/executable normally.
const completeStream = [
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "toolu_02", name: "write_file" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"path":"config/database.yml",' },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "input_json_delta",
      partial_json: '"content":"production:\\n  host: db.prod.internal\\n"}',
    },
  },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" } },
];

const complete = run("Scenario 2: the same call, genuinely complete", completeStream);
const completeCall = complete.calls[0];
if (completeCall.status !== "complete" || !completeCall.parser.executable) {
  console.error("\nFAIL: a genuinely complete tool call was not marked executable.");
  process.exitCode = 1;
} else {
  console.log("\nOK: a real, fully-delivered call is reported complete and executable.");
}
