// Real SDK and packed PSJ, authored model fixtures, harmless counters only.
import assert from "node:assert/strict";
import { streamText, type ModelMessage, type ToolResultPart } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { createAiSdkExecutionLock } from "prefix-safe-json";
import { createTypedAiSdkExecutionGuard } from "prefix-safe-json/standard-schema";

const inputSchema = z.object({ message: z.string() }).strict();
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
type Scenario = "complete" | "truncated" | "duplicate-id" | "cancelled" | "tool-error";

async function runScenario(scenario: Scenario) {
  let requests = 0;
  let sdkCallbacks = 0;
  let effectAttempts = 0;
  const effects: string[] = [];
  const signal = new AbortController();
  if (scenario === "cancelled") signal.abort();
  const ids = scenario === "duplicate-id" ? ["call-a", "call-a"] : ["call-a", "call-b"];
  const model = new MockLanguageModelV4({ doStream: async options => {
    requests++;
    if (requests === 2) {
      // The actual next model request must contain paired caller-owned
      // results. Guard decisions alone do not continue the conversation.
      const results = options.prompt.flatMap(message => message.role === "tool" ? message.content : [])
        .filter(part => part.type === "tool-result");
      assert.deepEqual(results.map(result => result.toolCallId), ids);
      assert.deepEqual(results.map(result => result.output), [
        { type: "json", value: { recorded: "alpha" } },
        { type: "json", value: { recorded: "beta" } },
      ]);
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({ type: "text-start", id: "answer" });
        controller.enqueue({ type: "text-delta", id: "answer", delta: "Recorded alpha and beta." });
        controller.enqueue({ type: "text-end", id: "answer" });
        controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage });
        controller.close();
      } }) };
    }
    assert.equal(requests, 1, "Unexpected extra model request");
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: "stream-start", warnings: [] });
      for (const [index, id] of ids.entries()) {
        const input = JSON.stringify({ message: index === 0 ? "alpha" : "beta" });
        controller.enqueue({ type: "tool-input-start", id, toolName: "record_message" });
        controller.enqueue({ type: "tool-input-delta", id, delta: input });
        controller.enqueue({ type: "tool-input-end", id });
        controller.enqueue({ type: "tool-call", toolCallId: id, toolName: "record_message", input });
      }
      controller.enqueue({ type: "finish", finishReason: {
        unified: scenario === "truncated" ? "length" : "tool-calls",
        raw: scenario === "truncated" ? "length" : "tool_calls",
      }, usage });
      controller.close();
    } }) };
  } });
  const tools = createAiSdkExecutionLock({ record_message: {
    inputSchema,
    execute: async () => { sdkCallbacks++; return "must not run"; },
    onInputAvailable: () => { sdkCallbacks++; },
  } });
  const messages: ModelMessage[] = [{ role: "user", content: "Record alpha and beta, then summarize." }];
  let text = "";
  let outcome: "complete" | "refused" | "cancelled" | "tool-error" = "refused";
  // The application owns this bounded loop, cancellation, dispatch and errors.
  // A fresh guard is scoped to exactly one physical model request.
  for (let round = 0; round < 3; round++) {
    if (signal.signal.aborted) { outcome = "cancelled"; break; }
    const guard = createTypedAiSdkExecutionGuard({ inputSchemas: { record_message: inputSchema } });
    const result = streamText({ model, messages, tools, abortSignal: signal.signal });
    for await (const part of result.fullStream) guard.push(part);
    const final = guard.finish();
    if (signal.signal.aborted) { outcome = "cancelled"; break; }
    if (final.decisions.length === 0) {
      if (await result.finishReason === "stop" && final.diagnostics.length === 0) {
        text = await result.text;
        outcome = text.length > 0 ? "complete" : "refused";
      }
      break;
    }
    // Application policy: the entire batch must have authority before any
    // tool runs. This is not a transaction or rollback guarantee.
    const authorities = final.decisions.map(d => guard.takeDecision(d.internalId));
    if (authorities.some(a => a === undefined)) break;
    const resultIds = authorities.map(a => a?.toolCallId);
    if (resultIds.some(id => id === undefined) || new Set(resultIds).size !== resultIds.length) break;
    const toolResults: ToolResultPart[] = [];
    let toolFailed = false;
    for (const authority of authorities) {
      if (!authority || !authority.toolCallId) { toolFailed = true; break; }
      if (signal.signal.aborted) { outcome = "cancelled"; toolFailed = true; break; }
      try {
        effectAttempts++;
        if (scenario === "tool-error") throw new Error("example tool failed");
        // TypeScript knows message is a string; no assertion or SDK projection.
        effects.push(authority.value.message);
        toolResults.push({ type: "tool-result", toolCallId: authority.toolCallId,
          toolName: authority.name, output: { type: "json", value: { recorded: authority.value.message } } });
      } catch {
        // No automatic retry: real tools can fail after a partial side effect.
        outcome = "tool-error"; toolFailed = true; break;
      }
      assert.equal(guard.takeDecision(authority.internalId), undefined);
    }
    if (toolFailed) break;
    messages.push(...(await result.response).messages, { role: "tool", content: toolResults });
  }
  assert.equal(sdkCallbacks, 0);
  if (scenario === "complete") {
    assert.deepEqual(effects, ["alpha", "beta"]);
    assert.equal(requests, 2);
    assert.equal(text, "Recorded alpha and beta.");
    assert.equal(outcome, "complete");
  } else {
    assert.deepEqual(effects, []);
    assert.equal(requests, scenario === "cancelled" ? 0 : 1);
    assert.equal(effectAttempts, scenario === "tool-error" ? 1 : 0);
    assert.equal(text, "");
  }
  console.log(JSON.stringify({ scenario, requests, effects, effectAttempts, sdkCallbacks, outcome, text }));
}

for (const scenario of ["complete", "truncated", "duplicate-id", "cancelled", "tool-error"] as const) {
  await runScenario(scenario);
}
console.log("PASS: typed raw inputs, paired results and caller-owned continuation; unsafe batches never continue.");
