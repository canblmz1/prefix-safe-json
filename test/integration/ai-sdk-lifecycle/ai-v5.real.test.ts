// Real AI SDK lifecycle integration tests — ai@5.0.244.
//
// Same driving approach as ai-v6/v7 (see ai-v7.real.test.ts's header), but
// implementing the real `LanguageModelV2` interface directly rather than
// importing ai@5's own `MockLanguageModelV2` from "ai-v5/test": that barrel
// transitively requires `msw` at import time (confirmed - `Cannot find
// package 'msw'` when actually attempted), which this project has no other
// reason to depend on. The interface is small and fully known from
// @ai-sdk/provider's real published types (specificationVersion, provider,
// modelId, supportedUrls, doGenerate, doStream) - implementing it directly
// is not a simplification of what's under test, only of which class
// constructs the fake.
//
// ai@5 is architecturally different in one load-bearing way, verified
// directly against its own published type declarations before writing any
// of this file: it has NO `needsApproval`, no `tool-approval-request`, no
// `experimental_toolApprovalSecret` anywhere (a single unrelated JSDoc
// mention of the word "approval" in an unrelated pruning comment was the
// only match). `createAiSdkExecutionLock()` still stays useful here, but for
// a *different*, weaker reason than on v6/v7: it strips the caller's
// `execute` field unconditionally, so a locked tool on v5 has literally no
// `execute` for the SDK to call - the pre-existing documented "omit execute
// entirely" safe pattern, arrived at structurally rather than via an SDK-
// enforced approval gate. What it can NOT do on v5 - and this file exists to
// prove that honestly, not paper over it - is stop a tool definition that
// still carries a caller-attached `execute` from executing natively before
// this library's gate ever sees a decision. That gap is real on v5 and has
// no structural fix from this library; the existing `sdk_execution_observed`
// detection remains the only backstop, exactly as it was before this
// feature existed.
//
// No paid/live model calls anywhere in this file.

import { describe, it, expect, beforeEach } from "vitest";
import { streamText, jsonSchema } from "ai-v5";
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

function finishPart(finishReason: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" | "unknown") {
  // ai@5's provider-level finishReason is a PLAIN STRING - verified directly
  // against @ai-sdk/provider's real LanguageModelV2FinishReason type. This
  // is genuinely different from ai@6/ai@7's `{ unified, raw }` object shape;
  // getting this wrong the way the first draft of the v7 file did silently
  // produces finishReason "other" and every "safe" case fails for reasons
  // that have nothing to do with the thing under test.
  return { type: "finish", finishReason, usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
}

function mockModel(parts: unknown[], opts?: { signalAbortAfter?: number }) {
  const cutoff = opts?.signalAbortAfter ?? parts.length;
  // Minimal, spec-compliant LanguageModelV2 - see this file's header comment
  // for why this is hand-built rather than imported from "ai-v5/test".
  return {
    specificationVersion: "v2" as const,
    provider: "test-provider",
    modelId: "test-model",
    supportedUrls: {},
    doGenerate() {
      throw new Error("doGenerate() should never be called by streamText()");
    },
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            for (let index = 0; index < cutoff; index += 1) {
              controller.enqueue(parts[index] as never);
            }
            controller.close();
          },
        }),
      };
    },
  };
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

