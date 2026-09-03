// ---------------------------------------------------------------------------
// P2: Official Anthropic SDK Lifecycle Proof.
//
// Every test in this file drives the REAL, installed `@anthropic-ai/sdk@0.123.0`
// client against a local loopback HTTP/SSE fixture server (Node built-ins
// only - see support/sse-fixture-server.ts). The client's OWN
// `Stream.fromSSEResponse` (node_modules/@anthropic-ai/sdk/core/streaming.js)
// is what turns raw wire bytes into userland event objects; those
// SDK-emitted objects are fed into AnthropicStreamAdapter UNCHANGED - never
// hand-constructed.
//
// One load-bearing wire-protocol detail, confirmed by reading
// core/streaming.js directly: fromSSEResponse only yields a frame whose SSE
// `event:` field name is on its explicit allowlist (message_start,
// content_block_start, content_block_delta, content_block_stop,
// message_delta, message_stop, ping [skipped, not yielded], error [thrown],
// plus several non-Messages-API event names for other Anthropic products).
// Every fixture frame below sets `event:` to match its JSON `type`
// accordingly - a frame with no matching event name is silently never
// yielded at all, unlike OpenAI's much more permissive Responses API filter.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach } from "vitest";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import { AnthropicStreamAdapter } from "../../src/providers/anthropic.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import { sseFrame, startSseFixtureServer, type RunningFixtureServer } from "./support/sse-fixture-server.js";

let server: RunningFixtureServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function client(baseUrl: string): Anthropic {
  return new Anthropic({ apiKey: "sk-ant-test-dummy-not-a-real-key", baseURL: baseUrl, maxRetries: 0 });
}

const messageStart = () =>
  sseFrame("message_start", {
    type: "message_start",
    message: { id: "msg_test1", type: "message", role: "assistant", model: "claude-test", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } },
  });

