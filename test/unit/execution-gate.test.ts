import { describe, it, expect } from "vitest";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { AiSdkStreamAdapter } from "../../src/providers/ai-sdk.js";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { expectDefined } from "../utils/expect-defined.js";
import type { ToolCallExecutionGate } from "../../src/gate/types.js";
import type { NormalizedToolStreamEvent, StreamEndReason } from "../../src/coordinator/protocol.js";
import type { CoordinatorLimits, JsonSchemaLike } from "../../src/coordinator/types.js";
import type { ParserOptions } from "../../src/types.js";

const WRITE_FILE_SCHEMA: JsonSchemaLike = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
};

function ev(partial: Record<string, unknown>): NormalizedToolStreamEvent {
  return { provider: "openai", sequence: 0, ...partial } as unknown as NormalizedToolStreamEvent;
}

function start(sourceKey: string, name?: string) {
  return ev({ type: "tool_call_start", callRef: { sourceKey }, name });
}
function argsDelta(sourceKey: string, delta: string) {
  return ev({ type: "tool_call_arguments_delta", callRef: { sourceKey }, delta });
}
function nameDelta(sourceKey: string, delta: string) {
  return ev({ type: "tool_call_name_delta", callRef: { sourceKey }, delta });
}
function callEnd(sourceKey: string, reason: StreamEndReason = "complete") {
  return ev({ type: "tool_call_end", callRef: { sourceKey }, reason });
}
function streamEnd(reason: StreamEndReason, providerReason?: string) {
  return ev({ type: "provider_stream_end", reason, providerReason });
}

function gateWith(
  limits?: Partial<CoordinatorLimits>,
  parserOptions?: ParserOptions,
  toolSchemas?: Record<string, JsonSchemaLike>,
): ToolCallExecutionGate {
  return createToolCallExecutionGate(limits, parserOptions, toolSchemas);
}

describe("execution gate — golden path", () => {
  it("a complete, valid single tool call is executable", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt","content":"hello"}'));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete", "tool_use"));

    const { decisions } = gate.finish();
    expect(decisions).toHaveLength(1);
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("execute");
    expect(decision.executable).toBe(true);
    if (decision.action === "execute") {
      expect(decision.value).toEqual({ path: "a.txt", content: "hello" });
    }
  });

  it("empty tool arguments ({}) are executable", () => {
    const gate = gateWith();
    gate.push(start("call-0", "list_files"));
    gate.push(argsDelta("call-0", "{}"));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    const { decisions } = gate.finish();
    expect(expectDefined(decisions[0]).action).toBe("execute");
  });

  it("nested objects/arrays round-trip to an executable decision", () => {
    const gate = gateWith();
    const payload = { config: { retries: 3, tags: ["a", "b", { deep: true }] } };
    gate.push(start("call-0", "configure"));
    gate.push(argsDelta("call-0", JSON.stringify(payload)));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    if (decision.action === "execute") expect(decision.value).toEqual(payload);
  });

  it("multi-byte UTF-8 content split across chunks still executes (thin confidence check — split-boundary correctness itself is owned by test/unit/utf8.test.ts)", () => {
    const gate = gateWith();
    const raw = '{"message":"café 😀"}'; // café 😀 - includes a 2-byte and a 4-byte UTF-8 char
    gate.push(start("call-0", "notify"));
    gate.push(argsDelta("call-0", raw.slice(0, 10)));
    gate.push(argsDelta("call-0", raw.slice(10)));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("execute");
    if (decision.action === "execute") {
      expect(decision.value).toEqual({ message: "café 😀" });
    }
  });
});

