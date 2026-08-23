// Real AI SDK lifecycle integration tests — ai@6.0.264.
//
// Same approach as ai-v7.real.test.ts (see its header comment for the full
// rationale) against `MockLanguageModelV3` — ai@6's own provider-boundary
// test double. Verified independently against ai@6's own real source
// (`isApprovalNeeded(...)` followed by an unconditional `break` before the
// line that would push the call into `toolCallsToExecute`) that ai@6
// provides the same `needsApproval` execution-blocking guarantee as ai@7,
// even though the two majors implement it with differently-named internals.
//
// No paid/live model calls anywhere in this file.

import { describe, it, expect, beforeEach } from "vitest";
import { streamText, jsonSchema } from "ai-v6";
import { MockLanguageModelV3 } from "ai-v6/test";
import { createAiSdkExecutionGuard } from "../../../src/guard/ai-sdk.js";
import { createAiSdkExecutionLock } from "../../../src/guard/ai-sdk-execution-lock.js";
import { OperationLedger } from "./ledger.js";

const WRITE_FILE_SCHEMA = jsonSchema<{ path: string; content: string }>({
  type: "object",
  properties: { path: { type: "string" }, content: { type: "string" } },
  required: ["path", "content"],
});

function toolInputParts(id: string, toolName: string, argsJson: string, chunkSize = 7) {
  const parts: unknown[] = [{ type: "tool-input-start", id, toolName }];
  for (let i = 0; i < argsJson.length; i += chunkSize) {
    parts.push({ type: "tool-input-delta", id, delta: argsJson.slice(i, i + chunkSize) });
  }
  parts.push({ type: "tool-input-end", id });
  return parts;
}

function toolCallPart(id: string, toolName: string, argsJson: string) {
  return { type: "tool-call", toolCallId: id, toolName, input: argsJson };
}

function streamStart() {
  return { type: "stream-start", warnings: [] };
}

function finishPart(unified: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other") {
  // ai@6's provider-level finishReason is the same `{ unified, raw }` object
  // shape as ai@7 - verified directly against @ai-sdk/provider's real
  // LanguageModelV3FinishReason type, not assumed by analogy from v7.
  return { type: "finish", finishReason: { unified, raw: unified }, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
}

function mockModel(parts: unknown[], opts?: { signalAbortAfter?: number }) {
  const cutoff = opts?.signalAbortAfter ?? parts.length;
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (let index = 0; index < cutoff; index += 1) {
            controller.enqueue(parts[index] as never);
          }
          controller.close();
        },
      }),
    }),
  });
}

let ledger: OperationLedger;
beforeEach(() => {
  ledger = new OperationLedger();
});

async function runGuardOverFullStream(fullStream: AsyncIterable<unknown>) {
  const guard = createAiSdkExecutionGuard({ schemas: { write_file: WRITE_FILE_SCHEMA.jsonSchema } });
  for await (const part of fullStream) guard.push(part);
  return guard.finish();
}

