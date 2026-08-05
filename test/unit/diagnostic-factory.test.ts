import { describe, it, expect } from "vitest";
import { createDiagnostic } from "../../src/diagnostics/factory.js";

describe("createDiagnostic", () => {
  it("sets the path field when a path is provided", () => {
    const diag = createDiagnostic("E_TEST", "error", 5, "msg", false, "/a/b");
    expect(diag.path).toBe("/a/b");
    expect(Object.prototype.hasOwnProperty.call(diag, "path")).toBe(true);
  });

  it("omits the path field entirely when no path is provided", () => {
    const diag = createDiagnostic("E_TEST", "error", 5, "msg", false);
    expect(diag.path).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(diag, "path")).toBe(false);
  });

  it("sets all other fields exactly as provided", () => {
    const diag = createDiagnostic("E_CODE", "fatal", 42, "hello", true);
    expect(diag).toEqual({
      code: "E_CODE",
      severity: "fatal",
      byteOffset: 42,
      message: "hello",
      recoverable: true,
    });
  });
});
