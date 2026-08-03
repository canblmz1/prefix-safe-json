import { ParserSnapshot, ParserEvent } from "../types.js";
import { NormalizedToolStreamEvent, ProviderName, StreamEndReason } from "./protocol.js";

export interface CoordinatorLimits {
  readonly maxToolCalls: number;
  readonly maxToolNameBytes: number;
  readonly maxTrailingDataBytes: number;
  readonly maxNormalizedEvents: number;
}

export const DEFAULT_COORDINATOR_LIMITS: CoordinatorLimits = {
  maxToolCalls: 128,
  maxToolNameBytes: 1024,
  maxTrailingDataBytes: 65536,
  maxNormalizedEvents: 100000,
};

export interface ToolCallState {
  readonly internalId: string;
  readonly provider: ProviderName;

  readonly toolCallId?: string;
  readonly toolIndex?: number;

  readonly name?: string;
  readonly nameComplete: boolean;

  readonly parser: ParserSnapshot;

  readonly status:
    | "collecting"
    | "complete"
    | "truncated"
    | "salvaged"
    | "invalid"
    | "cancelled";
}

export interface ToolCallCoordinatorSnapshot {
  readonly calls: readonly ToolCallState[];
  readonly diagnostics: readonly CoordinatorDiagnostic[];
  readonly eventsProcessed: number;
  readonly isFinished: boolean;
}

export type ToolCallCoordinatorEvent =
  | {
      readonly type: "tool_call_discovered";
      readonly sequence: number;
      readonly internalId: string;
      readonly provider: ProviderName;
    }
  | {
      readonly type: "tool_call_identity_updated";
      readonly sequence: number;
      readonly internalId: string;
      readonly toolCallId?: string;
      readonly toolIndex?: number;
    }
  | {
      readonly type: "tool_name_updated";
      readonly sequence: number;
      readonly internalId: string;
      readonly name: string;
      readonly complete: boolean;
    }
  | {
      readonly type: "tool_argument_event";
      readonly sequence: number;
      readonly internalId: string;
      readonly event: ParserEvent;
    }
  | {
      readonly type: "tool_call_finished";
      readonly sequence: number;
      readonly internalId: string;
      readonly outcome:
        | "complete"
        | "truncated"
        | "salvaged"
        | "invalid"
        | "cancelled";
      readonly executable: boolean;
    }
  | {
      readonly type: "coordinator_diagnostic";
      readonly sequence: number;
      readonly diagnostic: CoordinatorDiagnostic;
    }
  | {
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
