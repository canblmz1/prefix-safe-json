import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import {
  CONTENT_FILTERED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
  TOOL_END_BEFORE_START_DIAGNOSTIC_CODE,
} from "../coordinator/diagnostic-codes.js";

// ---------------------------------------------------------------------------
// Vercel AI SDK (`ai` package) fullStream part shapes.
//
// Hand-rolled locally rather than imported from the `ai` package - matching
// every other adapter in this directory (none of them import their vendor
// SDK's types either). This keeps `ai` out of this library's dependency
// graph entirely: consumers on any `ai` major version can use this adapter
// without this package forcing a specific one on them.
//
// Shapes verified against the published `ai@7.0.66` type declarations
// (the `TextStreamPart` / `fullStream` union) at the time this adapter was
// written, not guessed from memory or an older API version.
// ---------------------------------------------------------------------------

interface AiSdkToolInputStartPart {
  type: "tool-input-start";
  id?: string;
  toolCallId?: string;
  toolName?: string;
}

interface AiSdkToolInputDeltaPart {
  type: "tool-input-delta";
  id?: string;
  toolCallId?: string;
  delta?: string;
}

interface AiSdkToolInputEndPart {
  type: "tool-input-end";
  id?: string;
  toolCallId?: string;
}

interface AiSdkToolCallPart {
  type: "tool-call";
  toolCallId?: string;
  toolName?: string;
  // `input` is deliberately not modeled here - see the "tool-call" case in
  // push() for why this adapter never reads it.
}

interface AiSdkToolResultPart {
  type: "tool-result";
  toolCallId?: string;
  toolName?: string;
  // `output`/`result` deliberately not modeled - see the "tool-result" case
  // in push() below. This adapter only cares THAT the SDK's own tool loop
  // already executed the call, never what it returned.
}

interface AiSdkToolErrorPart {
  type: "tool-error";
  toolCallId?: string;
  toolName?: string;
  error?: unknown;
}

interface AiSdkFinishPart {
  type: "finish";
  finishReason?: string;
}

interface AiSdkErrorPart {
  type: "error";
  error?: unknown;
}

interface AiSdkAbortPart {
  type: "abort";
  reason?: string;
}

export type AiSdkStreamPart =
  | AiSdkToolInputStartPart
  | AiSdkToolInputDeltaPart
  | AiSdkToolInputEndPart
  | AiSdkToolCallPart
  | AiSdkToolResultPart
  | AiSdkToolErrorPart
  | AiSdkFinishPart
  | AiSdkErrorPart
  | AiSdkAbortPart
  | { type: string; [key: string]: unknown };

