import { describe, it, expect } from "vitest";
import { createAiSdkExecutionLock } from "../../src/guard/ai-sdk-execution-lock.js";

describe("createAiSdkExecutionLock", () => {
  it("drops a caller-supplied execute field", () => {
    const locked = createAiSdkExecutionLock({
      write_file: { description: "d", inputSchema: {}, execute: async () => "should never run" },
    });
    expect("execute" in locked.write_file).toBe(false);
  });

  it("forces needsApproval: true unconditionally, even if the caller passed something else", () => {
    const locked = createAiSdkExecutionLock({
      write_file: { description: "d", inputSchema: {}, needsApproval: false },
    });
    expect((locked.write_file as { needsApproval: unknown }).needsApproval).toBe(true);
  });

  it("preserves every other field on the tool definition unchanged", () => {
    const locked = createAiSdkExecutionLock({
      write_file: { description: "writes a file", inputSchema: { type: "object" }, someOtherField: 42 },
    });
    expect(locked.write_file).toMatchObject({
      description: "writes a file",
      inputSchema: { type: "object" },
      someOtherField: 42,
      needsApproval: true,
    });
  });

  it("locks every tool in a multi-tool object independently", () => {
    const locked = createAiSdkExecutionLock({
      write_file: { description: "d1", inputSchema: {}, execute: async () => 1 },
      delete_file: { description: "d2", inputSchema: {}, execute: async () => 2 },
    });
    expect("execute" in locked.write_file).toBe(false);
    expect("execute" in locked.delete_file).toBe(false);
    expect((locked.write_file as unknown as { needsApproval: unknown }).needsApproval).toBe(true);
    expect((locked.delete_file as unknown as { needsApproval: unknown }).needsApproval).toBe(true);
  });

  it("does not mutate the caller's original tool definitions", () => {
    const original = { write_file: { description: "d", inputSchema: {}, execute: async () => "x" } };
    createAiSdkExecutionLock(original);
    expect("execute" in original.write_file).toBe(true);
  });
});
