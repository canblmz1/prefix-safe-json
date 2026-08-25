import assert from "node:assert/strict";
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

const EXPECTED_VALUE = { path: "example.txt", content: "safe\n" };

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

function providerParts(makeFinishReason, terminalReason) {
  const id = "call_1";
  const toolName = "write_file";
  const argsJson = JSON.stringify(EXPECTED_VALUE);
  return [
    { type: "stream-start", warnings: [] },
    ...toolInputParts(id, toolName, argsJson),
    { type: "tool-call", toolCallId: id, toolName, input: argsJson },
    {
      type: "finish",
      finishReason: makeFinishReason(terminalReason),
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    },
  ];
}

function zeroNativeCounts() {
  return {
    execute: 0,
    onInputStart: 0,
    onInputDelta: 0,
    onInputAvailable: 0,
  };
}

function nativeEffectTotal(counts) {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function toolWithCallbacks(inputSchema, counts, assertBeforeAuthority) {
  return {
    description: "Count harmless execution-ownership effects",
    inputSchema,
    execute: async () => {
      assertBeforeAuthority();
      counts.execute += 1;
      return { ok: true };
    },
    onInputStart: () => {
      assertBeforeAuthority();
      counts.onInputStart += 1;
    },
    onInputDelta: () => {
      assertBeforeAuthority();
      counts.onInputDelta += 1;
    },
    onInputAvailable: () => {
      assertBeforeAuthority();
      counts.onInputAvailable += 1;
    },
  };
}

function createGuard() {
  return createAiSdkExecutionGuard({
    schemas: { write_file: WRITE_FILE_JSON_SCHEMA },
  });
}

async function drainIntoGuard(fullStream, guard) {
  for await (const part of fullStream) {
    guard.push(part);
  }
  return guard.finish();
}

export async function runLifecycleProof({
  exactVersion,
  approvalTruth,
  streamText,
  jsonSchema,
  createModel,
  makeFinishReason,
}) {
  const inputSchema = jsonSchema(WRITE_FILE_JSON_SCHEMA);

  // UNSAFE CONTROL: deliberately bypasses createAiSdkExecutionLock(). The
  // callbacks assert that SDK-owned caller code runs before guard.finish().
  const unlockedCounts = zeroNativeCounts();
  let unlockedGuardFinished = false;
  const unlockedResult = streamText({
    model: createModel(providerParts(makeFinishReason, "tool-calls")),
    prompt: "Unsafe control: do not copy this tool definition",
    tools: {
      write_file: toolWithCallbacks(inputSchema, unlockedCounts, () => {
        assert.equal(unlockedGuardFinished, false);
      }),
    },
  });
  const unlockedFinal = await drainIntoGuard(unlockedResult.fullStream, createGuard());
  unlockedGuardFinished = true;
  const unlockedNativeEffects = nativeEffectTotal(unlockedCounts);
  assert.ok(unlockedNativeEffects > 0);

  // LOCKED UNSAFE: a length termination never grants authority. The lock
  // removes every attached SDK callback before streamText() sees the tool.
  const lockedUnsafeCounts = zeroNativeCounts();
  const lockedUnsafeManualEffects = 0;
  const lockedUnsafeResult = streamText({
    model: createModel(providerParts(makeFinishReason, "length")),
    prompt: "Unsafe terminal condition",
    tools: createAiSdkExecutionLock({
      write_file: toolWithCallbacks(inputSchema, lockedUnsafeCounts, () => {
        throw new Error("locked unsafe callback must not run");
      }),
    }),
  });
  const lockedUnsafeFinal = await drainIntoGuard(
    lockedUnsafeResult.fullStream,
    createGuard(),
  );
  const lockedUnsafeDecision = lockedUnsafeFinal.decisions[0];
  assert.ok(lockedUnsafeDecision);
  assert.notEqual(lockedUnsafeDecision.action, "execute");
  assert.deepEqual(lockedUnsafeCounts, zeroNativeCounts());
  assert.equal(lockedUnsafeManualEffects, 0);

  // LOCKED SAFE: caller-owned dispatch occurs once, after guard authority,
  // and consumes only decision.value—not chunk.input or an SDK projection.
  const lockedSafeCounts = zeroNativeCounts();
  let lockedSafeManualEffects = 0;
  const lockedSafeResult = streamText({
    model: createModel(providerParts(makeFinishReason, "tool-calls")),
    prompt: "Safe complete call",
    tools: createAiSdkExecutionLock({
      write_file: toolWithCallbacks(inputSchema, lockedSafeCounts, () => {
        throw new Error("locked safe callback must not run");
      }),
    }),
  });
  const lockedSafeFinal = await drainIntoGuard(lockedSafeResult.fullStream, createGuard());
  const lockedSafeDecision = lockedSafeFinal.decisions[0];
  assert.ok(lockedSafeDecision);
  assert.equal(lockedSafeDecision.action, "execute");
  assert.deepEqual(lockedSafeCounts, zeroNativeCounts());

  if (lockedSafeDecision.action === "execute") {
    assert.deepEqual(lockedSafeDecision.value, EXPECTED_VALUE);
    lockedSafeManualEffects += 1;
  }
  assert.equal(lockedSafeManualEffects, 1);

  const summary = {
    aiSdk: exactVersion,
    approvalTruth,
    unlockedControl: {
      label: "UNSAFE CONTROL — never recommended",
      nativeEffects: unlockedNativeEffects,
      nativeCounts: unlockedCounts,
      guardDecisionAfterEffects: unlockedFinal.decisions[0]?.action ?? "none",
    },
    lockedUnsafe: {
      terminalReason: "length",
      nativeEffects: nativeEffectTotal(lockedUnsafeCounts),
      manualEffects: lockedUnsafeManualEffects,
      guardDecision: lockedUnsafeDecision.action,
    },
    lockedSafe: {
      nativeEffects: nativeEffectTotal(lockedSafeCounts),
      manualEffects: lockedSafeManualEffects,
      guardDecision: lockedSafeDecision.action,
    },
  };

  console.log(JSON.stringify(summary));
  console.log(`PASS ${exactVersion}`);
  return summary;
}
