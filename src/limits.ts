import type { ParserLimits } from "./types.js";

/** Default resource limits. */
export const DEFAULT_LIMITS: Readonly<ParserLimits> = {
  maxInputBytes: 8 * 1024 * 1024, // 8 MB
  maxDepth: 128,
  maxStringBytes: 4 * 1024 * 1024, // 4 MB
  maxQueuedEvents: 10_000,
  maxTrailingDataBytes: 65536, // 64 KB
};