describe("real ai@5 lifecycle — no needsApproval mechanism exists (verified, not assumed)", () => {
  it("CASE 1 — safe complete call, execute omitted entirely (the pre-existing documented safe pattern): gate says execute, manual execution runs exactly once", async () => {
    const args = JSON.stringify({ path: "config/database.yml", content: "production:\n  host: db.prod.internal\n" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);

    const result = streamText({
      model,
      prompt: "irrelevant — MockLanguageModelV2 ignores it",
      tools: createAiSdkExecutionLock({ write_file: { description: "writes a file", inputSchema: WRITE_FILE_SCHEMA } }),
    });

    const final = await runGuardOverFullStream(result.fullStream);
    expect(ledger.count).toBe(0);
    const decision = final.decisions.find((d) => d.name === "write_file");
    expect(decision?.action).toBe("execute");
    if (decision?.action === "execute") ledger.execute("call_1", decision.value);
    expect(ledger.count).toBe(1);
  });

  it("createAiSdkExecutionLock still prevents native execution on v5 too — but only because it strips `execute`, not because `needsApproval` is honored (it isn't, on this major)", async () => {
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);
    const result = streamText({
      model,
      prompt: "x",
      tools: createAiSdkExecutionLock({
        write_file: {
          description: "d",
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

  it("CASE 12 — THE REAL, UNFIXED GAP: a raw tool definition with `execute` attached directly (bypassing createAiSdkExecutionLock) fires natively on v5, before any guard decision exists", async () => {
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

    // This is the honest, unfixable-on-v5 limitation this file exists to
    // document with real evidence, not a bug in this test.
    expect(ledger.count).toBe(1);
  });
});

describe("real ai@5 lifecycle — terminal/evidence cases still hold via raw-evidence gating (unsafe ⇒ 0, when execute is correctly omitted)", () => {
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
});

describe("real ai@5 lifecycle — P1: input-lifecycle callback neutralization (onInputStart/onInputDelta/onInputAvailable)", () => {
  // ai@5 has no needsApproval at all (already established above), so unlike
  // v6/v7 there is no "needsApproval alone isn't enough" framing here - the
  // callback trio was always unconditional on this major. Verified directly
  // against ai@5's own runtime source, independent of v6/v7.
  function freshCounts() {
    return { execute: 0, onInputStart: 0, onInputDelta: 0, onInputAvailable: 0 };
  }

  it("LOCKED, safe call: all four counts stay 0 through the entire drained stream and through guard.finish(); manual dispatch afterward runs exactly once", async () => {
    const counts = freshCounts();
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);

    const result = streamText({
      model,
      prompt: "x",
      tools: createAiSdkExecutionLock({
        write_file: {
          description: "d",
          inputSchema: WRITE_FILE_SCHEMA,
          execute: async () => {
            counts.execute += 1;
            return { ok: true };
          },
          onInputStart: () => {
            counts.onInputStart += 1;
          },
          onInputDelta: () => {
            counts.onInputDelta += 1;
          },
          onInputAvailable: () => {
            counts.onInputAvailable += 1;
          },
        },
      }),
    });

    const guard = createAiSdkExecutionGuard({ schemas: { write_file: WRITE_FILE_SCHEMA.jsonSchema } });
    for await (const part of result.fullStream) guard.push(part);
    expect(counts).toEqual(freshCounts());

    const final = guard.finish();
    const decision = final.decisions.find((d) => d.name === "write_file");
    expect(decision?.action).toBe("execute");
    if (decision?.action === "execute") ledger.execute("call_1", decision.value);
    expect(ledger.count).toBe(1);
    expect(counts).toEqual(freshCounts());
  });

  it("UNLOCKED CONTROL: the SDK genuinely invokes onInputStart/onInputDelta/onInputAvailable under this exact stream on ai@5 too", async () => {
    const counts = freshCounts();
    const args = JSON.stringify({ path: "a.txt", content: "hello" });
    const model = mockModel([streamStart(), ...toolInputParts("call_1", "write_file", args), toolCallPart("call_1", "write_file", args), finishPart("tool-calls")]);

    const result = streamText({
      model,
      prompt: "x",
      tools: {
        write_file: {
          description: "d",
          inputSchema: WRITE_FILE_SCHEMA,
          onInputStart: () => {
            counts.onInputStart += 1;
          },
          onInputDelta: () => {
            counts.onInputDelta += 1;
          },
          onInputAvailable: () => {
            counts.onInputAvailable += 1;
          },
        },
      },
    });
    for await (const _part of result.fullStream) {
      /* drain */
    }
    expect(counts.onInputStart).toBe(1);
    expect(counts.onInputDelta).toBeGreaterThan(0);
    expect(counts.onInputAvailable).toBe(1);
  });
});
