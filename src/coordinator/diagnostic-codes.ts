// ---------------------------------------------------------------------------
// Cross-module coordinator-level diagnostic codes.
//
// Most coordinator diagnostics (see coordinator.ts) are inline string
// literals local to wherever they're raised - there's no central registry,
// unlike the parser-level `DiagnosticCode` in diagnostics/codes.ts. This
// file exists only for the handful of codes that a provider adapter raises
// and something *outside* that adapter (e.g. the execution gate) needs to
// recognize by exact code, where a shared constant is safer than either
// module guessing the other's string literal.
// ---------------------------------------------------------------------------

/**
 * Emitted (as a stream-wide `provider_diagnostic`, no `callRef`) by a
 * provider adapter when the underlying provider reports that generation was
 * stopped by a content-safety/policy filter, as opposed to a generic
 * cancellation. The execution gate matches on this to return a distinct
 * `reason: "content_filtered"` rather than lumping it in with ordinary
 * incomplete-stream retries - a policy termination should not be retried
 * blindly.
 */
export const CONTENT_FILTERED_DIAGNOSTIC_CODE = "E_CONTENT_FILTERED";
