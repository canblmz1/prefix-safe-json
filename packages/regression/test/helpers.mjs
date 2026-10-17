import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export function chunk(delta, finish_reason = null) {
  return { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model",
    choices: [{ index: 0, delta, finish_reason }] };
}

export function sse(events, done = true) {
  return events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + (done ? "data: [DONE]\n\n" : "");
}

export function call(index, id, name, args) {
  return { index, id, type: "function", function: { name, arguments: args } };
}

export async function writeExample(directory) {
  await mkdir(directory, { recursive: true });
  const schema = { type: "object", required: ["message"], additionalProperties: false, properties: { message: { type: "string" } } };
  const bodies = {
    "complete.sse": sse([chunk({ role: "assistant", tool_calls: [call(0, "call_a", "record", '{"message":"alpha"}')] }), chunk({}, "tool_calls")]),
    "answer.sse": sse([chunk({ role: "assistant", content: "Recorded α and β." }), chunk({}, "stop")]),
    "length.sse": sse([chunk({ role: "assistant", tool_calls: [call(0, "call_a", "record", '{"message":"alpha"}')] }), chunk({}, "length")]),
    "interleaved.sse": sse([
      chunk({ role: "assistant", tool_calls: [call(0, "call_a", "record", '{"message":"al'), call(1, "call_b", "record", '{"message":"be')] }),
      chunk({ tool_calls: [{ index: 1, function: { arguments: 'ta"}' } }, { index: 0, function: { arguments: 'pha"}' } }] }),
      chunk({}, "tool_calls"),
    ]),
    "duplicate.sse": sse([chunk({ role: "assistant", tool_calls: [call(0, "call_a", "record", '{"message":"alpha"}'), call(1, "call_a", "record", '{"message":"beta"}')] }), chunk({}, "tool_calls")]),
    "missing-terminal.sse": sse([chunk({ role: "assistant", tool_calls: [call(0, "call_a", "record", '{"message":"alpha"}')] })], false),
    "malformed.sse": sse([chunk({ role: "assistant", tool_calls: [call(0, "call_a", "record", '{"message":"al')] }), chunk({}, "tool_calls")]),
  };
  for (const [name, body] of Object.entries(bodies)) await writeFile(join(directory, name), body);
  const cases = [
    ["complete", "complete.sse", true],
    ["interleaved", "interleaved.sse", true],
    ["token-limit", "length.sse", false],
    ["duplicate-id", "duplicate.sse", true],
    ["missing-terminal", "missing-terminal.sse", true],
    ["malformed-arguments", "malformed.sse", true],
  ].map(([id, body, continuation]) => ({ id, ...(id === "complete" ? { positiveControl: true } : {}), provenance: { classification: "authored", note: "Synthetic raw-transport regression control; not a production incident." },
    responses: [{ body, chunkBytes: 13 }, ...(continuation ? [{ body: "answer.sse", chunkBytes: 7 }] : [])] }));
  const fixture = { formatVersion: 1, protocol: "openai-chat-completions-sse", tools: { record: { inputSchema: schema, result: { recorded: true } } }, cases };
  await writeFile(join(directory, "suite.json"), JSON.stringify(fixture, null, 2) + "\n");
  return fixture;
}
