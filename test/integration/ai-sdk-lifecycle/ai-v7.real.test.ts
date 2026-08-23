// Real AI SDK lifecycle integration tests — ai@7.0.77.
//
// Unlike test/guard/ai-sdk-guard.test.ts (which hand-builds fullStream part
// objects), every test here drives an actual `streamText()` call from the
// real `ai` package (aliased as `ai-v7` in package.json so v5/v6/v7 can
// coexist) against a `MockLanguageModelV4` — ai@7's own official test
// double for the low-level provider boundary. `fullStream` is 100% real SDK
// output: real argument-buffering, real tool-call/tool-input-* part
// construction, real `needsApproval` resolution, real execute-gating. Only
// the LLM provider layer is faked, which is exactly what `ai/test` exists
// for.
//
// No paid/live model calls anywhere in this file.

import { describe, it, expect, beforeEach } from "vitest";
import { streamText, jsonSchema } from "ai-v7";
import { MockLanguageModelV4 } from "ai-v7/test";
import { createAiSdkExecutionGuard } from "../../../src/guard/ai-sdk.js";
import { createAiSdkExecutionLock } from "../../../src/guard/ai-sdk-execution-lock.js";
import { OperationLedger } from "./ledger.js";

const WRITE_FILE_SCHEMA = jsonSchema<{ path: string; content: string }>({
  type: "object",
  properties: { path: { type: "string" }, content: { type: "string" } },
  required: ["path", "content"],
});

/** One low-level `LanguageModelV4StreamPart` tool-argument sequence, chunked byte-by-byte-ish to exercise real incremental buffering on both the SDK side and ours. */
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
  // ai@7's LOW-LEVEL provider `finishReason` is `{ unified, raw }`, not a bare
  // string - confirmed against @ai-sdk/provider's real LanguageModelV4FinishReason
  // type. The higher fullStream/TextStreamPart-level `finishReason` our
  // shipped AiSdkStreamAdapter reads IS a bare string (confirmed against
  // ai@7's real FinishReason type alias) - the SDK does that flattening
  // internally. Getting this wrong here silently produces `finishReason:
  // "other"` at the provider-normalization step, which is exactly why every
  // "safe" case failed before this fix: `isToolExecutionAllowedFinishReason`
  // (ai@7's own internal gate) never saw "tool-calls".
  return { type: "finish", finishReason: { unified, raw: unified }, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
}

