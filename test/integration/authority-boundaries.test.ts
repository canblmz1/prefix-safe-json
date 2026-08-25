import { describe, expect, it } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import {
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
} from "../../src/coordinator/diagnostic-codes.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { createAiSdkExecutionGuard } from "../../src/guard/ai-sdk.js";
import { AiSdkStreamAdapter } from "../../src/providers/ai-sdk.js";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { OpenAICompatibleStreamAdapter } from "../../src/providers/openai-compatible.js";

describe("remaining execution-authority boundaries — Phase 0 regressions", () => {
  it("A: projection-only Gemini arguments never receive strict execute authority", () => {
    const adapter = new GeminiStreamAdapter();
    const gate = createToolCallExecutionGate(undefined, undefined, {
      write_file: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    });

    for (const event of adapter.push({
      candidates: [{
        content: {
          parts: [{
            functionCall: {
              name: "write_file",
              args: { path: "a.txt", content: "hello" },
            },
          }],
        },
        finishReason: "STOP",
      }],
    })) {
      gate.push(event);
    }

    const decision = gate.finish().decisions[0];
    expect(decision?.action).not.toBe("execute");
    expect(decision?.reason).toBe("projection_only");
  });

  it("B: an AI SDK argument delta before start poisons that call permanently", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-delta", id: "call_1", delta: '{"ignored":true}' });
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "write_file" });
    guard.push({
      type: "tool-input-delta",
      id: "call_1",
      delta: '{"path":"a.txt","content":"hello"}',
    });
    guard.push({ type: "tool-input-end", id: "call_1" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    expect(guard.finish().decisions[0]?.action).not.toBe("execute");
  });

  it("C: explicit OpenAI-compatible choice identity separates equal tool indices", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    const events = adapter.push({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_0",
              function: { name: "first", arguments: "{}" },
            }],
          },
        },
        {
          index: 1,
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_1",
              function: { name: "second", arguments: "{}" },
            }],
          },
        },
      ],
    });

    const sourceKeys = events
      .filter((event) => event.type === "tool_call_start")
      .map((event) => event.callRef.sourceKey);
    expect(sourceKeys).toEqual(["choice:0/tool-index:0", "choice:1/tool-index:0"]);
  });

  it("D: executable authority is unavailable after its first takeDecision consumption", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "write_file" });
    guard.push({
      type: "tool-input-delta",
      id: "call_1",
      delta: '{"path":"a.txt","content":"hello"}',
    });
    guard.push({ type: "tool-input-end", id: "call_1" });
    guard.push({ type: "finish", finishReason: "tool-calls" });

    const final = guard.finish();
    const internalId = final.decisions[0]?.internalId ?? "missing";
    const firstExecutable = guard.takeDecision(internalId);
    const secondExecutable = guard.takeDecision(internalId);

    expect(firstExecutable?.action).toBe("execute");
    expect(secondExecutable).toBeUndefined();
    expect(guard.finish().decisions[0]?.action).toBe("execute");
  });

  it("B control: the AI SDK's declared start/delta/end order still executes", () => {
    const adapter = new AiSdkStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const raw of [
      { type: "tool-input-start", id: "call_1", toolName: "write_file" },
      { type: "tool-input-delta", id: "call_1", delta: "{}" },
      { type: "tool-input-end", id: "call_1" },
      { type: "finish", finishReason: "tool-calls" },
    ]) {
      for (const event of adapter.push(raw)) gate.push(event);
    }
    expect(gate.finish().decisions[0]?.action).toBe("execute");
  });

  it("A: malformed structured Gemini values fail closed without throwing", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const adapter = new GeminiStreamAdapter();
    const gate = createToolCallExecutionGate();

    expect(() => {
      for (const event of adapter.push({
        candidates: [{
          content: { parts: [{ functionCall: { name: "write_file", args: circular } }] },
          finishReason: "STOP",
        }],
      })) gate.push(event);
    }).not.toThrow();

    const final = gate.finish();
    expect(final.decisions[0]?.action).not.toBe("execute");
    expect(final.diagnostics.some((d) => d.code === "E_GEMINI_ARGUMENT_PROJECTION_FAILED")).toBe(true);
  });

  it("A: a structured value whose JSON projection is undefined also fails closed", () => {
    const adapter = new GeminiStreamAdapter();
    const events = adapter.push({
      candidates: [{
        content: { parts: [{ functionCall: { name: "f", args: () => undefined } }] },
        finishReason: "STOP",
      }],
    });
    expect(events.some(
      (event) => event.type === "provider_diagnostic" &&
        event.code === "E_GEMINI_ARGUMENT_PROJECTION_FAILED",
    )).toBe(true);
  });

  it("B: end before start and a later clean sequence remain poisoned", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-end", id: "call_1" });
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    guard.push({ type: "tool-input-delta", id: "call_1", delta: "{}" });
    guard.push({ type: "tool-input-end", id: "call_1" });
    guard.push({ type: "finish", finishReason: "tool-calls" });
    const decision = guard.finish().decisions[0];
    expect(decision?.action).not.toBe("execute");
    expect(decision?.reason).toBe("protocol_violation");
  });

  it("B: pre-start diagnostics remain source-scoped until the exact call starts", () => {
    const coordinator = createToolCallStreamCoordinator();
    coordinator.push({
      type: "provider_diagnostic",
      sequence: 1,
      provider: "ai-sdk",
      callRef: { sourceKey: "tool-input:late" },
      code: TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
      severity: "error",
      message: "before start",
    });

    expect(coordinator.snapshot().diagnostics).toEqual([{
      code: TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
      severity: "error",
      message: "before start",
      internalId: undefined,
      sourceKey: "tool-input:late",
    }]);

    coordinator.push({
      type: "tool_call_start",
      sequence: 2,
      provider: "ai-sdk",
      callRef: { sourceKey: "tool-input:late" },
      toolCallId: "late",
      name: "f",
    });

    expect(coordinator.snapshot().diagnostics).toEqual([
      {
        code: TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
        severity: "error",
        message: "before start",
        internalId: undefined,
        sourceKey: "tool-input:late",
      },
      {
        code: TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
        severity: "error",
        message: "before start",
        internalId: "call-0",
        sourceKey: undefined,
      },
    ]);
  });

  it("B: a clean start does not synthesize pending diagnostics", () => {
    const coordinator = createToolCallStreamCoordinator();
    coordinator.push({
      type: "tool_call_start",
      sequence: 1,
      provider: "ai-sdk",
      callRef: { sourceKey: "tool-input:clean" },
      toolCallId: "clean",
      name: "f",
    });
    expect(coordinator.snapshot().diagnostics).toEqual([]);
  });

  it("B: non-protocol source diagnostics are not promoted into protocol poison", () => {
    const gate = createToolCallExecutionGate();
    const events: NormalizedToolStreamEvent[] = [
      {
        type: "provider_diagnostic",
        sequence: 1,
        provider: "ai-sdk",
        callRef: { sourceKey: "tool-input:call_1" },
        code: "E_NON_PROTOCOL_SOURCE_NOTE",
        severity: "error",
        message: "not an ordering violation",
      },
      {
        type: "tool_call_start",
        sequence: 2,
        provider: "ai-sdk",
        callRef: { sourceKey: "tool-input:call_1" },
        toolCallId: "call_1",
        name: "f",
      },
      {
        type: "tool_call_arguments_delta",
        sequence: 3,
        provider: "ai-sdk",
        callRef: { sourceKey: "tool-input:call_1" },
        delta: "{}",
      },
      {
        type: "tool_call_end",
        sequence: 4,
        provider: "ai-sdk",
        callRef: { sourceKey: "tool-input:call_1" },
        reason: "complete",
      },
      { type: "provider_stream_end", sequence: 5, provider: "ai-sdk", reason: "complete" },
    ];
    for (const event of events) gate.push(event);
    expect(gate.finish().decisions[0]?.action).toBe("execute");
  });

  it("B: duplicate start fails closed with a precise sticky diagnostic", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    guard.push({ type: "tool-input-delta", id: "call_1", delta: "{}" });
    guard.push({ type: "tool-input-end", id: "call_1" });
    guard.push({ type: "finish", finishReason: "tool-calls" });
    const final = guard.finish();
    expect(final.decisions[0]?.reason).toBe("protocol_violation");
    expect(final.diagnostics.some((d) => d.code === "E_DUPLICATE_TOOL_CALL_START")).toBe(true);
  });

  it("B: delta after end and duplicate end are explicit protocol violations", () => {
    const adapter = new AiSdkStreamAdapter();
    adapter.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    adapter.push({ type: "tool-input-end", id: "call_1" });
    const afterEnd = adapter.push({ type: "tool-input-delta", id: "call_1", delta: "{}" });
    const duplicateEnd = adapter.push({ type: "tool-input-end", id: "call_1" });
    expect(afterEnd[0]?.type === "provider_diagnostic" && afterEnd[0].code).toBe(
      "E_TOOL_ARGUMENTS_AFTER_END",
    );
    expect(duplicateEnd[0]?.type === "provider_diagnostic" && duplicateEnd[0].code).toBe(
      "E_DUPLICATE_TOOL_END",
    );
  });

  it("B: each pre-start ordering violation emits the exact call-scoped diagnostic", () => {
    const delta = new AiSdkStreamAdapter().push({
      type: "tool-input-delta",
      id: "delta",
      delta: "{}",
    });
    expect(delta).toHaveLength(1);
    expect(delta[0]).toEqual({
      type: "provider_diagnostic",
      sequence: 1,
      provider: "ai-sdk",
      callRef: { sourceKey: "tool-input:delta" },
      code: "E_TOOL_ARGUMENTS_BEFORE_START",
      severity: "error",
      message: "AI SDK tool-input-delta arrived before tool-input-start",
    });

    const end = new AiSdkStreamAdapter().push({ type: "tool-input-end", id: "end" });
    expect(end).toHaveLength(1);
    expect(end[0]).toEqual({
      type: "provider_diagnostic",
      sequence: 1,
      provider: "ai-sdk",
      callRef: { sourceKey: "tool-input:end" },
      code: "E_TOOL_END_BEFORE_START",
      severity: "error",
      message: "AI SDK tool-input-end arrived before tool-input-start",
    });
  });

  it("B: post-end violations retain exact call scope and diagnostic metadata", () => {
    const adapter = new AiSdkStreamAdapter();
    adapter.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    adapter.push({ type: "tool-input-end", id: "call_1" });

    expect(adapter.push({ type: "tool-input-delta", id: "call_1", delta: "{}" })).toEqual([{
      type: "provider_diagnostic",
      sequence: 3,
      provider: "ai-sdk",
      callRef: { sourceKey: "tool-input:call_1" },
      code: "E_TOOL_ARGUMENTS_AFTER_END",
      severity: "error",
      message: "AI SDK tool-input-delta arrived after tool-input-end",
    }]);
    expect(adapter.push({ type: "tool-input-end", id: "call_1" })).toEqual([{
      type: "provider_diagnostic",
      sequence: 4,
      provider: "ai-sdk",
      callRef: { sourceKey: "tool-input:call_1" },
      code: "E_DUPLICATE_TOOL_END",
      severity: "error",
      message: "AI SDK emitted duplicate tool-input-end parts for one call",
    }]);
  });

  it("B: one poisoned call does not disqualify an unrelated valid call", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-delta", id: "bad", delta: "{}" });
    guard.push({ type: "tool-input-start", id: "bad", toolName: "bad_tool" });
    guard.push({ type: "tool-input-delta", id: "bad", delta: "{}" });
    guard.push({ type: "tool-input-end", id: "bad" });
    guard.push({ type: "tool-input-start", id: "good", toolName: "good_tool" });
    guard.push({ type: "tool-input-delta", id: "good", delta: "{}" });
    guard.push({ type: "tool-input-end", id: "good" });
    guard.push({ type: "finish", finishReason: "tool-calls" });
    const final = guard.finish();
    expect(final.decisions.find((d) => d.toolCallId === "bad")?.reason).toBe("protocol_violation");
    expect(final.decisions.find((d) => d.toolCallId === "good")?.action).toBe("execute");
  });

  it("C: out-of-order choice arrays use explicit indices and keep calls independent", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    const gate = createToolCallExecutionGate();
    const events = adapter.push({ choices: [
      { index: 1, delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "second", arguments: '{"n":2}' } }] } },
      { index: 0, delta: { tool_calls: [{ index: 0, id: "c0", function: { name: "first", arguments: '{"n":1}' } }] } },
    ] });
    expect(events.filter((e) => e.type === "tool_call_start").map((e) => e.callRef.sourceKey)).toEqual([
      "choice:1/tool-index:0",
      "choice:0/tool-index:0",
    ]);
    for (const event of events) gate.push(event);
    for (const event of adapter.finish({ reason: "complete", providerReason: "tool_calls" })) gate.push(event);
    const decisions = gate.finish().decisions;
    expect(decisions).toHaveLength(2);
    expect(decisions.find((d) => d.toolCallId === "c0")?.name).toBe("first");
    expect(decisions.find((d) => d.toolCallId === "c1")?.name).toBe("second");
    expect(decisions.every((d) => d.action === "execute")).toBe(true);
  });

  it("C: missing or invalid explicit choice identity fails the stream closed", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const event of adapter.push({ choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, id: "good", function: { name: "f", arguments: "{}" } }] } },
    ] })) gate.push(event);
    for (const event of adapter.push({ choices: [
      { delta: { tool_calls: [{ index: 0, id: "ambiguous", function: { name: "g", arguments: "{}" } }] } },
    ] })) gate.push(event);
    for (const event of adapter.finish({ reason: "complete" })) gate.push(event);
    const final = gate.finish();
    expect(final.decisions[0]?.action).not.toBe("execute");
    expect(final.decisions[0]?.reason).toBe("protocol_violation");
  });

  it("C: every invalid choice-index shape is rejected independently", () => {
    for (const index of [undefined, -1, 1.5, Number.NaN]) {
      const events = new OpenAICompatibleStreamAdapter().push({
        choices: [{
          index,
          delta: { tool_calls: [{ index: 0, id: "ambiguous", function: { name: "f", arguments: "{}" } }] },
        }],
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({
        type: "provider_diagnostic",
        sequence: 1,
        provider: "openai-compatible",
        code: "E_CHOICE_INDEX_INVALID",
        severity: "error",
        message: "choice.index is missing, non-integer, or negative; tool-call identity is ambiguous",
      });
      expect(events.some((event) => event.type === "tool_call_start")).toBe(false);
    }

    expect(new OpenAICompatibleStreamAdapter().push({ choices: [{ index: 0 }] })).toEqual([]);
  });

  it("C: every invalid tool index is rejected without manufacturing identity", () => {
    for (const index of [undefined, -1, 1.5, Number.NaN]) {
      const events = new OpenAICompatibleStreamAdapter().push({
        choices: [{ index: 0, delta: { tool_calls: [{ index }] } }],
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "provider_diagnostic",
        code: "E_PROVIDER_EVENT_MALFORMED",
        severity: "error",
      });
      expect(events.some((event) => event.type === "tool_call_start")).toBe(false);
    }
  });

  it("C: duplicate explicit choice identity is sticky for a later call at that coordinate", () => {
    const adapter = new OpenAICompatibleStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const event of adapter.push({ choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{" } }] } },
      { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } },
    ] })) gate.push(event);
    for (const event of adapter.push({ choices: [
      { index: 0, delta: { tool_calls: [{ index: 0, id: "later", function: { name: "f", arguments: "{}" } }] } },
    ] })) gate.push(event);
    for (const event of adapter.finish({ reason: "complete" })) gate.push(event);
    const final = gate.finish();
    expect(final.decisions[0]?.reason).toBe("protocol_violation");
    expect(final.diagnostics.some((d) => d.code === "E_CHOICE_INDEX_DUPLICATE")).toBe(true);
  });

  it("C: duplicate choices without valid tool coordinates and invalid tool indices diagnose without guessing", () => {
    const duplicate = new OpenAICompatibleStreamAdapter().push({
      choices: [{ index: 2 }, { index: 2 }],
    });
    expect(duplicate).toEqual([1, 2].map((sequence) => ({
      type: "provider_diagnostic",
      sequence,
      provider: "openai-compatible",
      code: "E_CHOICE_INDEX_DUPLICATE",
      severity: "error",
      message: "choice.index 2 is duplicated in one provider event",
    })));

    const invalidTool = new OpenAICompatibleStreamAdapter().push({
      choices: [
        { index: 0, delta: { tool_calls: [{ index: -1 }] } },
        { index: 1.5, delta: { tool_calls: [{ index: 0 }] } },
      ],
    });
    expect(invalidTool.every((event) => event.type === "provider_diagnostic")).toBe(true);
  });

  it("C: duplicate choice diagnostics use a callRef only for a trustworthy tool index", () => {
    const validCoordinate = new OpenAICompatibleStreamAdapter().push({
      choices: [
        { index: 2, delta: { tool_calls: [{ index: 0 }] } },
        { index: 2, delta: { tool_calls: [{ index: 0 }] } },
      ],
    });
    expect(validCoordinate).toEqual([1, 2].map((sequence) => ({
      type: "provider_diagnostic",
      sequence,
      provider: "openai-compatible",
      code: "E_CHOICE_INDEX_DUPLICATE",
      severity: "error",
      message: "choice.index 2 is duplicated in one provider event",
      callRef: { sourceKey: "choice:2/tool-index:0" },
    })));

    for (const index of [undefined, -1, 1.5, Number.NaN]) {
      const invalidCoordinate = new OpenAICompatibleStreamAdapter().push({
        choices: [
          { index: 2, delta: { tool_calls: [{ index }] } },
          { index: 2, delta: { tool_calls: [{ index }] } },
        ],
      });
      expect(invalidCoordinate).toHaveLength(2);
      expect(invalidCoordinate.every(
        (event) => event.type === "provider_diagnostic" &&
          event.code === DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE &&
          event.callRef === undefined,
      )).toBe(true);
    }
  });

  it("C: explicit-index terminal reasons preserve length and cancellation", () => {
    const length = new OpenAICompatibleStreamAdapter().push({
      choices: [{ index: 0, finish_reason: "length" }],
    });
    const cancelled = new OpenAICompatibleStreamAdapter().push({
      choices: [{ index: 0, finish_reason: "cancelled" }],
    });
    expect(length.find((event) => event.type === "provider_stream_end")?.reason).toBe("length");
    expect(cancelled.find((event) => event.type === "provider_stream_end")?.reason).toBe("cancelled");
  });

  it("D: taking one call's authority does not consume an unrelated call", () => {
    const guard = createAiSdkExecutionGuard();
    for (const id of ["a", "b"]) {
      guard.push({ type: "tool-input-start", id, toolName: `tool_${id}` });
      guard.push({ type: "tool-input-delta", id, delta: "{}" });
      guard.push({ type: "tool-input-end", id });
    }
    guard.push({ type: "finish", finishReason: "tool-calls" });
    const final = guard.finish();
    const first = final.decisions[0];
    const second = final.decisions[1];
    expect(first && guard.takeDecision(first.internalId)?.action).toBe("execute");
    expect(first && guard.takeDecision(first.internalId)).toBeUndefined();
    expect(second && guard.takeDecision(second.internalId)?.action).toBe("execute");
    expect(second && guard.takeDecision(second.internalId)).toBeUndefined();
  });

  it("D: authority cannot be taken before finish or through an unknown identity", () => {
    const guard = createAiSdkExecutionGuard();
    guard.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    guard.push({ type: "tool-input-delta", id: "call_1", delta: "{}" });
    guard.push({ type: "tool-input-end", id: "call_1" });

    expect(guard.takeDecision("call-0")).toBeUndefined();
    const final = guard.finish({ reason: "complete" });
    expect(guard.takeDecision("unknown")).toBeUndefined();
    expect(guard.takeDecision(final.decisions[0]?.internalId ?? "missing")?.action).toBe("execute");
  });

  it("D: unsafe finish, malformed JSON, and schema-invalid calls never yield authority", () => {
    const cases = [
      { id: "unsafe", json: "{}", finishReason: "length", options: undefined },
      { id: "malformed", json: '{"a":}', finishReason: "tool-calls", options: undefined },
      {
        id: "schema",
        json: "{}",
        finishReason: "tool-calls",
        options: { schemas: { f: { type: "object", required: ["required"] } } },
      },
    ] as const;
    for (const testCase of cases) {
      const guard = createAiSdkExecutionGuard(testCase.options);
      guard.push({ type: "tool-input-start", id: testCase.id, toolName: "f" });
      guard.push({ type: "tool-input-delta", id: testCase.id, delta: testCase.json });
      guard.push({ type: "tool-input-end", id: testCase.id });
      guard.push({ type: "finish", finishReason: testCase.finishReason });
      const final = guard.finish();
      const internalId = final.decisions[0]?.internalId ?? "missing";
      expect(guard.takeDecision(internalId)).toBeUndefined();
      expect(guard.takeDecision(internalId)).toBeUndefined();
      expect(final.decisions[0]?.action).not.toBe("execute");
    }
  });
});