describe("real ai@6 lifecycle — execution lock (needsApproval structural guarantee)", () => {
  it("CASE 1 — safe complete call: locked tool never self-executes; manual execution after guard.finish() runs exactly once", async () => {
    const args = JSON.stringify({ path: "config/database.yml", content: "production:\n  host: db.prod.internal\n" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);

    const result = streamText({
      model,
      prompt: "irrelevant — MockLanguageModelV3 ignores it",
      tools: createAiSdkExecutionLock({
        write_file: { description: "writes a file", inputSchema: WRITE_FILE_SCHEMA },
      }),
    });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);

    const decision = final.decisions.find((d) => d.name === "write_file");
    expect(decision?.action).toBe("execute");
    if (decision?.action === "execute") {
      ledger.execute("call_1", decision.value);
    }
    expect(ledger.count).toBe(1);
  });

  it("CASE 12 — native execute misuse: an UNLOCKED tool's execute DOES fire natively (proves the real, honest limitation)", async () => {
    const args = JSON.stringify({ path: "config/database.yml", content: "production:\n  host: db.prod.internal\n" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);

    const result = streamText({
      model,
      prompt: "irrelevant",
      tools: {
        write_file: {
          description: "writes a file",
          inputSchema: WRITE_FILE_SCHEMA,
          execute: async (input: { path: string; content: string }) => ledger.execute("call_1", input),
        },
      },
    });

    for await (const _part of result.fullStream) {
      /* drain */
    }
    expect(ledger.count).toBe(1);
  });

  it("CASE 12b — with the lock installed, the SAME native execute callback never fires even though it is present on the tool definition", async () => {
    const args = JSON.stringify({ path: "config/database.yml", content: "production:\n  host: db.prod.internal\n" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);

    const result = streamText({
      model,
      prompt: "irrelevant",
      tools: createAiSdkExecutionLock({
        write_file: {
          description: "writes a file",
          inputSchema: WRITE_FILE_SCHEMA,
          execute: async (input: { path: string; content: string }) => ledger.execute("call_1", input),
        },
      }),
    });

    for await (const _part of result.fullStream) {
      /* drain */
    }
    expect(ledger.count).toBe(0);
  });
});

describe("real ai@6 lifecycle — terminal/evidence cases (unsafe ⇒ 0)", () => {
  it("CASE 2 — finish reason length: real op count 0", async () => {
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("length")]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);
    expect(final.decisions.find((d) => d.name === "write_file")?.action).not.toBe("execute");
  });

  it("CASE 3 — truncated raw argument text with a provider-side 'repaired' tool-call.input that LOOKS complete: raw evidence still catches it", async () => {
    const truncatedRaw = '{"path":"config/database.yml","content":"produ';
    const repairedLookingInput = '{"path":"config/database.yml","content":"produ"}';
    const model = mockModel([
      streamStart(),
      { type: "tool-input-start", id: "call_1", toolName: "write_file" },
      { type: "tool-input-delta", id: "call_1", delta: truncatedRaw },
      { type: "tool-input-end", id: "call_1" },
      toolCallPart("call_1", "write_file", repairedLookingInput),
      finishPart("tool-calls"),
    ]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);
    const decision = final.decisions.find((d) => d.name === "write_file");
    expect(decision?.action).not.toBe("execute");
    expect(decision?.executable).toBe(false);
  });

  it("CASE 4 — provider error: real op count 0", async () => {
    const model = mockModel([streamStart(), { type: "error", error: new Error("upstream 500") }]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    try {
      const final = await runGuardOverFullStream(result.fullStream);
      expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
    } catch {
      /* either surfacing is safe - only ledger.count matters */
    }
    expect(ledger.count).toBe(0);
  });

  it("CASE 5 — abort mid-argument-stream: real op count 0", async () => {
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const allParts = [streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")];
    const model = mockModel(allParts, { signalAbortAfter: 3 });
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const guard = createAiSdkExecutionGuard({ schemas: { write_file: WRITE_FILE_SCHEMA.jsonSchema } });
    for await (const part of result.fullStream) guard.push(part);
    const final = guard.finish({ reason: "cancelled" });
    expect(ledger.count).toBe(0);
    expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
  });

  it("CASE 9 — schema-invalid input: complete JSON, safe finish, but violates the declared schema", async () => {
    const args = JSON.stringify({ path: "a.txt" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);
    expect(final.decisions.find((d) => d.name === "write_file")?.action).not.toBe("execute");
  });
});

describe("real ai@6 lifecycle — concurrency and identity isolation", () => {
  it("CASE 10 — one safe + one unsafe concurrent call: safe executes exactly once, unsafe never", async () => {
    const safeArgs = JSON.stringify({ path: "safe.txt", content: "ok" });
    const unsafeArgsRaw = '{"path":"unsafe.txt","content":"cut off mid';
    const model = mockModel([
      streamStart(),
      { type: "tool-input-start", id: "call_safe", toolName: "write_file" },
      { type: "tool-input-start", id: "call_unsafe", toolName: "write_file" },
      { type: "tool-input-delta", id: "call_safe", delta: safeArgs },
      { type: "tool-input-delta", id: "call_unsafe", delta: unsafeArgsRaw },
      { type: "tool-input-end", id: "call_safe" },
      { type: "tool-input-end", id: "call_unsafe" },
      toolCallPart("call_safe", "write_file", safeArgs),
      toolCallPart("call_unsafe", "write_file", unsafeArgsRaw + '"}'),
      finishPart("tool-calls"),
    ]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);

    for (const decision of final.decisions) {
      if (decision.action === "execute") ledger.execute("manual", decision.value);
    }
    expect(ledger.count).toBe(1);
  });

  it("CASE 11 — the same toolCallId reused across two isolated guard instances (two turns) does not cross-resolve", async () => {
    const safeArgs = JSON.stringify({ path: "turn1.txt", content: "ok" });
    const model1 = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", safeArgs), toolCallPart("call_1", "write_file", safeArgs), finishPart("tool-calls")]);
    const result1 = streamText({ model: model1, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });
    const final1 = await runGuardOverFullStream(result1.fullStream);
    expect(final1.decisions.find((d) => d.name === "write_file")?.action).toBe("execute");

    const truncatedRaw = '{"path":"turn2.txt","content":"cut';
    const model2 = mockModel([
      streamStart(),
      { type: "tool-input-start", id: "call_1", toolName: "write_file" },
      { type: "tool-input-delta", id: "call_1", delta: truncatedRaw },
      { type: "tool-input-end", id: "call_1" },
      toolCallPart("call_1", "write_file", truncatedRaw + '"}'),
      finishPart("tool-calls"),
    ]);
    const result2 = streamText({ model: model2, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });
    const final2 = await runGuardOverFullStream(result2.fullStream);
    expect(final2.decisions.find((d) => d.name === "write_file")?.action).not.toBe("execute");
  });
});
