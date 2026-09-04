// ---------------------------------------------------------------------------
// Official Google GenAI SDK (`@google/genai`) lifecycle proof, mirroring
// test/integration/openai-official-sdk-lifecycle.test.ts and
// anthropic-official-sdk-lifecycle.test.ts exactly: real bytes on a real
// local loopback socket (test/integration/support/sse-fixture-server.ts,
// Node built-ins only), so the REAL official SDK's OWN HTTP/SSE parser is
// what turns them into userland `GenerateContentResponse` objects - never
// hand-constructed here. No API key value is ever sent anywhere but this
// local fixture server; no network, no live provider, no credentials.
//
// The SDK client is pointed at the local fixture via `httpOptions.baseUrl`
// (GoogleGenAIOptions, see node_modules/@google/genai/dist/genai.d.ts) -
// the same mechanism openai-node's own `baseURL` option and Anthropic's
// `baseURL` option already use in the sibling harnesses.
// ---------------------------------------------------------------------------
import { describe, it, expect, afterEach } from "vitest";
import { GoogleGenAI } from "@google/genai";
import { GeminiStreamAdapter } from "../../src/providers/gemini.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import { expectDefined } from "../utils/expect-defined.js";
import { sseFrame, startSseFixtureServer, type RunningFixtureServer } from "./support/sse-fixture-server.js";

