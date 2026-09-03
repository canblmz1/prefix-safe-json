import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import {
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
} from "../coordinator/diagnostic-codes.js";

interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: {
    type: "input_json_delta";
    partial_json: string;
  };
}

interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: {
    type: "tool_use";
    id: string;
    name: string;
  };
}

interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason?: string | null;
  };
}

export type AnthropicEvent =
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | { type: string; [key: string]: unknown };

export class AnthropicStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "anthropic";
  private sequence = 0;
  private finished = false;
  // Block-local terminal state (P4.2 / F-1): every content-block index that
  // has already received its own content_block_stop. Uses the adapter's
  // existing `content-block:{index}` sourceKey identity - no second
  // identity system. content_block_stop closes the block's argument stream
  // (tool_call_end), but that alone does not stop the coordinator from
  // silently merging a LATER, real content_block_delta for the SAME index
  // into the same still-"collecting" call (handleCallEnd never changes
  // call.status - only finishCall(), called solely from the stream-wide
  // handleStreamEnd(), does that - see coordinator.ts). Recognized argument
  // evidence, and a duplicate content_block_stop itself, for an index
  // already in this set are therefore hardened below instead of merged/
  // silently repeated. Tracks every stopped index regardless of whether it
  // was ever a real tool_use block - content_block_stop carries no
  // content_block field to distinguish that, matching the adapter's own
  // existing behavior of never discriminating by type at stop time.
  private terminatedBlockIndices: Set<number> = new Set();

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    // No `finished` early return here: silently dropping every event after
    // the first terminal meant a late argument delta, a conflicting or
    // duplicate `message_delta` terminal, or a late `error` event that
    // arrived even one raw event late never reached the coordinator at all -
    // not even as a diagnostic - so an already-decided call's authority
    // could never be revoked by it. Every case below that has ITS OWN
    // meaningful post-terminal handling (a genuine argument delta, a second
    // content_block_start/_stop, a second stream-terminal) still fires
    // exactly as if the stream were open; the coordinator's own `isFinished`
    // gate (coordinator.ts's `push()`) is what turns each of those into a
    // sticky, stream-wide AUTHORITY_PROTOCOL_VIOLATION_CODES diagnostic once
    // it actually receives them. Mirrors the fix already applied to
    // AiSdkStreamAdapter for the same invariant (GHSA-3xpw-9694-2xxp).
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

    const chunk = rawEvent as {
      type?: string;
      index: number;
      content_block?: { type?: string; id: string; name: string };
      delta?: { type?: string; partial_json: string; stop_reason: string };
    };

    switch (chunk.type) {
      case "content_block_start": {
        if (chunk.content_block?.type === "tool_use") {
          const sourceKey = `content-block:${chunk.index}`;
          
          events.push({
            type: "tool_call_start",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            toolIndex: chunk.index,
            toolCallId: chunk.content_block.id,
            name: chunk.content_block.name,
          });
        }
        break;
      }
      case "content_block_delta": {
        if (chunk.delta?.type === "input_json_delta" && typeof chunk.delta.partial_json === "string") {
          const sourceKey = `content-block:${chunk.index}`;
          if (this.terminatedBlockIndices.has(chunk.index)) {
            // Block-local post-terminal evidence (P4.2 / F-1): this exact
            // block already recorded its own content_block_stop. Never
            // merge further argument evidence as normal - that would
            // silently mutate (and, if left structurally unclosed at stop
            // time, silently CLOSE) an already-ended block's value with no
            // record of the anomaly. Same diagnostic code
            // AiSdkStreamAdapter/OpenAICompatibleStreamAdapter/
            // OpenAIStreamAdapter already use for materially identical
            // semantics ("tool argument evidence arrived after that call's
            // end"), attributed to the block's own real, already-
            // tool_call_start'd sourceKey so the coordinator resolves it to
            // the actual call, not a phantom identity.
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey },
              code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
              severity: "error",
              message: `Tool call argument evidence for content block ${chunk.index} arrived after that block's own content_block_stop`,
            });
          } else {
            events.push({
              type: "tool_call_arguments_delta",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey },
              delta: chunk.delta.partial_json,
            });
          }
        }
        break;
      }
      case "content_block_stop": {
        const sourceKey = `content-block:${chunk.index}`;
        if (this.terminatedBlockIndices.has(chunk.index)) {
          // Duplicate content_block_stop for the same index (P4.2 / Phase
          // 7): pre-fix this silently re-emitted a second tool_call_end,
          // which coordinator.ts's handleCallEnd() tolerates idempotently
          // (it only sets two already-true booleans again) - authority-safe
          // but tolerated: the duplicate did not create or increase
          // execution authority, but it was silently accepted and did not
          // itself disqualify the call, so an otherwise-valid call could
          // still execute once a later, genuine terminal arrived. The
          // adapter now records the duplicate as DUPLICATE_TOOL_END and
          // therefore fails that call closed instead - genuinely a
          // repeated end signal for the same call, exactly
          // DUPLICATE_TOOL_END_DIAGNOSTIC_CODE's own documented meaning
          // ("more than one end part for the same call") and
          // AUTHORITY_PROTOCOL_VIOLATION_CODES membership - reused rather
          // than inventing a new code.
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            code: DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
            severity: "error",
            message: `content block ${chunk.index} received a second content_block_stop`,
          });
          break;
        }
        this.terminatedBlockIndices.add(chunk.index);
        events.push({
          type: "tool_call_end",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey },
          reason: "complete", // Default to complete, message_delta might adjust stream level
        });
        break;
      }
      case "message_delta": {
        if (chunk.delta?.stop_reason) {
          const sr = chunk.delta.stop_reason;
          let reason: StreamEndReason = "unknown";
          if (sr === "end_turn" || sr === "tool_use") {
             reason = "complete";
          } else if (sr === "max_tokens") {
             reason = "length";
          }
          
          events.push({
            type: "provider_stream_end",
            sequence: ++this.sequence,
            provider: this.provider,
            reason,
            providerReason: sr,
          });
          this.finished = true;
        }
        break;
      }
      case "error": {
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "provider_error",
          providerReason: "error_event",
        });
        this.finished = true;
        break;
      }
      // Unknown metadata events must not crash the adapter.
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
