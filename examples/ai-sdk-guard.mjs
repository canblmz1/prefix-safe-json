// End-to-end demonstration of the high-level createAiSdkExecutionGuard()
// API against this library's real public build (dist/, exactly as an
// external consumer would import it).
//
// This is the ~10-line drop-in shape README.md leads with:
//
//   const guard = createAiSdkExecutionGuard({ schemas: toolSchemas });
//   for await (const part of result.fullStream) guard.push(part);
//   const final = guard.finish();
//   for (const decision of final.decisions) {
//     if (decision.action === "execute") await tools[decision.name](decision.value);
//   }
//
// Same fullStream part shapes as examples/ai-sdk-execution-gate.mjs (verified
// identical across ai@5.0.240, ai@6.0.259, ai@7.0.70 - see
// test/guard/ai-sdk-compatibility.test.ts). This example never calls a real
// model - literal, correctly-shaped fullStream parts, no network, no API
// key, deterministic, safe to run in CI on every push.
//
// Run: node examples/ai-sdk-guard.mjs

import { createAiSdkExecutionGuard } from "../dist/index.js";

function run(label, parts, schemas) {
  console.log(`\n=== ${label} ===`);

  const guard = createAiSdkExecutionGuard({ schemas });
  for (const part of parts) guard.push(part);

  const { decisions } = guard.finish();
  for (const decision of decisions) {
    console.log(`tool: ${decision.name}`);
    console.log(`  action:      ${decision.action}`);
    console.log(`  reason:      ${decision.reason}`);
    console.log(`  evidence:    ${JSON.stringify(decision.evidence)}`);
    if (decision.action === "execute") {
      console.log(`  value:       ${JSON.stringify(decision.value)}`);
    }
  }
  return decisions;
}

const toolSchemas = {
  write_file: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
    required: ["path", "content"],
  },
};

// --- Scenario A: cut off mid-argument by finishReason "length" -------------
const truncatedParts = [
  { type: "tool-input-start", id: "call_1", toolName: "write_file" },
  { type: "tool-input-delta", id: "call_1", delta: '{"path":"config/database.yml",' },
  {
    type: "tool-input-delta",
    id: "call_1",
    delta: '"content":"production:\\n  host: db.prod.internal\\n  password: correct-horse-battery-sta',
  },
  { type: "tool-input-end", id: "call_1" },
  { type: "finish", finishReason: "length" },
];

const truncatedDecisions = run(
  "Scenario A: write_file cut off mid-argument, finishReason \"length\"",
  truncatedParts,
  toolSchemas,
);
const truncatedDecision = truncatedDecisions[0];
if (!truncatedDecision || truncatedDecision.action === "execute") {
  console.error("\nFAIL: a truncated tool call was reported as safe to execute.");
  process.exitCode = 1;
} else {
  console.log("\nOK: the guard refuses this call before it ever reaches the tool.");
}

// --- Scenario B: the same call, genuinely complete --------------------------
const completeParts = [
  { type: "tool-input-start", id: "call_2", toolName: "write_file" },
  { type: "tool-input-delta", id: "call_2", delta: '{"path":"config/database.yml",' },
  { type: "tool-input-delta", id: "call_2", delta: '"content":"production:\\n  host: db.prod.internal\\n"}' },
  { type: "tool-input-end", id: "call_2" },
  { type: "finish", finishReason: "tool-calls" },
];

const completeDecisions = run("Scenario B: the same call, genuinely complete", completeParts, toolSchemas);
const completeDecision = completeDecisions[0];
if (!completeDecision || completeDecision.action !== "execute") {
  console.error("\nFAIL: a genuinely complete tool call was not reported executable.");
  process.exitCode = 1;
} else {
  console.log("\nOK: a real, fully-delivered call is reported action: \"execute\".");
}
