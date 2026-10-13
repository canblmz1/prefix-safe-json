// Deterministic mock-provider demo of installed public packages.
// No API key, live provider call, filesystem write, or SDK-owned tool execution.
import assert from "node:assert/strict";
import { streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import {
  createAiSdkExecutionGuard,
  createAiSdkExecutionLock,
} from "prefix-safe-json";
import { fromStandardSchema } from "prefix-safe-json/standard-schema";

const inputSchema = z.object({ message: z.string() }).strict();
const rawValue = { message: "from raw argument deltas" };
const projectedValue = { message: "different SDK projection" };

function zeroCallbacks() {
  return { execute: 0, onInputStart: 0, onInputDelta: 0, onInputAvailable: 0 };
}

function createModel(id, rawInput, projectedInput, finishReason) {
  const parts = [
    { type: "stream-start", warnings: [] },
    { type: "tool-input-start", id, toolName: "record_message" },
  ];
  for (let offset = 0; offset < rawInput.length; offset += 7) {
    parts.push({ type: "tool-input-delta", id, delta: rawInput.slice(offset, offset + 7) });
  }
  parts.push(
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName: "record_message", input: projectedInput },
    {
      type: "finish",
      finishReason: { unified: finishReason, raw: finishReason },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
    },
  );
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });
}

async function runScenario({ name, rawInput, projectedInput = rawInput, finishReason, expectedEffects }) {
  const callbacks = zeroCallbacks();
  const dispatched = [];
  const guard = createAiSdkExecutionGuard({
    validators: { record_message: fromStandardSchema(inputSchema) },
  });
  const tools = createAiSdkExecutionLock({
    record_message: {
      description: "Record a harmless in-memory value",
      inputSchema,
      execute: async () => { callbacks.execute += 1; return { ok: true }; },
      onInputStart: () => { callbacks.onInputStart += 1; },
      onInputDelta: () => { callbacks.onInputDelta += 1; },
      onInputAvailable: () => { callbacks.onInputAvailable += 1; },
    },
  });
  const result = streamText({
    model: createModel(`call_${name}`, rawInput, projectedInput, finishReason),
    prompt: "Exercise the execution boundary without external side effects.",
    tools,
  });

  const observedParts = [];
  let sdkProjection;
  let observedRaw = "";
  for await (const part of result.fullStream) {
    observedParts.push(part.type);
    if (part.type === "tool-input-delta") observedRaw += part.delta;
    if (part.type === "tool-call") sdkProjection = part.input;
    guard.push(part);
  }
  assert.equal(observedRaw, rawInput, `${name}: real fullStream must carry the raw deltas`);
  assert.deepEqual(callbacks, zeroCallbacks(), `${name}: SDK callbacks must remain locked`);
  assert.equal(dispatched.length, 0, `${name}: no dispatch before authority`);

  const { decisions } = guard.finish();
  assert.equal(decisions.length, 1, `${name}: expected one observed call`);
  const decision = decisions[0];
  const authority = guard.takeDecision(decision.internalId);
  if (authority) {
    // Caller-owned dispatch consumes only the raw, validated authority.value.
    // Never dispatch part.input or treat a decision snapshot as authority.
    dispatched.push(authority.value);
  }
  const secondAuthority = guard.takeDecision(decision.internalId);
  assert.equal(secondAuthority, undefined, `${name}: authority is one-shot`);
  assert.equal(dispatched.length, expectedEffects, `${name}: unexpected effect count`);
  assert.deepEqual(callbacks, zeroCallbacks());
  if (expectedEffects === 1) {
    assert.equal(decision.action, "execute");
    assert.deepEqual(dispatched, [rawValue]);
  } else {
    assert.equal(authority, undefined);
    assert.notEqual(decision.action, "execute");
  }
  if (name === "projection-mismatch") {
    assert.deepEqual(sdkProjection, projectedValue);
    assert.notDeepEqual(dispatched[0], sdkProjection);
  }
  if (name === "invalid-schema") {
    // ai@7.0.77 emits tool-error on schema failure before any callback runs.
    // The guard rejects that evidence as sdk_execution_observed; the counter
    // checks above establish that no SDK callback actually executed here.
    assert.ok(observedParts.includes("tool-error"));
  }
  console.log(JSON.stringify({
    scenario: name,
    decision: decision.action,
    reason: decision.reason,
    effects: dispatched.length,
    sdkCallbacks: callbacks,
    secondAuthority: secondAuthority === undefined ? "undefined" : "unexpected",
    dispatched,
  }));
}

console.log("Deterministic mock-provider demo: real streamText().fullStream, installed public imports.");
await runScenario({
  name: "valid-complete",
  rawInput: JSON.stringify(rawValue),
  finishReason: "tool-calls",
  expectedEffects: 1,
});
await runScenario({
  name: "truncated",
  rawInput: '{"message":"partial',
  // Deliberately plausible projection cannot replace incomplete raw evidence.
  projectedInput: JSON.stringify({ message: "partial" }),
  finishReason: "length",
  expectedEffects: 0,
});
await runScenario({
  name: "invalid-schema",
  rawInput: JSON.stringify({ message: 42 }),
  finishReason: "tool-calls",
  expectedEffects: 0,
});
await runScenario({
  name: "projection-mismatch",
  rawInput: JSON.stringify(rawValue),
  projectedInput: JSON.stringify(projectedValue),
  finishReason: "tool-calls",
  expectedEffects: 1,
});
console.log("PASS: effects 1/0/0/1; SDK callbacks zero; second takeDecision() undefined.");
console.log("This is a local mock-provider check, not a live-provider or independent-adoption claim.");