function toolPartId(part: { id?: string; toolCallId?: string }): string | undefined {
  // "tool-input-start"/"tool-input-delta" carry `id`; "tool-input-end" is
  // documented with `toolCallId`. Reading both defensively means this
  // adapter keeps working correlated-by-ID either way, rather than silently
  // dropping events if one part type uses the other field name.
  return part.id ?? part.toolCallId;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export class AiSdkStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "ai-sdk";
  private sequence = 0;
  private finished = false;
  private readonly startedCallKeys = new Set<string>();
  private readonly endedCallKeys = new Set<string>();

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];

    const events: NormalizedToolStreamEvent[] = [];

    if (!rawEvent || typeof rawEvent !== "object") {
      events.push({
        type: "provider_diagnostic",
        sequence: ++this.sequence,
        provider: this.provider,
        code: "E_PROVIDER_EVENT_MALFORMED",
        severity: "error",
        message: "Raw event is not an object",
      });
      return events;
    }

    // A single permissive cast (rather than narrowing the `AiSdkStreamPart`
    // union directly) matches the other adapters in this directory - their
    // catch-all `{ type: string; [key: string]: unknown }` union member
    // means the compiler can never fully exclude it inside a `switch (type)`
    // case, so property access still needs a shape where every field used
    // below is already optional.
    const part = rawEvent as {
      type?: string;
      id?: string;
      toolCallId?: string;
      toolName?: string;
      delta?: string;
      finishReason?: string;
      error?: unknown;
      reason?: string;
    };

    switch (part.type) {
      case "tool-input-start": {
        const id = toolPartId(part);
        if (id === undefined) break;
        this.startedCallKeys.add(`tool-input:${id}`);
        events.push({
          type: "tool_call_start",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey: `tool-input:${id}` },
          toolCallId: id,
          name: part.toolName,
        });
        break;
      }
      case "tool-input-delta": {
        const id = toolPartId(part);
        if (id === undefined || typeof part.delta !== "string") break;
        const sourceKey = `tool-input:${id}`;
        if (!this.startedCallKeys.has(sourceKey)) {
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            code: TOOL_ARGUMENTS_BEFORE_START_DIAGNOSTIC_CODE,
            severity: "error",
            message: "AI SDK tool-input-delta arrived before tool-input-start",
          });
          break;
        }
        if (this.endedCallKeys.has(sourceKey)) {
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
            severity: "error",
            message: "AI SDK tool-input-delta arrived after tool-input-end",
          });
          break;
        }
        events.push({
          type: "tool_call_arguments_delta",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey },
          delta: part.delta,
        });
        break;
      }
      case "tool-input-end": {
        const id = toolPartId(part);
        if (id === undefined) break;
        const sourceKey = `tool-input:${id}`;
        if (!this.startedCallKeys.has(sourceKey)) {
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            code: TOOL_END_BEFORE_START_DIAGNOSTIC_CODE,
            severity: "error",
            message: "AI SDK tool-input-end arrived before tool-input-start",
          });
          break;
        }
        if (this.endedCallKeys.has(sourceKey)) {
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            code: DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
            severity: "error",
            message: "AI SDK emitted duplicate tool-input-end parts for one call",
          });
          break;
        }
        this.endedCallKeys.add(sourceKey);
        events.push({
          type: "tool_call_end",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey },
          reason: "complete", // corrected by the stream-level "finish" part below
        });
        break;
      }
      case "tool-call": {
        // Intentionally a no-op. This part carries the SDK's own resolved
        // `input` for the call, which - per this library's whole reason for
        // existing (see README's Cline / `fixJson` analysis) - may already
        // be silently repaired from a truncated stream. Trusting it here
        // would reintroduce exactly the problem this adapter exists to
        // avoid. The call's real argument text was already captured
        // verbatim from "tool-input-delta" parts above, byte for byte.
        break;
      }
      case "tool-result": {
        // Direct proof the SDK's own tool loop already invoked and completed
        // this call's `execute` callback - see
        // SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE's own docs. This adapter
        // never reads `output`/`result`: the point isn't what the SDK's
        // execution produced, only that execution already happened, which
        // must permanently disqualify this call from an `execute` decision
        // here (DefaultToolCallStreamCoordinator.handleProviderDiagnostic
        // acts on this code). An unattributable result (no id at all) still
        // gets reported - just without a callRef, matching "tool-error"
        // below - rather than silently dropped.
        const id = toolPartId(part);
        events.push({
          type: "provider_diagnostic",
          sequence: ++this.sequence,
          provider: this.provider,
          code: SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
          severity: "error",
          message: `Tool "${part.toolName ?? "unknown"}" was already executed by the AI SDK's own tool loop before this guard reached a decision`,
          ...(id !== undefined ? { callRef: { sourceKey: `tool-input:${id}` } } : {}),
        });
        break;
      }
      case "tool-error": {
        // Also proof the SDK's own tool loop already invoked this call's
        // `execute` callback - it threw, but that does not prove no partial
        // irreversible side effect occurred first. Deliberately the same
        // fail-closed treatment as "tool-result" above: see
        // SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE's own docs.
        const id = toolPartId(part);
        events.push({
          type: "provider_diagnostic",
          sequence: ++this.sequence,
          provider: this.provider,
          code: SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE,
          severity: "error",
          message: `Tool "${part.toolName ?? "unknown"}" reported an error: ${stringifyError(part.error)}`,
          ...(id !== undefined ? { callRef: { sourceKey: `tool-input:${id}` } } : {}),
        });
        break;
      }
      case "finish": {
        const finishReason = part.finishReason;
        let reason: StreamEndReason = "unknown";
        if (finishReason === "stop" || finishReason === "tool-calls") {
          reason = "complete";
        } else if (finishReason === "length") {
          reason = "length";
        } else if (finishReason === "content-filter") {
          // Not a generic cancellation: a policy/safety termination should
          // never be blindly retried. Recorded as its own machine-readable
          // diagnostic so the execution gate can reject with reason
          // "content_filtered" instead of the generic "stream_incomplete"
          // it would otherwise fall back to for a "cancelled" end reason.
          reason = "cancelled";
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            code: CONTENT_FILTERED_DIAGNOSTIC_CODE,
            severity: "error",
            message: "Generation stopped by the model provider's content filter",
          });
        } else if (finishReason === "error") {
          reason = "provider_error";
        }
        // "other" (and any future/unrecognized literal) intentionally falls
        // through to "unknown" - fail closed on an unclassified reason
        // rather than guessing it means "complete".

        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason,
          providerReason: finishReason,
        });
        this.finished = true;
        break;
      }
      case "error": {
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "provider_error",
          providerReason: stringifyError(part.error),
        });
        this.finished = true;
        break;
      }
      case "abort": {
        // Present on fullStream across ai@5/6/7 (verified against published
        // type declarations for ai@5.0.240, ai@6.0.259, ai@7.0.70) - the
        // stream was deliberately stopped (e.g. an AbortSignal), not a
        // provider-side failure or a length/content-filter termination.
        // Without this case it would silently fall through to `default`,
        // leaving `finished` false - the adapter would never learn the
        // stream ended, relying entirely on a caller's own finish() meta as
        // the fail-closed backstop. Handling it explicitly here means an
        // aborted stream is normalized the same way regardless of whether
        // the caller remembers to call finish() with an explicit reason.
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "cancelled",
          providerReason: part.reason,
        });
        this.finished = true;
        break;
      }
      // Unrelated part types (text-delta, reasoning-delta, start,
      // start-step, finish-step, etc.) carry no tool-argument or
      // stream-termination information for our purposes and must not crash
      // the adapter.
      default:
        break;
    }

    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    return [{
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason: meta?.reason ?? "unknown",
      providerReason: meta?.providerReason,
    }];
  }
}
