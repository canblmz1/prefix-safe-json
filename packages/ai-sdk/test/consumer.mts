import { createGuardedChat } from "psj-ai-sdk";
import { stepCountIs, tool } from "ai";
import { z } from "zod";

const chat = createGuardedChat({ name: "example", baseURL: "https://fixture.invalid/v1" });
const tools = {
  record: tool({ inputSchema: z.object({ message: z.string() }).strict(), execute: async input => input.message.length }),
};
const result = chat({ model: "fixture", tools, prompt: "Record a message", stopWhen: stepCountIs(3) });
const text: PromiseLike<string> = result.text;
void text;
const calls = await result.toolCalls;
for (const call of calls) {
  if (call.dynamic) continue;
  const message: string = call.input.message;
  void message;
}
// @ts-expect-error A prompt or messages is required.
chat({ model: "fixture", tools });
// @ts-expect-error Arbitrary model replacement bypasses the captured transport.
chat({ model: "fixture", tools, prompt: "x", prepareStep: () => ({ model: "other" }) });
