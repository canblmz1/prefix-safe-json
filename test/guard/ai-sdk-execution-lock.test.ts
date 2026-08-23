import { describe, it, expect } from "vitest";
import { createAiSdkExecutionLock, type LockedAiSdkTool } from "../../src/guard/ai-sdk-execution-lock.js";

describe("createAiSdkExecutionLock", () => {
  it("drops a caller-supplied execute field", () => {
    const locked = createAiSdkExecutionLock({
      write_file: { description: "d", inputSchema: {}, execute: async () => "should never run" },
    });
    expect("execute" in locked.write_file).toBe(false);
  });

  it("drops onInputStart/onInputDelta/onInputAvailable - the pre-decision callback trio needsApproval alone does not stop", () => {
    const locked = createAiSdkExecutionLock({
      write_file: {
        description: "d",
        inputSchema: {},
        onInputStart: () => {},
        onInputDelta: (_o: { inputTextDelta: string }) => {},
        onInputAvailable: (_o: { input: unknown }) => {},
      },
    });
    expect("onInputStart" in locked.write_file).toBe(false);
    expect("onInputDelta" in locked.write_file).toBe(false);
    expect("onInputAvailable" in locked.write_file).toBe(false);
  });

  it("forces needsApproval: true unconditionally, even if the caller passed something else", () => {
    const locked = createAiSdkExecutionLock({
      write_file: { description: "d", inputSchema: {}, needsApproval: false },
    });
    expect(locked.write_file.needsApproval).toBe(true);
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
    expect(locked.write_file.needsApproval).toBe(true);
    expect(locked.delete_file.needsApproval).toBe(true);
  });

  it("does not mutate the caller's original tool definitions", () => {
    const original = { write_file: { description: "d", inputSchema: {}, execute: async () => "x" } };
    createAiSdkExecutionLock(original);
    expect("execute" in original.write_file).toBe(true);
  });

  it("throws a message identifying the tool and explaining why, for a provider-executed tool", () => {
    let thrown: unknown;
    try {
      createAiSdkExecutionLock({
        web_search: { type: "provider", id: "openai.web_search", args: {}, isProviderExecuted: true },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    // Each expectation targets a distinct segment of the thrown message, not
    // just one word repeated across segments - a mutation that empties any
    // one segment (found via mutation testing: two segments both happen to
    // contain the word "provider-executed", masking a single-word check
    // against changes to the other two) fails at least one of these.
    expect(message).toContain('tool "web_search"'); // identifies which tool
    expect(message).toContain("is provider-executed");
    expect(message).toContain("provider's own infrastructure");
    expect(message).toContain("Wrapping it here would falsely imply");
    expect(message).toContain("Do not pass provider-executed tools to this function");
  });

  it("does not throw for a tool that merely mentions 'provider' fields without isProviderExecuted: true", () => {
    expect(() =>
      createAiSdkExecutionLock({
        write_file: { description: "d", inputSchema: {}, isProviderExecuted: false },
      }),
    ).not.toThrow();
  });
});

describe("createAiSdkExecutionLock — type-level regression (compile-time)", () => {
  it("needsApproval is the literal type true, execute/onInputStart/onInputDelta/onInputAvailable do not exist on the locked type, and unrelated fields keep their type", () => {
    const locked = createAiSdkExecutionLock({
      tool: {
        inputSchema: {},
        execute: async () => {},
        onInputStart: () => {},
        onInputDelta: (_o: { inputTextDelta: string }) => {},
        onInputAvailable: (_o: { input: unknown }) => {},
        needsApproval: false,
        description: "x",
      },
    });

    // Positive: needsApproval's type is the literal `true`, not `boolean`.
    // If createAiSdkExecutionLock ever regresses to returning `boolean` (or
    // the input's own type) here, this assignment stops compiling.
    const approvalIsLiteralTrue: true = locked.tool.needsApproval;
    expect(approvalIsLiteralTrue).toBe(true);

    // Positive: inert fields keep their real type.
    const description: string = locked.tool.description;
    expect(description).toBe("x");

    // Negative: none of the four removed fields exist on the locked type at
    // all - not optional-and-undefined, absent. If any of these four stops
    // erroring, `pnpm run typecheck` fails the build (this file is under
    // tsc's scope, not just vitest's transform).
    // @ts-expect-error - execute is removed by createAiSdkExecutionLock
    const _execute = locked.tool.execute;
    void _execute;
    // @ts-expect-error - onInputStart is removed by createAiSdkExecutionLock
    const _onInputStart = locked.tool.onInputStart;
    void _onInputStart;
    // @ts-expect-error - onInputDelta is removed by createAiSdkExecutionLock
    const _onInputDelta = locked.tool.onInputDelta;
    void _onInputDelta;
    // @ts-expect-error - onInputAvailable is removed by createAiSdkExecutionLock
    const _onInputAvailable = locked.tool.onInputAvailable;
    void _onInputAvailable;

    expect("execute" in locked.tool).toBe(false);
    expect("onInputStart" in locked.tool).toBe(false);
    expect("onInputDelta" in locked.tool).toBe(false);
    expect("onInputAvailable" in locked.tool).toBe(false);
  });

  it("LockedAiSdkTool<T> is usable standalone as a type annotation", () => {
    interface RawTool {
      description: string;
      execute: () => void;
      needsApproval: boolean;
    }
    type Locked = LockedAiSdkTool<RawTool>;
    const value: Locked = { description: "d", needsApproval: true };
    expect(value.needsApproval).toBe(true);
    // @ts-expect-error - execute does not exist on LockedAiSdkTool<RawTool>
    const _execute: Locked["execute"] = undefined;
    void _execute;
  });
});
