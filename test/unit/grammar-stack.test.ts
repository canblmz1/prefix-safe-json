import { describe, it, expect } from "vitest";
import { GrammarStack } from "../../src/grammar/stack.js";
import { expectDefined } from "../utils/expect-defined.js";

describe("GrammarStack", () => {
  describe("depth limit diagnostics", () => {
    it("pushObject at the depth limit emits the exact E_LIMIT_DEPTH diagnostic", () => {
      const stack = new GrammarStack(1);
      stack.pushObject(0);
      const frame = stack.pushObject(5); // exceeds maxDepth of 1
      expect(frame).toBeNull();

      const diags = stack.takeDiagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0]).toMatchObject({
        code: "E_LIMIT_DEPTH",
        severity: "fatal",
        byteOffset: 5,
        message: "Maximum nesting depth 1 exceeded",
        recoverable: false,
      });
    });

    it("pushArray at the depth limit emits the exact E_LIMIT_DEPTH diagnostic", () => {
      const stack = new GrammarStack(1);
      stack.pushArray(0);
      const frame = stack.pushArray(7);
      expect(frame).toBeNull();

      const diags = stack.takeDiagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0]).toMatchObject({
        code: "E_LIMIT_DEPTH",
        severity: "fatal",
        byteOffset: 7,
        message: "Maximum nesting depth 1 exceeded",
        recoverable: false,
      });
    });
  });

  describe("registerObjectKey", () => {
    it("emits the exact E_DUPLICATE_KEY diagnostic, including the frame path", () => {
      const stack = new GrammarStack(10);
      stack.pushObject(0);
      expect(stack.registerObjectKey("a", 1)).toBe(true);
      expect(stack.registerObjectKey("a", 10)).toBe(false);

      const diags = stack.takeDiagnostics();
      expect(diags).toHaveLength(1);
      expect(diags[0]).toMatchObject({
        code: "E_DUPLICATE_KEY",
        severity: "error",
        byteOffset: 10,
        message: 'Duplicate object key: "a"',
        recoverable: false,
        path: "",
      });
    });

    it("returns false without registering when there is no current frame", () => {
      const stack = new GrammarStack(10);
      expect(stack.registerObjectKey("a", 0)).toBe(false);
    });

    it("returns false without registering when the current frame is an array", () => {
      const stack = new GrammarStack(10);
      stack.pushArray(0);
      expect(stack.registerObjectKey("a", 0)).toBe(false);
    });
  });

  describe("currentValuePath", () => {
    it("returns the empty string when the stack has no open container", () => {
      const stack = new GrammarStack(10);
      expect(stack.currentValuePath()).toBe("");
    });
  });

  describe("segment derivation for a freshly-pushed container with no key registered yet", () => {
    it("an object frame pushed under a parent with no currentKey set gets a null segment (no path component)", () => {
      const stack = new GrammarStack(10);
      stack.pushObject(0); // parent: no key registered yet
      const child = expectDefined(stack.pushObject(1));
      // The parent contributed no segment, so the child's path is just "".
      expect(child.path).toBe("");
    });
  });

  describe("advanceArrayIndex", () => {
    it("is a no-op on an empty stack (does not throw)", () => {
      const stack = new GrammarStack(10);
      expect(() => stack.advanceArrayIndex()).not.toThrow();
    });

    it("is a no-op when the current frame is an object, not an array", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushObject(0));
      expect(() => stack.advanceArrayIndex()).not.toThrow();
      // nextArrayIndex is meaningless for an object frame but should stay
      // at its initial value, confirming the array-only branch didn't run.
      expect(frame.nextArrayIndex).toBe(0);
    });

    it("increments nextArrayIndex when the current frame is an array", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushArray(0));
      stack.advanceArrayIndex();
      expect(frame.nextArrayIndex).toBe(1);
    });
  });

  describe("canSafelyCloseAll", () => {
    it("is true for an empty stack", () => {
      const stack = new GrammarStack(10);
      expect(stack.canSafelyCloseAll()).toBe(true);
    });

    it("is false when an object frame is awaiting a colon", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushObject(0));
      frame.objectExpectation = "colon";
      expect(stack.canSafelyCloseAll()).toBe(false);
    });

    it("is false when an object frame is awaiting a value", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushObject(0));
      frame.objectExpectation = "value";
      expect(stack.canSafelyCloseAll()).toBe(false);
    });

    it("is false when an object frame is awaiting a key after a comma", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushObject(0));
      frame.objectExpectation = "key_after_comma";
      expect(stack.canSafelyCloseAll()).toBe(false);
    });

    it("is true when an object frame is only awaiting comma-or-end", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushObject(0));
      frame.objectExpectation = "comma_or_end";
      expect(stack.canSafelyCloseAll()).toBe(true);
    });

    it("is false when an array frame is awaiting a value after a comma", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushArray(0));
      frame.arrayExpectation = "value_after_comma";
      expect(stack.canSafelyCloseAll()).toBe(false);
    });

    it("is true when an array frame is only awaiting comma-or-end", () => {
      const stack = new GrammarStack(10);
      const frame = expectDefined(stack.pushArray(0));
      frame.arrayExpectation = "comma_or_end";
      expect(stack.canSafelyCloseAll()).toBe(true);
    });
  });
});
