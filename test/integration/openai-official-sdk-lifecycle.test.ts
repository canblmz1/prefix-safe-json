// ---------------------------------------------------------------------------
// P2: Official OpenAI SDK Lifecycle Proof.
//
// Every test in this file drives the REAL, installed `openai@7.8.0` client
// against a local loopback HTTP/SSE fixture server (Node built-ins only -
// see support/sse-fixture-server.ts). The client's OWN `Stream.fromSSEResponse`
// (node_modules/openai/core/streaming.js) is what turns the raw wire bytes
// into the userland event/chunk objects; those SDK-emitted objects are fed
// into OpenAIStreamAdapter UNCHANGED - never hand-constructed. This is
// strictly stronger evidence than P0/P1/the legacy-function-call bugfix
// phase, all of which validated the adapter against hand-built
// NormalizedToolStreamEvent-shaped or hand-built SDK-event-shaped objects.
//
// Fixture JSON bodies are intentionally MINIMAL, not full-schema-valid
// `Response`/`ChatCompletionChunk` payloads: they carry exactly the fields
// OpenAIStreamAdapter reads (plus enough surrounding structure to be
// readable), because TypeScript's `Response`/event interfaces are
// compile-time-only - the SDK does not runtime-validate a parsed SSE
// payload against them, so a field this file never sets is simply
// `undefined` on the SDK-emitted object.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach } from "vitest";
import OpenAI, { APIError } from "openai";
import { OpenAIStreamAdapter } from "../../src/providers/openai.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import { sseFrame, startSseFixtureServer, type RunningFixtureServer } from "./support/sse-fixture-server.js";

let server: RunningFixtureServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function client(baseUrl: string): OpenAI {
  return new OpenAI({ apiKey: "sk-test-dummy-not-a-real-key", baseURL: baseUrl, maxRetries: 0 });
}