describe("execution gate — truncation", () => {
  it("mid-string truncation by length -> retry/truncated, value never present", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"config/database.yml","content":"production:\\n  password: correct-horse-battery-sta'));
    gate.push(callEnd("call-0", "length"));
    gate.push(streamEnd("length", "max_tokens"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("truncated");
    expect("value" in decision).toBe(false);
    // What *was* safely committed (path) must still be visible, without the
    // truncated content field ever appearing as if it were real.
    expect(decision.stableValue).toEqual({ path: "config/database.yml" });
  });

  it("container-level truncation: a single unclosed container is safely repair-closed at finish, but stream said length -> retry/stream_incomplete, never execute", () => {
    // No unterminated string here - the parser *can* structurally close the
    // array - but the provider's own stream metadata says it was cut off by
    // max_tokens, so execution must still be refused even though the JSON
    // now looks complete.
    const gate = gateWith(undefined, { repairs: { closeContainersAtFinish: "safe-only" } });
    gate.push(start("call-0", "run_commands"));
    gate.push(argsDelta("call-0", '["npm install","npm test"'));
    gate.push(callEnd("call-0", "length"));
    gate.push(streamEnd("length", "max_tokens"));

    const { decisions } = gate.finish();
    const decision = expectDefined(decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.executable).toBe(false);
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("stream_incomplete");
  });

  it("the exact spec example `{\"commands\":[\"npm install\",\"npm test\"` (two unclosed containers) also never executes", () => {
    // Documents a real, pre-existing limitation found while writing this
    // test: GrammarStack.canSafelyCloseAll() only inspects each frame's own
    // expectation, so an ancestor object whose value is itself an
    // in-progress-but-closeable array is (incorrectly) treated as "missing
    // a value" and blocks the safe-close repair for the whole stack. So
    // with two levels of unclosed containers, this input is reported
    // "truncated" rather than "salvaged" (the single-level case above IS
    // salvaged) - a gap in the parser's structural-salvage reach, not in
    // the gate. Either way, the safety property this test exists to prove
    // holds regardless: it is never executed. See docs/EXECUTION_GATE.md
    // limitations and the final report's "Remaining risks".
    const gate = gateWith(undefined, { repairs: { closeContainersAtFinish: "safe-only" } });
    gate.push(start("call-0", "run_commands"));
    gate.push(argsDelta("call-0", '{"commands":["npm install","npm test"'));
    gate.push(callEnd("call-0", "length"));
    gate.push(streamEnd("length", "max_tokens"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.executable).toBe(false);
    expect(decision.action).toBe("retry");
    expect(["truncated", "stream_incomplete"]).toContain(decision.reason);
  });

  it("cancelled mid-stream -> retry/stream_incomplete", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt"'));
    gate.push(streamEnd("cancelled"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("retry");
    expect(decision.reason).toBe("stream_incomplete");
  });
});

describe("execution gate — OpenAI Responses termination semantics (raw adapter, not synthetic events)", () => {
  it("syntactically-complete arguments + response.incomplete/max_output_tokens: explicit provider truncation dominates syntax, never executes", () => {
    // The exact case this fix exists for: {"path":"a.txt"} is fully valid,
    // closed JSON - a naive adapter would call this "complete". But the
    // provider itself says the response was cut short by its output-token
    // budget, and that must win.
    const gate = gateWith();
    const adapter = new OpenAIStreamAdapter();

    const raw = [
      { type: "response.output_item.added", item: { type: "function_call", id: "item-1", call_id: "call-0", name: "read_file" } },
      { type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"path":"a.txt"}' },
      { type: "response.output_item.done", item: { id: "item-1" } },
      { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } },
    ];
    for (const event of raw) for (const normalized of adapter.push(event)) gate.push(normalized);

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.executable).toBe(false);
    expect("value" in decision).toBe(false);
  });

  it("response.incomplete/content_filter -> reject/content_filtered, not a generic cancellation", () => {
    const gate = gateWith();
    const adapter = new OpenAIStreamAdapter();

    const raw = [
      { type: "response.output_item.added", item: { type: "function_call", id: "item-1", call_id: "call-0", name: "send_email" } },
      { type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"to":"a@example.com"}' },
      { type: "response.output_item.done", item: { id: "item-1" } },
      { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "content_filter" } } },
    ];
    for (const event of raw) for (const normalized of adapter.push(event)) gate.push(normalized);

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("content_filtered");
  });

  it("response.incomplete with an unrecognized/future reason still never executes (fail-closed exhaustive mapping)", () => {
    const gate = gateWith();
    const adapter = new OpenAIStreamAdapter();

    const raw = [
      { type: "response.output_item.added", item: { type: "function_call", id: "item-1", call_id: "call-0", name: "read_file" } },
      { type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"path":"a.txt"}' },
      { type: "response.output_item.done", item: { id: "item-1" } },
      { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "some_future_reason_openai_has_not_documented_yet" } } },
    ];
    for (const event of raw) for (const normalized of adapter.push(event)) gate.push(normalized);

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(decision.executable).toBe(false);
  });

  it("response.failed (previously silently dropped) reaches the gate as reject/provider_error", () => {
    const gate = gateWith();
    const adapter = new OpenAIStreamAdapter();

    const raw = [
      { type: "response.output_item.added", item: { type: "function_call", id: "item-1", call_id: "call-0", name: "read_file" } },
      { type: "response.function_call_arguments.delta", item_id: "item-1", delta: '{"path":"a.txt"}' },
      { type: "response.failed", response: { status: "failed", error: { code: "server_error", message: "boom" } } },
    ];
    for (const event of raw) for (const normalized of adapter.push(event)) gate.push(normalized);

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("provider_error");
  });
});

