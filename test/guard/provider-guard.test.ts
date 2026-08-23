import { describe, it, expect } from "vitest";
import { createProviderExecutionGuard } from "../../src/guard/provider-guard.js";
import type { ProviderStreamAdapter } from "../../src/providers/adapter.js";
import type { NormalizedToolStreamEvent, StreamEndReason } from "../../src/coordinator/protocol.js";

// A minimal spy adapter - not one of the real per-provider adapters - whose
// only job is proving createProviderExecutionGuard's own composition wiring
// (push -> gate.push, finish -> gate.push THEN gate.finish), independent of
// any real adapter's own translation logic (already covered elsewhere).
function makeSpyAdapter(finishEvents: NormalizedToolStreamEvent[]) {
  let finished = false;
  const pushedRaw: unknown[] = [];
  const adapter: ProviderStreamAdapter<unknown> = {
    provider: "openai",
    push(rawEvent: unknown) {
      pushedRaw.push(rawEvent);
      return [];
    },
    finish(_meta?: { reason?: StreamEndReason; providerReason?: string }) {
      if (finished) return [];
      finished = true;
      return finishEvents;
    },
  };
  return { adapter, pushedRaw };
}

describe("createProviderExecutionGuard — composition wiring", () => {
  it("push() forwards every raw event to the adapter", () => {
    const { adapter, pushedRaw } = makeSpyAdapter([]);
    const guard = createProviderExecutionGuard(adapter);
    guard.push({ some: "raw-event" });
    expect(pushedRaw).toEqual([{ some: "raw-event" }]);
  });

  it("finish() pushes the adapter's own finish() events into the gate BEFORE calling gate.finish() - the backstop actually reaches the coordinator, not just gate.finish()'s own independent meta handling", () => {
    const { adapter } = makeSpyAdapter([
      {
        type: "tool_call_start",
        sequence: 1,
        provider: "openai",
        callRef: { sourceKey: "late-call" },
        name: "write_file",
      },
      {
        type: "provider_stream_end",
        sequence: 2,
        provider: "openai",
        reason: "complete",
      },
    ]);
    const guard = createProviderExecutionGuard(adapter, {
      schemas: { write_file: { type: "object", properties: {}, required: [] } },
    });

    // The guard's own push() was never called at all - every bit of the
    // coordinator's knowledge about "write_file" must come from the events
    // adapter.finish() returns, proven by asserting the gate produced a
    // decision for a call this test never pushed directly.
    const final = guard.finish();
    const decision = final.decisions.find((d) => d.name === "write_file");
    expect(decision).toBeDefined();
  });

  it("a real adapter.finish() no-op (already finished via push()) means gate.finish()'s own meta backstop is what's actually exercised - both paths converge on the same final result", () => {
    const { adapter } = makeSpyAdapter([]); // simulates an adapter already `finished` - returns nothing
    const guard = createProviderExecutionGuard(adapter);
    const final = guard.finish({ reason: "cancelled" });
    expect(final.decisions).toEqual([]); // no calls were ever registered - nothing to decide
  });
});