describe("OpenAI official SDK (openai@7.8.0): Responses API streaming, through the real SDK parser", () => {
  it("(A) happy path: tool identity, argument bytes, call close, terminal evidence all survive the real SDK parser end to end, and takeDecision() fires exactly once", async () => {
    server = await startSseFixtureServer({
      chunks: [
        sseFrame("response.output_item.added", {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "function_call", id: "fc_test_1", call_id: "call_test_1", name: "search", arguments: "", status: "in_progress" },
          sequence_number: 1,
        }),
        sseFrame("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta", item_id: "fc_test_1", output_index: 0, delta: '{"q":', sequence_number: 2,
        }),
        sseFrame("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta", item_id: "fc_test_1", output_index: 0, delta: '"test"}', sequence_number: 3,
        }),
        sseFrame("response.function_call_arguments.done", {
          type: "response.function_call_arguments.done", item_id: "fc_test_1", output_index: 0, name: "search", arguments: '{"q":"test"}', sequence_number: 4,
        }),
        sseFrame("response.output_item.done", {
          type: "response.output_item.done", output_index: 0,
          item: { type: "function_call", id: "fc_test_1", call_id: "call_test_1", name: "search", arguments: '{"q":"test"}', status: "completed" },
          sequence_number: 5,
        }),
        sseFrame("response.completed", {
          type: "response.completed", sequence_number: 6, response: { id: "resp_test_1", status: "completed", output: [] },
        }),
      ],
    });

    const stream = await client(server.baseUrl).responses.create({ model: "gpt-4o-mini", input: "irrelevant - server response is canned", stream: true });

    const adapter = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    let sawUntransformedType = true;
    for await (const event of stream) {
      // Adapter-contract check: the raw SDK-emitted object must be feedable
      // to the adapter with NO transformation. If this ever needed a shape
      // change first, that is itself a reportable adapter-contract finding.
      if (typeof (event as { type?: unknown }).type !== "string") sawUntransformedType = false;
      for (const normalized of adapter.push(event)) gate.push(normalized);
    }
    expect(sawUntransformedType).toBe(true);

    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.name).toBe("search");
    expect(decision.evidence.structurallyComplete).toBe(true);
    expect(decision.evidence.terminalConfirmed).toBe(true);
    expect(decision.action).toBe("execute");

    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({ q: "test" });
    // Exactly once: a second take must yield nothing.
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  it("(B) truncated/length termination (response.incomplete, max_output_tokens): never executable even with syntactically-plausible partial JSON", async () => {
    server = await startSseFixtureServer({
      chunks: [
        sseFrame("response.output_item.added", {
          type: "response.output_item.added", output_index: 0,
          item: { type: "function_call", id: "fc_test_2", call_id: "call_test_2", name: "search", arguments: "", status: "in_progress" },
          sequence_number: 1,
        }),
        sseFrame("response.function_call_arguments.delta", {
          type: "response.function_call_arguments.delta", item_id: "fc_test_2", output_index: 0, delta: '{"q":"cut off', sequence_number: 2,
        }),
        sseFrame("response.incomplete", {
          type: "response.incomplete", sequence_number: 3,
          response: { id: "resp_test_2", status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
        }),
      ],
    });

    const stream = await client(server.baseUrl).responses.create({ model: "gpt-4o-mini", input: "irrelevant", stream: true });
    const adapter = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    for await (const event of stream) {
      for (const normalized of adapter.push(event)) gate.push(normalized);
    }
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });

  describe("(C) post-terminal event semantics - experimentally determined, not assumed [CRITICAL]", () => {
    it("Responses API: the real SDK has NO [DONE]-style sentinel for this endpoint - it keeps parsing and YIELDING SSE frames the server sends after response.completed, up until the connection actually closes", async () => {
      server = await startSseFixtureServer({
        chunks: [
          sseFrame("response.output_item.added", {
            type: "response.output_item.added", output_index: 0,
            item: { type: "function_call", id: "fc_test_3", call_id: "call_test_3", name: "search", arguments: "", status: "in_progress" },
            sequence_number: 1,
          }),
          sseFrame("response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta", item_id: "fc_test_3", output_index: 0, delta: '{"q":"test"}', sequence_number: 2,
          }),
          sseFrame("response.output_item.done", {
            type: "response.output_item.done", output_index: 0,
            item: { type: "function_call", id: "fc_test_3", call_id: "call_test_3", name: "search", arguments: '{"q":"test"}', status: "completed" },
            sequence_number: 3,
          }),
          sseFrame("response.completed", {
            type: "response.completed", sequence_number: 4, response: { id: "resp_test_3", status: "completed", output: [] },
          }),
          // Bytes written AFTER the terminal event, on the SAME connection,
          // before it closes. This is the experiment: does the SDK's own
          // async iterator yield this to userland, or silently discard it?
          sseFrame("response.function_call_arguments.delta", {
            type: "response.function_call_arguments.delta", item_id: "fc_test_3", output_index: 0, delta: '{"evil":true}', sequence_number: 5,
          }),
        ],
      });

      const stream = await client(server.baseUrl).responses.create({ model: "gpt-4o-mini", input: "irrelevant", stream: true });
      // Drain the REAL SDK stream fully first - this is what proves the SDK
      // itself yielded the post-terminal frame (nothing about WHEN the
      // harness later feeds these already-real, already-SDK-emitted objects
      // into the adapter/gate affects that fact). Splitting the feed into
      // two phases below is a test-harness concern only, so the gate's
      // pre-late-evidence decision can be read before it is revoked -
      // exactly the two-phase pattern used throughout this repo's other
      // post-terminal regressions (e.g.
      // openai-legacy-function-call-termination.test.ts).
      const rawEvents: unknown[] = [];
      for await (const event of stream) rawEvents.push(event);

      expect(rawEvents.map((e) => (e as { type: string }).type)).toEqual([
        "response.output_item.added",
        "response.function_call_arguments.delta",
        "response.output_item.done",
        "response.completed",
        "response.function_call_arguments.delta",
      ]);
      // FINDING: the SDK's own async iterator DOES yield the post-terminal
      // frame (proving this is not defense-in-depth-only for the Responses
      // API - a real server or MITM proxy sending a late frame on an
      // already-"completed" stream is something the real openai@7.8.0
      // client will hand to application code, exactly like the
      // GHSA-3xpw-9694-2xxp scenario P0 defends against).

      const adapter = new OpenAIStreamAdapter();
      const gate = createToolCallExecutionGate();
      const legitimate = rawEvents.slice(0, 4); // up to and including response.completed
      const lateEvidence = rawEvents.slice(4); // written after the terminal event, same connection

      for (const event of legitimate) for (const normalized of adapter.push(event)) gate.push(normalized);
      // Real, unconsumed authority must exist BEFORE the late evidence -
      // read via finish()'s returned decisions, never takeDecision(), which
      // would consume it and make the second half of this test meaningless.
      const final = gate.finish();
      const decision = expectDefined(final.decisions[0]);
      expect(decision.action).toBe("execute");

      for (const event of lateEvidence) for (const normalized of adapter.push(event)) gate.push(normalized);
      // The coordinator's post-terminal defense (P0) must still hold when
      // fed through this real end-to-end path.
      expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    });

    it("Chat Completions: contrasts with the above - [DONE] IS a real sentinel here, and the SDK's own iterator never yields anything the server writes after it, even on the same connection", async () => {
      server = await startSseFixtureServer({
        chunks: [
          sseFrame(null, { id: "chatcmpl-t4", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { function_call: { name: "search", arguments: '{"q":"test"}' } }, finish_reason: null }] }),
          sseFrame(null, { id: "chatcmpl-t4", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
          sseFrame(null, "[DONE]"),
          // Written on the same connection, after [DONE]. Per
          // core/streaming.js's fromSSEResponse, `receivedCompletionSentinel`
          // causes the loop to `break` the instant `[DONE]` is seen - bytes
          // after it are never even handed to the SSE decoder's caller.
          sseFrame(null, { id: "chatcmpl-t4", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { function_call: { arguments: '{"evil":true}' } }, finish_reason: null }] }),
        ],
      });

      const stream = await client(server.baseUrl).chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });
      const yieldedCount = { n: 0 };
      for await (const _chunk of stream) {
        yieldedCount.n += 1;
      }
      expect(yieldedCount.n).toBe(2); // the two real chunks - never the post-[DONE] one.
    });
  });

  describe("(D) in-stream error behavior - experimentally determined, not assumed", () => {
    it("Responses API: a raw `event: error` SSE frame is surfaced as a THROWN APIError from the SDK's async iterator, never yielded as a { type: 'error' } object", async () => {
      server = await startSseFixtureServer({
        chunks: [
          sseFrame("response.output_item.added", {
            type: "response.output_item.added", output_index: 0,
            item: { type: "function_call", id: "fc_test_5", call_id: "call_test_5", name: "search", arguments: "", status: "in_progress" },
            sequence_number: 1,
          }),
          sseFrame("error", { type: "error", code: null, message: "boom", param: null, sequence_number: 2 }),
        ],
      });

      const stream = await client(server.baseUrl).responses.create({ model: "gpt-4o-mini", input: "irrelevant", stream: true });
      const seenTypes: string[] = [];
      let thrown: unknown;
      try {
        for await (const event of stream) {
          seenTypes.push((event as { type: string }).type);
        }
      } catch (e) {
        thrown = e;
      }

      expect(seenTypes).toEqual(["response.output_item.added"]); // the error event itself is never yielded
      expect(thrown).toBeInstanceOf(APIError);

      // FINDING: OpenAIStreamAdapter has a `chunk.type === "error"` branch
      // (openai.ts) that treats a yielded `{type:"error",...}` object as a
      // normal provider_stream_end. Given the above, that branch is
      // UNREACHABLE via this real SDK's streaming entrypoint for a wire-level
      // `event: error` frame - the SDK intercepts and throws first. This is
      // not a security gap (the throw must be handled by the stream-driving
      // code, and an unhandled throw is at least as fail-closed as the
      // adapter's own diagnostic would have been - no event ever reaches
      // push() for the caller to mishandle into an executable decision) but
      // it IS a real adapter-contract/dead-code finding, reported as such.
    });
  });
});

