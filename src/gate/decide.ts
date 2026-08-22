// ---------------------------------------------------------------------------
// Pure execution-decision mapping.
//
// Deliberately a standalone function (no coordinator/adapter dependency) so
// the entire decision table can be unit-tested directly against hand-built
// ToolCallState fixtures, without spinning up a full push()/finish()
// pipeline for every row of the table.
//
// Priority order matters and is intentional: every fail-closed disqualifier
// (resource limits, provider errors, content-policy terminations, schema
// mismatches, malformed content, positively-observed truncation) is checked
// before the single positive "execute" branch. "execute" is reached only
// once nothing above has disqualified the call - it is the last positive
// case, never the first check made, so a future status value that happens
// to superficially resemble "complete" still can't skip the checks ahead of
// it.
// ---------------------------------------------------------------------------

import { DiagnosticCode } from "../diagnostics/codes.js";
import { CoordinatorDiagnostic, ToolCallState } from "../coordinator/types.js";
import { StreamEndReason } from "../coordinator/protocol.js";
import { CONTENT_FILTERED_DIAGNOSTIC_CODE } from "../coordinator/diagnostic-codes.js";
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
  switch (call.status) {
    case "sdk_execution_observed":
      // The coordinator only ever sets this status once, the moment it sees
      // proof (a `tool-result` or `tool-error` diagnostic) that the AI SDK's
      // own tool loop already invoked this call's `execute` callback - see
      // `DefaultToolCallStreamCoordinator.handleProviderDiagnostic`. That
      // transition is one-way (collecting -> sdk_execution_observed only)
      // and every other status-setting path already guards on
      // `status === "collecting"` before running, so nothing downstream -
      // not a safe finish reason, not a structurally complete value, not a
      // passing schema - can ever move a call off this status once set.
      // Re-executing (or retrying) a call the SDK already ran risks a
      // second/duplicate invocation of the same irreversible side effect,
      // so this is always `reject`, never `retry`.
      return reject("sdk_execution_observed");

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
