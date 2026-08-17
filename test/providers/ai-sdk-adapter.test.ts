import { describe, it, expect } from "vitest";
import { AiSdkStreamAdapter } from "../../src/providers/ai-sdk.js";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import { expectDefined } from "../utils/expect-defined.js";

describe("AiSdkStreamAdapter — normalization", () => {
  it("tool-input-start/delta/end produce start/delta/end normalized events correlated by id", () => {
    const adapter = new AiSdkStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ type: "tool-input-start", id: "call_1", toolName: "write_file" }));
    events.push(...adapter.push({ type: "tool-input-delta", id: "call_1", delta: '{"path":"a.txt"' }));
    events.push(...adapter.push({ type: "tool-input-end", id: "call_1" }));

    expect(events.map((e) => e.type)).toEqual([
      "tool_call_start",
      "tool_call_arguments_delta",
      "tool_call_end",
    ]);
    const start = events[0] as NormalizedToolStreamEvent & { type: "tool_call_start" };
    expect(start.name).toBe("write_file");
    expect(start.callRef.sourceKey).toBe("tool-input:call_1");
    const delta = events[1] as NormalizedToolStreamEvent & { type: "tool_call_arguments_delta" };
    expect(delta.delta).toBe('{"path":"a.txt"');
    expect(delta.callRef.sourceKey).toBe("tool-input:call_1");
  });

  it("correlates tool-input-end by `toolCallId` when tool-input-start used `id` (defensive field-name handling)", () => {
    const adapter = new AiSdkStreamAdapter();
    adapter.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    adapter.push({ type: "tool-input-delta", id: "call_1", delta: "{}" });
    const endEvents = adapter.push({ type: "tool-input-end", toolCallId: "call_1" });
    expect(endEvents).toHaveLength(1);
    expect(expectDefined(endEvents[0]).type).toBe("tool_call_end");
    expect((endEvents[0] as NormalizedToolStreamEvent & { type: "tool_call_end" }).callRef.sourceKey).toBe(
      "tool-input:call_1",
    );
  });

  it("the 'tool-call' part is a no-op — never trusts the SDK's own resolved/repaired `input`", () => {
    const adapter = new AiSdkStreamAdapter();
    const events: NormalizedToolStreamEvent[] = [];
    events.push(...adapter.push({ type: "tool-input-start", id: "call_1", toolName: "write_file" }));
    events.push(
      ...adapter.push({ type: "tool-input-delta", id: "call_1", delta: '{"path":"a.txt","content":"unterm' }),
    );
    // The SDK's own resolved tool-call carries an "input" that has clearly
    // been repaired/guessed (closes the unterminated string) - this must
    // produce NO normalized event at all.
    const fromToolCall = adapter.push({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "write_file",
      input: { path: "a.txt", content: "unterm" },
    });
    expect(fromToolCall).toEqual([]);
    events.push(...fromToolCall);

    // End-to-end: feed this into a real coordinator and confirm the
    // committed value only ever reflects the raw, unrepaired delta text.
    const coord = createToolCallStreamCoordinator();
    for (const e of events) coord.push(e);
    coord.finish({ reason: "length" });
    const call = expectDefined(coord.snapshot().calls[0]);
    expect(call.parser.stableValue).toEqual({ path: "a.txt" }); // content never committed
    expect(call.parser.executable).toBe(false);
  });

  it("'tool-error' emits a provider_diagnostic (with the call's own callRef) without ending the stream", () => {
    const adapter = new AiSdkStreamAdapter();
    const events = adapter.push({
      type: "tool-error",
      toolCallId: "call_1",
      toolName: "write_file",
      error: new Error("invalid arguments"),
    });
    expect(events).toHaveLength(1);
    const diagEvent = expectDefined(events[0]) as NormalizedToolStreamEvent & { type: "provider_diagnostic" };
    expect(diagEvent.type).toBe("provider_diagnostic");
    expect(diagEvent.code).toBe("E_PROVIDER_TOOL_ERROR");
    expect(diagEvent.severity).toBe("error");
    expect(diagEvent.callRef?.sourceKey).toBe("tool-input:call_1");
    // Adapter must still be alive after this.
    expect(adapter.push({ type: "tool-input-start", id: "call_2", toolName: "f" })).toHaveLength(1);
  });

  it("'tool-error' with no toolCallId omits callRef instead of fabricating one", () => {
    const adapter = new AiSdkStreamAdapter();
    const events = adapter.push({ type: "tool-error", toolName: "write_file", error: "boom" });
    const diagEvent = expectDefined(events[0]) as NormalizedToolStreamEvent & { type: "provider_diagnostic" };
    expect(diagEvent.callRef).toBeUndefined();
  });

  it("rejects a non-object raw event with a fully-populated diagnostic instead of throwing", () => {
    const adapter = new AiSdkStreamAdapter();
    const events = adapter.push(null);
    expect(events).toHaveLength(1);
    const diag = expectDefined(events[0]) as NormalizedToolStreamEvent & { type: "provider_diagnostic" };
    expect(diag.type).toBe("provider_diagnostic");
    expect(diag.code).toBe("E_PROVIDER_EVENT_MALFORMED");
    expect(diag.severity).toBe("error");
    expect(diag.message).toBe("Raw event is not an object");
  });

  it("a primitive (non-null, non-object) raw event is also rejected the same way", () => {
    const adapter = new AiSdkStreamAdapter();
    const events = adapter.push("not an object");
    expect(expectDefined(events[0]).type).toBe("provider_diagnostic");
  });

  it("tool-input-start/delta/end with no id and no toolCallId at all produce no event (nothing to correlate it to)", () => {
    const adapter = new AiSdkStreamAdapter();
    expect(adapter.push({ type: "tool-input-start", toolName: "f" })).toEqual([]);
    expect(adapter.push({ type: "tool-input-delta", delta: "{}" })).toEqual([]);
    expect(adapter.push({ type: "tool-input-end" })).toEqual([]);
  });

  it("tool-input-delta with an id but a non-string delta produces no event", () => {
    const adapter = new AiSdkStreamAdapter();
    expect(adapter.push({ type: "tool-input-delta", id: "call_1", delta: 42 })).toEqual([]);
    expect(adapter.push({ type: "tool-input-delta", id: "call_1" })).toEqual([]);
  });

  it("ignores unrelated part types without crashing (text-delta, start-step, finish-step, tool-result)", () => {
    const adapter = new AiSdkStreamAdapter();
    for (const type of ["text-delta", "start-step", "finish-step", "tool-result", "reasoning-delta"]) {
      expect(() => adapter.push({ type })).not.toThrow();
    }
  });
});

