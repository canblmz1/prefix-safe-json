// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import { ParserSnapshot, ParserEvent } from "../types.js";
import { NormalizedToolStreamEvent, ProviderName, StreamEndReason } from "./protocol.js";
export interface CoordinatorLimits {
  readonly maxToolCalls: number;
  readonly maxToolNameBytes: number;
  readonly maxTrailingDataBytes: number;
  readonly maxNormalizedEvents: number;
}
export const DEFAULT_COORDINATOR_LIMITS: CoordinatorLimits = stryMutAct_9fa48("348") ? {} : (stryCov_9fa48("348"), {
  maxToolCalls: 128,
  maxToolNameBytes: 1024,
  maxTrailingDataBytes: 65536,
  maxNormalizedEvents: 100000
});
export interface ToolCallState {
  readonly internalId: string;
  readonly provider: ProviderName;
  readonly toolCallId?: string;
  readonly toolIndex?: number;
  readonly name?: string;
  readonly nameComplete: boolean;
  readonly parser: ParserSnapshot;
  readonly status: "collecting" | "complete" | "truncated" | "salvaged" | "invalid" | "cancelled";
}
export interface ToolCallCoordinatorSnapshot {
  readonly calls: readonly ToolCallState[];
  readonly diagnostics: readonly CoordinatorDiagnostic[];
  readonly eventsProcessed: number;
  readonly isFinished: boolean;
}
export type ToolCallCoordinatorEvent = {
  readonly type: "tool_call_discovered";
  readonly sequence: number;
  readonly internalId: string;
  readonly provider: ProviderName;
} | {
  readonly type: "tool_call_identity_updated";
  readonly sequence: number;
  readonly internalId: string;
  readonly toolCallId?: string;
  readonly toolIndex?: number;
} | {
  readonly type: "tool_name_updated";
  readonly sequence: number;
  readonly internalId: string;
  readonly name: string;
  readonly complete: boolean;
} | {
  readonly type: "tool_argument_event";
  readonly sequence: number;
  readonly internalId: string;
  readonly event: ParserEvent;
} | {
  readonly type: "tool_call_finished";
  readonly sequence: number;
  readonly internalId: string;
  readonly outcome: "complete" | "truncated" | "salvaged" | "invalid" | "cancelled";
  readonly executable: boolean;
} | {
  readonly type: "coordinator_diagnostic";
  readonly sequence: number;
  readonly diagnostic: CoordinatorDiagnostic;
} | {
  readonly type: "provider_stream_finished";
  readonly sequence: number;
  readonly reason: StreamEndReason;
};
export interface CoordinatorDiagnostic {
  readonly code: string;
  readonly severity: "info" | "warning" | "error" | "fatal";
  readonly message: string;
  readonly internalId?: string;
}
export interface CoordinatorPushResult {
  readonly accepted: boolean;
}
export interface ToolCallCoordinatorFinalResult {
  readonly calls: readonly ToolCallState[];
}
export interface ToolCallStreamCoordinator {
  push(event: NormalizedToolStreamEvent): CoordinatorPushResult;
  snapshot(): ToolCallCoordinatorSnapshot;
  drainEvents(): readonly ToolCallCoordinatorEvent[];
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): ToolCallCoordinatorFinalResult;
}