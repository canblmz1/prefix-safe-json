// Canonical AI SDK execution-ownership boundary, driven by ai@7.0.77's real
// streamText() lifecycle and official MockLanguageModelV4 provider boundary.
// No network request, API key, paid model, or manually constructed guard event.

import assert from "node:assert/strict";
import { jsonSchema, streamText } from "ai-v7";
import { MockLanguageModelV4 } from "ai-v7/test";
import {
  createAiSdkExecutionGuard,
  createAiSdkExecutionLock,
} from "../dist/index.js";

const WRITE_FILE_JSON_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

const WRITE_FILE_INPUT_SCHEMA = jsonSchema(WRITE_FILE_JSON_SCHEMA);

function toolInputParts(id, toolName, argsJson, chunkSize = 7) {
  const parts = [{ type: "tool-input-start", id, toolName }];
  for (let offset = 0; offset < argsJson.length; offset += chunkSize) {
    parts.push({
      type: "tool-input-delta",
      id,
      delta: argsJson.slice(offset, offset + chunkSize),
    });
  }
  parts.push({ type: "tool-input-end", id });
  return parts;
}

function mockModel(parts) {
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

function providerParts(finishReason) {
  const id = "call_1";
  const toolName = "write_file";
  const argsJson = JSON.stringify({ path: "example.txt", content: "safe\n" });
  return [
    { type: "stream-start", warnings: [] },
    ...toolInputParts(id, toolName, argsJson),
    { type: "tool-call", toolCallId: id, toolName, input: argsJson },
    {
      type: "finish",
      finishReason: { unified: finishReason, raw: finishReason },
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    },
  ];
}

function zeroCallbackCounts() {
  return {
    execute: 0,
    onInputStart: 0,
    onInputDelta: 0,
    onInputAvailable: 0,
  };
}

async function runScenario(label, finishReason) {
  const nativeCallbacks = zeroCallbackCounts();
  let manualOperations = 0;

  async function callerOwnedSideEffect(value) {
    assert.deepEqual(value, { path: "example.txt", content: "safe\n" });
    manualOperations += 1;
  }

  const lockedTools = createAiSdkExecutionLock({
    write_file: {
      description: "Count a caller-owned irreversible-operation substitute",
      inputSchema: WRITE_FILE_INPUT_SCHEMA,
      execute: async () => {
        nativeCallbacks.execute += 1;
      },
      onInputStart: () => {
        nativeCallbacks.onInputStart += 1;
      },
      onInputDelta: () => {
        nativeCallbacks.onInputDelta += 1;
      },
      onInputAvailable: () => {
        nativeCallbacks.onInputAvailable += 1;
      },
    },
  });

  const result = streamText({
    model: mockModel(providerParts(finishReason)),
    prompt: "Write example.txt",
    tools: lockedTools,
  });

  const guard = createAiSdkExecutionGuard({
    schemas: { write_file: WRITE_FILE_JSON_SCHEMA },
  });
  for await (const part of result.fullStream) {
    guard.push(part);
  }

  assert.deepEqual(nativeCallbacks, zeroCallbackCounts());

  const decisions = guard.finish().decisions;
  assert.equal(decisions.length, 1);
  const decision = decisions[0];
  assert.equal(decision.name, "write_file");

  for (const candidate of decisions) {
    if (candidate.action === "execute") {
      // The caller owns dispatch. Never execute chunk.input or an SDK-projected
      // or repaired value; execute only candidate.value after this decision.
      await callerOwnedSideEffect(candidate.value);
    }
  }

  const output = {
    scenario: label,
    nativeCallbacks,
    decision: decision.action,
    manualOperations,
  };
  console.log(JSON.stringify(output));
  return output;
}

const safe = await runScenario("locked-safe-complete", "tool-calls");
assert.equal(safe.decision, "execute");
assert.equal(safe.manualOperations, 1);

const unsafe = await runScenario("locked-unsafe-length", "length");
assert.notEqual(unsafe.decision, "execute");
assert.equal(unsafe.manualOperations, 0);

console.log("PASS: AI SDK ownership boundary is locked before decisions and caller-dispatched afterward.");

// Provider-executed tools are outside this local guarantee. Passing a locked
// definition through mutation or reconstruction also voids the guarantee.
// Application-level authorization and idempotency remain caller-owned.
