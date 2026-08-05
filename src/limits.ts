import type { ParserLimits } from "./types.js";

/** Default resource limits. */
export const DEFAULT_LIMITS: Readonly<ParserLimits> = {
  maxInputBytes: 8 * 1024 * 1024, // 8 MB
  maxDepth: 128,
  maxStringBytes: 4 * 1024 * 1024, // 4 MB
  maxQueuedEvents: 10_000,
  maxTrailingDataBytes: 65536, // 64 KB
};

/**
 * Resolve a user-supplied limit value, falling back to `fallback` for
 * anything that isn't a finite number. `??` alone only rejects
 * null/undefined - it lets NaN and +/-Infinity straight through, and every
 * limit check in this codebase is a plain `>`/`>=` comparison, which is
 * silently always-false against NaN. A limit value that arrives NaN (e.g.
 * computed from a caller's own division-by-zero bug) would otherwise
 * disable that resource limit entirely with no error and no warning.
 */
export function sanitizeLimit(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}