describe("AiSdkStreamAdapter — finishReason mapping", () => {
  const cases: Array<{ finishReason: string; expectedReason: string }> = [
    { finishReason: "stop", expectedReason: "complete" },
    { finishReason: "tool-calls", expectedReason: "complete" },
    { finishReason: "length", expectedReason: "length" },
    { finishReason: "error", expectedReason: "provider_error" },
    { finishReason: "other", expectedReason: "unknown" },
  ];

  for (const { finishReason, expectedReason } of cases) {
    it(`finishReason "${finishReason}" -> StreamEndReason "${expectedReason}"`, () => {
      const adapter = new AiSdkStreamAdapter();
      const events = adapter.push({ type: "finish", finishReason });
      const end = events.find((e) => e.type === "provider_stream_end") as
        | (NormalizedToolStreamEvent & { type: "provider_stream_end" })
        | undefined;
      expect(end?.reason).toBe(expectedReason);
      expect(end?.providerReason).toBe(finishReason);
    });
  }

  it('finishReason "content-filter" -> StreamEndReason "cancelled" PLUS an E_CONTENT_FILTERED diagnostic (not a generic cancellation)', () => {
    const adapter = new AiSdkStreamAdapter();
    const events = adapter.push({ type: "finish", finishReason: "content-filter" });
    const end = events.find((e) => e.type === "provider_stream_end") as
      | (NormalizedToolStreamEvent & { type: "provider_stream_end" })
      | undefined;
    expect(end?.reason).toBe("cancelled");
    const diag = events.find(
      (e) => e.type === "provider_diagnostic",
    ) as (NormalizedToolStreamEvent & { type: "provider_diagnostic" }) | undefined;
    expect(diag?.code).toBe("E_CONTENT_FILTERED");
    expect(diag?.severity).toBe("error");
    expect(diag?.message).toContain("content filter");
  });

  it('an "error" part ends the stream with reason "provider_error" and stops accepting further events', () => {
    const adapter = new AiSdkStreamAdapter();
    const events = adapter.push({ type: "error", error: new Error("upstream failure") });
    const end = events.find((e) => e.type === "provider_stream_end") as
      | (NormalizedToolStreamEvent & { type: "provider_stream_end" })
      | undefined;
    expect(end?.reason).toBe("provider_error");
    expect(end?.providerReason).toContain("upstream failure");
    expect(adapter.push({ type: "tool-input-start", id: "x", toolName: "f" })).toEqual([]);
  });

  it("push() after finish returns no events; finish() is idempotent", () => {
    const adapter = new AiSdkStreamAdapter();
    adapter.push({ type: "finish", finishReason: "stop" });
    expect(adapter.push({ type: "tool-input-start", id: "x", toolName: "f" })).toEqual([]);
    expect(adapter.finish()).toEqual([]);
  });

  it("finish() with no prior \"finish\"/\"error\" part still ends the stream using the caller-supplied reason, and is idempotent afterward", () => {
    const adapter = new AiSdkStreamAdapter();
    adapter.push({ type: "tool-input-start", id: "call_1", toolName: "f" });
    const events = adapter.finish({ reason: "cancelled", providerReason: "caller-cancelled" });
    expect(events).toHaveLength(1);
    const end = expectDefined(events[0]) as NormalizedToolStreamEvent & { type: "provider_stream_end" };
    expect(end.type).toBe("provider_stream_end");
    expect(end.reason).toBe("cancelled");
    expect(end.providerReason).toBe("caller-cancelled");
    // finish() must mark the adapter finished, not just return an event.
    expect(adapter.finish()).toEqual([]);
    expect(adapter.push({ type: "tool-input-start", id: "call_2", toolName: "g" })).toEqual([]);
  });

  it("finish() with zero arguments on a fresh adapter doesn't throw and defaults to reason \"unknown\"", () => {
    const adapter = new AiSdkStreamAdapter();
    const events = adapter.finish();
    const end = expectDefined(events[0]) as NormalizedToolStreamEvent & { type: "provider_stream_end" };
    expect(end.reason).toBe("unknown");
    expect(end.providerReason).toBeUndefined();
  });
});