let server: RunningFixtureServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("Official Google GenAI SDK (@google/genai): generateContentStream, through the real SDK parser", () => {
  it("Candidate.index survives real SDK parsing, in wire order that does NOT match array position - the exact premise this Phase B.1/B.4 correction rests on", async () => {
    server = await startSseFixtureServer({
      chunks: [
        // Deliberately candidate index 1 listed BEFORE candidate index 0 in
        // this raw chunk's own `candidates` array - proves the SDK exposes
        // `.index` as real, independent data, not merely an echo of
        // wherever the SDK itself might place entries positionally.
        sseFrame(null, {
          candidates: [
            { index: 1, content: { parts: [{ text: "b" }] } },
            { index: 0, content: { parts: [{ text: "a" }] }, finishReason: "STOP" },
          ],
        }),
      ],
    });
    const ai = new GoogleGenAI({ apiKey: "fixture-key", httpOptions: { baseUrl: server.baseUrl } });
    const stream = await ai.models.generateContentStream({ model: "gemini-2.5-flash", contents: "hello" });

    const chunks: unknown[] = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(chunks).toHaveLength(1);
    const candidates = (chunks[0] as { candidates?: Array<{ index?: number; finishReason?: string }> }).candidates;
    expect(candidates).toBeDefined();
    expect(candidates).toHaveLength(2);
    // Array position 0 is wire index 1; array position 1 is wire index 0 -
    // the SDK preserves both real index values, unreordered, exactly as
    // sent - proving `.index` is real, independent, SDK-surfaced data.
    expect(candidates?.[0]?.index).toBe(1);
    expect(candidates?.[1]?.index).toBe(0);
    expect(candidates?.[1]?.finishReason).toBe("STOP");
  });

  it("P4.4 (Phase B.1) GREEN (fixed - was genuine RED pre-fix, see this test's own git history/the accompanying report for the captured pre-fix misattribution): candidate wire index 0 terminates in chunk 1; candidate wire index 1 (still active) arrives ALONE in chunk 2, at array position 0 - real SDK-parsed chunks, no placeholder candidates inserted, provider evidence drives the test rather than being reshaped to fit the adapter", async () => {
    server = await startSseFixtureServer({
      chunks: [
        // Chunk 1: two real candidates, explicit wire indexes, ordinary
        // array order (0 then 1). Candidate 0 finishes; candidate 1 is
        // still generating (no finishReason yet).
        sseFrame(null, {
          candidates: [
            { index: 0, content: { parts: [{ functionCall: { name: "toolA", args: { a: 1 } } }] }, finishReason: "STOP" },
            { index: 1, content: { parts: [{ functionCall: { name: "toolB", args: { b: 2 } } }] } },
          ],
        }),
        // Chunk 2: the raw provider event contains ONLY candidate wire
        // index 1 - a completely realistic shape (candidate 0 has nothing
        // further to say once finished; the provider has no reason to
        // keep re-sending it). At JS array position 0 - the exact
        // situation array-position identity could not have distinguished
        // from candidate 0. A leading text part (realistic: the model may
        // emit commentary before a second tool call) is kept for shape
        // continuity with the original P4.4 version of this test, though
        // under P4.5 candidate-1 call identity no longer depends on part
        // position at all (see gemini.ts's own class-level doc comment) -
        // "toolB2" gets candidate 1's own 1st no-id occurrence regardless
        // of where in this chunk's parts[] array it appears.
        sseFrame(null, {
          candidates: [
            { index: 1, content: { parts: [{ text: "continuing" }, { functionCall: { name: "toolB2", args: { more: true } } }] } },
          ],
        }),
      ],
    });
    const ai = new GoogleGenAI({ apiKey: "fixture-key", httpOptions: { baseUrl: server.baseUrl } });
    const stream = await ai.models.generateContentStream({ model: "gemini-2.5-flash", contents: "hello" });

    const gate = createToolCallExecutionGate();
    const adapter = new GeminiStreamAdapter();
    const capturedEventsPerChunk: Array<Array<{ type: string; code?: string; callRef?: { sourceKey?: string } }>> = [];
    for await (const chunk of stream) {
      const events = adapter.push(chunk) as unknown as Array<{ type: string; code?: string; callRef?: { sourceKey?: string } }>;
      capturedEventsPerChunk.push(events);
      for (const e of events) gate.push(e as never);
    }

    // Chunk 2's evidence is attributed to candidate 1's own real identity -
    // NEVER to anything under candidate 0, which array position would
    // have implied pre-P4.4/P4.5.
    const chunk2SourceKeys = capturedEventsPerChunk[1]?.map((e) => e.callRef?.sourceKey).filter(Boolean);
    expect(chunk2SourceKeys).toContain("candidate:1/function-call:1");
    expect(chunk2SourceKeys?.some((k) => k?.startsWith("candidate:0/"))).toBe(false);
    // No anomaly diagnostic against candidate 0 fired either (the
    // unconditional, expected PROJECTION_ONLY diagnostic is fine and
    // present - this checks specifically for the disqualifying
    // TOOL_ARGUMENTS_AFTER_END shape, which pre-fix WOULD have fired
    // against candidate 0's own already-closed call): this genuinely is
    // clean, new, unrelated evidence for the still-open candidate 1, not
    // late evidence for the already-closed candidate 0.
    expect(capturedEventsPerChunk[1]?.some((e) => e.code === "E_TOOL_ARGUMENTS_AFTER_END")).toBe(false);
    expect(capturedEventsPerChunk[1]?.some((e) => e.callRef?.sourceKey?.startsWith("candidate:1"))).toBe(true);

    for (const e of adapter.finish()) gate.push(e as never);
    const final = gate.finish();
    const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
    // candidate 0's own call is entirely unaffected by any of candidate 1's
    // evidence, in either chunk.
    expect(a.action).not.toBe("execute"); // still projection_only - the epistemic boundary this whole fix respects
    expect((a as { reason?: string }).reason).toBe("projection_only");
  });

  it("P4.5 GREEN (fixed - was genuine RED pre-fix, captured via a throwaway probe before this fix was written, not merely inferred): two genuinely DIFFERENT function calls, each carrying its own official `FunctionCall.id`, land at the SAME part-array-position in their own respective chunks under the SAME candidate - real SDK-parsed chunks prove both ids survive parsing; the fixed adapter must isolate them into two independent, cleanly-attributed calls rather than the second colliding with and corrupting the first's already-closed identity", async () => {
    server = await startSseFixtureServer({
      chunks: [
        sseFrame(null, {
          candidates: [{
            index: 0,
            content: { parts: [{ functionCall: { id: "call-A", name: "toolA", args: { a: 1 } } }] },
          }],
        }),
        // Second, entirely separate functionCall - its own real id, own
        // name, own args - delivered in a LATER chunk, at part-array-
        // position 0 again (the exact coordinate the first call already
        // used and closed). Pre-fix this collided with "toolA"'s own
        // already-closed sourceKey (candidate:0/part:0 for both), which
        // the coordinator's own duplicate-start guard caught as
        // E_DUPLICATE_TOOL_CALL_START while "toolB"'s own arguments were
        // fed into "toolA"'s already-complete parser and flagged as
        // trailing garbage - "toolB" never surfaced as its own decision
        // at all. Not an execution-authority exploit (Gemini is
        // unconditionally projection_only regardless), but a genuine
        // identity-loss/correctness defect: a real, distinct, provider-
        // confirmed tool call was silently unrepresentable.
        sseFrame(null, {
          candidates: [{
            index: 0,
            content: { parts: [{ functionCall: { id: "call-B", name: "toolB", args: { b: 2 } } }] },
          }],
        }),
      ],
    });
    const ai = new GoogleGenAI({ apiKey: "fixture-key", httpOptions: { baseUrl: server.baseUrl } });
    const stream = await ai.models.generateContentStream({ model: "gemini-2.5-flash", contents: "hello" });

    const parsedChunks: unknown[] = [];
    for await (const chunk of stream) parsedChunks.push(chunk);
    // Real-SDK-parser-reachability proof, not a hand-built-only claim:
    // both distinct ids genuinely survive the official SDK's own parsing.
    type ParsedFcChunk = { candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { id?: string } }> } }> };
    expect((parsedChunks[0] as ParsedFcChunk).candidates?.[0]?.content?.parts?.[0]?.functionCall?.id).toBe("call-A");
    expect((parsedChunks[1] as ParsedFcChunk).candidates?.[0]?.content?.parts?.[0]?.functionCall?.id).toBe("call-B");

    const gate = createToolCallExecutionGate();
    const adapter = new GeminiStreamAdapter();
    const allEvents: Array<{ type: string; code?: string; callRef?: { sourceKey?: string } }> = [];
    for (const chunk of parsedChunks) {
      const events = adapter.push(chunk) as unknown as Array<{ type: string; code?: string; callRef?: { sourceKey?: string } }>;
      allEvents.push(...events);
      for (const e of events) gate.push(e as never);
    }
    for (const e of adapter.finish()) gate.push(e as never);
    const final = gate.finish();

    // Each call's own real, id-derived sourceKey - never colliding (unlike
    // the pre-fix "candidate:0/part:0" reused for both).
    const startSourceKeys = allEvents.filter((e) => e.type === "tool_call_start").map((e) => e.callRef?.sourceKey);
    expect(startSourceKeys).toEqual(["candidate:0/function-call-id:call-A", "candidate:0/function-call-id:call-B"]);

    // Both calls exist as their own, independent decisions - "toolB" was
    // not silently lost.
    expect(final.decisions).toHaveLength(2);
    const a = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolA"));
    const b = expectDefined(final.decisions.find((d) => (d as { name?: string }).name === "toolB"));
    // Neither call's own value was corrupted by the other's bytes.
    expect((a as { stableValue?: unknown }).stableValue).toEqual({ a: 1 });
    expect((b as { stableValue?: unknown }).stableValue).toEqual({ b: 2 });
    // No duplicate-start/trailing-data corruption diagnostics against
    // either call - the pre-fix failure signature.
    expect(a.parserDiagnostics.some((d) => d.code === "E_TRAILING_DATA")).toBe(false);
    expect(b.parserDiagnostics.some((d) => d.code === "E_TRAILING_DATA")).toBe(false);
    expect(a.coordinatorDiagnostics.some((d) => d.code === "E_DUPLICATE_TOOL_CALL_START")).toBe(false);
    expect(b.coordinatorDiagnostics.some((d) => d.code === "E_DUPLICATE_TOOL_CALL_START")).toBe(false);
    // Epistemic boundary unaffected either way: still never executable.
    expect(a.action).not.toBe("execute");
    expect(b.action).not.toBe("execute");
    expect((a as { reason?: string }).reason).toBe("projection_only");
    expect((b as { reason?: string }).reason).toBe("projection_only");
  });
});
