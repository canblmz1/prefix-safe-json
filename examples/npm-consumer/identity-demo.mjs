// Original-stream identity comparison through the installed SDK and PSJ.
// These are authored fixtures, not a WorkflowAgent reproducer or live model.
// Native controls execute harmless in-memory counters deliberately.
import assert from "node:assert/strict";
import { streamText, jsonSchema } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createAiSdkExecutionGuard, createAiSdkExecutionLock } from "prefix-safe-json";
import { createAjvValidator } from "prefix-safe-json/ajv";

const schema = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"], additionalProperties: false,
};
const values = [{ message: "first" }, { message: "second" }];
const fixtureValidator = createAjvValidator(schema);
for (const value of values) assert.equal(fixtureValidator.validate(value).valid, true);

function createModel(duplicateId) {
  const parts = [{ type: "stream-start", warnings: [] }];
  for (let index = 0; index < values.length; index++) {
    const id = duplicateId ? "call_0" : `call_${index}`;
    const input = JSON.stringify(values[index]);
    parts.push(
      { type: "tool-input-start", id, toolName: "record_message" },
      { type: "tool-input-delta", id, delta: input },
      { type: "tool-input-end", id },
      { type: "tool-call", toolCallId: id, toolName: "record_message", input },
    );
  }
  parts.push({
    type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
  });
  return new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  }) }) });
}

async function run(duplicateId, guarded) {
  const callbacks = { execute: 0, onInputStart: 0, onInputDelta: 0, onInputAvailable: 0 };
  const effects = [];
  const definitions = { record_message: {
    description: "Record a harmless in-memory message", inputSchema: jsonSchema(schema),
    execute: async input => { callbacks.execute++; effects.push(input); return "recorded"; },
    onInputStart: () => { callbacks.onInputStart++; },
    onInputDelta: () => { callbacks.onInputDelta++; },
    onInputAvailable: () => { callbacks.onInputAvailable++; },
  } };
  const result = streamText({
    model: createModel(duplicateId), prompt: "Record both messages.",
    tools: guarded ? createAiSdkExecutionLock(definitions) : definitions,
  });
  const guard = guarded ? createAiSdkExecutionGuard({ schemas: { record_message: schema } }) : undefined;
  const errors = [];
  const starts = [];
  const deltas = [];
  for await (const part of result.fullStream) {
    if (part.type === "error" || part.type === "tool-error") errors.push(part);
    if (part.type === "tool-input-start") starts.push(part.id);
    if (part.type === "tool-input-delta") deltas.push(part.delta);
    guard?.push(part);
  }
  assert.deepEqual(errors, [], "The SDK must accept the authored call inputs.");
  assert.deepEqual(starts, duplicateId ? ["call_0", "call_0"] : ["call_0", "call_1"]);
  assert.deepEqual(deltas, values.map(value => JSON.stringify(value)), "Original deltas must reach the guard unchanged.");
  const final = guard?.finish();
  if (guarded) {
    assert.deepEqual(effects, [], "No effect before caller-owned authority.");
    assert.deepEqual(callbacks, { execute: 0, onInputStart: 0, onInputDelta: 0, onInputAvailable: 0 });
    for (const call of final.decisions) {
      const authority = guard.takeDecision(call.internalId);
      if (authority) effects.push(authority.value);
      assert.equal(guard.takeDecision(call.internalId), undefined, "Authority must remain one-shot.");
    }
    if (duplicateId) {
      assert.equal(final.decisions.length, 1, "An ambiguous identity is refused, never split into invented identities.");
      assert.equal(final.decisions[0].action, "reject");
      assert.equal(final.decisions[0].reason, "protocol_violation");
      assert.equal(final.decisions[0].evidence.structurallyComplete, true);
    } else {
      assert.equal(final.decisions.length, 2);
      assert.ok(final.decisions.every(call => call.action === "execute"));
    }
  } else {
    assert.equal(callbacks.execute, 2, "The native control must genuinely execute both calls.");
    assert.ok(callbacks.onInputStart > 0 && callbacks.onInputDelta > 0 && callbacks.onInputAvailable > 0);
  }
  assert.deepEqual(effects, guarded && duplicateId ? [] : values);
  return {
    effects: effects.length, callbacks,
    decisions: final?.decisions.map(({ action, reason }) => ({ action, reason })) ?? [],
  };
}

for (const duplicateId of [false, true]) {
  const native = await run(duplicateId, false);
  const psj = await run(duplicateId, true);
  console.log(JSON.stringify({ scenario: duplicateId ? "duplicate-call-id" : "distinct-call-ids", native, psj }));
}
console.log("PASS: native / PSJ effects = 2 / 2 for distinct IDs, 2 / 0 for duplicate IDs.");
console.log("Fixture comparison only: no WorkflowAgent integration, ID repair, or result-pairing fix is provided.");
