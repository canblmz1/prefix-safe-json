import { describe, it, expect } from "vitest";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";

const WRITE_FILE_SCHEMA = {
  type: "object",
  properties: {
    path: { type: "string" },
    content: { type: "string" },
  },
  required: ["path", "content"],
  additionalProperties: false,
};

function runToolCall(
  coord: ReturnType<typeof createToolCallStreamCoordinator>,
  name: string,
  argsJson: string,
) {
  const ref = { sourceKey: "call-0" };
  coord.push({
    type: "tool_call_start",
    callRef: ref,
    name,
    provider: "openai",
  } as unknown as NormalizedToolStreamEvent);
  coord.push({
    type: "tool_call_arguments_delta",
    callRef: ref,
    delta: argsJson,
    provider: "openai",
  } as unknown as NormalizedToolStreamEvent);
  coord.push({
    type: "tool_call_end",
    callRef: ref,
    reason: "complete",
    provider: "openai",
  } as unknown as NormalizedToolStreamEvent);
  coord.push({
    type: "provider_stream_end",
    reason: "complete",
    provider: "openai",
  } as unknown as NormalizedToolStreamEvent);
  return coord.snapshot().calls[0];
}

describe("Coordinator JSON Schema validation", () => {
  it("marks a call executable when its arguments match the registered schema", () => {
    const coord = createToolCallStreamCoordinator(undefined, undefined, {
      write_file: WRITE_FILE_SCHEMA,
    });
    const call = runToolCall(coord, "write_file", '{"path":"a.txt","content":"hello"}');

    expect(call?.status).toBe("complete");
    expect(call?.schemaValid).toBe(true);
    expect(call?.parser.executable).toBe(true);
  });

  it("marks a call NOT executable when arguments are structurally complete but violate the schema (missing required field)", () => {
    const coord = createToolCallStreamCoordinator(undefined, undefined, {
      write_file: WRITE_FILE_SCHEMA,
    });
    // Missing "content" entirely - not truncated, genuinely never provided.
    const call = runToolCall(coord, "write_file", '{"path":"a.txt"}');

    expect(call?.status).toBe("complete"); // structurally valid, complete JSON
    expect(call?.parser.executable).toBe(true); // prefix-safety alone says "safe"
    expect(call?.schemaValid).toBe(false); // but it doesn't match the tool's contract
  });

  it("reports E_SCHEMA_VALIDATION_FAILED with a descriptive message on schema mismatch", () => {
    const coord = createToolCallStreamCoordinator(undefined, undefined, {
      write_file: WRITE_FILE_SCHEMA,
    });
    runToolCall(coord, "write_file", '{"path":"a.txt","content":42}'); // wrong type

    const diagnostics = coord.snapshot().diagnostics;
    const diag = diagnostics.find((d) => d.code === "E_SCHEMA_VALIDATION_FAILED");
    expect(diag).toBeDefined();
    expect(diag?.severity).toBe("error");
    expect(diag?.message).toContain("write_file");
  });

  it("leaves schemaValid undefined for a tool with no registered schema (unaffected by this feature)", () => {
    const coord = createToolCallStreamCoordinator(undefined, undefined, {
      write_file: WRITE_FILE_SCHEMA,
    });
    const call = runToolCall(coord, "some_other_tool", '{"anything":"goes"}');

    expect(call?.schemaValid).toBeUndefined();
    expect(call?.parser.executable).toBe(true);
  });

  it("does not run schema validation at all when the call isn't structurally complete (truncated)", () => {
    const coord = createToolCallStreamCoordinator(undefined, undefined, {
      write_file: WRITE_FILE_SCHEMA,
    });
    // Cut off mid-value - never reaches outcome "complete".
    const call = runToolCall(coord, "write_file", '{"path":"a.txt","content":"unterm');

    expect(call?.status).not.toBe("complete");
    expect(call?.schemaValid).toBeUndefined();
    expect(
      coord.snapshot().diagnostics.some((d) => d.code === "E_SCHEMA_VALIDATION_FAILED"),
    ).toBe(false);
  });

  it("fails fast at construction time on a malformed schema, rather than failing later mid-stream", () => {
    expect(() =>
      createToolCallStreamCoordinator(undefined, undefined, {
        bad_tool: { type: "not-a-real-json-schema-type" },
      }),
    ).toThrow();
  });

  it("works with no toolSchemas argument at all (fully backward compatible)", () => {
    const coord = createToolCallStreamCoordinator();
    const call = runToolCall(coord, "write_file", '{"path":"a.txt","content":"hello"}');
    expect(call?.schemaValid).toBeUndefined();
    expect(call?.parser.executable).toBe(true);
  });
});
