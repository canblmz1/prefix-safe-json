import { describe, it, expect } from "vitest";
import { VercelAiIncrementalAdapter } from "../../adapters/vercel-ai/index.js";
import { LangChainIncrementalAdapter } from "../../adapters/langchain/index.js";
import { MastraToolStreamAdapter } from "../../adapters/mastra/index.js";
import { StagehandActionAdapter } from "../../adapters/stagehand/index.js";
import { GooseToolStreamAdapter } from "../../adapters/goose/index.js";

describe("Adoption Lab — Vercel AI SDK Adapter", () => {
  it("processes tool-call-delta incrementally without re-parsing full string", () => {
    const adapter = new VercelAiIncrementalAdapter();
    const c1 = adapter.processChunk({
      type: "tool-call-delta",
      toolCallId: "call_1",
      toolName: "weather",
      argsTextDelta: '{"city":"Tokyo',
    });
    expect(c1.experimental_stableArgs).toEqual({});

    const c2 = adapter.processChunk({
      type: "tool-call-delta",
      toolCallId: "call_1",
      toolName: "weather",
      argsTextDelta: '","unit":"celsius"}',
    });
    expect(c2.experimental_stableArgs).toEqual({ city: "Tokyo", unit: "celsius" });
  });
});

describe("Adoption Lab — LangChain.js Adapter", () => {
  it("buffers tool call chunks and returns stable arguments", () => {
    const adapter = new LangChainIncrementalAdapter();
    const r1 = adapter.pushChunk({ id: "call_lc", args: '{"expression":"2+' });
    expect(r1.stableArgs).toEqual({});

    const r2 = adapter.pushChunk({ id: "call_lc", args: '2"}' });
    expect(r2.stableArgs).toEqual({ expression: "2+2" });

    const finalCall = adapter.finalize("call_lc", "calculator");
    expect(finalCall.name).toBe("calculator");
    expect(finalCall.args).toEqual({ expression: "2+2" });
  });
});

describe("Adoption Lab — Mastra Adapter", () => {
  it("parses tool input deterministically without jsonrepair fabrication", () => {
    const adapter = new MastraToolStreamAdapter();
    const res = adapter.parseToolInput({
      toolName: "file_writer",
      callId: "call_m1",
      rawArgsString: '{"path":"/tmp/test.txt","content":"hello"}',
    });
    expect(res.executable).toBe(true);
    expect(res.args).toEqual({ path: "/tmp/test.txt", content: "hello" });
  });
});

describe("Adoption Lab — Stagehand Adapter", () => {
  it("extracts Playwright browser action parameters incrementally", () => {
    const adapter = new StagehandActionAdapter();
    adapter.pushDelta('{"selector":"#submit-btn');
    expect(adapter.getCommittedParameters()).toEqual({});

    adapter.pushDelta('"}');
    expect(adapter.getCommittedParameters()).toEqual({ selector: "#submit-btn" });

    const action = adapter.finalize("click");
    expect(action.actionName).toBe("click");
    expect(action.parameters).toEqual({ selector: "#submit-btn" });
  });
});

describe("Adoption Lab — Block Goose Adapter", () => {
  it("evaluates canExecute safely without try/catch exception polling", () => {
    const adapter = new GooseToolStreamAdapter();
    const v1 = adapter.pushDelta({
      callId: "g1",
      name: "bash",
      argumentsDelta: '{"command":"ls',
    });
    expect(v1.canExecute).toBe(false);

    const v2 = adapter.pushDelta({
      callId: "g1",
      name: "bash",
      argumentsDelta: ' -la"}',
    });
    expect(v2.canExecute).toBe(true);
    expect(v2.args).toEqual({ command: "ls -la" });
  });
});
