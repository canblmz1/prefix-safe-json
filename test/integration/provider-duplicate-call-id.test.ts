import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";

const args = '{"message":"hello"}';
const responsesEvents = (ids: string[]) => [
  ...ids.flatMap((id, index) => [
    { type: "response.output_item.added", output_index: index,
      item: { type: "function_call", id: `item_${index}`, call_id: id, name: "record", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: `item_${index}`, delta: args },
    { type: "response.function_call_arguments.done", item_id: `item_${index}`, arguments: args },
    { type: "response.output_item.done", item: { type: "function_call", id: `item_${index}`, call_id: id, name: "record", arguments: args } },
  ]),
  { type: "response.completed", response: { status: "completed" } },
];
const anthropicEvents = (ids: string[]) => [
  ...ids.flatMap((id, index) => [
    { type: "content_block_start", index, content_block: { type: "tool_use", id, name: "record", input: {} } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: args } },
    { type: "content_block_stop", index },
  ]),
  { type: "message_delta", delta: { stop_reason: "tool_use" } }, { type: "message_stop" },
];

describe.each(["responses", "anthropic"] as const)("%s duplicate IDs through the installed official SDK", protocol => {
  async function run(ids: string[]) {
    const events = protocol === "responses" ? responsesEvents(ids) : anthropicEvents(ids);
    const sse = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    const options = { apiKey: "fixture-not-a-real-credential", baseURL: "https://fixture.invalid", maxRetries: 0,
      fetch: async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }) };
    const stream = protocol === "responses"
      ? await new OpenAI(options).responses.create({ model: "fixture", input: "fixture", stream: true })
      : await new Anthropic(options).messages.create({ model: "fixture", max_tokens: 128,
        messages: [{ role: "user", content: "fixture" }], stream: true });
    const adapter = protocol === "responses" ? new OpenAIStreamAdapter() : new AnthropicStreamAdapter();
    const gate = createToolCallExecutionGate();
    const received = [];
    for await (const raw of stream) {
      received.push(raw);
      for (const event of adapter.push(raw)) gate.push(event);
    }
    expect(received).toEqual(events);
    for (const event of adapter.finish()) gate.push(event);
    const final = gate.finish();
    expect(final.decisions).toHaveLength(ids.length);
    const authorities = final.decisions.map(d => gate.takeDecision(d.internalId));
    for (const d of final.decisions) expect(gate.takeDecision(d.internalId)).toBeUndefined();
    return { final, authorities };
  }

  it("rejects colliding IDs without revoking an unrelated call", async () => {
    const { final, authorities } = await run(["shared", "shared", "other"]);
    expect(final.decisions.map(d => [d.action, d.reason])).toEqual([
      ["reject", "protocol_violation"], ["reject", "protocol_violation"], ["execute", "complete"],
    ]);
    expect(authorities.map(Boolean)).toEqual([false, false, true]);
  });

  it("rejects all three calls when an ID is reused three times", async () => {
    const { final, authorities } = await run(["shared", "shared", "shared"]);
    expect(authorities).toEqual([undefined, undefined, undefined]);
    expect(final.diagnostics.filter(d => d.code === "E_DUPLICATE_TOOL_CALL_ID")).toHaveLength(3);
  });

  it("grants each distinct call once and isolates separate response instances", async () => {
    for (let iteration = 0; iteration < 2; iteration++) {
      const { authorities } = await run(["first", "second"]);
      expect(authorities.map(a => a?.value)).toEqual([{ message: "hello" }, { message: "hello" }]);
    }
  });
});
