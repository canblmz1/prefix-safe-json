// ---------------------------------------------------------------------------
// JSON Pointer utilities (RFC 6901)
// ---------------------------------------------------------------------------

/**
 * Escape a JSON Pointer reference token per RFC 6901.
 * ~ → ~0, / → ~1
 */
export function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Build a JSON Pointer path from parent path and a key or index.
 */
export function appendPointer(parent: string, token: string | number): string {
  if (typeof token === "number") {
    return `${parent}/${token}`;
  }
  return `${parent}/${escapePointerToken(token)}`;
}
