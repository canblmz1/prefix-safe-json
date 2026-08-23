// ---------------------------------------------------------------------------
// Pure execution-decision mapping.
//
// Deliberately a standalone function (no coordinator/adapter dependency) so
// the entire decision table can be unit-tested directly against hand-built
// ToolCallState fixtures, without spinning up a full push()/finish()
// pipeline for every row of the table.
//
// Priority order matters and is intentional. SDK-execution-ownership
// evidence (attributed to this call, or stream-wide/unattributable) is
// checked FIRST, before every other disqualifier - it is a statement that
// execution authority already left this library's hands, categorically
// different from every other check below, which are all statements about
// the ARGUMENTS/STREAM being unusable. A caller's higher-level logic might
// reasonably retry a whole request on resource_limit/provider_error/
// content_filtered; retrying is never safe once SDK execution was observed,
// since a fresh generation could trigger the SDK's own execute() again for
// whatever already (partially) ran. That distinction would be lost if a
// data-quality reason could mask it, so it always wins regardless of what
// else is also true about the call. Every other fail-closed disqualifier
// (resource limits, provider errors, content-policy terminations, schema
// mismatches, malformed content, positively-observed truncation) is then
// checked before the single positive "execute" branch. "execute" is reached
// only once nothing above has disqualified the call - it is the last
// positive case, never the first check made, so a future status value that
// happens to superficially resemble "complete" still can't skip the checks
// ahead of it.
// ---------------------------------------------------------------------------

import { DiagnosticCode } from "../diagnostics/codes.js";
import { CoordinatorDiagnostic, ToolCallState } from "../coordinator/types.js";
import { StreamEndReason } from "../coordinator/protocol.js";
import {
  CONTENT_FILTERED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE,
} from "../coordinator/diagnostic-codes.js";
import { DecisionEvidence, ExecuteDecision, ExecutionReason, NonExecutableDecision } from "./types.js";

export interface DecisionContext {
  /**
   * The stream-level end reason - what actually happened to the underlying
   * provider stream, not any single call's own (possibly still-"collecting")
   * status. Stream-wide fail-closed conditions (provider_error) key off this
   * rather than per-call state.
   */
  readonly streamEndReason: StreamEndReason;

  /**
   * The provider's own pre-normalization reason string for the stream-end
   * event, when one was given (`ProviderStreamEndEvent.providerReason`).
   * Observability only, mirrored onto `DecisionEvidence.providerReason` -
   * never consulted by the decision logic itself.
   */
  readonly streamEndProviderReason?: string;

  /**
   * The coordinator's full, unfiltered diagnostics list (`snapshot().diagnostics`).
   * `decideExecution` splits this into per-call (`internalId` matches) and
   * global (`internalId` undefined) subsets itself.
   */
  readonly diagnostics: readonly CoordinatorDiagnostic[];
}

const PARSER_RESOURCE_LIMIT_CODES: ReadonlySet<string> = new Set([
  DiagnosticCode.E_LIMIT_DEPTH,
  DiagnosticCode.E_LIMIT_INPUT_BYTES,
  DiagnosticCode.E_LIMIT_STRING_BYTES,
  DiagnosticCode.E_LIMIT_EVENT_QUEUE,
]);

const COORDINATOR_RESOURCE_LIMIT_CODES: ReadonlySet<string> = new Set([
  "E_COORDINATOR_LIMIT_CALLS",
  "E_COORDINATOR_LIMIT_EVENTS",
  "E_TOOL_NAME_LIMIT",
]);

const SDK_EXECUTION_OBSERVED_CODES: ReadonlySet<string> = new Set([
  SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE,
]);

