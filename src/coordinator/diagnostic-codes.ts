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

/**
 * Emitted (as a `provider_diagnostic` carrying the call's own `callRef`) by
 * the AI SDK adapter when a `tool-result` part is observed: direct proof
 * that the Vercel AI SDK's own tool-calling loop already invoked this call's
 * `execute` callback and it returned successfully - independent of, and
 * almost always before, this library's own decision is ever computed. See
 * `SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE` for the failed-attempt counterpart;
 * the coordinator treats both identically (see `coordinator.ts`'s
 * `handleProviderDiagnostic`), poisoning the call to `status:
 * "sdk_execution_observed"` so the gate can never later report `execute` for
 * it - re-running (or, for the error case, retrying) a call the SDK already
 * attempted would risk a second/duplicate invocation of the same
 * irreversible side effect.
 */
export const SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE = "E_SDK_EXECUTION_OBSERVED";

/**
 * Emitted (as a `provider_diagnostic` carrying the call's own `callRef`, when
 * a `callRef` could be determined) by the AI SDK adapter when a `tool-error`
 * part is observed: proof that the Vercel AI SDK's own tool-calling loop
 * already invoked this call's `execute` callback and it threw. This does NOT
 * prove no partial irreversible side effect occurred before the throw, so it
 * receives the exact same fail-closed treatment as
 * `SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE` - success and failure are not
 * distinguished into safe/unsafe here, both must fail closed.
 */
export const SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE = "E_PROVIDER_TOOL_ERROR";

/** Gemini supplied an already-parsed argument object, not raw argument text. */
export const PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE =
  "E_ARGUMENT_EVIDENCE_PROJECTION_ONLY";

/** AI SDK `tool-input-delta` arrived before its required start part. */
export const TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE =
  "E_TOOL_ARGUMENTS_BEFORE_START";

/** AI SDK `tool-input-end` arrived before its required start part. */
export const TOOL_END_BEFORE_START_DIAGNOSTIC_CODE = "E_TOOL_END_BEFORE_START";

/** AI SDK argument evidence arrived after the call's end part. */
export const TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE = "E_TOOL_ARGUMENTS_AFTER_END";

/** AI SDK emitted more than one end part for the same call. */
export const DUPLICATE_TOOL_END_DIAGNOSTIC_CODE = "E_DUPLICATE_TOOL_END";

/** The coordinator observed more than one start for the same source identity. */
export const DUPLICATE_TOOL_CALL_START_DIAGNOSTIC_CODE =
  "E_DUPLICATE_TOOL_CALL_START";

/** An OpenAI-compatible choice omitted a trustworthy explicit index. */
export const INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE = "E_CHOICE_INDEX_INVALID";

/** An OpenAI-compatible event repeated the same explicit choice index. */
export const DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE = "E_CHOICE_INDEX_DUPLICATE";

/**
 * A normalized event was pushed into the coordinator after `isFinished` was
 * already set — a genuine post-terminal delivery that is neither a
 * conflicting nor a duplicate `provider_stream_end` (see
 * `TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE` for that narrower case).
 * Stream-wide (no `internalId`/`sourceKey`): once any evidence has arrived
 * after the stream's own terminal, every open or already-decided call in
 * that stream is authority-disqualified — see
 * `AUTHORITY_PROTOCOL_VIOLATION_CODES` and `ToolCallExecutionGate.takeDecision()`
 * (GHSA-3xpw-9694-2xxp).
 */
export const EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE = "E_EVENT_AFTER_STREAM_END";

/**
 * A second `provider_stream_end` arrived whose `reason` disagrees with the
 * one that already ended the stream (e.g. `"complete"` then
 * `"provider_error"`). Stream-wide, same disqualifying treatment as
 * `EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE` — a distinct code purely so a
 * caller can tell the two apart without comparing diagnostic payloads
 * (GHSA-3xpw-9694-2xxp).
 */
export const TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE = "E_TERMINAL_REASON_CONFLICT";

/**
 * A single raw provider event carried both `id` and `toolCallId`, non-empty
 * and unequal. Which one names the real call cannot be inferred — silently
 * preferring either one risks attributing evidence (including a positive
 * decision) to the wrong call. Stream-wide (no `internalId`/`sourceKey`):
 * with attribution itself ambiguous, every call in the stream fails closed
 * rather than guessing which one is affected (GHSA-3xpw-9694-2xxp).
 */
export const PROVIDER_EVENT_IDENTITY_AMBIGUOUS_DIAGNOSTIC_CODE =
  "E_PROVIDER_EVENT_IDENTITY_AMBIGUOUS";

/** Diagnostics that permanently disqualify their affected authority scope. */
export const AUTHORITY_PROTOCOL_VIOLATION_CODES: ReadonlySet<string> = new Set([
  TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
  TOOL_END_BEFORE_START_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_CALL_START_DIAGNOSTIC_CODE,
  INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
  EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE,
  TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE,
  PROVIDER_EVENT_IDENTITY_AMBIGUOUS_DIAGNOSTIC_CODE,
]);