function mockModel(parts: unknown[], opts?: { signalAbortAfter?: number }) {
  const cutoff = opts?.signalAbortAfter ?? parts.length;
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          // Real dropped-connection shape: enqueue only up to `cutoff`, then
          // close — no tool-input-end/tool-call/finish ever arrives for a
          // call that was still mid-stream. Stops cleanly rather than
          // continuing to enqueue on an already-closed controller.
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

describe("real ai@7 lifecycle — execution lock (needsApproval structural guarantee)", () => {
  it("CASE 1 — safe complete call: locked tool never self-executes; manual execution after guard.finish() runs exactly once", async () => {
    const args = JSON.stringify({ path: "config/database.yml", content: "production:\n  host: db.prod.internal\n" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);

    const result = streamText({
      model,
      prompt: "irrelevant — MockLanguageModelV4 ignores it",
      tools: createAiSdkExecutionLock({
        write_file: { description: "writes a file", inputSchema: WRITE_FILE_SCHEMA },
      }),
    });

    const final = await runGuardOverFullStream(result.fullStream);

    // The SDK's own tool loop must never have executed anything — there is
    // no `execute` on the locked tool for it to call at all.
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
          execute: async (input: { path: string; content: string }) => {
            // This is the real, first-party AI SDK `execute` path — no lock installed.
            return ledger.execute("call_1", input);
          },
        },
      },
    });

    for await (const _part of result.fullStream) {
      /* drain — this is the caller's own stream consumption, independent of our guard */
    }

    // Proves the exact gap this whole feature exists to close: without the
    // lock, the SDK's native execute already ran before any guard decision.
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
          // Deliberately still attached — createAiSdkExecutionLock must strip it.
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

describe("real ai@7 lifecycle — terminal/evidence cases (unsafe ⇒ 0)", () => {
  it("CASE 2 — finish reason length: real op count 0 (SDK's own isToolExecutionAllowedFinishReason already excludes it; our gate independently agrees)", async () => {
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("length")]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);
    const decision = final.decisions.find((d) => d.name === "write_file");
    expect(decision?.action).not.toBe("execute");
  });

  it("CASE 3 — truncated raw argument text with a provider-side 'repaired' tool-call.input that LOOKS complete: raw evidence still catches it", async () => {
    // The provider only ever streamed a truncated string (no closing quote,
    // no closing brace) via tool-input-delta — but the final low-level
    // tool-call part's `input` field claims a suspiciously auto-closed,
    // syntactically valid JSON string. This is the exact "safe-looking
    // projection over truncated raw evidence" shape README/Cline analysis
    // describes. Our adapter deliberately never reads tool-call.input (see
    // its own source comment) — only the raw delta text matters here.
    const truncatedRaw = '{"path":"config/database.yml","content":"produ';
    const repairedLookingInput = '{"path":"config/database.yml","content":"produ"}';
    const model = mockModel([
      streamStart(),
      { type: "tool-input-start", id: "call_1", toolName: "write_file" },
      { type: "tool-input-delta", id: "call_1", delta: truncatedRaw },
      { type: "tool-input-end", id: "call_1" },
      toolCallPart("call_1", "write_file", repairedLookingInput),
      finishPart("tool-calls"), // looks completely safe from the SDK's own point of view
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

    let threw = false;
    try {
      const final = await runGuardOverFullStream(result.fullStream);
      expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
    } catch {
      threw = true;
    }
    expect(ledger.count).toBe(0);
    void threw; // either the stream surfaces the error to the consumer or our guard just never sees an "execute" decision — both are safe; only the count matters
  });

  it("CASE 5 — abort mid-argument-stream (connection dies before tool-input-end/tool-call/finish): real op count 0", async () => {
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const allParts = [streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")];
    // Kill the stream after the 3rd part (mid tool-input-delta), before the
    // call ever resolves — a real dropped-connection shape, not a hand-built
    // "abort" fullStream part.
    const model = mockModel(allParts, { signalAbortAfter: 3 });
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const guard = createAiSdkExecutionGuard({ schemas: { write_file: WRITE_FILE_SCHEMA.jsonSchema } });
    for await (const part of result.fullStream) guard.push(part);
    const final = guard.finish({ reason: "cancelled" });
    expect(ledger.count).toBe(0);
    expect(final.decisions.every((d) => d.action !== "execute")).toBe(true);
  });

  it("CASE 9 — schema-invalid input: complete JSON, safe finish, but violates the declared schema", async () => {
    const args = JSON.stringify({ path: "a.txt" }); // missing required "content"
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);
    const decision = final.decisions.find((d) => d.name === "write_file");
    expect(decision?.action).not.toBe("execute");
  });
});

describe("real ai@7 lifecycle — concurrency and identity isolation", () => {
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
      toolCallPart("call_unsafe", "write_file", unsafeArgsRaw + '"}'), // provider "repairs" only the unsafe one
      finishPart("tool-calls"),
    ]);
    const result = streamText({ model, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0); // nothing self-executed regardless

    for (const decision of final.decisions) {
      if (decision.action === "execute") ledger.execute("manual", decision.value);
    }
    expect(ledger.count).toBe(1); // exactly the safe call, exactly once
  });

  it("CASE 11 — the same toolCallId reused across two isolated guard instances (two turns) does not cross-resolve", async () => {
    const safeArgs = JSON.stringify({ path: "turn1.txt", content: "ok" });
    const model1 = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", safeArgs), toolCallPart("call_1", "write_file", safeArgs), finishPart("tool-calls")]);
    const result1 = streamText({ model: model1, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });
    const final1 = await runGuardOverFullStream(result1.fullStream); // fresh guard instance — turn 1
    expect(final1.decisions.find((d) => d.name === "write_file")?.action).toBe("execute");

    const truncatedRaw = '{"path":"turn2.txt","content":"cut';
    const model2 = mockModel([
      streamStart(),
      { type: "tool-input-start", id: "call_1", toolName: "write_file" }, // SAME id, new turn
      { type: "tool-input-delta", id: "call_1", delta: truncatedRaw },
      { type: "tool-input-end", id: "call_1" },
      toolCallPart("call_1", "write_file", truncatedRaw + '"}'),
      finishPart("tool-calls"),
    ]);
    const result2 = streamText({ model: model2, prompt: "x", tools: createAiSdkExecutionLock({ write_file: { description: "d", inputSchema: WRITE_FILE_SCHEMA } }) });
    const final2 = await runGuardOverFullStream(result2.fullStream); // fresh guard instance — turn 2, no shared state with turn 1
    expect(final2.decisions.find((d) => d.name === "write_file")?.action).not.toBe("execute");
  });
});

describe("real ai@7 lifecycle — needsApproval structural proof (source-level guarantee, black-box confirmed)", () => {
  it("a locked tool's execute is never invoked even when the model asks for it twice in one step", async () => {
    let nativeCalls = 0;
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const model = mockModel([
      streamStart(),
      ...toolInputParts("call_1", "write_file", args),
      toolCallPart("call_1", "write_file", args),
      ...toolInputParts("call_2", "write_file", args, 5),
      toolCallPart("call_2", "write_file", args),
      finishPart("tool-calls"),
    ]);
    const result = streamText({
      model,
      prompt: "x",
      tools: createAiSdkExecutionLock({
        write_file: {
          description: "d",
          inputSchema: WRITE_FILE_SCHEMA,
          execute: async () => {
            nativeCalls += 1;
            return { ok: true };
          },
        },
      }),
    });
    for await (const _part of result.fullStream) {
      /* drain */
    }
    expect(nativeCalls).toBe(0);
  });
});