export function decideExecution(
  call: ToolCallState,
  ctx: DecisionContext,
): ExecuteDecision | NonExecutableDecision {
  const parserDiagnostics = call.parser.diagnostics;
  const callCoordinatorDiagnostics = ctx.diagnostics.filter(
    (d) => d.internalId === call.internalId,
  );
  const globalCoordinatorDiagnostics = ctx.diagnostics.filter(
    (d) => d.internalId === undefined,
  );
  const coordinatorDiagnostics = [
    ...globalCoordinatorDiagnostics,
    ...callCoordinatorDiagnostics,
  ];

  const evidence: DecisionEvidence = {
    provider: call.provider,
    providerReason: ctx.streamEndProviderReason,
    streamEndReason: ctx.streamEndReason,
    terminalConfirmed: ctx.streamEndReason !== "unknown",
    structurallyComplete: call.parser.rootComplete,
    parserExecutable: call.parser.executable,
    schemaValid: call.schemaValid,
    receivedBytes: call.parser.receivedBytes,
  };

  const common = {
    internalId: call.internalId,
    toolCallId: call.toolCallId,
    toolIndex: call.toolIndex,
    name: call.name,
    stableValue: call.parser.stableValue,
    parserDiagnostics,
    coordinatorDiagnostics,
    evidence,
  };

  function reject(reason: Exclude<ExecutionReason, "complete">): NonExecutableDecision {
    return { ...common, action: "reject", executable: false, reason };
  }
  function retry(reason: "truncated" | "stream_incomplete"): NonExecutableDecision {
    return { ...common, action: "retry", executable: false, reason };
  }

  // --- SDK execution ownership (highest priority - see file header) -------
  // Two evidence shapes, identical outcome:
  //  - attributed: `call.status` was poisoned the moment the coordinator
  //    resolved a tool-result/tool-error to this exact call - see
  //    DefaultToolCallStreamCoordinator.handleProviderDiagnostic. One-way,
  //    call-scoped.
  //  - unattributable: a tool-result/tool-error arrived with no resolvable
  //    call identity at all, recorded as a stream-wide diagnostic
  //    (`internalId: undefined`) instead of guessing which call it meant.
  //    With no way to rule any call in this stream out - including one
  //    whose `tool_call_start` arrives after this point - as the one the
  //    SDK already executed, EVERY call decided against this same
  //    `ctx.diagnostics` list must fail closed, not just the one that
  //    happens to look safest. `globalCoordinatorDiagnostics` is re-derived
  //    fresh from the full, append-only diagnostics list on every call to
  //    this function, so this is automatic for calls that exist now and
  //    calls the coordinator hasn't created yet.
  if (
    call.status === "sdk_execution_observed" ||
    globalCoordinatorDiagnostics.some((d) => SDK_EXECUTION_OBSERVED_CODES.has(d.code))
  ) {
    return reject("sdk_execution_observed");
  }

  // --- Universal fail-closed checks ---------------------------------------
  // Evaluated first and unconditionally, regardless of call.status, so a
  // resource limit, a provider-side failure, or a content-policy
  // termination always wins over whatever the structural status looks like.

  const hasResourceLimit =
    parserDiagnostics.some((d) => PARSER_RESOURCE_LIMIT_CODES.has(d.code)) ||
    callCoordinatorDiagnostics.some((d) => COORDINATOR_RESOURCE_LIMIT_CODES.has(d.code)) ||
    globalCoordinatorDiagnostics.some((d) => d.code === "E_COORDINATOR_LIMIT_EVENTS");
  if (hasResourceLimit) {
    return reject("resource_limit");
  }

  if (ctx.streamEndReason === "provider_error") {
    return reject("provider_error");
  }

  const isContentFiltered = globalCoordinatorDiagnostics.some(
    (d) => d.code === CONTENT_FILTERED_DIAGNOSTIC_CODE,
  );
  if (isContentFiltered) {
    return reject("content_filtered");
  }

  // --- Status-specific handling --------------------------------------------
  // Exhaustive over ToolCallState["status"] with no `default`: if a future
  // coordinator version adds a new status literal without a matching case
  // here, `noImplicitReturns` fails the build - not a silent runtime gap.
  // "sdk_execution_observed" has no case here at all: the check above
  // already returned for it, and TypeScript's own control-flow narrowing
  // has removed that literal from `call.status`'s type by this point - the
  // compiler itself now rejects a case for it as unreachable, a stronger
  // guarantee than a runtime-only "this shouldn't happen" comment could give.
  switch (call.status) {
    case "complete": {
      if (call.schemaValid === false) {
        return reject("schema_invalid");
      }
      // The ONLY positive branch in this entire function, reached only
      // after every disqualifying check above has already passed. The
      // `call.name !== undefined` check is defensive/redundant with the
      // coordinator's own invariant (a call only reaches status "complete"
      // when its name is known) - narrowing on it here is what lets
      // `ExecuteDecision.name` be typed as a required `string` instead of
      // `string | undefined`, so it never needs re-checking at every call
      // site. If the invariant were ever violated, this still fails closed
      // to "stream_incomplete" rather than fabricating a name.
      if (
        call.parser.executable === true &&
        call.parser.stableValue !== undefined &&
        call.name !== undefined
      ) {
        const decision: ExecuteDecision = {
          ...common,
          name: call.name,
          action: "execute",
          executable: true,
          reason: "complete",
          value: call.parser.stableValue,
        };
        return decision;
      }
      // Root closed, syntactically valid, but not trusted: the parser's
      // own executable contract failed it (stream-end-reason mismatch or
      // trailing data), even though nothing here required a repair.
      return retry("stream_incomplete");
    }

    case "truncated":
      // The parser positively observed an open string/number/literal or an
      // unclosed container - a real, raw mid-value cut, not a matter of
      // interpretation.
      return retry("truncated");

    case "invalid":
      // Duplicate key, unexpected token, or a missing/conflicting tool
      // identity - a genuine content defect, independent of how the stream
      // ended.
      return reject("malformed");

    case "salvaged":
      // Root only closed via a safe-container-closing repair; the JSON
      // *looks* complete, but provider metadata never confirmed genuine
      // completion. This is the container-level truncation case.
      return retry("stream_incomplete");

    case "cancelled":
    case "collecting":
      return retry("stream_incomplete");
  }
}
