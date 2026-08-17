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
import { ExecuteDecision, ExecutionReason, NonExecutableDecision } from "./types.js";

export interface DecisionContext {
  /**
   * The stream-level end reason - what actually happened to the underlying
   * provider stream, not any single call's own (possibly still-"collecting")
   * status. Stream-wide fail-closed conditions (provider_error) key off this
   * rather than per-call state.
   */
  readonly streamEndReason: StreamEndReason;

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

  const common = {
    internalId: call.internalId,
    toolCallId: call.toolCallId,
    toolIndex: call.toolIndex,
    name: call.name,
    stableValue: call.parser.stableValue,
    parserDiagnostics,
    coordinatorDiagnostics,
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
    case "complete": {
      if (call.schemaValid === false) {
        return reject("schema_invalid");
      }
      // The ONLY positive branch in this entire function, reached only
      // after every disqualifying check above has already passed.
      if (call.parser.executable === true && call.parser.stableValue !== undefined) {
        const decision: ExecuteDecision = {
          ...common,
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
