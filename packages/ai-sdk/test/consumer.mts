import { createGuardedChat } from "psj-ai-sdk";
import { dynamicTool, jsonSchema, stepCountIs, tool } from "ai";
import { z } from "zod";
import { createFileRecorder, replayRecording } from "psj-ai-sdk/recording";

const chat = createGuardedChat({ name: "example", baseURL: "https://fixture.invalid/v1" });
const recordedChat = createGuardedChat({ name: "recorded", baseURL: "https://fixture.invalid/v1", textStreaming: "buffered",
  onCapture: createFileRecorder({ directory: ".psj/captures" }) });
void recordedChat;
const replay = replayRecording(".psj/captures/example/recording.json");
void replay;
createGuardedChat({ name: "routed", baseURL: "https://fixture.invalid/v1", queryParams: { route: "local" }, includeUsage: true });
const tools = {
  record: tool({ inputSchema: z.object({ message: z.string() }).strict(), execute: async input => input.message.length }),
};
const result = chat({ model: "fixture", tools, prompt: "Record a message", stopWhen: stepCountIs(3) });
const text: PromiseLike<string> = result.text;
void text;
chat({ model: "fixture", tools, prompt: "x", instructions: "Be concise", reasoning: "none", topP: 0.9,
  prepareStep: ({ messages, stepNumber }) => ({ messages, activeTools: stepNumber === 0 ? ["record"] : [], temperature: 0 }) });
const calls = await result.toolCalls;
const runtimeTools = { external: dynamicTool({ inputSchema: jsonSchema({ type: "object" }), execute: async input => input }) };
const runtimeResult = chat({ model: "fixture", tools: runtimeTools, prompt: "Run external", prepareStep: () => ({ activeTools: ["external"] }) });
for (const call of await runtimeResult.toolCalls) {
  const input: unknown = call.input;
  void input;
}
for (const call of calls) {
  if (call.dynamic) continue;
  const message: string = call.input.message;
  void message;
}
// @ts-expect-error A prompt or messages is required.
chat({ model: "fixture", tools });
// @ts-expect-error Arbitrary model replacement bypasses the captured transport.
chat({ model: "fixture", tools, prompt: "x", prepareStep: () => ({ model: "other" }) });
// @ts-expect-error Even a hook selecting valid tools cannot replace the model.
chat({ model: "fixture", tools, prompt: "x", prepareStep: () => ({ activeTools: ["record"], model: "other" }) });
// @ts-expect-error Only the documented streaming modes are accepted.
createGuardedChat({ name: "bad", baseURL: "https://fixture.invalid/v1", textStreaming: "eager" });
