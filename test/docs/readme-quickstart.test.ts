import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MockLanguageModelV4 } from "ai-v7/test";

// Runs README.md's "Safe execution example" code block as written, so the
// example users copy first can't silently stop working again.

const here = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(here, ".generated");

const MODULE_MAP: Record<string, string> = {
  ai: "ai-v7",
  zod: "zod",
  "prefix-safe-json": "../../../src/index.ts",
  "prefix-safe-json/standard-schema": "../../../src/standard-schema.ts",
};

function readmeQuickstart(): string {
  const readme = readFileSync(join(here, "..", "..", "README.md"), "utf8").replace(/\r\n/g, "\n");
  const section = readme.split("\n## Safe execution example\n")[1];
  const block = section?.match(/```javascript\n([\s\S]*?)\n```/)?.[1];
  if (!block) throw new Error('README.md has no javascript block under "## Safe execution example"');
  return block;
}

function toRunnableModule(code: string): string {
  const withoutFs = code.replace(
    'import { writeFile } from "node:fs/promises";\n',
    "const { writeFile } = globalThis.__readmeQuickstart;\n",
  );
  const mapped = withoutFs.replace(/from "([^"]+)";/g, (_match, specifier: string) => {
    const target = MODULE_MAP[specifier];
    if (!target) throw new Error(`README quickstart imports an unmapped module: ${specifier}`);
    return `from ${JSON.stringify(target)};`;
  });
  return `const { model, prompt } = globalThis.__readmeQuickstart;\n${mapped}\n`;
}

function mockModel(argsJson: string, finishReason: string) {
  const parts = [
    { type: "stream-start", warnings: [] },
    { type: "tool-input-start", id: "call-1", toolName: "write_file" },
    { type: "tool-input-delta", id: "call-1", delta: argsJson },
    { type: "tool-input-end", id: "call-1" },
    { type: "tool-call", toolCallId: "call-1", toolName: "write_file", input: argsJson },
    {
      type: "finish",
      finishReason: { unified: finishReason, raw: finishReason },
      usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    },
  ];
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of parts) controller.enqueue(part as never);
          controller.close();
        },
      }),
    }),
  });
}

async function runQuickstart(caseName: string, argsJson: string, finishReason: string) {
  const writeFile = vi.fn(async () => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  (globalThis as Record<string, unknown>).__readmeQuickstart = {
    model: mockModel(argsJson, finishReason),
    prompt: "write the file",
    writeFile,
  };
  mkdirSync(generatedDir, { recursive: true });
  const file = join(generatedDir, `quickstart-${caseName}.mjs`);
  writeFileSync(file, toRunnableModule(readmeQuickstart()));
  await import(pathToFileURL(file).href);
  return { writeFile, warn };
}

afterAll(() => {
  rmSync(generatedDir, { recursive: true, force: true });
  delete (globalThis as Record<string, unknown>).__readmeQuickstart;
});

describe("README quickstart, executed as written", () => {
  it("writes the file for a complete, schema-valid tool call", async () => {
    const { writeFile } = await runQuickstart("valid", '{"path":"notes.txt","content":"hello"}', "tool-calls");
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledWith("notes.txt", "hello");
  });

  it("does not write a tool call that was cut off by the token limit", async () => {
    const { writeFile, warn } = await runQuickstart("truncated", '{"path":"notes.txt","content":"hel', "length");
    expect(writeFile).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^skipped write_file: reject \(/));
  });

  it("does not write a complete call that fails the schema", async () => {
    const { writeFile } = await runQuickstart("invalid", '{"path":"notes.txt","content":5}', "tool-calls");
    expect(writeFile).not.toHaveBeenCalled();
  });
});
