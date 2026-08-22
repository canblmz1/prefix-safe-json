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
    | "cancelled"
    | "sdk_execution_observed";

  /**
   * Result of validating `parser.stableValue` against the JSON Schema
   * registered for this call's tool name (see `toolSchemas` on
   * `createToolCallStreamCoordinator`). `undefined` when no schema was
   * registered for this tool, or the call never reached a "complete"
   * outcome (there's nothing meaningful to validate). This is a *separate*
   * concern from `parser.executable` — that flag means "the data is
   * structurally complete and wasn't fabricated by truncation"; this one
   * means "the data matches the shape the tool declared it needs." Both
   * must hold for the coordinator's own `executable` (on the
   * `tool_call_finished` event) to be true.
   */
  readonly schemaValid?: boolean;
}

/**
 * A JSON Schema object (draft-07, matching ajv's default). Kept as `object`
 * rather than a specific type-checked shape so callers can pass whatever
 * JSON Schema library/types they already have without a forced dependency
 * on this package's own schema typings.
 */
export type JsonSchemaLike = object;

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