describe("execution gate — malformed / schema", () => {
  it("malformed but non-truncated JSON (duplicate key), stream complete -> reject/malformed", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt","path":"b.txt"}'));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("malformed");
  });

  it("structurally complete but schema-invalid (missing required field) -> reject/schema_invalid", () => {
    const gate = gateWith(undefined, undefined, { write_file: WRITE_FILE_SCHEMA });
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt"}'));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("schema_invalid");
  });

  it("schema-valid and complete -> execute", () => {
    const gate = gateWith(undefined, undefined, { write_file: WRITE_FILE_SCHEMA });
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt","content":"hi"}'));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    expect(expectDefined(gate.finish().decisions[0]).action).toBe("execute");
  });
});

describe("execution gate — provider error / content filter / resource limits", () => {
  it("provider_error stream end -> reject/provider_error for the in-flight call", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt"'));
    gate.push(streamEnd("provider_error", "upstream_5xx"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("provider_error");
  });

  it("AI SDK content-filter finish reason -> reject/content_filtered (not a generic cancellation)", () => {
    const gate = gateWith();
    const adapter = new AiSdkStreamAdapter();

    for (const part of [
      { type: "tool-input-start", id: "call-0", toolName: "send_email" },
      { type: "tool-input-delta", id: "call-0", delta: '{"to":"a@example.com","body":"..."' },
      { type: "finish", finishReason: "content-filter" },
    ]) {
      for (const normalized of adapter.push(part)) gate.push(normalized);
    }

    const { decisions } = gate.finish();
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("content_filtered");
    // And specifically NOT the generic bucket a plain "cancelled" would get.
    expect(decision.reason).not.toBe("stream_incomplete");
  });

  it("a resource limit (tool name length) rejects with resource_limit, overriding what would otherwise be 'malformed'", () => {
    const gate = gateWith({ maxToolNameBytes: 3 });
    gate.push(start("call-0", undefined));
    gate.push(nameDelta("call-0", "write_file")); // 10 chars > limit of 3
    gate.push(argsDelta("call-0", "{}"));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("resource_limit");
  });
});

describe("execution gate — concurrency and protocol edge cases", () => {
  it("parallel tool calls each get an independent, correct decision", () => {
    // Stream reason is "complete" here deliberately: the coordinator applies
    // one shared stream-level end reason to every open call when finalizing
    // (see DefaultToolCallStreamCoordinator.finishCall/handleStreamEnd), so
    // a "length"-truncated stream would make even a call whose own JSON is
    // complete non-executable too - that's a real, correct, existing
    // per-stream (not per-call) behavior, not something this test is about.
    // What this test isolates is: one call whose *own* JSON never closes
    // (independent of reason) vs one call that's genuinely complete.
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(start("call-1", "read_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt","content":"unterminated'));
    gate.push(argsDelta("call-1", '{"path":"b.txt"}'));
    gate.push(callEnd("call-1"));
    gate.push(streamEnd("complete"));

    const { decisions } = gate.finish();
    expect(decisions).toHaveLength(2);
    const byName = new Map(decisions.map((d) => [d.name, d]));
    expect(expectDefined(byName.get("write_file")).action).toBe("retry");
    expect(expectDefined(byName.get("read_file")).action).toBe("execute");
  });

  it("duplicate tool_call_start for the same sourceKey poisons the original call (identity conflict -> reject/malformed), diagnostic surfaces globally", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(start("call-0", "write_file")); // duplicate - coordinator attributes the conflict to the original call
    gate.push(argsDelta("call-0", '{"path":"a.txt","content":"hi"}'));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));

    const { decisions, diagnostics } = gate.finish();
    expect(decisions).toHaveLength(1);
    // Structurally, the JSON is perfectly complete - this is specifically
    // proving that a protocol-level identity conflict still fails closed
    // even when the underlying arguments themselves are fine.
    const decision = expectDefined(decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("malformed");
    expect(diagnostics.some((d) => d.code === "E_DUPLICATE_TOOL_CALL_START")).toBe(true);
  });

  it("snapshot() before finish() is always fail-closed: no in-flight call is ever 'execute'", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt","content":"hello"}')); // fully complete already, but stream hasn't ended

    for (const decision of gate.snapshot()) {
      expect(decision.action).not.toBe("execute");
      expect(decision.executable).toBe(false);
    }
  });

  it("finish(meta) with no provider_stream_end ever pushed applies the caller-supplied reason (observable via the provider_error universal check)", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt","content":"hello"}')); // structurally complete

    // No streamEnd(...) pushed - the gate must fall back to meta itself,
    // exactly as the underlying coordinator does. Using "provider_error"
    // here (rather than "cancelled") makes the fallback observable: it's
    // the one reason the universal pre-checks key off directly, so if the
    // gate's own bookkeeping silently stayed at its "unknown" default
    // instead of actually capturing "provider_error", this call would
    // wrongly fall through to a generic stream_incomplete retry instead.
    const decision = expectDefined(gate.finish({ reason: "provider_error" }).decisions[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("provider_error");
  });

  it("finish() with no meta at all doesn't throw (fail-closed default, not a crash)", () => {
    const gate = gateWith();
    gate.push(start("call-0", "f"));
    gate.push(argsDelta("call-0", "{}"));
    expect(() => gate.finish()).not.toThrow();
  });

  it("only the first provider_stream_end is captured — a later/duplicate one can't override it", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt","content":"hi"}'));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("length", "max_tokens"));
    // The coordinator itself would already reject this as
    // E_EVENT_AFTER_STREAM_END, but the gate's own reason-capture must not
    // be fooled into overriding what it already captured either.
    gate.push(streamEnd("provider_error", "should be ignored"));

    const decision = expectDefined(gate.finish().decisions[0]);
    expect(decision.reason).not.toBe("provider_error");
    expect(decision.reason).toBe("stream_incomplete");
  });

  it("snapshot() called after the stream has ended (but before finish()) reflects the real captured reason, not a neutral placeholder", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", '{"path":"a.txt"'));
    gate.push(streamEnd("provider_error", "boom"));
    // finish() deliberately not called - the coordinator already finalized
    // every call once the provider_stream_end event above was pushed.

    const decision = expectDefined(gate.snapshot()[0]);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toBe("provider_error");
  });

  it("drainEvents() exposes the underlying coordinator's raw event stream", () => {
    const gate = gateWith();
    gate.push(start("call-0", "write_file"));
    gate.push(argsDelta("call-0", "{}"));
    gate.push(callEnd("call-0"));
    gate.push(streamEnd("complete"));
    gate.finish();

    const events = gate.drainEvents();
    expect(events.some((e) => e.type === "tool_call_discovered")).toBe(true);
    expect(events.some((e) => e.type === "tool_call_finished")).toBe(true);
  });
});
