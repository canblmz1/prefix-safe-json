import type { StreamEndReason } from "../types.js";

export type { StreamEndReason };

export type ProviderName =
  | "openai"
  | "anthropic"
  | "gemini"
  | "openrouter"
  | "openai-compatible"
  | "ai-sdk"
  | "unknown";

export interface NormalizedEventBase {
  /**
   * Deterministic sequence number assigned by the stream coordinator.
   */
  readonly sequence: number;
  readonly provider: ProviderName;
  readonly rawEventType?: string;
  readonly providerRequestId?: string;
}

export type NormalizedToolStreamEvent =
  | ToolCallStartEvent
  | ToolCallIdentityEvent
  | ToolCallNameDeltaEvent
  | ToolCallArgumentsDeltaEvent
  | ToolCallEndEvent
  | ProviderDiagnosticEvent
  | ProviderStreamEndEvent;

export interface ToolCallStartEvent extends NormalizedEventBase {
  readonly type: "tool_call_start";
  readonly callRef: ProviderCallRef;

  readonly toolCallId?: string;
  readonly toolIndex?: number;
  readonly name?: string;
}

export interface ToolCallIdentityEvent extends NormalizedEventBase {
  readonly type: "tool_call_identity";
  readonly callRef: ProviderCallRef;

  readonly toolCallId?: string;
  readonly toolIndex?: number;
}

export interface ToolCallNameDeltaEvent extends NormalizedEventBase {
  readonly type: "tool_call_name_delta";
  readonly callRef: ProviderCallRef;
  readonly delta: string;
}

export interface ToolCallArgumentsDeltaEvent extends NormalizedEventBase {
  readonly type: "tool_call_arguments_delta";
  readonly callRef: ProviderCallRef;
  readonly delta: string | Uint8Array;
}

export interface ToolCallEndEvent extends NormalizedEventBase {
  readonly type: "tool_call_end";
  readonly callRef: ProviderCallRef;
  readonly reason: StreamEndReason;
  readonly providerReason?: string;
}

export interface ProviderDiagnosticEvent extends NormalizedEventBase {
  readonly type: "provider_diagnostic";
  readonly code: string;
  readonly severity: "info" | "warning" | "error" | "fatal";
  readonly message: string;
  readonly callRef?: ProviderCallRef;
}

export interface ProviderStreamEndEvent extends NormalizedEventBase {
  readonly type: "provider_stream_end";
  readonly reason: StreamEndReason;
  readonly providerReason?: string;
}

export interface ProviderCallRef {
  /**
   * Deterministic provider-local identity.
   * e.g. "content-block:0"
   */
  readonly sourceKey: string;
}
