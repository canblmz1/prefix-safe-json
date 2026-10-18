import assert from "node:assert/strict";
import { stepCountIs } from "ai";
import { z } from "zod";
import { createGuardedChat } from "psj-ai-sdk";

const chunk = (delta, finish_reason = null) => ({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] });
const call = (index, id, message) => ({ index, id, type: "function", function: { name: "record", arguments: JSON.stringify({ message }) } });
const sse = events => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
const answer = sse([chunk({ content: "Recorded alpha and beta." }), chunk({}, "stop")]);

for (const scenario of ["complete", "duplicate-id", "token-limit", "invalid-sibling"]) {
  const requests = [], effects = [], errors = [];
  const body = sse([
    chunk({ role: "assistant", tool_calls: [call(0, "a", "alpha"), call(1, scenario === "duplicate-id" ? "a" : "b", scenario === "invalid-sibling" ? 42 : "beta")] }),
    chunk({}, scenario === "token-limit" ? "length" : "tool_calls"),
  ]);
  const chat = createGuardedChat({
    name: "local-fixture", baseURL: "https://fixture.invalid/v1",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      assert.ok(requests.length <= 2);
      return new Response(requests.length === 1 ? body : answer, { headers: { "content-type": "text/event-stream" } });
    },
  });
  // Application integration: normal schemas/callbacks, with SDK-owned results
  // and continuation. Everything above is only the offline provider fixture.
  const result = chat({
    model: "fixture",
    prompt: "Record alpha and beta, then summarize.",
    tools: { record: {
      inputSchema: z.object({ message: z.string() }).strict(),
      execute: async ({ message }) => { effects.push(message); return { recorded: message }; },
    } },
    stopWhen: stepCountIs(3),
    onError: ({ error }) => errors.push(error),
  });
  await result.consumeStream();
  if (scenario === "complete") {
    assert.deepEqual(effects, ["alpha", "beta"]);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].messages.filter(m => m.role === "tool").map(m => m.tool_call_id), ["a", "b"]);
    assert.equal(await result.text, "Recorded alpha and beta.");
    assert.equal(errors.length, 0);
  } else {
    assert.deepEqual(effects, []);
    assert.equal(requests.length, 1);
    assert.ok(errors.length > 0);
  }
  console.log(JSON.stringify({ scenario, requests: requests.length, effects, errors: errors.length }));
}
console.log("PASS: native callbacks and paired continuation; refused batches have zero effects.");