describe("AiSdkStreamAdapter — stringifyError() branches (via 'tool-error')", () => {
  it("a plain string error", () => {
    const adapter = new AiSdkStreamAdapter();
    const [diag] = adapter.push({ type: "tool-error", toolCallId: "c", error: "boom" }) as [
      NormalizedToolStreamEvent & { type: "provider_diagnostic" },
    ];
    expect(diag.message).toContain("boom");
  });

  it("a plain object with a string `message` property (not an Error instance)", () => {
    const adapter = new AiSdkStreamAdapter();
    const [diag] = adapter.push({
      type: "tool-error",
      toolCallId: "c",
      error: { message: "invalid schema" },
    }) as [NormalizedToolStreamEvent & { type: "provider_diagnostic" }];
    expect(diag.message).toContain("invalid schema");
  });

  it("a value with no usable message falls back to JSON.stringify", () => {
    const adapter = new AiSdkStreamAdapter();
    const [diag] = adapter.push({ type: "tool-error", toolCallId: "c", error: { code: 42 } }) as [
      NormalizedToolStreamEvent & { type: "provider_diagnostic" },
    ];
    expect(diag.message).toContain('"code":42');
  });

  it("a value that can't even be JSON.stringify'd falls back to String()", () => {
    const adapter = new AiSdkStreamAdapter();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const [diag] = adapter.push({ type: "tool-error", toolCallId: "c", error: circular }) as [
      NormalizedToolStreamEvent & { type: "provider_diagnostic" },
    ];
    expect(diag.message).toContain("[object Object]");
  });
});