describe("Anthropic official SDK (@anthropic-ai/sdk@0.123.0): Messages streaming, through the real SDK parser", () => {
  it("(1) normal tool_use lifecycle: id/name/input-JSON-bytes/call-close/terminal-reason/executable authority all survive the real SDK parser end to end, exactly once", async () => {
    server = await startSseFixtureServer({
      chunks: [
        messageStart(),
        sseFrame("ping", { type: "ping" }), // must be silently skipped, not yielded, per fromSSEResponse
        sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_test1", name: "search", input: {} } }),
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":' } }),
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '"test"}' } }),
        sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }),
        sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 10 } }),
        sseFrame("message_stop", { type: "message_stop" }),
      ],
    });

    const stream = await client(server.baseUrl).messages.create({ model: "claude-test", max_tokens: 100, messages: [{ role: "user", content: "hi" }], stream: true });

    const adapter = new AnthropicStreamAdapter();
    const gate = createToolCallExecutionGate();
    let sawUntransformedType = true;
    const yieldedTypes: string[] = [];
    for await (const event of stream) {
      yieldedTypes.push(event.type);
      if (typeof (event as { type?: unknown }).type !== "string") sawUntransformedType = false;
      for (const normalized of adapter.push(event)) gate.push(normalized);
    }
    expect(sawUntransformedType).toBe(true);
    // The `ping` frame must never reach userland at all (filtered by the SDK itself).
    expect(yieldedTypes).toEqual(["message_start", "content_block_start", "content_block_delta", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);

    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.name).toBe("search");
    expect(decision.evidence.structurallyComplete).toBe(true);
    expect(decision.evidence.terminalConfirmed).toBe(true);
    expect(decision.action).toBe("execute");

    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({ q: "test" });
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("(2) truncated JSON: content_block_stop/message_stop arrive but the accumulated partial_json never closes valid JSON - never executable", async () => {
    server = await startSseFixtureServer({
      chunks: [
        messageStart(),
        sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_test2", name: "search", input: {} } }),
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"cut off' } }),
        sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }),
        sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }),
        sseFrame("message_stop", { type: "message_stop" }),
      ],
    });
    const stream = await client(server.baseUrl).messages.create({ model: "claude-test", max_tokens: 100, messages: [{ role: "user", content: "hi" }], stream: true });
    const adapter = new AnthropicStreamAdapter();
    const gate = createToolCallExecutionGate();
    for await (const event of stream) {
      for (const normalized of adapter.push(event)) gate.push(normalized);
    }
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("(3) max_tokens termination: otherwise syntactically-complete JSON must still fail closed, and the adapter maps stop_reason:'max_tokens' to reason:'length'", async () => {
    server = await startSseFixtureServer({
      chunks: [
        messageStart(),
        sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_test3", name: "search", input: {} } }),
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"test"}' } }),
        sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }),
        sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: 100 } }),
        sseFrame("message_stop", { type: "message_stop" }),
      ],
    });
    const stream = await client(server.baseUrl).messages.create({ model: "claude-test", max_tokens: 100, messages: [{ role: "user", content: "hi" }], stream: true });
    const adapter = new AnthropicStreamAdapter();
    const gate = createToolCallExecutionGate();
    for await (const event of stream) {
      for (const normalized of adapter.push(event)) gate.push(normalized);
    }
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    // Ground truth regardless of the specific label: must never execute,
    // even though the JSON itself is syntactically complete.
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  describe("(4) post-terminal event semantics - experimentally determined, not assumed [CRITICAL]", () => {
    it("the real SDK has NO [DONE]-style sentinel anywhere in its streaming pipeline - it keeps parsing and YIELDING SSE frames the server sends after message_stop, up until the connection actually closes", async () => {
      server = await startSseFixtureServer({
        chunks: [
          messageStart(),
          sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_test4", name: "search", input: {} } }),
          sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"q":"test"}' } }),
          sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }),
          sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 10 } }),
          sseFrame("message_stop", { type: "message_stop" }),
          // Written on the SAME connection, after message_stop, before close.
          sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"evil":true}' } }),
        ],
      });

      const stream = await client(server.baseUrl).messages.create({ model: "claude-test", max_tokens: 100, messages: [{ role: "user", content: "hi" }], stream: true });
      // Drain the REAL SDK stream fully first - proves the SDK itself
      // yielded the post-terminal frame. Feeding is then split into two
      // phases purely so the gate's pre-late-evidence decision can be read
      // before it is revoked (same two-phase pattern used throughout this
      // repo's other post-terminal regressions).
      const rawEvents: Array<{ type: string }> = [];
      for await (const event of stream) rawEvents.push(event);

      // FINDING: unlike OpenAI's Chat Completions [DONE] sentinel (which the
      // SDK itself refuses to look past), Anthropic's SDK has no
      // equivalent anywhere - this post-message_stop frame IS handed to
      // userland.
      expect(rawEvents.map((e) => e.type)).toEqual(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop", "content_block_delta"]);

      const adapter = new AnthropicStreamAdapter();
      const gate = createToolCallExecutionGate();
      const legitimate = rawEvents.slice(0, 6); // up to and including message_stop
      const lateEvidence = rawEvents.slice(6); // written after message_stop, same connection

      for (const event of legitimate) for (const normalized of adapter.push(event)) gate.push(normalized);
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");

      for (const event of lateEvidence) for (const normalized of adapter.push(event)) gate.push(normalized);
      // P0's coordinator-level post-terminal defense (GHSA-3xpw-9694-2xxp)
      // must still hold end to end through the real SDK.
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });
  });

  it("P4.2 F-1: content_block_stop seals the block against later real-SDK-yielded input_json_delta for the same index (L3 regression; RED pre-fix)", async () => {
    // Exact adversarial sequence from the P4 audit's F-1 finding: the
    // block is left structurally UNCLOSED before content_block_stop
    // (matching a real truncation/interruption shape - see
    // examples/anthropic-truncation-safety.mjs's own confirmed real-
    // protocol shape: Anthropic still closes the in-progress block even
    // when cut short), then a later delta for the SAME index closes it
    // while injecting content. Per test (4) above, the real SDK's own
    // async iterator has already been proven to yield every SSE frame
    // written on this connection with no [DONE]-style sentinel at all -
    // so this exact adversarial shape is expected to survive real SDK
    // parsing unchanged.
    server = await startSseFixtureServer({
      chunks: [
        messageStart(),
        sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_f1", name: "toolA", input: {} } }),
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"a":1' } }),
        sseFrame("content_block_stop", { type: "content_block_stop", index: 0 }),
        // Late evidence for the SAME index, written on the same
        // connection after content_block_stop, closing the object with
        // injected content.
        sseFrame("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: ',"evil":true}' } }),
        sseFrame("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 10 } }),
        sseFrame("message_stop", { type: "message_stop" }),
      ],
    });

    const stream = await client(server.baseUrl).messages.create({ model: "claude-test", max_tokens: 100, messages: [{ role: "user", content: "hi" }], stream: true });
    const rawEvents: Array<{ type: string }> = [];
    for await (const event of stream) rawEvents.push(event);

    // Official-SDK-parser reachability proof: every frame, including the
    // adversarial late delta, was yielded by the real @anthropic-ai/sdk
    // client unchanged, in order - not filtered, transformed, or dropped.
    expect(rawEvents.map((e) => e.type)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_delta",
      "message_delta",
      "message_stop",
    ]);
    const lateDeltaEvent = rawEvents[4] as { index?: number; delta?: { partial_json?: string } };
    expect(lateDeltaEvent.index).toBe(0); // same block index, survives real SDK parsing unchanged
    expect(lateDeltaEvent.delta?.partial_json).toBe(',"evil":true}');

    const adapter = new AnthropicStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const event of rawEvents) for (const normalized of adapter.push(event)) gate.push(normalized);

    // Universal documented lifecycle (docs/EXECUTION_GATE.md#example):
    // message_delta already observed a genuine provider-level terminal
    // above, so adapter.finish() here must be the standard idempotent
    // no-op every adapter guarantees - no Anthropic-specific exception.
    const finishEvents = adapter.finish();
    expect(finishEvents).toEqual([]);
    for (const normalized of finishEvents) gate.push(normalized);

    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);

    // REQUIRED INVARIANT (genuine RED on pre-fix production, L3-confirmed
    // via the real SDK-yielded events above - see P4 audit finding F-1:
    // pre-fix this was {action:"execute", reason:"complete",
    // value:{a:1,evil:true}}, takeDecision() returned the full live
    // authority with the injected value):
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  describe("(5) in-stream error behavior - experimentally determined, not assumed", () => {
    it("a raw `event: error` SSE frame is surfaced as a THROWN APIError from the SDK's async iterator, never yielded as a { type: 'error' } object", async () => {
      server = await startSseFixtureServer({
        chunks: [
          messageStart(),
          sseFrame("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_test5", name: "search", input: {} } }),
          sseFrame("error", { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }),
        ],
      });

      const stream = await client(server.baseUrl).messages.create({ model: "claude-test", max_tokens: 100, messages: [{ role: "user", content: "hi" }], stream: true });
      const seenTypes: string[] = [];
      let thrown: unknown;
      try {
        for await (const event of stream) {
          seenTypes.push(event.type);
        }
      } catch (e) {
        thrown = e;
      }

      expect(seenTypes).toEqual(["message_start", "content_block_start"]); // the error event itself is never yielded
      expect(thrown).toBeInstanceOf(APIError);

      // FINDING: AnthropicStreamAdapter has a `case "error":` branch
      // (anthropic.ts) that treats a yielded {type:"error",...} object as a
      // normal provider_stream_end. Given the above, that branch is
      // UNREACHABLE via this real SDK's streaming entrypoint for a
      // wire-level `event: error` frame - RawMessageStreamEvent's own type
      // union (message_start|message_delta|message_stop|content_block_start|
      // content_block_delta|content_block_stop) does not even include an
      // "error" member; the SDK intercepts and throws before anything
      // reaches the for-await loop. Not a security gap (an unhandled throw
      // aborts stream consumption at least as fail-closed as the adapter's
      // own diagnostic would - no event ever reaches push()), but a real
      // adapter-contract/dead-code finding, reported as such.
    });
  });
});
