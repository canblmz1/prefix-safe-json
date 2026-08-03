import type { Diagnostic } from "../types.js";

type Severity = Diagnostic["severity"];

/**
 * Creates a Diagnostic object.
 */
export function createDiagnostic(
  code: string,
  severity: Severity,
  byteOffset: number,
  message: string,
  recoverable: boolean,
  path?: string,
): Diagnostic {
  const diag: Diagnostic = {
    code,
    severity,
    byteOffset,
    message,
    recoverable,
  };
  if (path !== undefined) {
    diag.path = path;
  }
  return diag;
}