describe("OpenAI official SDK (openai@7.8.0): Chat Completions streaming, through the real SDK parser", () => {
  it("Legacy singular function_call: end-to-end proof that the 2f4f76f fix holds against REAL SDK-parsed chunks, not just hand-built ones", async () => {
    server = await startSseFixtureServer({
      chunks: [
        sseFrame(null, { id: "chatcmpl-legacy1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { function_call: { name: "search", arguments: "" } }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-legacy1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { function_call: { arguments: '{"q":' } }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-legacy1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { function_call: { arguments: '"test"}' } }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-legacy1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        sseFrame(null, "[DONE]"),
      ],
    });

    const stream = await client(server.baseUrl).chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });
    const adapter = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    for await (const chunk of stream) {
      for (const normalized of adapter.push(chunk)) gate.push(normalized);
    }
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.name).toBe("search");
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({ q: "test" });
  });

  it("Legacy singular function_call: SDK types DO expose this shape at openai@7.8.0 (the field survives real SDK parsing) - the harness proves parser support, not that current live models still emit it", async () => {
    // This test's own passing is itself the proof requested by the task:
    // if openai@7.8.0's ChatCompletionChunk.Choice.Delta had dropped the
    // deprecated `function_call` field from what the SDK actually returns
    // at runtime, `chunk.choices[0].delta.function_call` below would be
    // undefined and the adapter would never see a tool_call_start.
    server = await startSseFixtureServer({
      chunks: [
        sseFrame(null, { id: "chatcmpl-legacy2", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { function_call: { name: "ping", arguments: "{}" } }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-legacy2", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
        sseFrame(null, "[DONE]"),
      ],
    });
    const stream = await client(server.baseUrl).chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });
    let sawLegacyField = false;
    const adapter = new OpenAIStreamAdapter();
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.function_call) sawLegacyField = true;
      adapter.push(chunk);
    }
    expect(sawLegacyField).toBe(true);
  });

  it("content_filter finish_reason on the legacy function_call path: not in the adapter's explicit reason table, but still fails closed (falls to 'unknown', never 'complete')", async () => {
    // finish_reason: 'content_filter' is a real, officially-typed value
    // (ChatCompletionChunk.Choice.finish_reason) that OpenAIStreamAdapter's
    // legacy branch does not special-case the way its Responses API branch
    // special-cases response.incomplete's content_filter reason (no
    // CONTENT_FILTERED_DIAGNOSTIC_CODE is raised here). Verifying the one
    // invariant that actually matters: this never becomes executable.
    server = await startSseFixtureServer({
      chunks: [
        sseFrame(null, { id: "chatcmpl-cf1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { function_call: { name: "search", arguments: '{"q":"test"}' } }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-cf1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: {}, finish_reason: "content_filter" }] }),
        sseFrame(null, "[DONE]"),
      ],
    });
    const stream = await client(server.baseUrl).chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });
    const adapter = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    const diagnosticCodes: string[] = [];
    for await (const chunk of stream) {
      for (const normalized of adapter.push(chunk)) {
        if (normalized.type === "provider_diagnostic") diagnosticCodes.push(normalized.code);
        gate.push(normalized);
      }
    }
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).not.toBe("execute");
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
    expect(diagnosticCodes).not.toContain("E_CONTENT_FILTERED");
  });

  it("New-style tool_calls, SAME chunk as finish_reason: delegates and executes correctly end to end", async () => {
    // Isolates the shape that works, in contrast to the NEW OFFICIAL-SDK
    // MISMATCH finding below: here `tool_calls` is present in the very
    // delta that also carries finish_reason, so openai.ts's own per-chunk
    // delegation gate (`chunk.choices?.[0]?.delta?.tool_calls !== undefined`)
    // is satisfied and the whole chunk is correctly routed to
    // OpenAICompatibleStreamAdapter, which closes the call itself.
    server = await startSseFixtureServer({
      chunks: [
        sseFrame(null, { id: "chatcmpl-tc1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "search", arguments: "" } }] }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-tc1", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"test"}' } }] }, finish_reason: "tool_calls" }] }),
        sseFrame(null, "[DONE]"),
      ],
    });
    const stream = await client(server.baseUrl).chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });
    const adapter = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    for await (const chunk of stream) {
      for (const normalized of adapter.push(chunk)) gate.push(normalized);
    }
    // choice.finish_reason is choice-local (see
    // OpenAICompatibleStreamAdapter's class-level lifecycle-contract doc,
    // inherited unchanged by this delegating OpenAIStreamAdapter): the ONE
    // provider_stream_end comes from finish(), called once the raw SDK
    // iterator above is drained.
    for (const normalized of adapter.finish()) gate.push(normalized);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.name).toBe("search");
    expect(decision.action).toBe("execute");
    const authority = expectDefined(gate.takeDecision(decision.internalId));
    expect(authority.value).toEqual({ q: "test" });
  });

  it("new-style tool_calls with a separate empty-delta finish_reason chunk closes and executes", async () => {
    // A separate empty-delta finish_reason terminal shape, accepted and
    // exposed by the real openai@7.8.0 SDK parser in this deterministic
    // fixture (proven below). This harness proves SDK-parser compatibility
    // with the shape; it does not claim that every current live OpenAI
    // model/request emits this exact sequence. The LAST chunk carries
    // `finish_reason` with an EMPTY `delta: {}` - no `tool_calls` key at
    // all on that specific chunk (openai@7.8.0's own
    // ChatCompletionChunk.Choice.Delta.tool_calls is typed optional,
    // consistent with this).
    //
    // Formerly a NEW OFFICIAL-SDK MISMATCH (see fix/openai-tool-calls-terminal-routing):
    // openai.ts's old delegation gate was evaluated PER CHUNK
    // (`chunk.choices?.[0]?.delta?.tool_calls !== undefined`), so this exact
    // terminal chunk fell through into the unrelated legacy function_call
    // loop instead of reaching OpenAICompatibleStreamAdapter, leaving the
    // tracked call's tool_call_end never emitted -
    // coordinator.ts's handleStreamEnd() then raised
    // E_STREAM_ENDED_WITH_OPEN_CALL and forced outcome:"invalid" even
    // though the JSON was complete and valid. Fixed by a sticky
    // `hasCompatibleToolCalls` stream-mode flag: once a genuine plural
    // tool_calls delta is observed, every later Chat Completions chunk
    // (including this empty-delta terminal one) continues through
    // OpenAICompatibleStreamAdapter for the rest of the stream's lifetime.
    server = await startSseFixtureServer({
      chunks: [
        sseFrame(null, { id: "chatcmpl-tc2", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_abc2", type: "function", function: { name: "search", arguments: "" } }] }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-tc2", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-tc2", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-tc2", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
        sseFrame(null, "[DONE]"),
      ],
    });
    const stream = await client(server.baseUrl).chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });

    // Adapter-contract check: confirm the real SDK really did parse the
    // terminal chunk with an empty delta and no tool_calls key, i.e. this
    // is not a fixture artifact.
    const rawChunks: Array<{ choices: Array<{ delta: { tool_calls?: unknown }; finish_reason: string | null }> }> = [];
    for await (const chunk of stream) rawChunks.push(chunk);
    const terminalChunk = expectDefined(rawChunks.find((c) => c.choices[0]?.finish_reason != null));
    expect(terminalChunk.choices[0]?.delta.tool_calls).toBeUndefined();

    const adapter = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    for (const chunk of rawChunks) for (const normalized of adapter.push(chunk)) gate.push(normalized);
    // The terminal chunk's own finish_reason only closes the call
    // choice-locally; finish() (called once the raw SDK iterator above is
    // fully drained) is what emits the real provider_stream_end.
    for (const normalized of adapter.finish()) gate.push(normalized);
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

  it("new-style tool_calls, separate terminal chunk: post-terminal evidence arriving BEFORE [DONE] on the real SDK still reaches the coordinator and revokes unconsumed authority (P0 preserved end to end)", async () => {
    // Chat Completions uses [DONE] as its true SDK-level stop sentinel (see
    // the (C) contrast test above), but a chunk written AFTER the
    // finish_reason terminal and BEFORE [DONE], on the same connection, is
    // still real evidence the official SDK hands to userland - this proves
    // the fix does not create a new GHSA-3xpw-9694-2xxp-class gap for the
    // newly-corrected routing path.
    server = await startSseFixtureServer({
      chunks: [
        sseFrame(null, { id: "chatcmpl-tc3", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_abc3", type: "function", function: { name: "search", arguments: '{"q":"test"}' } }] }, finish_reason: null }] }),
        sseFrame(null, { id: "chatcmpl-tc3", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
        // Late evidence: written after the terminal chunk, BEFORE [DONE].
        sseFrame(null, { id: "chatcmpl-tc3", object: "chat.completion.chunk", created: 1, model: "gpt-4o-mini", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"evil":true}' } }] }, finish_reason: null }] }),
        sseFrame(null, "[DONE]"),
      ],
    });
    const stream = await client(server.baseUrl).chat.completions.create({ model: "gpt-4o-mini", messages: [{ role: "user", content: "hi" }], stream: true });

    const rawChunks: unknown[] = [];
    for await (const chunk of stream) rawChunks.push(chunk);
    expect(rawChunks).toHaveLength(3); // the late chunk before [DONE] IS yielded; [DONE] itself is not.

    const adapter = new OpenAIStreamAdapter();
    const gate = createToolCallExecutionGate();
    const legitimate = rawChunks.slice(0, 2); // tool_calls delta + separate finish_reason terminal
    const lateEvidence = rawChunks.slice(2); // the late chunk before [DONE]

    for (const chunk of legitimate) for (const normalized of adapter.push(chunk)) gate.push(normalized);
    // A genuine, clean "execute" terminal requires finish() - the
    // separate terminal chunk above only closes the call choice-locally.
    for (const normalized of adapter.finish()) gate.push(normalized);
    const final = gate.finish();
    const decision = expectDefined(final.decisions[0]);
    expect(decision.action).toBe("execute");

    for (const chunk of lateEvidence) for (const normalized of adapter.push(chunk)) gate.push(normalized);
    expect(gate.takeDecision(decision.internalId)).toBeUndefined();
  });
});

describe("OpenAI official SDK (openai@7.8.0): adapter-contract nuance - ResponseFunctionToolCall.id is typed optional", () => {
  it("a real SDK-parsed output_item.added with no item.id present emits no tool_call_start (documented adapter behavior, not a crash)", async () => {
    server = await startSseFixtureServer({
      chunks: [
        sseFrame("response.output_item.added", {
          type: "response.output_item.added", output_index: 0,
          item: { type: "function_call", call_id: "call_test_6", name: "search", arguments: "", status: "in_progress" }, // no `id`
          sequence_number: 1,
        }),
      ],
    });
    const stream = await client(server.baseUrl).responses.create({ model: "gpt-4o-mini", input: "irrelevant", stream: true });
    const adapter = new OpenAIStreamAdapter();
    let idWasUndefined = false;
    const events = [];
    for await (const event of stream) {
      const item = (event as { item?: { id?: string } }).item;
      if (item && !("id" in item ? item.id : undefined)) idWasUndefined = true;
      events.push(...adapter.push(event));
    }
    expect(idWasUndefined).toBe(true); // confirms the SDK really did parse it through with no `id`, not just our fixture's intent
    expect(events).toHaveLength(0);
  });
});
