// End-to-end demonstration against this library's real public API
// (createToolCallExecutionGate + AiSdkStreamAdapter, both from dist/, exactly
// as an external consumer would import them - not an internal
// reimplementation).
//
// The event shapes below match the Vercel AI SDK's actual `fullStream` part
// shapes for tool-call argument streaming (verified against the exact pinned
// `ai@7.0.77` lifecycle dependency):
// tool-input-start -> repeated tool-input-delta -> tool-input-end -> finish
// (which carries `finishReason`). A real integration looks like:
//
//   const gate = createToolCallExecutionGate(undefined, undefined, toolSchemas);
//   const adapter = new AiSdkStreamAdapter();
//   for await (const part of result.fullStream) {
//     for (const normalized of adapter.push(part)) gate.push(normalized);
//   }
//   // The caller has exhausted fullStream - let the adapter finalize
//   // provider-stream termination if push() hasn't already (every adapter's
//   // finish() is idempotent, so this is always safe to call, regardless of
//   // provider - see docs/EXECUTION_GATE.md#example).
//   for (const normalized of adapter.finish()) gate.push(normalized);
//   const final = gate.finish();
//   for (const observed of final.decisions) {
//     const authority = gate.takeDecision(observed.internalId);
//     if (authority) await tools[authority.name](authority.value);
//   }
//
// This example never calls a real model - it feeds literal, correctly-shaped
// fullStream parts, the same way examples/anthropic-truncation-safety.mjs
// feeds literal Anthropic SSE shapes. No network, no API key, deterministic,
// safe to run in CI on every push.
//
// Run: node examples/ai-sdk-execution-gate.mjs

import {
  createToolCallExecutionGate,
  AiSdkStreamAdapter,
} from "../dist/index.js";

function run(label, parts) {
  console.log(`\n=== ${label} ===`);

  const gate = createToolCallExecutionGate();
  const adapter = new AiSdkStreamAdapter();

  for (const part of parts) {
    for (const normalized of adapter.push(part)) {
      gate.push(normalized);
    }
  }

  // Universal pattern: always call adapter.finish() once the raw event
  // source is exhausted, even though AiSdkStreamAdapter's own push() will
  // typically already have observed a genuine terminal via the "finish"
  // part below - finish() is idempotent and returns nothing in that case.
  for (const normalized of adapter.finish()) {
    gate.push(normalized);
  }

  const { decisions } = gate.finish();
  for (const decision of decisions) {
    console.log(`tool: ${decision.name}`);
    console.log(`  action:      ${decision.action}`);
    console.log(`  executable:  ${decision.executable}`);
    console.log(`  reason:      ${decision.reason}`);
    console.log(`  stableValue: ${JSON.stringify(decision.stableValue)}`);
    if (decision.action === "execute") {
      console.log(`  value:       ${JSON.stringify(decision.value)}`);
    }
  }
  return { gate, decisions };
}

// --- Scenario A: a tool call cut off mid-argument by finishReason "length" -
// The model was writing a config file and got cut off mid-password, same
// shape as the Cline/Anthropic finding in README.md - except streamed
// through the AI SDK's fullStream protocol and this library's high-level
// execution gate, not the low-level parser/coordinator directly.
const truncatedParts = [
  { type: "tool-input-start", id: "call_1", toolName: "write_file" },
  { type: "tool-input-delta", id: "call_1", delta: '{"path":"config/database.yml",' },
  {
    type: "tool-input-delta",
    id: "call_1",
    delta: '"content":"production:\\n  host: db.prod.internal\\n  password: correct-horse-battery-sta',
  },
  { type: "tool-input-end", id: "call_1" },
  // The AI SDK's own "tool-call" part would carry a `input` here that may
  // already be silently repaired (closing the unterminated string) - see
  // AiSdkStreamAdapter's handling of "tool-call": it is intentionally never
  // read. Omitted here since it plays no role in the decision either way.
  { type: "finish", finishReason: "length" },
];

const { gate: truncatedGate, decisions: truncatedDecisions } = run(
  "Scenario A: write_file cut off mid-argument, finishReason \"length\"",
  truncatedParts,
);
const truncatedDecision = truncatedDecisions[0];
if (!truncatedDecision || truncatedDecision.action === "execute") {
  console.error(
    "\nFAIL: a truncated tool call was reported as safe to execute.",
  );
  process.exitCode = 1;
} else {
  if (truncatedGate.takeDecision(truncatedDecision.internalId) !== undefined) {
    throw new Error("unsafe call exposed executable authority");
  }
  console.log(
    "\nOK: the execution gate refuses this call - the corrupted `content`",
    "\n    value never appears in stableValue, so a caller gating write_file",
    "\n    on `action === \"execute\"` correctly never runs it.",
  );
}

// --- Scenario B: the same tool call, genuinely complete --------------------
// Contrast case: the gate isn't just always saying no - a real, fully
// delivered tool call is reported executable, with its committed value
// available directly on the decision.
const completeParts = [
  { type: "tool-input-start", id: "call_2", toolName: "write_file" },
  { type: "tool-input-delta", id: "call_2", delta: '{"path":"config/database.yml",' },
  { type: "tool-input-delta", id: "call_2", delta: '"content":"production:\\n  host: db.prod.internal\\n"}' },
  { type: "tool-input-end", id: "call_2" },
  { type: "finish", finishReason: "tool-calls" },
];

const { gate: completeGate, decisions: completeDecisions } = run("Scenario B: the same call, genuinely complete", completeParts);
const completeDecision = completeDecisions[0];
if (!completeDecision || completeDecision.action !== "execute") {
  console.error("\nFAIL: a genuinely complete tool call was not reported executable.");
  process.exitCode = 1;
} else {
  const authority = completeGate.takeDecision(completeDecision.internalId);
  if (!authority || completeGate.takeDecision(completeDecision.internalId) !== undefined) {
    throw new Error("execute authority was not available exactly once");
  }
  console.log("\nOK: a real, fully-delivered call exposes execute authority exactly once.");
}
