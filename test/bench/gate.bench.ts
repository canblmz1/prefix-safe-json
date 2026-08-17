import { bench, describe } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import { createToolCallExecutionGate } from "../../src/gate/gate.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";

// Mirrors test/bench/parser.bench.ts's payload shapes - the gate should add
// no meaningfully new cost beyond what the coordinator already pays, since
// it does no re-parsing of its own (see docs/EXECUTION_GATE.md).

const mediumArgs = JSON.stringify({ query: "weather in tokyo", max_results: 5 });

const largeArgs = JSON.stringify(
  Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    name: `item_${i}`,
    description: "A relatively long description to pad out the JSON size somewhat efficiently.",
    metadata: { tags: ["a", "b", "c"], active: true },
  })),
);

function ev(partial: Record<string, unknown>): NormalizedToolStreamEvent {
  return { provider: "openai", sequence: 0, ...partial } as unknown as NormalizedToolStreamEvent;
}

function callEvents(sourceKey: string, name: string, args: string): NormalizedToolStreamEvent[] {
  return [
    ev({ type: "tool_call_start", callRef: { sourceKey }, name }),
    ev({ type: "tool_call_arguments_delta", callRef: { sourceKey }, delta: args }),
    ev({ type: "tool_call_end", callRef: { sourceKey }, reason: "complete" }),
  ];
}

function manyCallEvents(count: number, args: string): NormalizedToolStreamEvent[] {
  const events: NormalizedToolStreamEvent[] = [];
  for (let i = 0; i < count; i++) {
    events.push(...callEvents(`call-${i}`, `tool_${i}`, args));
  }
  events.push(ev({ type: "provider_stream_end", reason: "complete" }));
  return events;
}

describe("Coordinator vs Execution Gate — single call, medium payload", () => {
  const events = callEvents("call-0", "search", mediumArgs).concat(
    ev({ type: "provider_stream_end", reason: "complete" }),
  );

  bench("Coordinator only", () => {
    const coord = createToolCallStreamCoordinator();
    for (const e of events) coord.push(e);
    coord.finish();
  });

  bench("Execution Gate", () => {
    const gate = createToolCallExecutionGate();
    for (const e of events) gate.push(e);
    gate.finish();
  });
});

describe("Coordinator vs Execution Gate — single call, large (~100KB) payload", () => {
  const events = callEvents("call-0", "bulk_import", largeArgs).concat(
    ev({ type: "provider_stream_end", reason: "complete" }),
  );

  bench("Coordinator only", () => {
    const coord = createToolCallStreamCoordinator();
    for (const e of events) coord.push(e);
    coord.finish();
  });

  bench("Execution Gate", () => {
    const gate = createToolCallExecutionGate();
    for (const e of events) gate.push(e);
    gate.finish();
  });
});

describe("Coordinator vs Execution Gate — 50 concurrent calls, medium payload each", () => {
  const events = manyCallEvents(50, mediumArgs);

  bench("Coordinator only", () => {
    const coord = createToolCallStreamCoordinator();
    for (const e of events) coord.push(e);
    coord.finish();
  });

  bench("Execution Gate", () => {
    const gate = createToolCallExecutionGate();
    for (const e of events) gate.push(e);
    gate.finish();
  });
});

describe("Execution Gate with schema validation — 50 concurrent calls", () => {
  const events = manyCallEvents(50, mediumArgs);
  const schemas = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `tool_${i}`,
      { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    ]),
  );

  bench("Execution Gate (no schemas)", () => {
    const gate = createToolCallExecutionGate();
    for (const e of events) gate.push(e);
    gate.finish();
  });

  bench("Execution Gate (with schemas)", () => {
    const gate = createToolCallExecutionGate(undefined, undefined, schemas);
    for (const e of events) gate.push(e);
    gate.finish();
  });
});
