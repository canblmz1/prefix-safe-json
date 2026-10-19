import assert from "node:assert/strict";
import test from "node:test";
const { guardResponse, GuardRefusal } = await import(new URL("./wire.js", import.meta.resolve("psj-ai-sdk")));

const event = (delta, extra = {}) => `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;

for (const newline of ["\n", "\r\n", "\r"]) test(`allowed streaming preserves every original byte (${JSON.stringify(newline)})`, async () => {
  const raw = new TextEncoder().encode(("\uFEFF: comment\n\n" + event({ content: "\u03b1\ud83d\ude80" }) + event({ tool_calls: [] }) + "data: [DONE]\n\n").replaceAll("\n", newline));
  let position = 0, validated = false;
  const response = new Response(new ReadableStream({ pull(controller) {
    if (position === raw.length) { controller.close(); return; }
    controller.enqueue(raw.slice(position, ++position));
  } }), { headers: { "content-type": "text/event-stream", "content-length": String(raw.length), "content-encoding": "gzip", "x-request-id": "keep" } });
  const output = await guardResponse(response, { limit: 1024 * 1024, buffered: false,
    async validate(body) { assert.deepEqual(body, raw); validated = true; return { toolCalls: 0, commit() {} }; },
    async observe() {}, decide() {}, revoke() {} });
  assert.deepEqual(new Uint8Array(await output.arrayBuffer()), raw);
  assert.equal(validated, true);
  assert.equal(output.headers.has("content-length"), false);
  assert.equal(output.headers.has("content-encoding"), false);
  assert.equal(output.headers.get("x-request-id"), "keep");
});

test("an unknown envelope holds even text until validation", async () => {
  let validated = false;
  const output = await guardResponse(new Response(event({ content: "held" }, { unknown_provider_field: true })), {
    limit: 10000, buffered: false, async validate() { validated = true; return { toolCalls: 0, commit() {} }; },
    async observe() {}, decide() {}, revoke() {},
  });
  assert.equal(validated, true);
  assert.ok((await output.text()).includes("held"));
});

test("consumer cancellation cancels the upstream reader and records once", async () => {
  let cancelled = false, revoked = 0, observed = 0;
  const output = await guardResponse(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(event({ content: "display" })));
  }, cancel() { cancelled = true; } })), { limit: 10000, buffered: false,
    async validate() { assert.fail("The upstream never reached EOF"); },
    async observe(_body, complete, decision) { observed++; assert.equal(complete, false); assert.equal(decision.reason, "cancelled"); },
    decide() {}, revoke() { revoked++; },
  });
  const reader = output.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(cancelled, true);
  assert.equal(revoked, 1);
  assert.equal(observed, 1);
});

test("a refusing observer cannot replace a refusal with execution or stall cleanup", async () => {
  let revoked = false;
  await assert.rejects(guardResponse(new Response("data: [DONE]\n\n"), { limit: 10000, buffered: false,
    async validate() { throw new GuardRefusal("provider_error"); }, async observe() { throw new Error("writer failed"); },
    decide() { throw new Error("observer failed"); }, revoke() { revoked = true; },
  }), { reason: "provider_error" });
  assert.equal(revoked, true);
});
